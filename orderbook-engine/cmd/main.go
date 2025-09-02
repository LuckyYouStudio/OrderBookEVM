package main

import (
	"context"
	"math/big"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
	"github.com/spf13/viper"

	"orderbook-engine/internal/api"
	"orderbook-engine/internal/matching"
	"orderbook-engine/internal/storage"
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

	// 初始化撮合引擎
	engine := matching.NewMatchingEngine(logger)

	// 初始化WebSocket Hub
	wsHub := websocket.NewHub(logger)
	go wsHub.Run()

	// 启动事件处理器
	go handleMatchingEvents(engine, wsHub, logger)

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
	viper.SetDefault("server.address", ":8080")
	viper.SetDefault("server.read_timeout", "15s")
	viper.SetDefault("server.write_timeout", "15s")
	viper.SetDefault("log.level", "info")
	viper.SetDefault("log.format", "json")
	viper.SetDefault("blockchain.chain_id", 31337)
	viper.SetDefault("blockchain.contract_address", "0x0000000000000000000000000000000000000000")

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
	// 这里应该根据配置选择存储实现
	// 目前返回一个内存存储的模拟实现
	return &MemoryStorage{}, nil
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

// handleMatchingEvents 处理撮合引擎事件
func handleMatchingEvents(engine *matching.MatchingEngine, wsHub *websocket.Hub, logger *logrus.Logger) {
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

// MemoryStorage 内存存储实现（用于演示）
type MemoryStorage struct{}

func (m *MemoryStorage) CreateOrder(order *types.Order) error        { return nil }
func (m *MemoryStorage) GetOrder(orderID uuid.UUID) (*types.Order, error) { return nil, nil }
func (m *MemoryStorage) GetOrderByHash(hash string) (*types.Order, error) { return nil, nil }
func (m *MemoryStorage) UpdateOrder(order *types.Order) error        { return nil }
func (m *MemoryStorage) GetUserOrders(userAddress, tradingPair, status string, limit, offset int) ([]*types.Order, error) {
	return []*types.Order{}, nil
}
func (m *MemoryStorage) GetActiveOrders(tradingPair string) ([]*types.Order, error) { return []*types.Order{}, nil }
func (m *MemoryStorage) CreateFill(fill *types.Fill) error             { return nil }
func (m *MemoryStorage) GetOrderFills(orderID uuid.UUID) ([]*types.Fill, error) { return []*types.Fill{}, nil }
func (m *MemoryStorage) GetUserFills(userAddress string, limit, offset int) ([]*types.Fill, error) {
	return []*types.Fill{}, nil
}
func (m *MemoryStorage) GetRecentFills(tradingPair string, limit int) ([]*types.Fill, error) {
	return []*types.Fill{}, nil
}
func (m *MemoryStorage) GetTradingPairStats(tradingPair string, period time.Duration) (*storage.TradingPairStats, error) {
	return &storage.TradingPairStats{}, nil
}
func (m *MemoryStorage) GetUserStats(userAddress string, period time.Duration) (*storage.UserStats, error) {
	return &storage.UserStats{}, nil
}
func (m *MemoryStorage) HealthCheck() error { return nil }
func (m *MemoryStorage) Close() error       { return nil }