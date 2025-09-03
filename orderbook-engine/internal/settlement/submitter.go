package settlement

import (
	"context"
	"fmt"
	"math/big"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/shopspring/decimal"
	"github.com/sirupsen/logrus"

	"orderbook-engine/internal/types"
)

// SettlementSubmitter 结算提交器
// 负责将链下撮合的结果打包提交到区块链
type SettlementSubmitter struct {
	mu                sync.RWMutex
	client            *ethclient.Client
	contractAddress   common.Address
	privateKey        string
	batchSize         int
	batchTimeout      time.Duration
	pendingFills      []*types.Fill
	pendingOrders     map[string]*types.Order // orderHash -> Order
	orderSignatures   map[string]string       // orderHash -> signature
	lastBatchTime     time.Time
	logger            *logrus.Logger
	shutdown          chan struct{}
	wg                sync.WaitGroup
}

// BatchSettlementData 批量结算数据
type BatchSettlementData struct {
	TakerOrders      []*types.Order
	MakerOrders      []*types.Order
	TakerSignatures  []string
	MakerSignatures  []string
	Fills            []*types.Fill
}

// NewSettlementSubmitter 创建结算提交器
func NewSettlementSubmitter(
	client *ethclient.Client,
	contractAddress common.Address,
	privateKey string,
	batchSize int,
	batchTimeout time.Duration,
	logger *logrus.Logger,
) *SettlementSubmitter {
	return &SettlementSubmitter{
		client:          client,
		contractAddress: contractAddress,
		privateKey:      privateKey,
		batchSize:       batchSize,
		batchTimeout:    batchTimeout,
		pendingFills:    make([]*types.Fill, 0, batchSize),
		pendingOrders:   make(map[string]*types.Order),
		orderSignatures: make(map[string]string),
		lastBatchTime:   time.Now(),
		logger:          logger,
		shutdown:        make(chan struct{}),
	}
}

// Start 启动结算提交器
func (s *SettlementSubmitter) Start() {
	s.wg.Add(1)
	go s.batchProcessor()
	s.logger.Info("Settlement submitter started")
}

// Stop 停止结算提交器
func (s *SettlementSubmitter) Stop() {
	close(s.shutdown)
	s.wg.Wait()
	s.logger.Info("Settlement submitter stopped")
}

// SubmitFill 提交成交记录
func (s *SettlementSubmitter) SubmitFill(
	fill *types.Fill,
	takerOrder *types.Order,
	makerOrder *types.Order,
	takerSignature string,
	makerSignature string,
) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 添加到待处理列表
	s.pendingFills = append(s.pendingFills, fill)

	// 缓存订单和签名
	takerHash := s.getOrderHash(takerOrder)
	makerHash := s.getOrderHash(makerOrder)

	s.pendingOrders[takerHash] = takerOrder
	s.pendingOrders[makerHash] = makerOrder
	s.orderSignatures[takerHash] = takerSignature
	s.orderSignatures[makerHash] = makerSignature

	s.logger.WithFields(logrus.Fields{
		"fill_id":        fill.ID.String(),
		"taker_order_id": fill.TakerOrderID.String(),
		"maker_order_id": fill.MakerOrderID.String(),
		"amount":         fill.Amount.String(),
		"price":          fill.Price.String(),
		"pending_count":  len(s.pendingFills),
	}).Debug("Fill added to settlement queue")

	// 检查是否需要立即处理批次
	if s.shouldProcessBatch() {
		go s.processBatch()
	}
}

// shouldProcessBatch 检查是否应该处理批次
func (s *SettlementSubmitter) shouldProcessBatch() bool {
	return len(s.pendingFills) >= s.batchSize ||
		time.Since(s.lastBatchTime) >= s.batchTimeout
}

// batchProcessor 批次处理器
func (s *SettlementSubmitter) batchProcessor() {
	defer s.wg.Done()

	ticker := time.NewTicker(s.batchTimeout / 2) // 检查频率是超时时间的一半
	defer ticker.Stop()

	for {
		select {
		case <-s.shutdown:
			// 关闭前处理剩余的批次
			s.processBatch()
			return
		case <-ticker.C:
			s.mu.RLock()
			shouldProcess := len(s.pendingFills) > 0 &&
				time.Since(s.lastBatchTime) >= s.batchTimeout
			s.mu.RUnlock()

			if shouldProcess {
				s.processBatch()
			}
		}
	}
}

// processBatch 处理批次
func (s *SettlementSubmitter) processBatch() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.pendingFills) == 0 {
		return
	}

	// 准备批量结算数据
	batchData := s.prepareBatchData()
	if batchData == nil {
		return
	}

	// 提交到区块链
	txHash, err := s.submitBatchSettlement(batchData)
	if err != nil {
		s.logger.WithError(err).Error("Failed to submit batch settlement")
		return
	}

	s.logger.WithFields(logrus.Fields{
		"tx_hash":    txHash.Hex(),
		"fills":      len(batchData.Fills),
		"takers":     len(batchData.TakerOrders),
		"makers":     len(batchData.MakerOrders),
	}).Info("Batch settlement submitted successfully")

	// 清空待处理列表
	s.clearPendingData()
	s.lastBatchTime = time.Now()
}

// prepareBatchData 准备批量数据
func (s *SettlementSubmitter) prepareBatchData() *BatchSettlementData {
	if len(s.pendingFills) == 0 {
		return nil
	}

	// 去重订单
	takerOrdersMap := make(map[string]*types.Order)
	makerOrdersMap := make(map[string]*types.Order)
	takerSigsMap := make(map[string]string)
	makerSigsMap := make(map[string]string)

	for _, fill := range s.pendingFills {
		takerHash := fill.TakerOrderID.String() // 简化处理
		makerHash := fill.MakerOrderID.String()

		if takerOrder, exists := s.pendingOrders[takerHash]; exists {
			takerOrdersMap[takerHash] = takerOrder
			takerSigsMap[takerHash] = s.orderSignatures[takerHash]
		}

		if makerOrder, exists := s.pendingOrders[makerHash]; exists {
			makerOrdersMap[makerHash] = makerOrder
			makerSigsMap[makerHash] = s.orderSignatures[makerHash]
		}
	}

	// 转换为数组
	takerOrders := make([]*types.Order, 0, len(takerOrdersMap))
	takerSigs := make([]string, 0, len(takerOrdersMap))
	for hash, order := range takerOrdersMap {
		takerOrders = append(takerOrders, order)
		takerSigs = append(takerSigs, takerSigsMap[hash])
	}

	makerOrders := make([]*types.Order, 0, len(makerOrdersMap))
	makerSigs := make([]string, 0, len(makerOrdersMap))
	for hash, order := range makerOrdersMap {
		makerOrders = append(makerOrders, order)
		makerSigs = append(makerSigs, makerSigsMap[hash])
	}

	return &BatchSettlementData{
		TakerOrders:     takerOrders,
		MakerOrders:     makerOrders,
		TakerSignatures: takerSigs,
		MakerSignatures: makerSigs,
		Fills:           append([]*types.Fill{}, s.pendingFills...), // 复制
	}
}

// submitBatchSettlement 提交批量结算到区块链
func (s *SettlementSubmitter) submitBatchSettlement(batchData *BatchSettlementData) (common.Hash, error) {
	// 这里应该调用实际的智能合约方法
	// 为了简化，我们使用一个模拟的交易

	privateKey, err := crypto.HexToECDSA(s.privateKey)
	if err != nil {
		return common.Hash{}, fmt.Errorf("invalid private key: %w", err)
	}

	// 获取链ID
	chainID, err := s.client.NetworkID(context.Background())
	if err != nil {
		return common.Hash{}, fmt.Errorf("failed to get network ID: %w", err)
	}

	// 创建交易选项
	auth, err := bind.NewKeyedTransactorWithChainID(privateKey, chainID)
	if err != nil {
		return common.Hash{}, fmt.Errorf("failed to create transactor: %w", err)
	}

	// 设置 Gas 参数（实际使用时需要根据具体合约调整）
	auth.GasLimit = uint64(500000 * len(batchData.Fills)) // 每个成交约50万gas
	auth.GasPrice, err = s.client.SuggestGasPrice(context.Background())
	if err != nil {
		s.logger.WithError(err).Warn("Failed to get gas price, using default")
		auth.GasPrice = big.NewInt(20000000000) // 20 gwei
	}

	// 这里应该调用实际的合约方法
	// 例如：contract.BatchSettle(auth, batchData)
	// 暂时返回一个模拟的交易哈希
	txHash := common.HexToHash(fmt.Sprintf("0x%x", time.Now().UnixNano()))

	s.logger.WithFields(logrus.Fields{
		"gas_limit": auth.GasLimit,
		"gas_price": auth.GasPrice.String(),
		"fills":     len(batchData.Fills),
	}).Debug("Batch settlement transaction parameters")

	return txHash, nil
}

// clearPendingData 清空待处理数据
func (s *SettlementSubmitter) clearPendingData() {
	s.pendingFills = s.pendingFills[:0]                   // 保留底层数组
	s.pendingOrders = make(map[string]*types.Order)      // 清空订单缓存
	s.orderSignatures = make(map[string]string)          // 清空签名缓存
}

// getOrderHash 获取订单哈希（简化版本）
func (s *SettlementSubmitter) getOrderHash(order *types.Order) string {
	return fmt.Sprintf("%s-%s-%s-%d",
		order.UserAddress,
		order.TradingPair,
		order.Price.String(),
		order.Nonce,
	)
}

// GetPendingCount 获取待处理的成交数量
func (s *SettlementSubmitter) GetPendingCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.pendingFills)
}

// GetStats 获取统计信息
func (s *SettlementSubmitter) GetStats() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return map[string]interface{}{
		"pending_fills":     len(s.pendingFills),
		"pending_orders":    len(s.pendingOrders),
		"batch_size":        s.batchSize,
		"batch_timeout":     s.batchTimeout.String(),
		"last_batch_time":   s.lastBatchTime.Format(time.RFC3339),
		"time_since_batch":  time.Since(s.lastBatchTime).String(),
	}
}

// ForceBatch 强制处理当前批次
func (s *SettlementSubmitter) ForceBatch() {
	s.processBatch()
}
