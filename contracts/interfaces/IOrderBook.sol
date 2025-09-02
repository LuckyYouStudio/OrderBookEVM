// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IOrderBook {
    enum OrderType { LIMIT, MARKET, STOP_LOSS, TAKE_PROFIT }
    enum OrderStatus { OPEN, PARTIALLY_FILLED, FILLED, CANCELLED }
    
    struct Order {
        uint256 orderId;
        address trader;
        address tokenA;
        address tokenB;
        uint256 price;
        uint256 amount;
        uint256 filledAmount;
        OrderType orderType;
        uint256 timestamp;
        uint256 expirationTime;
        OrderStatus status;
        bool isBuy;
    }
    
    struct OrderNode {
        uint256 orderId;
        uint256 next;
        uint256 prev;
    }
    
    event OrderPlaced(
        uint256 indexed orderId,
        address indexed trader,
        address tokenA,
        address tokenB,
        uint256 price,
        uint256 amount,
        bool isBuy,
        OrderType orderType
    );
    
    event OrderCancelled(uint256 indexed orderId, address indexed trader);
    event OrderMatched(
        uint256 indexed buyOrderId,
        uint256 indexed sellOrderId,
        uint256 matchedAmount,
        uint256 price
    );
    event OrderPartiallyFilled(uint256 indexed orderId, uint256 filledAmount, uint256 remainingAmount);
    event OrderFilled(uint256 indexed orderId);
    
    function placeOrder(
        address tokenA,
        address tokenB,
        uint256 price,
        uint256 amount,
        bool isBuy,
        OrderType orderType,
        uint256 expirationTime
    ) external returns (uint256 orderId);
    
    function cancelOrder(uint256 orderId) external;
    function getOrder(uint256 orderId) external view returns (Order memory);
    function getUserOrders(address trader) external view returns (uint256[] memory);
}