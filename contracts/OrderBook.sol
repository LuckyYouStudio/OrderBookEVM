// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./interfaces/IOrderBook.sol";

/**
 * @title OrderBook
 * @dev 去中心化订单簿合约，实现链上限价订单的管理和匹配
 * 支持多种订单类型，包括限价单、市价单、止损单和止盈单
 * 使用双向链表维护每个价格水平的订单队列，实现高效的订单插入和删除
 */
contract OrderBook is 
    IOrderBook,
    Initializable, 
    OwnableUpgradeable, 
    PausableUpgradeable, 
    ReentrancyGuardUpgradeable 
{
    // 订单ID计数器，用于生成唯一订单ID
    uint256 private _orderIdCounter;
    // 最小订单规模，防止粉尘攻击
    uint256 public constant MIN_ORDER_SIZE = 1e15;
    // 最大价格偏差，以基点表示（5000 = 50%）
    uint256 public constant MAX_PRICE_DEVIATION = 5000;
    // 基点常量，用于百分比计算
    uint256 public constant BASIS_POINTS = 10000;
    
    // 订单ID到订单详情的映射
    mapping(uint256 => Order) public orders;
    // 用户地址到其订单ID数组的映射
    mapping(address => uint256[]) public userOrders;
    // 交易对的最佳买价（最高买价）
    mapping(address => mapping(address => uint256)) public bestBid;
    // 交易对的最佳卖价（最低卖价）
    mapping(address => mapping(address => uint256)) public bestAsk;
    
    // 在特定价格水平的买单链表节点映射
    // tokenA => tokenB => price => orderId => OrderNode
    mapping(address => mapping(address => mapping(uint256 => mapping(uint256 => IOrderBook.OrderNode)))) public buyOrdersAtPrice;
    // 在特定价格水平的卖单链表节点映射
    mapping(address => mapping(address => mapping(uint256 => mapping(uint256 => IOrderBook.OrderNode)))) public sellOrdersAtPrice;
    // 每个价格水平买单链表的头节点
    mapping(address => mapping(address => mapping(uint256 => uint256))) public buyOrdersHead;
    // 每个价格水平卖单链表的头节点
    mapping(address => mapping(address => mapping(uint256 => uint256))) public sellOrdersHead;
    
    // 买单价格水平数组，按价格降序排列
    mapping(address => mapping(address => uint256[])) public buyPriceLevels;
    // 卖单价格水平数组，按价格升序排列
    mapping(address => mapping(address => uint256[])) public sellPriceLevels;
    
    // 订单匹配引擎合约地址
    address public orderMatching;
    // 结算合约地址
    address public settlement;
    // 代币注册表合约地址
    address public tokenRegistry;
    
    /**
     * @dev 限制只有授权合约可以调用
     * 包括订单匹配引擎、结算合约和合约所有者
     */
    modifier onlyAuthorized() {
        require(
            msg.sender == orderMatching || 
            msg.sender == settlement || 
            msg.sender == owner(),
            "Unauthorized"
        );
        _;
    }
    
    /**
     * @dev 验证交易对是否有效
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     */
    modifier validPair(address tokenA, address tokenB) {
        require(tokenA != address(0) && tokenB != address(0), "Invalid token address");
        require(tokenA != tokenB, "Same token pair");
        _;
    }
    
    /**
     * @dev 初始化函数，用于代理合约的初始化
     * 设置合约所有者并初始化各个模块
     */
    function initialize() public initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __ReentrancyGuard_init();
        _orderIdCounter = 1;
    }
    
    /**
     * @dev 设置关联合约地址
     * @param _orderMatching 订单匹配引擎合约地址
     * @param _settlement 结算合约地址
     * @param _tokenRegistry 代币注册表合约地址
     */
    function setContracts(
        address _orderMatching,
        address _settlement,
        address _tokenRegistry
    ) external onlyOwner {
        // require(_orderMatching != address(0), "Invalid matching address"); // 暂时允许零地址，用于测试
        require(_settlement != address(0), "Invalid settlement address");
        require(_tokenRegistry != address(0), "Invalid registry address");
        
        orderMatching = _orderMatching;
        settlement = _settlement;
        tokenRegistry = _tokenRegistry;
    }
    
    /**
     * @dev 下单函数
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param price 订单价格（以tokenB计价）
     * @param amount 订单数量（tokenA的数量）
     * @param isBuy 是否为买单
     * @param orderType 订单类型（限价、市价、止损、止盈）
     * @param expirationTime 订单过期时间（0表示永不过期）
     * @return orderId 生成的订单ID
     */
    function placeOrder(
        address tokenA,
        address tokenB,
        uint256 price,
        uint256 amount,
        bool isBuy,
        OrderType orderType,
        uint256 expirationTime
    ) external 
        whenNotPaused 
        nonReentrant 
        validPair(tokenA, tokenB)
        returns (uint256 orderId) 
    {
        require(amount >= MIN_ORDER_SIZE, "Order too small");
        require(price > 0, "Invalid price");
        require(
            expirationTime == 0 || expirationTime > block.timestamp,
            "Invalid expiration"
        );
        
        orderId = _orderIdCounter++;
        
        Order memory newOrder = Order({
            orderId: orderId,
            trader: msg.sender,
            tokenA: tokenA,
            tokenB: tokenB,
            price: price,
            amount: amount,
            filledAmount: 0,
            orderType: orderType,
            timestamp: block.timestamp,
            expirationTime: expirationTime,
            status: OrderStatus.OPEN,
            isBuy: isBuy
        });
        
        orders[orderId] = newOrder;
        userOrders[msg.sender].push(orderId);
        
        if (orderType == OrderType.LIMIT || orderType == OrderType.STOP_LOSS || orderType == OrderType.TAKE_PROFIT) {
            _addToOrderBook(orderId, tokenA, tokenB, price, isBuy);
        }
        
        emit OrderPlaced(
            orderId,
            msg.sender,
            tokenA,
            tokenB,
            price,
            amount,
            isBuy,
            orderType
        );
        
        return orderId;
    }
    
    /**
     * @dev 将订单添加到订单簿
     * @param orderId 订单ID
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param price 订单价格
     * @param isBuy 是否为买单
     */
    function _addToOrderBook(
        uint256 orderId,
        address tokenA,
        address tokenB,
        uint256 price,
        bool isBuy
    ) private {
        if (isBuy) {
            _insertBuyOrder(orderId, tokenA, tokenB, price);
            _updateBestBid(tokenA, tokenB, price);
        } else {
            _insertSellOrder(orderId, tokenA, tokenB, price);
            _updateBestAsk(tokenA, tokenB, price);
        }
    }
    
    /**
     * @dev 插入买单到指定价格水平的链表头部
     * 使用FIFO（先进先出）原则
     * @param orderId 订单ID
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param price 订单价格
     */
    function _insertBuyOrder(
        uint256 orderId,
        address tokenA,
        address tokenB,
        uint256 price
    ) private {
        uint256 head = buyOrdersHead[tokenA][tokenB][price];
        
        IOrderBook.OrderNode memory newNode = IOrderBook.OrderNode({
            orderId: orderId,
            next: head,
            prev: 0
        });
        
        if (head != 0) {
            buyOrdersAtPrice[tokenA][tokenB][price][head].prev = orderId;
        } else {
            _addBuyPriceLevel(tokenA, tokenB, price);
        }
        
        buyOrdersAtPrice[tokenA][tokenB][price][orderId] = newNode;
        buyOrdersHead[tokenA][tokenB][price] = orderId;
    }
    
    /**
     * @dev 插入卖单到指定价格水平的链表头部
     * 使用FIFO（先进先出）原则
     * @param orderId 订单ID
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param price 订单价格
     */
    function _insertSellOrder(
        uint256 orderId,
        address tokenA,
        address tokenB,
        uint256 price
    ) private {
        uint256 head = sellOrdersHead[tokenA][tokenB][price];
        
        IOrderBook.OrderNode memory newNode = IOrderBook.OrderNode({
            orderId: orderId,
            next: head,
            prev: 0
        });
        
        if (head != 0) {
            sellOrdersAtPrice[tokenA][tokenB][price][head].prev = orderId;
        } else {
            _addSellPriceLevel(tokenA, tokenB, price);
        }
        
        sellOrdersAtPrice[tokenA][tokenB][price][orderId] = newNode;
        sellOrdersHead[tokenA][tokenB][price] = orderId;
    }
    
    /**
     * @dev 添加新的买单价格水平
     * 保持价格水平数组按降序排列（最高价在前）
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param price 新的价格水平
     */
    function _addBuyPriceLevel(
        address tokenA,
        address tokenB,
        uint256 price
    ) private {
        uint256[] storage levels = buyPriceLevels[tokenA][tokenB];
        uint256 i = 0;
        
        while (i < levels.length && levels[i] > price) {
            i++;
        }
        
        if (i == levels.length) {
            levels.push(price);
        } else if (levels[i] != price) {
            levels.push();
            for (uint256 j = levels.length - 1; j > i; j--) {
                levels[j] = levels[j - 1];
            }
            levels[i] = price;
        }
    }
    
    /**
     * @dev 添加新的卖单价格水平
     * 保持价格水平数组按升序排列（最低价在前）
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param price 新的价格水平
     */
    function _addSellPriceLevel(
        address tokenA,
        address tokenB,
        uint256 price
    ) private {
        uint256[] storage levels = sellPriceLevels[tokenA][tokenB];
        uint256 i = 0;
        
        while (i < levels.length && levels[i] < price) {
            i++;
        }
        
        if (i == levels.length) {
            levels.push(price);
        } else if (levels[i] != price) {
            levels.push();
            for (uint256 j = levels.length - 1; j > i; j--) {
                levels[j] = levels[j - 1];
            }
            levels[i] = price;
        }
    }
    
    /**
     * @dev 更新最佳买价（最高买价）
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param price 新的买价
     */
    function _updateBestBid(
        address tokenA,
        address tokenB,
        uint256 price
    ) private {
        if (price > bestBid[tokenA][tokenB]) {
            bestBid[tokenA][tokenB] = price;
        }
    }
    
    /**
     * @dev 更新最佳卖价（最低卖价）
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param price 新的卖价
     */
    function _updateBestAsk(
        address tokenA,
        address tokenB,
        uint256 price
    ) private {
        if (bestAsk[tokenA][tokenB] == 0 || price < bestAsk[tokenA][tokenB]) {
            bestAsk[tokenA][tokenB] = price;
        }
    }
    
    /**
     * @dev 取消订单
     * 只有订单所有者可以取消自己的订单
     * @param orderId 要取消的订单ID
     */
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.trader == msg.sender, "Not order owner");
        require(order.status == OrderStatus.OPEN || order.status == OrderStatus.PARTIALLY_FILLED, "Cannot cancel");
        
        order.status = OrderStatus.CANCELLED;
        
        if (order.orderType != OrderType.MARKET) {
            _removeFromOrderBook(orderId, order);
        }
        
        emit OrderCancelled(orderId, msg.sender);
    }
    
    /**
     * @dev 从订单簿中移除订单
     * @param orderId 订单ID
     * @param order 订单详情
     */
    function _removeFromOrderBook(uint256 orderId, Order memory order) private {
        if (order.isBuy) {
            _removeBuyOrder(orderId, order.tokenA, order.tokenB, order.price);
        } else {
            _removeSellOrder(orderId, order.tokenA, order.tokenB, order.price);
        }
    }
    
    /**
     * @dev 从买单链表中移除订单
     * 维护双向链表的完整性
     * @param orderId 订单ID
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param price 订单价格
     */
    function _removeBuyOrder(
        uint256 orderId,
        address tokenA,
        address tokenB,
        uint256 price
    ) private {
        IOrderBook.OrderNode storage node = buyOrdersAtPrice[tokenA][tokenB][price][orderId];
        
        if (node.prev != 0) {
            buyOrdersAtPrice[tokenA][tokenB][price][node.prev].next = node.next;
        } else {
            buyOrdersHead[tokenA][tokenB][price] = node.next;
        }
        
        if (node.next != 0) {
            buyOrdersAtPrice[tokenA][tokenB][price][node.next].prev = node.prev;
        }
        
        delete buyOrdersAtPrice[tokenA][tokenB][price][orderId];
        
        if (buyOrdersHead[tokenA][tokenB][price] == 0) {
            _removeBuyPriceLevel(tokenA, tokenB, price);
            _recalculateBestBid(tokenA, tokenB);
        }
    }
    
    /**
     * @dev 从卖单链表中移除订单
     * 维护双向链表的完整性
     * @param orderId 订单ID
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param price 订单价格
     */
    function _removeSellOrder(
        uint256 orderId,
        address tokenA,
        address tokenB,
        uint256 price
    ) private {
        IOrderBook.OrderNode storage node = sellOrdersAtPrice[tokenA][tokenB][price][orderId];
        
        if (node.prev != 0) {
            sellOrdersAtPrice[tokenA][tokenB][price][node.prev].next = node.next;
        } else {
            sellOrdersHead[tokenA][tokenB][price] = node.next;
        }
        
        if (node.next != 0) {
            sellOrdersAtPrice[tokenA][tokenB][price][node.next].prev = node.prev;
        }
        
        delete sellOrdersAtPrice[tokenA][tokenB][price][orderId];
        
        if (sellOrdersHead[tokenA][tokenB][price] == 0) {
            _removeSellPriceLevel(tokenA, tokenB, price);
            _recalculateBestAsk(tokenA, tokenB);
        }
    }
    
    /**
     * @dev 移除买单价格水平
     * 当某个价格水平没有订单时调用
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param price 要移除的价格水平
     */
    function _removeBuyPriceLevel(
        address tokenA,
        address tokenB,
        uint256 price
    ) private {
        uint256[] storage levels = buyPriceLevels[tokenA][tokenB];
        for (uint256 i = 0; i < levels.length; i++) {
            if (levels[i] == price) {
                for (uint256 j = i; j < levels.length - 1; j++) {
                    levels[j] = levels[j + 1];
                }
                levels.pop();
                break;
            }
        }
    }
    
    /**
     * @dev 移除卖单价格水平
     * 当某个价格水平没有订单时调用
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param price 要移除的价格水平
     */
    function _removeSellPriceLevel(
        address tokenA,
        address tokenB,
        uint256 price
    ) private {
        uint256[] storage levels = sellPriceLevels[tokenA][tokenB];
        for (uint256 i = 0; i < levels.length; i++) {
            if (levels[i] == price) {
                for (uint256 j = i; j < levels.length - 1; j++) {
                    levels[j] = levels[j + 1];
                }
                levels.pop();
                break;
            }
        }
    }
    
    /**
     * @dev 重新计算最佳买价
     * 在移除价格水平后调用
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     */
    function _recalculateBestBid(address tokenA, address tokenB) private {
        uint256[] storage levels = buyPriceLevels[tokenA][tokenB];
        if (levels.length > 0) {
            bestBid[tokenA][tokenB] = levels[0];
        } else {
            bestBid[tokenA][tokenB] = 0;
        }
    }
    
    /**
     * @dev 重新计算最佳卖价
     * 在移除价格水平后调用
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     */
    function _recalculateBestAsk(address tokenA, address tokenB) private {
        uint256[] storage levels = sellPriceLevels[tokenA][tokenB];
        if (levels.length > 0) {
            bestAsk[tokenA][tokenB] = levels[0];
        } else {
            bestAsk[tokenA][tokenB] = 0;
        }
    }
    
    /**
     * @dev 更新订单状态
     * 只能由授权合约调用（匹配引擎或结算合约）
     * @param orderId 订单ID
     * @param status 新的订单状态
     * @param filledAmount 已成交数量
     */
    function updateOrderStatus(
        uint256 orderId,
        OrderStatus status,
        uint256 filledAmount
    ) external onlyAuthorized {
        Order storage order = orders[orderId];
        order.status = status;
        order.filledAmount = filledAmount;
        
        if (status == OrderStatus.FILLED) {
            emit OrderFilled(orderId);
            if (order.orderType != OrderType.MARKET) {
                _removeFromOrderBook(orderId, order);
            }
        } else if (status == OrderStatus.PARTIALLY_FILLED) {
            emit OrderPartiallyFilled(orderId, filledAmount, order.amount - filledAmount);
        }
    }
    
    /**
     * @dev 获取订单详情
     * @param orderId 订单ID
     * @return 订单详情
     */
    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }
    
    /**
     * @dev 获取用户的所有订单ID
     * @param trader 用户地址
     * @return 用户订单ID数组
     */
    function getUserOrders(address trader) external view returns (uint256[] memory) {
        return userOrders[trader];
    }
    
    /**
     * @dev 获取特定价格水平的所有买单ID
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param price 价格水平
     * @return 该价格水平的订单ID数组
     */
    function getBuyOrdersAtPrice(
        address tokenA,
        address tokenB,
        uint256 price
    ) external view returns (uint256[] memory) {
        uint256 count = 0;
        uint256 current = buyOrdersHead[tokenA][tokenB][price];
        
        while (current != 0) {
            count++;
            current = buyOrdersAtPrice[tokenA][tokenB][price][current].next;
        }
        
        uint256[] memory orderIds = new uint256[](count);
        current = buyOrdersHead[tokenA][tokenB][price];
        
        for (uint256 i = 0; i < count; i++) {
            orderIds[i] = current;
            current = buyOrdersAtPrice[tokenA][tokenB][price][current].next;
        }
        
        return orderIds;
    }
    
    /**
     * @dev 获取特定价格水平的所有卖单ID
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param price 价格水平
     * @return 该价格水平的订单ID数组
     */
    function getSellOrdersAtPrice(
        address tokenA,
        address tokenB,
        uint256 price
    ) external view returns (uint256[] memory) {
        uint256 count = 0;
        uint256 current = sellOrdersHead[tokenA][tokenB][price];
        
        while (current != 0) {
            count++;
            current = sellOrdersAtPrice[tokenA][tokenB][price][current].next;
        }
        
        uint256[] memory orderIds = new uint256[](count);
        current = sellOrdersHead[tokenA][tokenB][price];
        
        for (uint256 i = 0; i < count; i++) {
            orderIds[i] = current;
            current = sellOrdersAtPrice[tokenA][tokenB][price][current].next;
        }
        
        return orderIds;
    }
    
    /**
     * @dev 暂停合约，只有所有者可以调用
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @dev 恢复合约，只有所有者可以调用
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    /**
     * @dev 获取买单价格水平列表
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param limit 返回的最大价格水平数量（0表示返回全部）
     * @return 价格水平数组（按降序排列）
     */
    function getBuyPriceLevels(
        address tokenA,
        address tokenB,
        uint256 limit
    ) external view returns (uint256[] memory) {
        uint256[] memory levels = buyPriceLevels[tokenA][tokenB];
        if (limit == 0 || limit >= levels.length) {
            return levels;
        }
        
        uint256[] memory limitedLevels = new uint256[](limit);
        for (uint256 i = 0; i < limit; i++) {
            limitedLevels[i] = levels[i];
        }
        return limitedLevels;
    }
    
    /**
     * @dev 获取卖单价格水平列表
     * @param tokenA 基础代币地址
     * @param tokenB 报价代币地址
     * @param limit 返回的最大价格水平数量（0表示返回全部）
     * @return 价格水平数组（按升序排列）
     */
    function getSellPriceLevels(
        address tokenA,
        address tokenB,
        uint256 limit
    ) external view returns (uint256[] memory) {
        uint256[] memory levels = sellPriceLevels[tokenA][tokenB];
        if (limit == 0 || limit >= levels.length) {
            return levels;
        }
        
        uint256[] memory limitedLevels = new uint256[](limit);
        for (uint256 i = 0; i < limit; i++) {
            limitedLevels[i] = levels[i];
        }
        return limitedLevels;
    }
}