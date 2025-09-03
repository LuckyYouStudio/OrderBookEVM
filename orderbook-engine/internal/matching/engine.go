package matching

import (
	"container/heap"
	"sync"
	"time"

	"orderbook-engine/internal/types"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/sirupsen/logrus"
)

// MatchingEngine 撮合引擎
type MatchingEngine struct {
	mu          sync.RWMutex
	orderBooks  map[string]*OrderBook
	eventChan   chan *MatchEvent
	logger      *logrus.Logger
}

// MatchEvent 撮合事件
type MatchEvent struct {
	Type        string        `json:"type"`
	TradingPair string        `json:"trading_pair"`
	Order       *types.Order  `json:"order,omitempty"`
	Fills       []*types.Fill `json:"fills,omitempty"`
	Timestamp   time.Time     `json:"timestamp"`
}

// OrderBook 单个交易对的订单簿
type OrderBook struct {
	TradingPair string
	Bids        *PriceLevel // 买单队列（最高价优先）
	Asks        *PriceLevel // 卖单队列（最低价优先）
	Orders      map[uuid.UUID]*types.Order
}

// PriceLevel 价格层级（使用堆实现优先队列）
type PriceLevel struct {
	levels map[string]*PriceLevelQueue // price -> queue
	heap   PriceHeap
	isBuy  bool
}

// PriceLevelQueue 同一价格的订单队列（价格-时间优先）
type PriceLevelQueue struct {
	Price     decimal.Decimal
	Orders    []*types.Order // 按时间顺序排列（FIFO）
	Total     decimal.Decimal
	OrdersMap map[uuid.UUID]*types.Order // 快速查找
}

// PriceHeap 价格堆（买单降序，卖单升序）
type PriceHeap struct {
	items []PriceLevelItem
	isBuy bool
}

type PriceLevelItem struct {
	Price decimal.Decimal
	Total decimal.Decimal
}

// NewMatchingEngine 创建撮合引擎
func NewMatchingEngine(logger *logrus.Logger) *MatchingEngine {
	return &MatchingEngine{
		orderBooks: make(map[string]*OrderBook),
		eventChan:  make(chan *MatchEvent, 10000),
		logger:     logger,
	}
}

// GetEventChannel 获取事件通道
func (me *MatchingEngine) GetEventChannel() <-chan *MatchEvent {
	return me.eventChan
}

// AddOrder 添加订单
func (me *MatchingEngine) AddOrder(order *types.Order) []*types.Fill {
	me.mu.Lock()
	defer me.mu.Unlock()

	orderBook := me.getOrCreateOrderBook(order.TradingPair)
	fills := me.matchOrder(orderBook, order)

	if order.GetRemainingAmount().GreaterThan(decimal.Zero) && order.Type == types.OrderTypeLimit {
		me.addOrderToBook(orderBook, order)
	}

	// 发送事件
	me.eventChan <- &MatchEvent{
		Type:        "order_added",
		TradingPair: order.TradingPair,
		Order:       order,
		Fills:       fills,
		Timestamp:   time.Now(),
	}

	return fills
}

// CancelOrder 取消订单
func (me *MatchingEngine) CancelOrder(orderID uuid.UUID, tradingPair string) bool {
	me.mu.Lock()
	defer me.mu.Unlock()

	orderBook, exists := me.orderBooks[tradingPair]
	if !exists {
		return false
	}

	order, exists := orderBook.Orders[orderID]
	if !exists {
		return false
	}

	me.removeOrderFromBook(orderBook, order)
	order.Status = types.OrderStatusCancelled
	order.UpdatedAt = time.Now()

	// 发送事件
	me.eventChan <- &MatchEvent{
		Type:        "order_cancelled",
		TradingPair: tradingPair,
		Order:       order,
		Timestamp:   time.Now(),
	}

	return true
}

// GetOrderBook 获取订单簿快照
func (me *MatchingEngine) GetOrderBook(tradingPair string, depth int) *types.OrderBookSnapshot {
	me.mu.RLock()
	defer me.mu.RUnlock()

	orderBook, exists := me.orderBooks[tradingPair]
	if !exists {
		return &types.OrderBookSnapshot{
			TradingPair: tradingPair,
			Bids:        []types.OrderBookLevel{},
			Asks:        []types.OrderBookLevel{},
			Timestamp:   time.Now(),
		}
	}

	return &types.OrderBookSnapshot{
		TradingPair: tradingPair,
		Bids:        me.getPriceLevels(orderBook.Bids, depth),
		Asks:        me.getPriceLevels(orderBook.Asks, depth),
		Timestamp:   time.Now(),
	}
}

// matchOrder 撮合订单
func (me *MatchingEngine) matchOrder(orderBook *OrderBook, takerOrder *types.Order) []*types.Fill {
	var fills []*types.Fill
	var targetSide *PriceLevel

	if takerOrder.Side == types.OrderSideBuy {
		targetSide = orderBook.Asks
	} else {
		targetSide = orderBook.Bids
	}

	for takerOrder.GetRemainingAmount().GreaterThan(decimal.Zero) && targetSide.heap.Len() > 0 {
		bestPrice := targetSide.heap.Peek()
		if !me.canMatch(takerOrder, bestPrice.Price) {
			break
		}

		queue := targetSide.levels[bestPrice.Price.String()]
		if queue == nil || len(queue.Orders) == 0 {
			heap.Pop(&targetSide.heap)
			continue
		}

		makerOrder := queue.Orders[0]
		matchPrice := makerOrder.Price
		matchAmount := decimal.Min(takerOrder.GetRemainingAmount(), makerOrder.GetRemainingAmount())

		// 创建成交记录
		fill := &types.Fill{
			ID:           uuid.New(),
			TakerOrderID: takerOrder.ID,
			MakerOrderID: makerOrder.ID,
			TradingPair:  takerOrder.TradingPair,
			Price:        matchPrice,
			Amount:       matchAmount,
			TakerSide:    takerOrder.Side,
			CreatedAt:    time.Now(),
		}

		fills = append(fills, fill)

		// 更新订单状态
		takerOrder.FilledAmount = takerOrder.FilledAmount.Add(matchAmount)
		makerOrder.FilledAmount = makerOrder.FilledAmount.Add(matchAmount)

		if takerOrder.GetRemainingAmount().IsZero() {
			takerOrder.Status = types.OrderStatusFilled
		} else {
			takerOrder.Status = types.OrderStatusPartiallyFilled
		}

		if makerOrder.GetRemainingAmount().IsZero() {
			makerOrder.Status = types.OrderStatusFilled
			me.removeOrderFromBook(orderBook, makerOrder)
		} else {
			makerOrder.Status = types.OrderStatusPartiallyFilled
		}

		takerOrder.UpdatedAt = time.Now()
		makerOrder.UpdatedAt = time.Now()

		me.logger.WithFields(logrus.Fields{
			"trading_pair": takerOrder.TradingPair,
			"price":        matchPrice.String(),
			"amount":       matchAmount.String(),
			"taker_id":     takerOrder.ID.String(),
			"maker_id":     makerOrder.ID.String(),
		}).Info("Order matched")
	}

	return fills
}

// canMatch 检查订单是否可以撮合
func (me *MatchingEngine) canMatch(order *types.Order, price decimal.Decimal) bool {
	if order.Type == types.OrderTypeMarket {
		return true
	}

	if order.Side == types.OrderSideBuy {
		return order.Price.GreaterThanOrEqual(price)
	}
	return order.Price.LessThanOrEqual(price)
}

// addOrderToBook 将订单添加到订单簿（价格-时间优先）
func (me *MatchingEngine) addOrderToBook(orderBook *OrderBook, order *types.Order) {
	orderBook.Orders[order.ID] = order

	var targetSide *PriceLevel
	if order.Side == types.OrderSideBuy {
		targetSide = orderBook.Bids
	} else {
		targetSide = orderBook.Asks
	}

	priceStr := order.Price.String()
	queue, exists := targetSide.levels[priceStr]
	if !exists {
		queue = &PriceLevelQueue{
			Price:     order.Price,
			Orders:    []*types.Order{},
			Total:     decimal.Zero,
			OrdersMap: make(map[uuid.UUID]*types.Order),
		}
		targetSide.levels[priceStr] = queue
		heap.Push(&targetSide.heap, PriceLevelItem{
			Price: order.Price,
			Total: decimal.Zero,
		})
	}

	// 按时间顺序添加（FIFO）
	queue.Orders = append(queue.Orders, order)
	queue.OrdersMap[order.ID] = order
	queue.Total = queue.Total.Add(order.GetRemainingAmount())
	order.Status = types.OrderStatusOpen

	me.logger.WithFields(logrus.Fields{
		"order_id":     order.ID.String(),
		"price":        order.Price.String(),
		"side":         order.Side,
		"trading_pair": order.TradingPair,
		"timestamp":    order.CreatedAt,
	}).Debug("Added order to book with price-time priority")
}

// removeOrderFromBook 从订单簿移除订单
func (me *MatchingEngine) removeOrderFromBook(orderBook *OrderBook, order *types.Order) {
	delete(orderBook.Orders, order.ID)

	var targetSide *PriceLevel
	if order.Side == types.OrderSideBuy {
		targetSide = orderBook.Bids
	} else {
		targetSide = orderBook.Asks
	}

	priceStr := order.Price.String()
	queue, exists := targetSide.levels[priceStr]
	if !exists {
		return
	}

	// 从队列中移除订单
	for i, o := range queue.Orders {
		if o.ID == order.ID {
			queue.Orders = append(queue.Orders[:i], queue.Orders[i+1:]...)
			queue.Total = queue.Total.Sub(o.GetRemainingAmount())
			break
		}
	}

	// 如果队列为空，从堆中移除
	if len(queue.Orders) == 0 {
		delete(targetSide.levels, priceStr)
		targetSide.heap.Remove(order.Price)
	}
}

// getOrCreateOrderBook 获取或创建订单簿
func (me *MatchingEngine) getOrCreateOrderBook(tradingPair string) *OrderBook {
	orderBook, exists := me.orderBooks[tradingPair]
	if !exists {
		orderBook = &OrderBook{
			TradingPair: tradingPair,
			Bids: &PriceLevel{
				levels: make(map[string]*PriceLevelQueue),
				heap:   PriceHeap{isBuy: true},
				isBuy:  true,
			},
			Asks: &PriceLevel{
				levels: make(map[string]*PriceLevelQueue),
				heap:   PriceHeap{isBuy: false},
				isBuy:  false,
			},
			Orders: make(map[uuid.UUID]*types.Order),
		}
		me.orderBooks[tradingPair] = orderBook
	}
	return orderBook
}

// getPriceLevels 获取价格层级
func (me *MatchingEngine) getPriceLevels(priceLevel *PriceLevel, depth int) []types.OrderBookLevel {
	var levels []types.OrderBookLevel
	
	heap := make([]PriceLevelItem, len(priceLevel.heap.items))
	copy(heap, priceLevel.heap.items)
	
	count := 0
	for _, item := range heap {
		if count >= depth {
			break
		}
		
		queue := priceLevel.levels[item.Price.String()]
		if queue != nil && len(queue.Orders) > 0 {
			levels = append(levels, types.OrderBookLevel{
				Price:  item.Price,
				Amount: queue.Total,
				Count:  len(queue.Orders),
			})
			count++
		}
	}
	
	return levels
}

// GetBestPrice 获取最佳价格（价格优先）
func (me *MatchingEngine) GetBestPrice(tradingPair string, side types.OrderSide) (decimal.Decimal, bool) {
	me.mu.RLock()
	defer me.mu.RUnlock()

	orderBook, exists := me.orderBooks[tradingPair]
	if !exists {
		return decimal.Zero, false
	}

	var targetSide *PriceLevel
	if side == types.OrderSideBuy {
		targetSide = orderBook.Bids
	} else {
		targetSide = orderBook.Asks
	}

	if targetSide.heap.Len() == 0 {
		return decimal.Zero, false
	}

	bestPrice := targetSide.heap.Peek()
	return bestPrice.Price, true
}

// GetOrdersAtPrice 获取指定价格的所有订单（按时间顺序）
func (me *MatchingEngine) GetOrdersAtPrice(tradingPair string, side types.OrderSide, price decimal.Decimal) []*types.Order {
	me.mu.RLock()
	defer me.mu.RUnlock()

	orderBook, exists := me.orderBooks[tradingPair]
	if !exists {
		return nil
	}

	var targetSide *PriceLevel
	if side == types.OrderSideBuy {
		targetSide = orderBook.Bids
	} else {
		targetSide = orderBook.Asks
	}

	priceStr := price.String()
	queue, exists := targetSide.levels[priceStr]
	if !exists {
		return nil
	}

	// 返回按时间顺序排列的订单副本
	orders := make([]*types.Order, len(queue.Orders))
	copy(orders, queue.Orders)
	return orders
}

// PriceHeap 实现 heap.Interface
func (h PriceHeap) Len() int { return len(h.items) }

func (h PriceHeap) Less(i, j int) bool {
	if h.isBuy {
		return h.items[i].Price.GreaterThan(h.items[j].Price) // 买单：价格降序
	}
	return h.items[i].Price.LessThan(h.items[j].Price) // 卖单：价格升序
}

func (h PriceHeap) Swap(i, j int) {
	h.items[i], h.items[j] = h.items[j], h.items[i]
}

func (h *PriceHeap) Push(x interface{}) {
	h.items = append(h.items, x.(PriceLevelItem))
}

func (h *PriceHeap) Pop() interface{} {
	old := h.items
	n := len(old)
	item := old[n-1]
	h.items = old[0 : n-1]
	return item
}

func (h *PriceHeap) Peek() PriceLevelItem {
	if len(h.items) == 0 {
		return PriceLevelItem{}
	}
	return h.items[0]
}

func (h *PriceHeap) Remove(price decimal.Decimal) {
	for i, item := range h.items {
		if item.Price.Equal(price) {
			heap.Remove(h, i)
			break
		}
	}
}