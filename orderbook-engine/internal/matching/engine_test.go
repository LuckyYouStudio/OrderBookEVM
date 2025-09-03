package matching

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"orderbook-engine/internal/types"
)

func setupTestEngine() *MatchingEngine {
	logger := logrus.New()
	logger.SetLevel(logrus.DebugLevel)
	return NewMatchingEngine(logger)
}

func createTestOrder(side types.OrderSide, price, amount float64) *types.Order {
	return &types.Order{
		ID:          uuid.New(),
		UserAddress: "0x1234567890123456789012345678901234567890",
		TradingPair: "WETH-USDC",
		BaseToken:   "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		QuoteToken:  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
		Side:        side,
		Type:        types.OrderTypeLimit,
		Price:       decimal.NewFromFloat(price),
		Amount:      decimal.NewFromFloat(amount),
		Status:      types.OrderStatusOpen,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
}

func TestAddOrder(t *testing.T) {
	engine := setupTestEngine()

	// 测试添加买单
	buyOrder := createTestOrder(types.OrderSideBuy, 2000, 1)
	fills := engine.AddOrder(buyOrder)
	
	assert.Empty(t, fills, "买单应该被添加到订单簿，没有成交")
	assert.Equal(t, types.OrderStatusOpen, buyOrder.Status)
}

func TestOrderMatching(t *testing.T) {
	engine := setupTestEngine()

	// 添加买单
	buyOrder := createTestOrder(types.OrderSideBuy, 2000, 1)
	fills := engine.AddOrder(buyOrder)
	assert.Empty(t, fills)

	// 添加可以匹配的卖单
	sellOrder := createTestOrder(types.OrderSideSell, 1999, 1)
	fills = engine.AddOrder(sellOrder)
	
	require.NotEmpty(t, fills, "应该产生成交")
	assert.Equal(t, 1, len(fills), "应该有一笔成交")
	
	fill := fills[0]
	assert.Equal(t, buyOrder.ID, fill.MakerOrderID)
	assert.Equal(t, sellOrder.ID, fill.TakerOrderID)
	assert.Equal(t, decimal.NewFromFloat(2000), fill.Price, "成交价格应该是maker价格")
	assert.Equal(t, decimal.NewFromFloat(1), fill.Amount)
}

func TestPartialFill(t *testing.T) {
	engine := setupTestEngine()

	// 添加大买单
	buyOrder := createTestOrder(types.OrderSideBuy, 2000, 10)
	fills := engine.AddOrder(buyOrder)
	assert.Empty(t, fills)

	// 添加小卖单
	sellOrder := createTestOrder(types.OrderSideSell, 1999, 3)
	fills = engine.AddOrder(sellOrder)
	
	require.NotEmpty(t, fills)
	assert.Equal(t, 1, len(fills))
	
	fill := fills[0]
	assert.Equal(t, decimal.NewFromFloat(3), fill.Amount, "成交量应该是较小的订单量")
	
	// 检查订单状态
	assert.Equal(t, types.OrderStatusPartiallyFilled, buyOrder.Status)
	assert.Equal(t, types.OrderStatusFilled, sellOrder.Status)
	assert.Equal(t, decimal.NewFromFloat(3), buyOrder.FilledAmount)
	assert.Equal(t, decimal.NewFromFloat(3), sellOrder.FilledAmount)
}

func TestMultipleOrderMatching(t *testing.T) {
	engine := setupTestEngine()

	// 添加多个买单
	buyOrder1 := createTestOrder(types.OrderSideBuy, 2000, 1)
	buyOrder2 := createTestOrder(types.OrderSideBuy, 1999, 2)
	buyOrder3 := createTestOrder(types.OrderSideBuy, 1998, 3)
	
	engine.AddOrder(buyOrder1)
	engine.AddOrder(buyOrder2)
	engine.AddOrder(buyOrder3)

	// 添加大卖单
	sellOrder := createTestOrder(types.OrderSideSell, 1998, 5)
	fills := engine.AddOrder(sellOrder)
	
	// 应该先匹配最高价的买单
	assert.Equal(t, 2, len(fills), "应该匹配前两个买单")
	assert.Equal(t, buyOrder1.ID, fills[0].MakerOrderID)
	assert.Equal(t, buyOrder2.ID, fills[1].MakerOrderID)
}

func TestCancelOrder(t *testing.T) {
	engine := setupTestEngine()

	// 添加订单
	order := createTestOrder(types.OrderSideBuy, 2000, 1)
	engine.AddOrder(order)

	// 取消订单
	success := engine.CancelOrder(order.ID, order.TradingPair)
	assert.True(t, success, "取消应该成功")
	assert.Equal(t, types.OrderStatusCancelled, order.Status)

	// 再次尝试取消
	success = engine.CancelOrder(order.ID, order.TradingPair)
	assert.False(t, success, "重复取消应该失败")
}

func TestGetOrderBook(t *testing.T) {
	engine := setupTestEngine()

	// 添加多个买卖单
	engine.AddOrder(createTestOrder(types.OrderSideBuy, 2000, 1))
	engine.AddOrder(createTestOrder(types.OrderSideBuy, 1999, 2))
	engine.AddOrder(createTestOrder(types.OrderSideSell, 2001, 1))
	engine.AddOrder(createTestOrder(types.OrderSideSell, 2002, 2))

	// 获取订单簿快照
	snapshot := engine.GetOrderBook("WETH-USDC", 10)
	
	assert.Equal(t, "WETH-USDC", snapshot.TradingPair)
	assert.Equal(t, 2, len(snapshot.Bids))
	assert.Equal(t, 2, len(snapshot.Asks))
	
	// 验证价格排序
	assert.True(t, snapshot.Bids[0].Price.GreaterThan(snapshot.Bids[1].Price), "买单应该按价格降序")
	assert.True(t, snapshot.Asks[0].Price.LessThan(snapshot.Asks[1].Price), "卖单应该按价格升序")
}

func TestMarketOrder(t *testing.T) {
	engine := setupTestEngine()

	// 添加限价单
	engine.AddOrder(createTestOrder(types.OrderSideSell, 2000, 1))
	engine.AddOrder(createTestOrder(types.OrderSideSell, 2001, 2))

	// 添加市价买单
	marketOrder := &types.Order{
		ID:          uuid.New(),
		UserAddress: "0x1234567890123456789012345678901234567890",
		TradingPair: "WETH-USDC",
		BaseToken:   "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		QuoteToken:  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
		Side:        types.OrderSideBuy,
		Type:        types.OrderTypeMarket,
		Price:       decimal.Zero, // 市价单不需要价格
		Amount:      decimal.NewFromFloat(2),
		Status:      types.OrderStatusOpen,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	fills := engine.AddOrder(marketOrder)
	
	assert.Equal(t, 2, len(fills), "市价单应该匹配两个卖单")
	assert.Equal(t, types.OrderStatusFilled, marketOrder.Status)
}

func TestOrderExpiration(t *testing.T) {
	// 创建已过期的订单
	expiredTime := time.Now().Add(-1 * time.Hour)
	expiredOrder := &types.Order{
		ID:          uuid.New(),
		UserAddress: "0x1234567890123456789012345678901234567890",
		TradingPair: "WETH-USDC",
		BaseToken:   "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		QuoteToken:  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
		Side:        types.OrderSideBuy,
		Type:        types.OrderTypeLimit,
		Price:       decimal.NewFromFloat(2000),
		Amount:      decimal.NewFromFloat(1),
		ExpiresAt:   &expiredTime,
		Status:      types.OrderStatusOpen,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	assert.True(t, expiredOrder.IsExpired(), "订单应该已过期")
}

func BenchmarkAddOrder(b *testing.B) {
	engine := setupTestEngine()
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		order := createTestOrder(types.OrderSideBuy, 2000+float64(i), 1)
		engine.AddOrder(order)
	}
}

func BenchmarkMatchOrder(b *testing.B) {
	engine := setupTestEngine()
	
	// 预先添加一些订单
	for i := 0; i < 100; i++ {
		engine.AddOrder(createTestOrder(types.OrderSideBuy, 2000-float64(i), 1))
	}
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		order := createTestOrder(types.OrderSideSell, 1999, 0.1)
		engine.AddOrder(order)
	}
}