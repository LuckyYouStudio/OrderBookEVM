package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/sirupsen/logrus"

	"orderbook-engine/internal/matching"
	"orderbook-engine/internal/storage"
	"orderbook-engine/internal/types"
	"orderbook-engine/pkg/crypto"
)

// Handler API处理器
type Handler struct {
	engine     *matching.MatchingEngine
	storage    storage.Storage
	signer     *crypto.OrderSigner
	logger     *logrus.Logger
}

// NewHandler 创建API处理器
func NewHandler(engine *matching.MatchingEngine, storage storage.Storage, signer *crypto.OrderSigner, logger *logrus.Logger) *Handler {
	return &Handler{
		engine:  engine,
		storage: storage,
		signer:  signer,
		logger:  logger,
	}
}

// PlaceOrder 下单接口
func (h *Handler) PlaceOrder(c *gin.Context) {
	var signedOrder types.SignedOrder
	if err := c.ShouldBindJSON(&signedOrder); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order format", "details": err.Error()})
		return
	}

	// 验证订单签名
	valid, err := h.signer.VerifyOrderSignature(&signedOrder)
	if err != nil {
		h.logger.WithError(err).Error("Failed to verify signature")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Signature verification failed"})
		return
	}
	if !valid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid signature"})
		return
	}

	// 检查订单是否过期
	if signedOrder.ExpiresAt != nil && signedOrder.ExpiresAt.Before(time.Now()) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Order expired"})
		return
	}

	// 生成订单哈希
	orderHash := crypto.GenerateOrderHash(&signedOrder)

	// 检查订单是否已存在
	existingOrder, err := h.storage.GetOrderByHash(orderHash)
	if err == nil && existingOrder != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Order already exists", "order_id": existingOrder.ID})
		return
	}

	// 创建订单
	order := &types.Order{
		ID:          uuid.New(),
		UserAddress: signedOrder.UserAddress,
		TradingPair: signedOrder.TradingPair,
		BaseToken:   signedOrder.BaseToken,
		QuoteToken:  signedOrder.QuoteToken,
		Side:        signedOrder.Side,
		Type:        signedOrder.Type,
		Price:       signedOrder.Price,
		Amount:      signedOrder.Amount,
		ExpiresAt:   signedOrder.ExpiresAt,
		Nonce:       signedOrder.Nonce,
		Signature:   signedOrder.Signature,
		Hash:        orderHash,
		Status:      types.OrderStatusPending,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	// 保存到数据库
	if err := h.storage.CreateOrder(order); err != nil {
		h.logger.WithError(err).Error("Failed to create order")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create order"})
		return
	}

	// 提交到撮合引擎
	fills := h.engine.AddOrder(order)

	// 保存成交记录
	for _, fill := range fills {
		if err := h.storage.CreateFill(fill); err != nil {
			h.logger.WithError(err).Error("Failed to save fill")
		}
	}

	// 更新订单状态
	if err := h.storage.UpdateOrder(order); err != nil {
		h.logger.WithError(err).Error("Failed to update order")
	}

	h.logger.WithFields(logrus.Fields{
		"order_id":     order.ID,
		"user_address": order.UserAddress,
		"trading_pair": order.TradingPair,
		"side":         order.Side,
		"amount":       order.Amount.String(),
		"price":        order.Price.String(),
		"fills":        len(fills),
	}).Info("Order placed")

	c.JSON(http.StatusCreated, gin.H{
		"order_id": order.ID,
		"status":   order.Status,
		"fills":    fills,
	})
}

// CancelOrder 取消订单接口
func (h *Handler) CancelOrder(c *gin.Context) {
	orderIDStr := c.Param("order_id")
	orderID, err := uuid.Parse(orderIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order ID"})
		return
	}

	userAddress := c.Query("user_address")
	if userAddress == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "User address required"})
		return
	}

	// 获取订单
	order, err := h.storage.GetOrder(orderID)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get order")
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	// 验证用户权限
	if order.UserAddress != userAddress {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not authorized to cancel this order"})
		return
	}

	// 检查订单状态
	if !order.IsActive() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Order cannot be cancelled", "status": order.Status})
		return
	}

	// 从撮合引擎中取消
	success := h.engine.CancelOrder(orderID, order.TradingPair)
	if !success {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to cancel order in engine"})
		return
	}

	// 更新数据库
	if err := h.storage.UpdateOrder(order); err != nil {
		h.logger.WithError(err).Error("Failed to update cancelled order")
	}

	h.logger.WithFields(logrus.Fields{
		"order_id":     order.ID,
		"user_address": order.UserAddress,
		"trading_pair": order.TradingPair,
	}).Info("Order cancelled")

	c.JSON(http.StatusOK, gin.H{
		"order_id": order.ID,
		"status":   order.Status,
	})
}

// GetOrderBook 获取订单簿接口
func (h *Handler) GetOrderBook(c *gin.Context) {
	tradingPair := c.Param("trading_pair")
	if tradingPair == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Trading pair required"})
		return
	}

	depthStr := c.DefaultQuery("depth", "20")
	depth, err := strconv.Atoi(depthStr)
	if err != nil || depth <= 0 || depth > 100 {
		depth = 20
	}

	orderBook := h.engine.GetOrderBook(tradingPair, depth)
	c.JSON(http.StatusOK, orderBook)
}

// GetOrders 获取用户订单列表
func (h *Handler) GetOrders(c *gin.Context) {
	userAddress := c.Query("user_address")
	if userAddress == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "User address required"})
		return
	}

	tradingPair := c.Query("trading_pair")
	status := c.Query("status")
	
	limitStr := c.DefaultQuery("limit", "50")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 || limit > 100 {
		limit = 50
	}

	offsetStr := c.DefaultQuery("offset", "0")
	offset, err := strconv.Atoi(offsetStr)
	if err != nil || offset < 0 {
		offset = 0
	}

	orders, err := h.storage.GetUserOrders(userAddress, tradingPair, status, limit, offset)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get user orders")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get orders"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"orders": orders,
		"total":  len(orders),
	})
}

// GetOrder 获取单个订单详情
func (h *Handler) GetOrder(c *gin.Context) {
	orderIDStr := c.Param("order_id")
	orderID, err := uuid.Parse(orderIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order ID"})
		return
	}

	order, err := h.storage.GetOrder(orderID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	c.JSON(http.StatusOK, order)
}

// GetTrades 获取交易历史
func (h *Handler) GetTrades(c *gin.Context) {
	tradingPair := c.Query("trading_pair")
	
	limitStr := c.DefaultQuery("limit", "50")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 || limit > 100 {
		limit = 50
	}

	fills, err := h.storage.GetRecentFills(tradingPair, limit)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get trades")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get trades"})
		return
	}

	// 转换为交易格式
	trades := make([]types.Trade, len(fills))
	for i, fill := range fills {
		trades[i] = types.Trade{
			ID:          fill.ID,
			TradingPair: fill.TradingPair,
			Price:       fill.Price,
			Amount:      fill.Amount,
			Side:        fill.TakerSide,
			Timestamp:   fill.CreatedAt,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"trades": trades,
		"total":  len(trades),
	})
}

// GetStats 获取交易对统计信息
func (h *Handler) GetStats(c *gin.Context) {
	tradingPair := c.Param("trading_pair")
	if tradingPair == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Trading pair required"})
		return
	}

	stats, err := h.storage.GetTradingPairStats(tradingPair, 24*time.Hour)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get trading pair stats")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get stats"})
		return
	}

	c.JSON(http.StatusOK, stats)
}

// HealthCheck 健康检查接口
func (h *Handler) HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"timestamp": time.Now(),
		"version":   "1.0.0",
	})
}

// Middleware 中间件
func (h *Handler) CORSMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

// LoggerMiddleware 日志中间件
func (h *Handler) LoggerMiddleware() gin.HandlerFunc {
	return gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		h.logger.WithFields(logrus.Fields{
			"status_code": param.StatusCode,
			"latency":     param.Latency,
			"client_ip":   param.ClientIP,
			"method":      param.Method,
			"path":        param.Path,
			"user_agent":  param.Request.UserAgent(),
		}).Info("HTTP Request")
		return ""
	})
}