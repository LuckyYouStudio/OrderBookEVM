// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./interfaces/IOrderBook.sol";

contract OrderBook is 
    IOrderBook,
    Initializable, 
    OwnableUpgradeable, 
    PausableUpgradeable, 
    ReentrancyGuardUpgradeable 
{
    uint256 private _orderIdCounter;
    uint256 public constant MIN_ORDER_SIZE = 1e15;
    uint256 public constant MAX_PRICE_DEVIATION = 5000;
    uint256 public constant BASIS_POINTS = 10000;
    
    mapping(uint256 => Order) public orders;
    mapping(address => uint256[]) public userOrders;
    mapping(address => mapping(address => uint256)) public bestBid;
    mapping(address => mapping(address => uint256)) public bestAsk;
    
    mapping(address => mapping(address => mapping(uint256 => OrderNode))) public buyOrdersAtPrice;
    mapping(address => mapping(address => mapping(uint256 => OrderNode))) public sellOrdersAtPrice;
    mapping(address => mapping(address => mapping(uint256 => uint256))) public buyOrdersHead;
    mapping(address => mapping(address => mapping(uint256 => uint256))) public sellOrdersHead;
    
    mapping(address => mapping(address => uint256[])) public buyPriceLevels;
    mapping(address => mapping(address => uint256[])) public sellPriceLevels;
    
    address public orderMatching;
    address public settlement;
    address public tokenRegistry;
    
    modifier onlyAuthorized() {
        require(
            msg.sender == orderMatching || 
            msg.sender == settlement || 
            msg.sender == owner(),
            "Unauthorized"
        );
        _;
    }
    
    modifier validPair(address tokenA, address tokenB) {
        require(tokenA != address(0) && tokenB != address(0), "Invalid token address");
        require(tokenA != tokenB, "Same token pair");
        _;
    }
    
    function initialize() public initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __ReentrancyGuard_init();
        _orderIdCounter = 1;
    }
    
    function setContracts(
        address _orderMatching,
        address _settlement,
        address _tokenRegistry
    ) external onlyOwner {
        require(_orderMatching != address(0), "Invalid matching address");
        require(_settlement != address(0), "Invalid settlement address");
        require(_tokenRegistry != address(0), "Invalid registry address");
        
        orderMatching = _orderMatching;
        settlement = _settlement;
        tokenRegistry = _tokenRegistry;
    }
    
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
    
    function _insertBuyOrder(
        uint256 orderId,
        address tokenA,
        address tokenB,
        uint256 price
    ) private {
        uint256 head = buyOrdersHead[tokenA][tokenB][price];
        
        OrderNode memory newNode = OrderNode({
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
    
    function _insertSellOrder(
        uint256 orderId,
        address tokenA,
        address tokenB,
        uint256 price
    ) private {
        uint256 head = sellOrdersHead[tokenA][tokenB][price];
        
        OrderNode memory newNode = OrderNode({
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
    
    function _updateBestBid(
        address tokenA,
        address tokenB,
        uint256 price
    ) private {
        if (price > bestBid[tokenA][tokenB]) {
            bestBid[tokenA][tokenB] = price;
        }
    }
    
    function _updateBestAsk(
        address tokenA,
        address tokenB,
        uint256 price
    ) private {
        if (bestAsk[tokenA][tokenB] == 0 || price < bestAsk[tokenA][tokenB]) {
            bestAsk[tokenA][tokenB] = price;
        }
    }
    
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
    
    function _removeFromOrderBook(uint256 orderId, Order memory order) private {
        if (order.isBuy) {
            _removeBuyOrder(orderId, order.tokenA, order.tokenB, order.price);
        } else {
            _removeSellOrder(orderId, order.tokenA, order.tokenB, order.price);
        }
    }
    
    function _removeBuyOrder(
        uint256 orderId,
        address tokenA,
        address tokenB,
        uint256 price
    ) private {
        OrderNode storage node = buyOrdersAtPrice[tokenA][tokenB][price][orderId];
        
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
    
    function _removeSellOrder(
        uint256 orderId,
        address tokenA,
        address tokenB,
        uint256 price
    ) private {
        OrderNode storage node = sellOrdersAtPrice[tokenA][tokenB][price][orderId];
        
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
    
    function _recalculateBestBid(address tokenA, address tokenB) private {
        uint256[] storage levels = buyPriceLevels[tokenA][tokenB];
        if (levels.length > 0) {
            bestBid[tokenA][tokenB] = levels[0];
        } else {
            bestBid[tokenA][tokenB] = 0;
        }
    }
    
    function _recalculateBestAsk(address tokenA, address tokenB) private {
        uint256[] storage levels = sellPriceLevels[tokenA][tokenB];
        if (levels.length > 0) {
            bestAsk[tokenA][tokenB] = levels[0];
        } else {
            bestAsk[tokenA][tokenB] = 0;
        }
    }
    
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
    
    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }
    
    function getUserOrders(address trader) external view returns (uint256[] memory) {
        return userOrders[trader];
    }
    
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
    
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
}