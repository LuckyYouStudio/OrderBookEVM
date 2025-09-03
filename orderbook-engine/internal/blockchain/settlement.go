package blockchain

import (
	"context"
	"crypto/ecdsa"
	"math/big"
	"time"
	"fmt"
	"log"
	"sync"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"

	ordertypes "orderbook-engine/internal/types"
)

// SettlementManager 链上结算管理器
type SettlementManager struct {
	client               *ethclient.Client
	settlementContract   common.Address
	privateKey          *ecdsa.PrivateKey
	auth                *bind.TransactOpts
	chainID             *big.Int
	batchSize           int
	settlementQueue     chan *PendingSettlement
	batchTimer          *time.Timer
	pendingSettlements  []*PendingSettlement
	mu                  sync.RWMutex
	running             bool
	stopCh              chan struct{}
}

// PendingSettlement 待结算交易
type PendingSettlement struct {
	TakerOrderHash  [32]byte
	MakerOrderHash  [32]byte
	Price           *big.Int
	Amount          *big.Int
	TakerSide       uint8
	TakerOrder      *CompactOrder
	MakerOrder      *CompactOrder
	TakerSignature  []byte
	MakerSignature  []byte
	Timestamp       time.Time
}

// CompactOrder 紧凑订单结构（匹配Solidity）
type CompactOrder struct {
	UserAddress common.Address
	BaseToken   common.Address
	QuoteToken  common.Address
	Price       *big.Int // 128位
	Amount      *big.Int // 128位
	ExpiresAt   uint64
	Nonce       uint64
	Side        uint8
	OrderType   uint8
}

// BatchFill 批量成交结构（匹配Solidity）
type BatchFill struct {
	TakerOrderHashes [][32]byte
	MakerOrderHashes [][32]byte
	Prices           []*big.Int
	Amounts          []*big.Int
	TakerSides       []uint8
	TakerSignatures  [][]byte
	MakerSignatures  [][]byte
	TakerOrders      []CompactOrder
	MakerOrders      []CompactOrder
}

// NewSettlementManager 创建结算管理器
func NewSettlementManager(
	rpcURL string,
	settlementAddress common.Address,
	privateKeyHex string,
	chainID *big.Int,
) (*SettlementManager, error) {
	// 连接以太坊节点
	client, err := ethclient.Dial(rpcURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Ethereum node: %w", err)
	}

	// 解析私钥
	privateKey, err := crypto.HexToECDSA(privateKeyHex)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	// 创建交易认证
	auth, err := bind.NewKeyedTransactorWithChainID(privateKey, chainID)
	if err != nil {
		return nil, fmt.Errorf("failed to create auth: %w", err)
	}

	// 设置Gas参数
	auth.GasLimit = uint64(3000000) // 3M gas limit for batch transactions
	auth.GasPrice = big.NewInt(20000000000) // 20 gwei

	sm := &SettlementManager{
		client:              client,
		settlementContract:  settlementAddress,
		privateKey:          privateKey,
		auth:                auth,
		chainID:             chainID,
		batchSize:           10, // 每批处理10笔交易
		settlementQueue:     make(chan *PendingSettlement, 1000),
		pendingSettlements:  make([]*PendingSettlement, 0),
		stopCh:              make(chan struct{}),
	}

	return sm, nil
}

// Start 启动结算管理器
func (sm *SettlementManager) Start() {
	sm.mu.Lock()
	if sm.running {
		sm.mu.Unlock()
		return
	}
	sm.running = true
	sm.mu.Unlock()

	log.Println("🚀 Settlement Manager started - 链上结算管理器已启动")

	// 启动批量处理器
	go sm.batchProcessor()
	
	// 启动定时器（每5秒强制执行一次批量结算）
	sm.batchTimer = time.NewTimer(5 * time.Second)
	go sm.timerProcessor()
}

// Stop 停止结算管理器
func (sm *SettlementManager) Stop() {
	sm.mu.Lock()
	if !sm.running {
		sm.mu.Unlock()
		return
	}
	sm.running = false
	sm.mu.Unlock()

	close(sm.stopCh)
	if sm.batchTimer != nil {
		sm.batchTimer.Stop()
	}
	log.Println("⏹️  Settlement Manager stopped - 链上结算管理器已停止")
}

// SubmitTradeForSettlement 提交交易到结算队列
func (sm *SettlementManager) SubmitTradeForSettlement(
	takerOrder *ordertypes.SignedOrder,
	makerOrder *ordertypes.SignedOrder,
	fillPrice *big.Int,
	fillAmount *big.Int,
) error {
	// 转换订单格式
	takerCompact, err := sm.convertToCompactOrder(takerOrder)
	if err != nil {
		return fmt.Errorf("failed to convert taker order: %w", err)
	}

	makerCompact, err := sm.convertToCompactOrder(makerOrder)
	if err != nil {
		return fmt.Errorf("failed to convert maker order: %w", err)
	}

	// 生成订单哈希
	takerHash := sm.generateOrderHash(takerOrder)
	makerHash := sm.generateOrderHash(makerOrder)

	// 解析签名
	takerSig, err := hexToBytes(takerOrder.Signature)
	if err != nil {
		return fmt.Errorf("invalid taker signature: %w", err)
	}

	makerSig, err := hexToBytes(makerOrder.Signature)
	if err != nil {
		return fmt.Errorf("invalid maker signature: %w", err)
	}

	// 确定taker方向
	var takerSide uint8
	if takerOrder.Side == ordertypes.OrderSideBuy {
		takerSide = 0
	} else {
		takerSide = 1
	}

	settlement := &PendingSettlement{
		TakerOrderHash:  takerHash,
		MakerOrderHash:  makerHash,
		Price:           fillPrice,
		Amount:          fillAmount,
		TakerSide:       takerSide,
		TakerOrder:      takerCompact,
		MakerOrder:      makerCompact,
		TakerSignature:  takerSig,
		MakerSignature:  makerSig,
		Timestamp:       time.Now(),
	}

	select {
	case sm.settlementQueue <- settlement:
		log.Printf("📝 Trade queued for settlement: %x vs %x, amount: %s", 
			takerHash[:8], makerHash[:8], fillAmount.String())
		return nil
	default:
		return fmt.Errorf("settlement queue is full")
	}
}

// batchProcessor 批量处理器
func (sm *SettlementManager) batchProcessor() {
	for {
		select {
		case <-sm.stopCh:
			return
		case settlement := <-sm.settlementQueue:
			sm.mu.Lock()
			sm.pendingSettlements = append(sm.pendingSettlements, settlement)
			shouldProcess := len(sm.pendingSettlements) >= sm.batchSize
			sm.mu.Unlock()

			if shouldProcess {
				sm.processBatch()
			}
		}
	}
}

// timerProcessor 定时器处理器
func (sm *SettlementManager) timerProcessor() {
	for {
		select {
		case <-sm.stopCh:
			return
		case <-sm.batchTimer.C:
			sm.processBatch()
			sm.batchTimer.Reset(5 * time.Second)
		}
	}
}

// processBatch 处理批量结算
func (sm *SettlementManager) processBatch() {
	sm.mu.Lock()
	if len(sm.pendingSettlements) == 0 {
		sm.mu.Unlock()
		return
	}

	// 复制待处理的结算
	batch := make([]*PendingSettlement, len(sm.pendingSettlements))
	copy(batch, sm.pendingSettlements)
	sm.pendingSettlements = sm.pendingSettlements[:0] // 清空
	sm.mu.Unlock()

	log.Printf("🔗 Processing batch settlement with %d trades", len(batch))

	if err := sm.executeBatchSettlement(batch); err != nil {
		log.Printf("❌ Batch settlement failed: %v", err)
		
		// 重试逻辑：将失败的交易重新加入队列
		sm.mu.Lock()
		sm.pendingSettlements = append(batch, sm.pendingSettlements...)
		sm.mu.Unlock()
	} else {
		log.Printf("✅ Batch settlement completed successfully - %d trades settled", len(batch))
	}
}

// executeBatchSettlement 执行批量链上结算
func (sm *SettlementManager) executeBatchSettlement(settlements []*PendingSettlement) error {
	if len(settlements) == 0 {
		return nil
	}

	// 构建BatchFill数据结构
	batchFill := &BatchFill{
		TakerOrderHashes: make([][32]byte, len(settlements)),
		MakerOrderHashes: make([][32]byte, len(settlements)),
		Prices:           make([]*big.Int, len(settlements)),
		Amounts:          make([]*big.Int, len(settlements)),
		TakerSides:       make([]uint8, len(settlements)),
		TakerSignatures:  make([][]byte, len(settlements)),
		MakerSignatures:  make([][]byte, len(settlements)),
		TakerOrders:      make([]CompactOrder, len(settlements)),
		MakerOrders:      make([]CompactOrder, len(settlements)),
	}

	for i, settlement := range settlements {
		batchFill.TakerOrderHashes[i] = settlement.TakerOrderHash
		batchFill.MakerOrderHashes[i] = settlement.MakerOrderHash
		batchFill.Prices[i] = settlement.Price
		batchFill.Amounts[i] = settlement.Amount
		batchFill.TakerSides[i] = settlement.TakerSide
		batchFill.TakerSignatures[i] = settlement.TakerSignature
		batchFill.MakerSignatures[i] = settlement.MakerSignature
		batchFill.TakerOrders[i] = *settlement.TakerOrder
		batchFill.MakerOrders[i] = *settlement.MakerOrder
	}

	// 获取最新的nonce
	nonce, err := sm.client.PendingNonceAt(context.Background(), sm.auth.From)
	if err != nil {
		return fmt.Errorf("failed to get nonce: %w", err)
	}
	sm.auth.Nonce = big.NewInt(int64(nonce))

	// 预估Gas
	gasPrice, err := sm.client.SuggestGasPrice(context.Background())
	if err != nil {
		log.Printf("⚠️  Failed to get gas price, using default: %v", err)
		gasPrice = big.NewInt(20000000000) // 20 gwei fallback
	}
	sm.auth.GasPrice = gasPrice

	// 调用智能合约的batchSettleTrades函数
	// 注意：这里需要生成合约ABI绑定，或者使用低级别的合约调用
	tx, err := sm.callBatchSettleTrades(batchFill)
	if err != nil {
		return fmt.Errorf("failed to call batchSettleTrades: %w", err)
	}

	// 等待交易确认
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	receipt, err := bind.WaitMined(ctx, sm.client, tx)
	if err != nil {
		return fmt.Errorf("transaction failed or timeout: %w", err)
	}

	if receipt.Status != types.ReceiptStatusSuccessful {
		return fmt.Errorf("transaction reverted, hash: %s", tx.Hash().Hex())
	}

	log.Printf("🎉 Batch settlement successful! TX: %s, Gas used: %d", 
		tx.Hash().Hex(), receipt.GasUsed)
	
	return nil
}

// 辅助函数
func (sm *SettlementManager) convertToCompactOrder(order *ordertypes.SignedOrder) (*CompactOrder, error) {
	// 转换地址
	userAddr := common.HexToAddress(order.UserAddress)
	baseToken := common.HexToAddress(order.BaseToken)
	quoteToken := common.HexToAddress(order.QuoteToken)

	// 转换价格和数量（使用BigInt）
	price := order.Price.BigInt()
	amount := order.Amount.BigInt()

	// 转换过期时间
	var expiresAt uint64
	if order.ExpiresAt != nil {
		expiresAt = uint64(order.ExpiresAt.Unix())
	}

	// 转换订单方向
	var side uint8
	if order.Side == ordertypes.OrderSideBuy {
		side = 0
	} else {
		side = 1
	}

	// 转换订单类型
	var orderType uint8
	switch order.Type {
	case ordertypes.OrderTypeLimit:
		orderType = 0
	case ordertypes.OrderTypeMarket:
		orderType = 1
	case ordertypes.OrderTypeStopLoss:
		orderType = 2
	case ordertypes.OrderTypeTakeProfit:
		orderType = 3
	}

	return &CompactOrder{
		UserAddress: userAddr,
		BaseToken:   baseToken,
		QuoteToken:  quoteToken,
		Price:       price,
		Amount:      amount,
		ExpiresAt:   expiresAt,
		Nonce:       order.Nonce,
		Side:        side,
		OrderType:   orderType,
	}, nil
}

func (sm *SettlementManager) generateOrderHash(order *ordertypes.SignedOrder) [32]byte {
	// 简单哈希生成，实际应该匹配链上的哈希计算
	data := fmt.Sprintf("%s%s%s%d%s%s%d",
		order.UserAddress,
		order.BaseToken,
		order.QuoteToken,
		order.Side,
		order.Price.String(),
		order.Amount.String(),
		order.Nonce,
	)
	return crypto.Keccak256Hash([]byte(data))
}

func hexToBytes(hexStr string) ([]byte, error) {
	if len(hexStr) > 2 && hexStr[:2] == "0x" {
		hexStr = hexStr[2:]
	}
	return common.FromHex("0x" + hexStr), nil
}

// callBatchSettleTrades 调用批量结算合约函数
// 这是一个简化版本，实际需要生成合约ABI绑定
func (sm *SettlementManager) callBatchSettleTrades(batchFill *BatchFill) (*types.Transaction, error) {
	// 注意：这里需要实现实际的合约调用
	// 可以使用abigen生成的绑定，或者使用低级别的合约调用
	
	// 示例：构建交易数据（需要根据实际ABI调整）
	// 这里返回一个模拟的交易，实际实现需要：
	// 1. 使用abigen生成合约绑定
	// 2. 调用绑定的batchSettleTrades方法
	
	log.Printf("⚠️  TODO: Implement actual contract call for batchSettleTrades")
	
	// 临时返回一个空交易作为占位符
	return &types.Transaction{}, fmt.Errorf("contract call not implemented yet - need to generate ABI bindings")
}

// GetSettlementStats 获取结算统计
func (sm *SettlementManager) GetSettlementStats() map[string]interface{} {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	return map[string]interface{}{
		"running":            sm.running,
		"pending_settlements": len(sm.pendingSettlements),
		"queue_length":       len(sm.settlementQueue),
		"batch_size":         sm.batchSize,
		"contract_address":   sm.settlementContract.Hex(),
	}
}