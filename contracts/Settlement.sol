// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title Settlement - 链上清算合约
 * @dev 处理链下撮合后的批量清算，支持EIP-712签名验证
 */
contract Settlement is 
    Initializable, 
    EIP712,
    OwnableUpgradeable, 
    PausableUpgradeable, 
    ReentrancyGuardUpgradeable 
{
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // 订单结构（EIP-712）
    struct Order {
        address userAddress;
        string tradingPair;
        address baseToken;
        address quoteToken;
        uint8 side; // 0: buy, 1: sell
        uint8 orderType; // 0: limit, 1: market, 2: stop_loss, 3: take_profit
        uint256 price;
        uint256 amount;
        uint256 expiresAt;
        uint256 nonce;
    }

    // 成交结构
    struct Fill {
        bytes32 takerOrderHash;
        bytes32 makerOrderHash;
        uint256 price;
        uint256 amount;
        uint8 takerSide;
    }

    // 批量结算参数
    struct BatchSettlement {
        Order[] takerOrders;
        Order[] makerOrders;
        bytes[] takerSignatures;
        bytes[] makerSignatures;
        Fill[] fills;
    }

    // EIP-712 类型哈希
    bytes32 private constant ORDER_TYPEHASH = keccak256(
        "Order(address userAddress,string tradingPair,address baseToken,address quoteToken,uint8 side,uint8 orderType,uint256 price,uint256 amount,uint256 expiresAt,uint256 nonce)"
    );

    // 状态变量
    mapping(address => mapping(address => uint256)) public userBalances;
    mapping(address => uint256) public userNonces;
    mapping(bytes32 => bool) public settledOrders;
    mapping(address => uint256) public collectedFees;
    
    uint256 public makerFee; // 做市商费率（基点）
    uint256 public takerFee; // 吃单者费率（基点）
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant MAX_FEE = 500; // 最大5%
    
    address public feeRecipient;
    address public operator; // 可执行批量结算的操作员
    
    uint256 public emergencyWithdrawalDelay;
    mapping(address => uint256) public emergencyWithdrawalRequests;

    // 事件
    event Deposit(address indexed user, address indexed token, uint256 amount);
    event Withdrawal(address indexed user, address indexed token, uint256 amount);
    event BatchSettlementExecuted(
        uint256 indexed batchId,
        uint256 fillCount,
        uint256 totalVolume
    );
    event TradeExecuted(
        bytes32 indexed takerOrderHash,
        bytes32 indexed makerOrderHash,
        address indexed takerAddress,
        address makerAddress,
        address baseToken,
        address quoteToken,
        uint256 price,
        uint256 amount,
        uint8 takerSide
    );
    event EmergencyWithdrawalRequested(address indexed user, uint256 timestamp);
    event EmergencyWithdrawalExecuted(address indexed user, address indexed token, uint256 amount);
    
    modifier onlyOperator() {
        require(msg.sender == operator || msg.sender == owner(), "Unauthorized operator");
        _;
    }

    function initialize(
        address _feeRecipient,
        address _operator
    ) public initializer {
        __EIP712_init("OrderBook DEX", "1.0");
        __Ownable_init(msg.sender);
        __Pausable_init();
        __ReentrancyGuard_init();
        
        feeRecipient = _feeRecipient;
        operator = _operator;
        makerFee = 10; // 0.1%
        takerFee = 25; // 0.25%
        emergencyWithdrawalDelay = 24 hours;
    }

    /**
     * @dev 存入代币
     */
    function deposit(address token, uint256 amount) external whenNotPaused nonReentrant {
        require(token != address(0), "Invalid token");
        require(amount > 0, "Invalid amount");
        
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        userBalances[msg.sender][token] += amount;
        
        emit Deposit(msg.sender, token, amount);
    }

    /**
     * @dev 提取代币
     */
    function withdraw(address token, uint256 amount) external whenNotPaused nonReentrant {
        require(token != address(0), "Invalid token");
        require(amount > 0, "Invalid amount");
        require(userBalances[msg.sender][token] >= amount, "Insufficient balance");
        
        userBalances[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        
        emit Withdrawal(msg.sender, token, amount);
    }

    /**
     * @dev 批量结算交易
     */
    function batchSettle(
        BatchSettlement calldata settlement
    ) external onlyOperator whenNotPaused nonReentrant {
        require(settlement.fills.length > 0, "No fills to settle");
        require(
            settlement.takerOrders.length == settlement.takerSignatures.length &&
            settlement.makerOrders.length == settlement.makerSignatures.length,
            "Mismatched arrays"
        );

        uint256 batchId = uint256(keccak256(abi.encode(block.timestamp, settlement.fills.length)));
        uint256 totalVolume = 0;

        for (uint256 i = 0; i < settlement.fills.length; i++) {
            Fill memory fill = settlement.fills[i];
            
            // 验证和执行单个成交
            (Order memory takerOrder, Order memory makerOrder) = _findOrders(
                fill.takerOrderHash,
                fill.makerOrderHash,
                settlement
            );

            _verifyAndExecuteFill(takerOrder, makerOrder, fill, settlement);
            totalVolume += fill.amount;
        }

        emit BatchSettlementExecuted(batchId, settlement.fills.length, totalVolume);
    }

    /**
     * @dev 查找订单
     */
    function _findOrders(
        bytes32 takerHash,
        bytes32 makerHash,
        BatchSettlement calldata settlement
    ) private pure returns (Order memory takerOrder, Order memory makerOrder) {
        // 查找taker订单
        for (uint256 i = 0; i < settlement.takerOrders.length; i++) {
            if (_hashOrder(settlement.takerOrders[i]) == takerHash) {
                takerOrder = settlement.takerOrders[i];
                break;
            }
        }
        
        // 查找maker订单
        for (uint256 i = 0; i < settlement.makerOrders.length; i++) {
            if (_hashOrder(settlement.makerOrders[i]) == makerHash) {
                makerOrder = settlement.makerOrders[i];
                break;
            }
        }
        
        require(takerOrder.userAddress != address(0), "Taker order not found");
        require(makerOrder.userAddress != address(0), "Maker order not found");
    }

    /**
     * @dev 验证和执行成交
     */
    function _verifyAndExecuteFill(
        Order memory takerOrder,
        Order memory makerOrder,
        Fill memory fill,
        BatchSettlement calldata settlement
    ) private {
        // 计算订单哈希
        bytes32 takerHash = _hashOrder(takerOrder);
        bytes32 makerHash = _hashOrder(makerOrder);
        
        require(!settledOrders[takerHash], "Taker order already settled");
        require(!settledOrders[makerHash], "Maker order already settled");
        
        // 验证签名
        _verifyOrderSignature(takerOrder, takerHash, _findSignature(takerHash, settlement, true));
        _verifyOrderSignature(makerOrder, makerHash, _findSignature(makerHash, settlement, false));
        
        // 验证订单匹配条件
        _validateOrderMatch(takerOrder, makerOrder, fill);
        
        // 验证用户nonce
        require(userNonces[takerOrder.userAddress] == takerOrder.nonce, "Invalid taker nonce");
        require(userNonces[makerOrder.userAddress] == makerOrder.nonce, "Invalid maker nonce");
        
        // 执行结算
        _executeFill(takerOrder, makerOrder, fill);
        
        // 更新状态
        settledOrders[takerHash] = true;
        settledOrders[makerHash] = true;
        userNonces[takerOrder.userAddress]++;
        userNonces[makerOrder.userAddress]++;
        
        emit TradeExecuted(
            takerHash,
            makerHash,
            takerOrder.userAddress,
            makerOrder.userAddress,
            takerOrder.baseToken,
            takerOrder.quoteToken,
            fill.price,
            fill.amount,
            fill.takerSide
        );
    }

    /**
     * @dev 执行成交结算
     */
    function _executeFill(
        Order memory takerOrder,
        Order memory makerOrder,
        Fill memory fill
    ) private {
        uint256 quoteAmount = (fill.amount * fill.price) / 1e18;
        
        uint256 takerFeeAmount;
        uint256 makerFeeAmount;
        
        if (fill.takerSide == 0) { // Taker买入
            // 计算费用
            takerFeeAmount = (quoteAmount * takerFee) / BASIS_POINTS;
            makerFeeAmount = (fill.amount * makerFee) / BASIS_POINTS;
            
            // 验证余额
            require(
                userBalances[takerOrder.userAddress][takerOrder.quoteToken] >= quoteAmount + takerFeeAmount,
                "Insufficient taker quote balance"
            );
            require(
                userBalances[makerOrder.userAddress][takerOrder.baseToken] >= fill.amount + makerFeeAmount,
                "Insufficient maker base balance"
            );
            
            // 转账
            userBalances[takerOrder.userAddress][takerOrder.quoteToken] -= (quoteAmount + takerFeeAmount);
            userBalances[takerOrder.userAddress][takerOrder.baseToken] += fill.amount;
            
            userBalances[makerOrder.userAddress][takerOrder.baseToken] -= (fill.amount + makerFeeAmount);
            userBalances[makerOrder.userAddress][takerOrder.quoteToken] += quoteAmount;
            
            // 收取费用
            collectedFees[takerOrder.quoteToken] += takerFeeAmount;
            collectedFees[takerOrder.baseToken] += makerFeeAmount;
            
        } else { // Taker卖出
            // 计算费用
            takerFeeAmount = (fill.amount * takerFee) / BASIS_POINTS;
            makerFeeAmount = (quoteAmount * makerFee) / BASIS_POINTS;
            
            // 验证余额
            require(
                userBalances[takerOrder.userAddress][takerOrder.baseToken] >= fill.amount + takerFeeAmount,
                "Insufficient taker base balance"
            );
            require(
                userBalances[makerOrder.userAddress][takerOrder.quoteToken] >= quoteAmount + makerFeeAmount,
                "Insufficient maker quote balance"
            );
            
            // 转账
            userBalances[takerOrder.userAddress][takerOrder.baseToken] -= (fill.amount + takerFeeAmount);
            userBalances[takerOrder.userAddress][takerOrder.quoteToken] += quoteAmount;
            
            userBalances[makerOrder.userAddress][takerOrder.quoteToken] -= (quoteAmount + makerFeeAmount);
            userBalances[makerOrder.userAddress][takerOrder.baseToken] += fill.amount;
            
            // 收取费用
            collectedFees[takerOrder.baseToken] += takerFeeAmount;
            collectedFees[takerOrder.quoteToken] += makerFeeAmount;
        }
    }

    /**
     * @dev 验证订单匹配条件
     */
    function _validateOrderMatch(
        Order memory takerOrder,
        Order memory makerOrder,
        Fill memory fill
    ) private view {
        require(
            keccak256(bytes(takerOrder.tradingPair)) == keccak256(bytes(makerOrder.tradingPair)),
            "Trading pair mismatch"
        );
        require(takerOrder.baseToken == makerOrder.baseToken, "Base token mismatch");
        require(takerOrder.quoteToken == makerOrder.quoteToken, "Quote token mismatch");
        require(takerOrder.side != makerOrder.side, "Same side orders");
        
        // 验证价格匹配
        if (takerOrder.side == 0) { // Taker买入
            require(takerOrder.price >= fill.price, "Taker price too low");
            require(makerOrder.price <= fill.price, "Maker price too high");
        } else { // Taker卖出
            require(takerOrder.price <= fill.price, "Taker price too high");
            require(makerOrder.price >= fill.price, "Maker price too low");
        }
        
        // 验证过期时间
        if (takerOrder.expiresAt > 0) {
            require(block.timestamp <= takerOrder.expiresAt, "Taker order expired");
        }
        if (makerOrder.expiresAt > 0) {
            require(block.timestamp <= makerOrder.expiresAt, "Maker order expired");
        }
    }

    /**
     * @dev 查找签名
     */
    function _findSignature(
        bytes32 orderHash,
        BatchSettlement calldata settlement,
        bool isTaker
    ) private pure returns (bytes memory) {
        Order[] memory orders = isTaker ? settlement.takerOrders : settlement.makerOrders;
        bytes[] memory signatures = isTaker ? settlement.takerSignatures : settlement.makerSignatures;
        
        for (uint256 i = 0; i < orders.length; i++) {
            if (_hashOrder(orders[i]) == orderHash) {
                return signatures[i];
            }
        }
        revert("Signature not found");
    }

    /**
     * @dev 验证订单签名
     */
    function _verifyOrderSignature(
        Order memory order,
        bytes32 orderHash,
        bytes memory signature
    ) private view {
        bytes32 digest = _hashTypedDataV4(orderHash);
        address signer = digest.recover(signature);
        require(signer == order.userAddress, "Invalid signature");
    }

    /**
     * @dev 计算订单哈希
     */
    function _hashOrder(Order memory order) private pure returns (bytes32) {
        return keccak256(abi.encode(
            ORDER_TYPEHASH,
            order.userAddress,
            keccak256(bytes(order.tradingPair)),
            order.baseToken,
            order.quoteToken,
            order.side,
            order.orderType,
            order.price,
            order.amount,
            order.expiresAt,
            order.nonce
        ));
    }

    /**
     * @dev 紧急提款请求
     */
    function requestEmergencyWithdrawal() external {
        emergencyWithdrawalRequests[msg.sender] = block.timestamp;
        emit EmergencyWithdrawalRequested(msg.sender, block.timestamp);
    }

    /**
     * @dev 执行紧急提款
     */
    function executeEmergencyWithdrawal(address token) external nonReentrant {
        require(emergencyWithdrawalRequests[msg.sender] > 0, "No emergency request");
        require(
            block.timestamp >= emergencyWithdrawalRequests[msg.sender] + emergencyWithdrawalDelay,
            "Emergency delay not met"
        );
        
        uint256 balance = userBalances[msg.sender][token];
        require(balance > 0, "No balance to withdraw");
        
        userBalances[msg.sender][token] = 0;
        emergencyWithdrawalRequests[msg.sender] = 0;
        
        IERC20(token).safeTransfer(msg.sender, balance);
        
        emit EmergencyWithdrawalExecuted(msg.sender, token, balance);
    }

    /**
     * @dev 管理员功能
     */
    function setFees(uint256 _makerFee, uint256 _takerFee) external onlyOwner {
        require(_makerFee <= MAX_FEE && _takerFee <= MAX_FEE, "Fee too high");
        makerFee = _makerFee;
        takerFee = _takerFee;
    }

    function setOperator(address _operator) external onlyOwner {
        require(_operator != address(0), "Invalid operator");
        operator = _operator;
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "Invalid fee recipient");
        feeRecipient = _feeRecipient;
    }

    function collectFees(address token) external onlyOwner nonReentrant {
        uint256 amount = collectedFees[token];
        require(amount > 0, "No fees to collect");
        
        collectedFees[token] = 0;
        IERC20(token).safeTransfer(feeRecipient, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev 查询函数
     */
    function getUserBalance(address user, address token) external view returns (uint256) {
        return userBalances[user][token];
    }

    function getUserNonce(address user) external view returns (uint256) {
        return userNonces[user];
    }

    function isOrderSettled(bytes32 orderHash) external view returns (bool) {
        return settledOrders[orderHash];
    }
}