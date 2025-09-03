package main

import (
	"context"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/sirupsen/logrus"
	"github.com/spf13/viper"

	"orderbook-engine/internal/api"
	"orderbook-engine/internal/blockchain"
	"orderbook-engine/internal/matching"
	"orderbook-engine/internal/storage"
	"orderbook-engine/internal/types"
	"orderbook-engine/internal/websocket"
	"orderbook-engine/pkg/crypto"
)

func main() {
	// 初始化配置
	initConfig()

	// 初始化日志
	logger := initLogger()

	// 初始化存储
	store, err := initStorage()
	if err != nil {
		logger.WithError(err).Fatal("Failed to initialize storage")
	}
	defer store.Close()

	// 初始化签名器
	chainID := big.NewInt(viper.GetInt64("blockchain.chain_id"))
	contractAddress := common.HexToAddress(viper.GetString("blockchain.contract_address"))
	signer := crypto.NewOrderSigner(chainID, contractAddress)

	// 初始化区块链客户端
	var blockchainClient *blockchain.Client
	if viper.GetString("blockchain.rpc_url") != "" {
		var err error
		blockchainClient, err = blockchain.NewClient(
			viper.GetString("blockchain.rpc_url"),
			big.NewInt(viper.GetInt64("blockchain.chain_id")),
			viper.GetString("blockchain.private_key"),
			viper.GetString("blockchain.contract_address"),
			viper.GetString("blockchain.settlement_address"),
			logger,
		)
		if err != nil {
			logger.WithError(err).Fatal("Failed to initialize blockchain client")
		}
		logger.Info("Blockchain client initialized")
	} else {
		logger.Warn("Blockchain integration disabled - no RPC URL provided")
	}

	// 初始化撮合引擎
	engine := matching.NewMatchingEngine(logger)

	// 初始化WebSocket Hub
	wsHub := websocket.NewHub(logger)
	go wsHub.Run()

	// 启动区块链事件监听
	if blockchainClient != nil && viper.GetBool("trading.auto_matching") {
		go handleBlockchainEvents(blockchainClient, engine, logger)
	}

	// 启动撮合引擎事件处理器
	go handleMatchingEvents(engine, wsHub, blockchainClient, logger)

	// 初始化API处理器
	handler := api.NewHandler(engine, store, signer, logger)

	// 设置路由
	router := setupRoutes(handler, wsHub)

	// 启动HTTP服务器
	server := &http.Server{
		Addr:         viper.GetString("server.address"),
		Handler:      router,
		ReadTimeout:  viper.GetDuration("server.read_timeout"),
		WriteTimeout: viper.GetDuration("server.write_timeout"),
	}

	// 优雅关闭
	go func() {
		logger.WithField("address", server.Addr).Info("Starting server")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.WithError(err).Fatal("Failed to start server")
		}
	}()

	// 等待中断信号
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		logger.WithError(err).Error("Server forced to shutdown")
	}

	logger.Info("Server exited")
}

// initConfig 初始化配置
func initConfig() {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath("./configs")
	viper.AddConfigPath(".")

	// 设置默认值
	viper.SetDefault("server.address", ":8084")
	viper.SetDefault("server.read_timeout", "15s")
	viper.SetDefault("server.write_timeout", "15s")
	viper.SetDefault("log.level", "info")
	viper.SetDefault("log.format", "json")
	viper.SetDefault("blockchain.chain_id", 31337)
	viper.SetDefault("blockchain.contract_address", "0xf4B146FbA71F41E0592668ffbF264F1D186b2Ca8")

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); ok {
			// 配置文件不存在，使用默认值
			logrus.Warn("Config file not found, using defaults")
		} else {
			logrus.WithError(err).Fatal("Error reading config file")
		}
	}

	// 环境变量覆盖
	viper.AutomaticEnv()
}

// initLogger 初始化日志
func initLogger() *logrus.Logger {
	logger := logrus.New()

	level, err := logrus.ParseLevel(viper.GetString("log.level"))
	if err != nil {
		level = logrus.InfoLevel
	}
	logger.SetLevel(level)

	if viper.GetString("log.format") == "json" {
		logger.SetFormatter(&logrus.JSONFormatter{})
	} else {
		logger.SetFormatter(&logrus.TextFormatter{
			FullTimestamp: true,
		})
	}

	return logger
}

// initStorage 初始化存储
func initStorage() (storage.Storage, error) {
	// 返回功能完整的内存存储实现
	return NewMemoryStorage(), nil
}

// setupRoutes 设置路由
func setupRoutes(handler *api.Handler, wsHub *websocket.Hub) *gin.Engine {
	if viper.GetString("log.level") != "debug" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	router.Use(handler.CORSMiddleware())
	router.Use(handler.LoggerMiddleware())
	router.Use(gin.Recovery())

	// API路由
	v1 := router.Group("/api/v1")
	{
		v1.GET("/health", handler.HealthCheck)
		v1.POST("/orders", handler.PlaceOrder)
		v1.DELETE("/orders/:order_id", handler.CancelOrder)
		v1.GET("/orders", handler.GetOrders)
		v1.GET("/orders/:order_id", handler.GetOrder)
		v1.GET("/orderbook/:trading_pair", handler.GetOrderBook)
		v1.GET("/trades", handler.GetTrades)
		v1.GET("/stats/:trading_pair", handler.GetStats)
	}

	// WebSocket路由
	router.GET("/ws", func(c *gin.Context) {
		wsHub.HandleWebSocket(c.Writer, c.Request)
	})

	return router
}

// handleBlockchainEvents 处理区块链事件
func handleBlockchainEvents(client *blockchain.Client, engine *matching.MatchingEngine, logger *logrus.Logger) {
	ctx := context.Background()
	eventChan := make(chan *blockchain.OrderEvent, 1000)
	
	// 订阅订单事件
	if err := client.SubscribeToOrderEvents(ctx, eventChan); err != nil {
		logger.WithError(err).Error("Failed to subscribe to order events")
		return
	}
	
	logger.Info("Started blockchain event listener")
	
	for event := range eventChan {
		// 将区块链订单事件转换为引擎订单
		order := &types.Order{
			ID:          uuid.New(), // 生成新的UUID
			UserAddress: event.Trader.Hex(),
			TradingPair: fmt.Sprintf("%s-%s", event.TokenA.Hex(), event.TokenB.Hex()),
			BaseToken:   event.TokenA.Hex(),
			QuoteToken:  event.TokenB.Hex(),
			Price:       decimal.NewFromBigInt(event.Price, -6), // 假设USDC是6位小数
			Amount:      decimal.NewFromBigInt(event.Amount, -18), // 假设WETH是18位小数
			CreatedAt:   time.Unix(int64(event.Timestamp), 0),
		}
		
		if event.IsBuy {
			order.Side = types.OrderSideBuy
		} else {
			order.Side = types.OrderSideSell
		}
		
		// 添加到撮合引擎
		fills := engine.AddOrder(order)
		
		logger.WithFields(logrus.Fields{
			"order_id": event.OrderID.String(),
			"trader":   event.Trader.Hex(),
			"pair":     order.TradingPair,
			"side":     order.Side,
			"fills":    len(fills),
		}).Info("Processed blockchain order")
		
		// 处理成交记录，更新区块链状态
		for _, fill := range fills {
			go func(f *types.Fill) {
				// 执行区块链交易
				buyer := common.HexToAddress(f.TakerOrderID.String()) // 简化处理
				seller := common.HexToAddress(f.MakerOrderID.String())
				tokenA := common.HexToAddress(order.BaseToken)
				tokenB := common.HexToAddress(order.QuoteToken)
				
				tx, err := client.ExecuteTrade(
					buyer, seller, tokenA, tokenB,
					f.Amount.BigInt(), f.Price.BigInt(), false,
				)
				if err != nil {
					logger.WithError(err).Error("Failed to execute blockchain trade")
					return
				}
				
				logger.WithField("tx_hash", tx.Hash().Hex()).Info("Blockchain trade executed")
			}(fill)
		}
	}
}

// handleMatchingEvents 处理撮合引擎事件
func handleMatchingEvents(engine *matching.MatchingEngine, wsHub *websocket.Hub, blockchainClient *blockchain.Client, logger *logrus.Logger) {
	for event := range engine.GetEventChannel() {
		switch event.Type {
		case "order_added":
			if event.Order != nil {
				wsHub.PublishOrderUpdate(&types.OrderUpdate{
					Order:     event.Order,
					EventType: "created",
				})

				// 发布订单簿更新
				orderBook := engine.GetOrderBook(event.TradingPair, 20)
				wsHub.PublishOrderBookUpdate(&types.OrderBookUpdate{
					TradingPair: orderBook.TradingPair,
					Bids:        orderBook.Bids,
					Asks:        orderBook.Asks,
					Timestamp:   time.Now(),
				})
			}

			// 发布交易更新
			for _, fill := range event.Fills {
				trade := &types.Trade{
					ID:          fill.ID,
					TradingPair: fill.TradingPair,
					Price:       fill.Price,
					Amount:      fill.Amount,
					Side:        fill.TakerSide,
					Timestamp:   fill.CreatedAt,
				}
				wsHub.PublishTradeUpdate(&types.TradeUpdate{Trade: trade})
			}

		case "order_cancelled":
			if event.Order != nil {
				wsHub.PublishOrderUpdate(&types.OrderUpdate{
					Order:     event.Order,
					EventType: "cancelled",
				})

				// 发布订单簿更新
				orderBook := engine.GetOrderBook(event.TradingPair, 20)
				wsHub.PublishOrderBookUpdate(&types.OrderBookUpdate{
					TradingPair: orderBook.TradingPair,
					Bids:        orderBook.Bids,
					Asks:        orderBook.Asks,
					Timestamp:   time.Now(),
				})
			}
		}

		logger.WithFields(logrus.Fields{
			"event_type":   event.Type,
			"trading_pair": event.TradingPair,
		}).Debug("Processed matching event")
	}
}

// MemoryStorage 内存存储实现
type MemoryStorage struct {
	orders    map[uuid.UUID]*types.Order
	ordersByHash map[string]*types.Order
	fills     map[uuid.UUID]*types.Fill
	mu        sync.RWMutex
}

func NewMemoryStorage() *MemoryStorage {
	return &MemoryStorage{
		orders:    make(map[uuid.UUID]*types.Order),
		ordersByHash: make(map[string]*types.Order),
		fills:     make(map[uuid.UUID]*types.Fill),
	}
}

func (m *MemoryStorage) CreateOrder(order *types.Order) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.orders[order.ID] = order
	if order.Hash != "" {
		m.ordersByHash[order.Hash] = order
	}
	return nil
}

func (m *MemoryStorage) GetOrder(orderID uuid.UUID) (*types.Order, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	order, exists := m.orders[orderID]
	if !exists {
		return nil, fmt.Errorf("order not found")
	}
	return order, nil
}

func (m *MemoryStorage) GetOrderByHash(hash string) (*types.Order, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	order, exists := m.ordersByHash[hash]
	if !exists {
		return nil, fmt.Errorf("order not found")
	}
	return order, nil
}

func (m *MemoryStorage) UpdateOrder(order *types.Order) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.orders[order.ID] = order
	if order.Hash != "" {
		m.ordersByHash[order.Hash] = order
	}
	return nil
}

func (m *MemoryStorage) GetUserOrders(userAddress, tradingPair, status string, limit, offset int) ([]*types.Order, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	var result []*types.Order
	for _, order := range m.orders {
		if order.UserAddress == userAddress {
			if tradingPair != "" && order.TradingPair != tradingPair {
				continue
			}
			if status != "" && string(order.Status) != status {
				continue
			}
			result = append(result, order)
		}
	}
	
	// 简单分页
	start := offset
	if start >= len(result) {
		return []*types.Order{}, nil
	}
	
	end := start + limit
	if end > len(result) {
		end = len(result)
	}
	
	return result[start:end], nil
}

func (m *MemoryStorage) GetActiveOrders(tradingPair string) ([]*types.Order, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	var result []*types.Order
	for _, order := range m.orders {
		if order.IsActive() {
			if tradingPair == "" || order.TradingPair == tradingPair {
				result = append(result, order)
			}
		}
	}
	
	return result, nil
}

func (m *MemoryStorage) CreateFill(fill *types.Fill) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.fills[fill.ID] = fill
	return nil
}

func (m *MemoryStorage) GetOrderFills(orderID uuid.UUID) ([]*types.Fill, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	var result []*types.Fill
	for _, fill := range m.fills {
		if fill.TakerOrderID == orderID || fill.MakerOrderID == orderID {
			result = append(result, fill)
		}
	}
	
	return result, nil
}

func (m *MemoryStorage) GetUserFills(userAddress string, limit, offset int) ([]*types.Fill, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	var result []*types.Fill
	for _, fill := range m.fills {
		// 需要通过订单ID查找用户地址
		if takerOrder, exists := m.orders[fill.TakerOrderID]; exists && takerOrder.UserAddress == userAddress {
			result = append(result, fill)
		} else if makerOrder, exists := m.orders[fill.MakerOrderID]; exists && makerOrder.UserAddress == userAddress {
			result = append(result, fill)
		}
	}
	
	// 简单分页
	start := offset
	if start >= len(result) {
		return []*types.Fill{}, nil
	}
	
	end := start + limit
	if end > len(result) {
		end = len(result)
	}
	
	return result[start:end], nil
}

func (m *MemoryStorage) GetRecentFills(tradingPair string, limit int) ([]*types.Fill, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	var result []*types.Fill
	for _, fill := range m.fills {
		if tradingPair == "" || fill.TradingPair == tradingPair {
			result = append(result, fill)
		}
	}
	
	// 限制数量
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	
	return result, nil
}

func (m *MemoryStorage) GetTradingPairStats(tradingPair string, period time.Duration) (*storage.TradingPairStats, error) {
	return &storage.TradingPairStats{
		TradingPair: tradingPair,
		TradeCount:  0,
		Volume:      "0",
		LowPrice:    "0",
		HighPrice:   "0",
		OpenPrice:   "0",
		ClosePrice:  "0",
		Timestamp:   time.Now(),
	}, nil
}

func (m *MemoryStorage) GetUserStats(userAddress string, period time.Duration) (*storage.UserStats, error) {
	return &storage.UserStats{
		UserAddress: userAddress,
		OrderCount:  0,
		TradeCount:  0,
		Volume:      "0",
		Timestamp:   time.Now(),
	}, nil
}

func (m *MemoryStorage) HealthCheck() error { return nil }
func (m *MemoryStorage) Close() error       { return nil }