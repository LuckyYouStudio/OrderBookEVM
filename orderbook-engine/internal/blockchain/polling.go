package blockchain

import (
	"context"
	"fmt"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	"github.com/shopspring/decimal"

	"orderbook-engine/internal/matching"
	"orderbook-engine/internal/types"
)

// OrderPollingService 订单轮询服务
type OrderPollingService struct {
	client       *Client
	engine       *matching.MatchingEngine
	logger       *logrus.Logger
	lastBlock    uint64
	pollInterval time.Duration
}

// NewOrderPollingService 创建轮询服务
func NewOrderPollingService(client *Client, engine *matching.MatchingEngine, logger *logrus.Logger) *OrderPollingService {
	return &OrderPollingService{
		client:       client,
		engine:       engine,
		logger:       logger,
		pollInterval: 5 * time.Second, // 每5秒轮询一次
	}
}

// Start 启动轮询服务
func (ops *OrderPollingService) Start(ctx context.Context) error {
	// 获取当前区块高度
	header, err := ops.client.client.HeaderByNumber(ctx, nil)
	if err != nil {
		return err
	}
	ops.lastBlock = header.Number.Uint64()

	ops.logger.WithField("start_block", ops.lastBlock).Info("Starting order polling service")

	ticker := time.NewTicker(ops.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			ops.logger.Info("Order polling service stopped")
			return nil
		case <-ticker.C:
			if err := ops.pollNewOrders(ctx); err != nil {
				ops.logger.WithError(err).Error("Failed to poll orders")
			}
		}
	}
}

// pollNewOrders 轮询新订单
func (ops *OrderPollingService) pollNewOrders(ctx context.Context) error {
	// 获取最新区块
	header, err := ops.client.client.HeaderByNumber(ctx, nil)
	if err != nil {
		return err
	}

	currentBlock := header.Number.Uint64()
	if currentBlock <= ops.lastBlock {
		return nil // 没有新区块
	}

	ops.logger.WithFields(logrus.Fields{
		"from_block": ops.lastBlock + 1,
		"to_block":   currentBlock,
	}).Debug("Polling new blocks for orders")

	// 这里我们简化处理：直接调用合约获取所有OPEN订单
	// 在生产环境中应该解析事件日志
	err = ops.processOpenOrders(ctx)
	if err != nil {
		return err
	}

	ops.lastBlock = currentBlock
	return nil
}

// processOpenOrders 处理所有OPEN状态的订单
func (ops *OrderPollingService) processOpenOrders(ctx context.Context) error {
	// 这里需要实现合约调用来获取OPEN订单
	// 由于合约结构复杂，我们采用另一种方法：
	// 让前端在下单后主动通知引擎
	ops.logger.Debug("Processing open orders (placeholder)")
	return nil
}

// ProcessOrderFromFrontend 处理来自前端的订单
func (ops *OrderPollingService) ProcessOrderFromFrontend(orderData map[string]interface{}) error {
	// 解析订单数据
	userAddress, ok := orderData["userAddress"].(string)
	if !ok {
		return fmt.Errorf("invalid userAddress")
	}

	tokenA, ok := orderData["tokenA"].(string)
	if !ok {
		return fmt.Errorf("invalid tokenA")
	}

	tokenB, ok := orderData["tokenB"].(string)
	if !ok {
		return fmt.Errorf("invalid tokenB")
	}

	priceStr, ok := orderData["price"].(string)
	if !ok {
		return fmt.Errorf("invalid price")
	}

	amountStr, ok := orderData["amount"].(string)
	if !ok {
		return fmt.Errorf("invalid amount")
	}

	isBuy, ok := orderData["isBuy"].(bool)
	if !ok {
		return fmt.Errorf("invalid isBuy")
	}

	// 转换数据类型
	price, err := decimal.NewFromString(priceStr)
	if err != nil {
		return fmt.Errorf("invalid price format: %v", err)
	}

	amount, err := decimal.NewFromString(amountStr)
	if err != nil {
		return fmt.Errorf("invalid amount format: %v", err)
	}

	// 创建订单对象
	order := &types.Order{
		ID:          uuid.New(),
		UserAddress: userAddress,
		TradingPair: fmt.Sprintf("%s-%s", tokenA, tokenB),
		BaseToken:   tokenA,
		QuoteToken:  tokenB,
		Price:       price,
		Amount:      amount,
		CreatedAt:   time.Now(),
	}

	if isBuy {
		order.Side = types.OrderSideBuy
	} else {
		order.Side = types.OrderSideSell
	}

	// 添加到撮合引擎
	fills := ops.engine.AddOrder(order)

	ops.logger.WithFields(logrus.Fields{
		"user":   userAddress,
		"pair":   order.TradingPair,
		"side":   order.Side,
		"price":  price.String(),
		"amount": amount.String(),
		"fills":  len(fills),
	}).Info("Processed order from frontend")

	// 如果有撮合结果，执行区块链交易
	for _, fill := range fills {
		go ops.executeFill(fill, order)
	}

	return nil
}

// executeFill 执行撮合结果
func (ops *OrderPollingService) executeFill(fill *types.Fill, order *types.Order) {
	// 简化处理：使用配置中的地址作为买卖双方
	buyer := common.HexToAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")
	seller := common.HexToAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")
	tokenA := common.HexToAddress(order.BaseToken)
	tokenB := common.HexToAddress(order.QuoteToken)

	// 转换精度：USDC 6位小数，WETH 18位小数
	priceWei := fill.Price.Mul(decimal.New(1, 6)).BigInt()   // USDC精度
	amountWei := fill.Amount.Mul(decimal.New(1, 18)).BigInt() // WETH精度

	tx, err := ops.client.ExecuteTrade(
		buyer, seller, tokenA, tokenB,
		amountWei, priceWei, false,
	)
	if err != nil {
		ops.logger.WithError(err).Error("Failed to execute blockchain trade")
		return
	}

	ops.logger.WithField("tx_hash", tx.Hash().Hex()).Info("Blockchain trade executed")
}