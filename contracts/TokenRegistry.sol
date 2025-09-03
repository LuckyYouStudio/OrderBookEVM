// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title TokenRegistry
 * @dev 代币注册表合约，管理支持的代币和交易对
 * 提供代币白名单、交易对配置、KYC验证等功能
 */
contract TokenRegistry is 
    Initializable, 
    AccessControlUpgradeable, 
    PausableUpgradeable 
{
    // 角色定义
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");     // 管理员角色
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE"); // 操作员角色
    
    /**
     * @dev 代币信息结构体
     */
    struct TokenInfo {
        bool isActive;                // 是否激活
        uint8 decimals;               // 小数位数
        string symbol;                // 代币符号
        string name;                  // 代币名称
        uint256 minOrderSize;         // 最小订单规模
        uint256 maxOrderSize;         // 最大订单规模
        uint256 dailyVolumeLimit;     // 每日交易量限制
        uint256 currentDailyVolume;   // 当前日交易量
        uint256 lastVolumeResetTime;  // 上次重置时间
        bool requiresKYC;             // 是否需要KYC
    }
    
    /**
     * @dev 交易对信息结构体
     */
    struct TradingPair {
        bool isActive;               // 是否激活
        uint256 minPrice;            // 最低价格
        uint256 maxPrice;            // 最高价格
        uint256 tickSize;            // 价格最小变动单位
        uint256 makerFeeOverride;    // 做市商费率覆盖
        uint256 takerFeeOverride;    // 吃单者费率覆盖
        bool useFeeOverride;         // 是否使用费率覆盖
    }
    
    // 代币地址到代币信息的映射
    mapping(address => TokenInfo) public tokens;
    // 交易对映射：tokenA => tokenB => 交易对信息
    mapping(address => mapping(address => TradingPair)) public tradingPairs;
    
    // 已注册代币列表
    address[] public tokenList;
    // 代币是否已上市
    mapping(address => bool) public isListed;
    
    // 用户KYC验证状态
    mapping(address => bool) public kycVerified;
    
    event TokenAdded(
        address indexed token,
        string symbol,
        string name,
        uint8 decimals
    );
    
    event TokenUpdated(address indexed token, bool isActive);
    
    event TradingPairAdded(
        address indexed tokenA,
        address indexed tokenB,
        uint256 minPrice,
        uint256 maxPrice
    );
    
    event TradingPairUpdated(
        address indexed tokenA,
        address indexed tokenB,
        bool isActive
    );
    
    event KYCStatusUpdated(address indexed user, bool verified);
    
    /**
     * @dev 初始化函数
     * 设置初始角色权限
     */
    function initialize() public initializer {
        __AccessControl_init();
        __Pausable_init();
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }
    
    /**
     * @dev 添加新代币到注册表
     * @param token 代币地址
     * @param minOrderSize 最小订单规模
     * @param maxOrderSize 最大订单规模
     * @param dailyVolumeLimit 每日交易量限制
     * @param requiresKYC 是否需要KYC验证
     */
    function addToken(
        address token,
        uint256 minOrderSize,
        uint256 maxOrderSize,
        uint256 dailyVolumeLimit,
        bool requiresKYC
    ) external onlyRole(ADMIN_ROLE) {
        require(token != address(0), "Invalid token address");
        require(!isListed[token], "Token already listed");
        require(minOrderSize > 0, "Invalid min order size");
        require(maxOrderSize > minOrderSize, "Invalid max order size");
        
        IERC20Metadata tokenContract = IERC20Metadata(token);
        
        tokens[token] = TokenInfo({
            isActive: true,
            decimals: tokenContract.decimals(),
            symbol: tokenContract.symbol(),
            name: tokenContract.name(),
            minOrderSize: minOrderSize,
            maxOrderSize: maxOrderSize,
            dailyVolumeLimit: dailyVolumeLimit,
            currentDailyVolume: 0,
            lastVolumeResetTime: block.timestamp,
            requiresKYC: requiresKYC
        });
        
        tokenList.push(token);
        isListed[token] = true;
        
        emit TokenAdded(
            token,
            tokens[token].symbol,
            tokens[token].name,
            tokens[token].decimals
        );
    }
    
    /**
     * @dev 更新代币状态
     * @param token 代币地址
     * @param isActive 是否激活
     */
    function updateTokenStatus(
        address token,
        bool isActive
    ) external onlyRole(OPERATOR_ROLE) {
        require(isListed[token], "Token not listed");
        tokens[token].isActive = isActive;
        emit TokenUpdated(token, isActive);
    }
    
    /**
     * @dev 更新代币交易限制
     * @param token 代币地址
     * @param minOrderSize 新的最小订单规模
     * @param maxOrderSize 新的最大订单规模
     * @param dailyVolumeLimit 新的每日交易量限制
     */
    function updateTokenLimits(
        address token,
        uint256 minOrderSize,
        uint256 maxOrderSize,
        uint256 dailyVolumeLimit
    ) external onlyRole(ADMIN_ROLE) {
        require(isListed[token], "Token not listed");
        require(minOrderSize > 0, "Invalid min order size");
        require(maxOrderSize > minOrderSize, "Invalid max order size");
        
        TokenInfo storage tokenInfo = tokens[token];
        tokenInfo.minOrderSize = minOrderSize;
        tokenInfo.maxOrderSize = maxOrderSize;
        tokenInfo.dailyVolumeLimit = dailyVolumeLimit;
    }
    
    /**
     * @dev 添加新交易对
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param minPrice 最低价格
     * @param maxPrice 最高价格
     * @param tickSize 价格最小变动单位
     */
    function addTradingPair(
        address tokenA,
        address tokenB,
        uint256 minPrice,
        uint256 maxPrice,
        uint256 tickSize
    ) external onlyRole(ADMIN_ROLE) {
        require(isListed[tokenA] && isListed[tokenB], "Token not listed");
        require(tokenA != tokenB, "Same token");
        require(minPrice > 0 && maxPrice > minPrice, "Invalid price range");
        require(tickSize > 0, "Invalid tick size");
        
        // 设置正向交易对
        tradingPairs[tokenA][tokenB] = TradingPair({
            isActive: true,
            minPrice: minPrice,
            maxPrice: maxPrice,
            tickSize: tickSize,
            makerFeeOverride: 0,
            takerFeeOverride: 0,
            useFeeOverride: false
        });
        
        // 设置反向交易对（价格倒数）
        tradingPairs[tokenB][tokenA] = TradingPair({
            isActive: true,
            minPrice: 1e36 / maxPrice,  // 反向交易对的最低价是正向最高价的倒数
            maxPrice: 1e36 / minPrice,  // 反向交易对的最高价是正向最低价的倒数
            tickSize: tickSize,
            makerFeeOverride: 0,
            takerFeeOverride: 0,
            useFeeOverride: false
        });
        
        emit TradingPairAdded(tokenA, tokenB, minPrice, maxPrice);
    }
    
    /**
     * @dev 更新交易对状态
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param isActive 是否激活
     */
    function updateTradingPairStatus(
        address tokenA,
        address tokenB,
        bool isActive
    ) external onlyRole(OPERATOR_ROLE) {
        tradingPairs[tokenA][tokenB].isActive = isActive;
        tradingPairs[tokenB][tokenA].isActive = isActive;
        emit TradingPairUpdated(tokenA, tokenB, isActive);
    }
    
    /**
     * @dev 设置交易对费率覆盖
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param makerFee 做市商费率（基点）
     * @param takerFee 吃单者费率（基点）
     * @param useFeeOverride 是否启用费率覆盖
     */
    function setTradingPairFees(
        address tokenA,
        address tokenB,
        uint256 makerFee,
        uint256 takerFee,
        bool useFeeOverride
    ) external onlyRole(ADMIN_ROLE) {
        require(makerFee <= 500 && takerFee <= 500, "Fee too high");
        
        TradingPair storage pair = tradingPairs[tokenA][tokenB];
        pair.makerFeeOverride = makerFee;
        pair.takerFeeOverride = takerFee;
        pair.useFeeOverride = useFeeOverride;
        
        TradingPair storage reversePair = tradingPairs[tokenB][tokenA];
        reversePair.makerFeeOverride = makerFee;
        reversePair.takerFeeOverride = takerFee;
        reversePair.useFeeOverride = useFeeOverride;
    }
    
    /**
     * @dev 更新用户KYC状态
     * @param user 用户地址
     * @param verified 是否通过KYC验证
     */
    function updateKYCStatus(
        address user,
        bool verified
    ) external onlyRole(OPERATOR_ROLE) {
        kycVerified[user] = verified;
        emit KYCStatusUpdated(user, verified);
    }
    
    /**
     * @dev 批量更新KYC状态
     * @param users 用户地址数组
     * @param statuses KYC状态数组
     */
    function batchUpdateKYCStatus(
        address[] calldata users,
        bool[] calldata statuses
    ) external onlyRole(OPERATOR_ROLE) {
        require(users.length == statuses.length, "Length mismatch");
        require(users.length <= 100, "Batch too large");
        
        for (uint256 i = 0; i < users.length; i++) {
            kycVerified[users[i]] = statuses[i];
            emit KYCStatusUpdated(users[i], statuses[i]);
        }
    }
    
    /**
     * @dev 验证订单是否有效
     * @param trader 交易者地址
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param amount 订单数量
     * @param price 订单价格
     * @return valid 是否有效
     * @return reason 无效原因
     */
    function isValidOrder(
        address trader,
        address tokenA,
        address tokenB,
        uint256 amount,
        uint256 price
    ) external view returns (bool valid, string memory reason) {
        if (!tokens[tokenA].isActive) {
            return (false, "TokenA not active");
        }
        
        if (!tokens[tokenB].isActive) {
            return (false, "TokenB not active");
        }
        
        if (!tradingPairs[tokenA][tokenB].isActive) {
            return (false, "Trading pair not active");
        }
        
        TokenInfo memory tokenInfo = tokens[tokenA];
        
        if (tokenInfo.requiresKYC && !kycVerified[trader]) {
            return (false, "KYC required");
        }
        
        if (amount < tokenInfo.minOrderSize) {
            return (false, "Below minimum order size");
        }
        
        if (amount > tokenInfo.maxOrderSize) {
            return (false, "Above maximum order size");
        }
        
        TradingPair memory pair = tradingPairs[tokenA][tokenB];
        
        if (price < pair.minPrice) {
            return (false, "Price below minimum");
        }
        
        if (price > pair.maxPrice) {
            return (false, "Price above maximum");
        }
        
        if (price % pair.tickSize != 0) {
            return (false, "Invalid price tick");
        }
        
        return (true, "");
    }
    
    /**
     * @dev 更新代币日交易量
     * @param token 代币地址
     * @param volume 交易量
     */
    function updateDailyVolume(
        address token,
        uint256 volume
    ) external onlyRole(OPERATOR_ROLE) {
        TokenInfo storage tokenInfo = tokens[token];
        
        // 如果距离上次重置超过1天，重置日交易量
        if (block.timestamp >= tokenInfo.lastVolumeResetTime + 1 days) {
            tokenInfo.currentDailyVolume = volume;
            tokenInfo.lastVolumeResetTime = block.timestamp;
        } else {
            // 累加到当前日交易量
            tokenInfo.currentDailyVolume += volume;
        }
        
        require(
            tokenInfo.dailyVolumeLimit == 0 || 
            tokenInfo.currentDailyVolume <= tokenInfo.dailyVolumeLimit,
            "Daily volume limit exceeded"
        );
    }
    
    /**
     * @dev 获取所有注册代币列表
     * @return 代币地址数组
     */
    function getTokenList() external view returns (address[] memory) {
        return tokenList;
    }
    
    /**
     * @dev 获取所有激活代币列表
     * @return 激活代币地址数组
     */
    function getActiveTokens() external view returns (address[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokens[tokenList[i]].isActive) {
                activeCount++;
            }
        }
        
        address[] memory activeTokens = new address[](activeCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokens[tokenList[i]].isActive) {
                activeTokens[index] = tokenList[i];
                index++;
            }
        }
        
        return activeTokens;
    }
    
    /**
     * @dev 获取交易对详细信息
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @return isActive 是否激活
     * @return minPrice 最低价格
     * @return maxPrice 最高价格
     * @return tickSize 价格最小变动单位
     * @return makerFee 做市商费率
     * @return takerFee 吃单者费率
     */
    function getTradingPairInfo(
        address tokenA,
        address tokenB
    ) external view returns (
        bool isActive,
        uint256 minPrice,
        uint256 maxPrice,
        uint256 tickSize,
        uint256 makerFee,
        uint256 takerFee
    ) {
        TradingPair memory pair = tradingPairs[tokenA][tokenB];
        return (
            pair.isActive,
            pair.minPrice,
            pair.maxPrice,
            pair.tickSize,
            pair.useFeeOverride ? pair.makerFeeOverride : 0,
            pair.useFeeOverride ? pair.takerFeeOverride : 0
        );
    }
    
    /**
     * @dev 暂停合约
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    /**
     * @dev 恢复合约
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
}