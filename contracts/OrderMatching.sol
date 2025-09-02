// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./interfaces/IOrderBook.sol";
import "./OrderBook.sol";
import "./Settlement.sol";

contract OrderMatching is 
    Initializable, 
    OwnableUpgradeable, 
    PausableUpgradeable, 
    ReentrancyGuardUpgradeable 
{
    OrderBook public orderBook;
    Settlement public settlement;
    
    uint256 public maxSlippage;
    uint256 public maxMatchesPerTx;
    uint256 public constant BASIS_POINTS = 10000;
    
    struct MatchResult {
        uint256 buyOrderId;
        uint256 sellOrderId;
        uint256 matchedAmount;
        uint256 matchedPrice;
    }
    
    event OrdersMatched(
        uint256 indexed buyOrderId,
        uint256 indexed sellOrderId,
        uint256 matchedAmount,
        uint256 matchedPrice,
        address tokenA,
        address tokenB
    );
    
    event MarketOrderExecuted(
        uint256 indexed orderId,
        uint256 totalFilledAmount,
        uint256 averagePrice
    );
    
    function initialize(address _orderBook, address _settlement) public initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __ReentrancyGuard_init();
        
        orderBook = OrderBook(_orderBook);
        settlement = Settlement(_settlement);
        maxSlippage = 500;
        maxMatchesPerTx = 50;
    }
    
    function setMaxSlippage(uint256 _maxSlippage) external onlyOwner {
        require(_maxSlippage <= BASIS_POINTS, "Slippage too high");
        maxSlippage = _maxSlippage;
    }
    
    function setMaxMatchesPerTx(uint256 _max) external onlyOwner {
        require(_max > 0 && _max <= 100, "Invalid max matches");
        maxMatchesPerTx = _max;
    }
    
    function matchOrders(
        address tokenA,
        address tokenB
    ) external whenNotPaused nonReentrant returns (MatchResult[] memory matches) {
        uint256[] memory buyPrices = orderBook.buyPriceLevels(tokenA, tokenB, 0);
        uint256[] memory sellPrices = orderBook.sellPriceLevels(tokenA, tokenB, 0);
        
        if (buyPrices.length == 0 || sellPrices.length == 0) {
            return new MatchResult[](0);
        }
        
        uint256 bestBidPrice = orderBook.bestBid(tokenA, tokenB);
        uint256 bestAskPrice = orderBook.bestAsk(tokenA, tokenB);
        
        if (bestBidPrice < bestAskPrice) {
            return new MatchResult[](0);
        }
        
        matches = new MatchResult[](maxMatchesPerTx);
        uint256 matchCount = 0;
        
        while (
            bestBidPrice >= bestAskPrice && 
            matchCount < maxMatchesPerTx
        ) {
            uint256[] memory buyOrderIds = orderBook.getBuyOrdersAtPrice(tokenA, tokenB, bestBidPrice);
            uint256[] memory sellOrderIds = orderBook.getSellOrdersAtPrice(tokenA, tokenB, bestAskPrice);
            
            if (buyOrderIds.length == 0 || sellOrderIds.length == 0) {
                break;
            }
            
            for (uint256 i = 0; i < buyOrderIds.length && matchCount < maxMatchesPerTx; i++) {
                for (uint256 j = 0; j < sellOrderIds.length && matchCount < maxMatchesPerTx; j++) {
                    IOrderBook.Order memory buyOrder = orderBook.getOrder(buyOrderIds[i]);
                    IOrderBook.Order memory sellOrder = orderBook.getOrder(sellOrderIds[j]);
                    
                    if (_canMatch(buyOrder, sellOrder)) {
                        MatchResult memory result = _executeMatch(buyOrder, sellOrder);
                        matches[matchCount] = result;
                        matchCount++;
                        
                        emit OrdersMatched(
                            result.buyOrderId,
                            result.sellOrderId,
                            result.matchedAmount,
                            result.matchedPrice,
                            tokenA,
                            tokenB
                        );
                        
                        if (buyOrder.amount == buyOrder.filledAmount) {
                            break;
                        }
                    }
                }
            }
            
            bestBidPrice = orderBook.bestBid(tokenA, tokenB);
            bestAskPrice = orderBook.bestAsk(tokenA, tokenB);
        }
        
        assembly {
            mstore(matches, matchCount)
        }
        
        return matches;
    }
    
    function executeMarketOrder(
        uint256 orderId
    ) external whenNotPaused nonReentrant returns (uint256 totalFilledAmount, uint256 averagePrice) {
        IOrderBook.Order memory marketOrder = orderBook.getOrder(orderId);
        require(marketOrder.orderType == IOrderBook.OrderType.MARKET, "Not a market order");
        require(marketOrder.status == IOrderBook.OrderStatus.OPEN, "Order not open");
        require(marketOrder.trader == msg.sender || msg.sender == owner(), "Unauthorized");
        
        uint256 remainingAmount = marketOrder.amount;
        uint256 totalCost = 0;
        uint256 matchCount = 0;
        
        if (marketOrder.isBuy) {
            uint256[] memory sellPrices = orderBook.sellPriceLevels(marketOrder.tokenA, marketOrder.tokenB, 0);
            
            for (uint256 p = 0; p < sellPrices.length && remainingAmount > 0 && matchCount < maxMatchesPerTx; p++) {
                uint256 price = sellPrices[p];
                
                if (!_checkSlippage(marketOrder.price, price, true)) {
                    break;
                }
                
                uint256[] memory sellOrderIds = orderBook.getSellOrdersAtPrice(
                    marketOrder.tokenA,
                    marketOrder.tokenB,
                    price
                );
                
                for (uint256 i = 0; i < sellOrderIds.length && remainingAmount > 0 && matchCount < maxMatchesPerTx; i++) {
                    IOrderBook.Order memory sellOrder = orderBook.getOrder(sellOrderIds[i]);
                    
                    if (sellOrder.status == IOrderBook.OrderStatus.OPEN || 
                        sellOrder.status == IOrderBook.OrderStatus.PARTIALLY_FILLED) {
                        
                        uint256 availableAmount = sellOrder.amount - sellOrder.filledAmount;
                        uint256 matchAmount = remainingAmount > availableAmount ? availableAmount : remainingAmount;
                        
                        settlement.executeTrade(
                            marketOrder.trader,
                            sellOrder.trader,
                            marketOrder.tokenA,
                            marketOrder.tokenB,
                            matchAmount,
                            price,
                            true
                        );
                        
                        remainingAmount -= matchAmount;
                        totalFilledAmount += matchAmount;
                        totalCost += matchAmount * price;
                        matchCount++;
                        
                        _updateOrderAfterMatch(sellOrderIds[i], matchAmount);
                    }
                }
            }
        } else {
            uint256[] memory buyPrices = orderBook.buyPriceLevels(marketOrder.tokenA, marketOrder.tokenB, 0);
            
            for (uint256 p = 0; p < buyPrices.length && remainingAmount > 0 && matchCount < maxMatchesPerTx; p++) {
                uint256 price = buyPrices[p];
                
                if (!_checkSlippage(marketOrder.price, price, false)) {
                    break;
                }
                
                uint256[] memory buyOrderIds = orderBook.getBuyOrdersAtPrice(
                    marketOrder.tokenA,
                    marketOrder.tokenB,
                    price
                );
                
                for (uint256 i = 0; i < buyOrderIds.length && remainingAmount > 0 && matchCount < maxMatchesPerTx; i++) {
                    IOrderBook.Order memory buyOrder = orderBook.getOrder(buyOrderIds[i]);
                    
                    if (buyOrder.status == IOrderBook.OrderStatus.OPEN || 
                        buyOrder.status == IOrderBook.OrderStatus.PARTIALLY_FILLED) {
                        
                        uint256 availableAmount = buyOrder.amount - buyOrder.filledAmount;
                        uint256 matchAmount = remainingAmount > availableAmount ? availableAmount : remainingAmount;
                        
                        settlement.executeTrade(
                            buyOrder.trader,
                            marketOrder.trader,
                            marketOrder.tokenA,
                            marketOrder.tokenB,
                            matchAmount,
                            price,
                            false
                        );
                        
                        remainingAmount -= matchAmount;
                        totalFilledAmount += matchAmount;
                        totalCost += matchAmount * price;
                        matchCount++;
                        
                        _updateOrderAfterMatch(buyOrderIds[i], matchAmount);
                    }
                }
            }
        }
        
        if (totalFilledAmount > 0) {
            averagePrice = totalCost / totalFilledAmount;
            _updateOrderAfterMatch(orderId, totalFilledAmount);
            
            emit MarketOrderExecuted(orderId, totalFilledAmount, averagePrice);
        } else {
            orderBook.updateOrderStatus(orderId, IOrderBook.OrderStatus.CANCELLED, 0);
        }
        
        return (totalFilledAmount, averagePrice);
    }
    
    function _canMatch(
        IOrderBook.Order memory buyOrder,
        IOrderBook.Order memory sellOrder
    ) private view returns (bool) {
        if (buyOrder.status != IOrderBook.OrderStatus.OPEN && 
            buyOrder.status != IOrderBook.OrderStatus.PARTIALLY_FILLED) {
            return false;
        }
        
        if (sellOrder.status != IOrderBook.OrderStatus.OPEN && 
            sellOrder.status != IOrderBook.OrderStatus.PARTIALLY_FILLED) {
            return false;
        }
        
        if (buyOrder.expirationTime > 0 && buyOrder.expirationTime <= block.timestamp) {
            return false;
        }
        
        if (sellOrder.expirationTime > 0 && sellOrder.expirationTime <= block.timestamp) {
            return false;
        }
        
        if (buyOrder.price < sellOrder.price) {
            return false;
        }
        
        return true;
    }
    
    function _executeMatch(
        IOrderBook.Order memory buyOrder,
        IOrderBook.Order memory sellOrder
    ) private returns (MatchResult memory) {
        uint256 buyRemaining = buyOrder.amount - buyOrder.filledAmount;
        uint256 sellRemaining = sellOrder.amount - sellOrder.filledAmount;
        uint256 matchAmount = buyRemaining > sellRemaining ? sellRemaining : buyRemaining;
        uint256 matchPrice = sellOrder.price;
        
        settlement.executeTrade(
            buyOrder.trader,
            sellOrder.trader,
            buyOrder.tokenA,
            buyOrder.tokenB,
            matchAmount,
            matchPrice,
            true
        );
        
        _updateOrderAfterMatch(buyOrder.orderId, matchAmount);
        _updateOrderAfterMatch(sellOrder.orderId, matchAmount);
        
        return MatchResult({
            buyOrderId: buyOrder.orderId,
            sellOrderId: sellOrder.orderId,
            matchedAmount: matchAmount,
            matchedPrice: matchPrice
        });
    }
    
    function _updateOrderAfterMatch(uint256 orderId, uint256 matchedAmount) private {
        IOrderBook.Order memory order = orderBook.getOrder(orderId);
        uint256 newFilledAmount = order.filledAmount + matchedAmount;
        
        if (newFilledAmount >= order.amount) {
            orderBook.updateOrderStatus(orderId, IOrderBook.OrderStatus.FILLED, order.amount);
        } else {
            orderBook.updateOrderStatus(orderId, IOrderBook.OrderStatus.PARTIALLY_FILLED, newFilledAmount);
        }
    }
    
    function _checkSlippage(
        uint256 expectedPrice,
        uint256 actualPrice,
        bool isBuy
    ) private view returns (bool) {
        if (expectedPrice == 0) return true;
        
        uint256 priceDiff;
        if (isBuy) {
            if (actualPrice <= expectedPrice) return true;
            priceDiff = ((actualPrice - expectedPrice) * BASIS_POINTS) / expectedPrice;
        } else {
            if (actualPrice >= expectedPrice) return true;
            priceDiff = ((expectedPrice - actualPrice) * BASIS_POINTS) / expectedPrice;
        }
        
        return priceDiff <= maxSlippage;
    }
    
    function checkStopOrders(
        address tokenA,
        address tokenB,
        uint256 currentPrice
    ) external whenNotPaused {
        uint256 processedCount = 0;
        uint256 maxToProcess = 20;
        
        uint256[] memory userOrderIds = orderBook.getUserOrders(msg.sender);
        
        for (uint256 i = 0; i < userOrderIds.length && processedCount < maxToProcess; i++) {
            IOrderBook.Order memory order = orderBook.getOrder(userOrderIds[i]);
            
            if (order.tokenA != tokenA || order.tokenB != tokenB) continue;
            if (order.status != IOrderBook.OrderStatus.OPEN) continue;
            
            bool shouldTrigger = false;
            
            if (order.orderType == IOrderBook.OrderType.STOP_LOSS) {
                if (order.isBuy && currentPrice >= order.price) {
                    shouldTrigger = true;
                } else if (!order.isBuy && currentPrice <= order.price) {
                    shouldTrigger = true;
                }
            } else if (order.orderType == IOrderBook.OrderType.TAKE_PROFIT) {
                if (order.isBuy && currentPrice <= order.price) {
                    shouldTrigger = true;
                } else if (!order.isBuy && currentPrice >= order.price) {
                    shouldTrigger = true;
                }
            }
            
            if (shouldTrigger) {
                executeMarketOrder(userOrderIds[i]);
                processedCount++;
            }
        }
    }
    
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
}