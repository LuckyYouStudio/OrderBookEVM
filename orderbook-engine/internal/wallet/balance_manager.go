package wallet

import (
	"fmt"
	"sync"
	"time"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/shopspring/decimal"
	"github.com/sirupsen/logrus"

	"orderbook-engine/internal/types"
)

// BalanceManager 钱包余额管理器
// 负责资金锁定、解锁和转账
type BalanceManager struct {
	balances      map[string]map[string]*decimal.Decimal // user -> token -> balance
	lockedFunds   map[string]map[string]*decimal.Decimal // user -> token -> locked amount
	orderLocks    map[string]*OrderLock                   // order_id -> lock info
	mu            sync.RWMutex
	logger        *logrus.Logger
}

// OrderLock 订单资金锁定信息
type OrderLock struct {
	OrderID     string
	UserAddress string
	Token       string
	Amount      decimal.Decimal
	CreatedAt   time.Time
	ExpiresAt   *time.Time
}

// NewBalanceManager 创建余额管理器
func NewBalanceManager(logger *logrus.Logger) *BalanceManager {
	bm := &BalanceManager{
		balances:    make(map[string]map[string]*decimal.Decimal),
		lockedFunds: make(map[string]map[string]*decimal.Decimal),
		orderLocks:  make(map[string]*OrderLock),
		logger:      logger,
	}

	// 启动过期锁定清理器
	go bm.expiredLockCleaner()
	
	return bm
}

// SetBalance 设置用户代币余额（用于初始化或充值）
func (bm *BalanceManager) SetBalance(userAddress, token string, amount decimal.Decimal) {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if bm.balances[userAddress] == nil {
		bm.balances[userAddress] = make(map[string]*decimal.Decimal)
	}
	if bm.lockedFunds[userAddress] == nil {
		bm.lockedFunds[userAddress] = make(map[string]*decimal.Decimal)
		bm.lockedFunds[userAddress][token] = &decimal.Decimal{}
	}

	bm.balances[userAddress][token] = &amount
	
	bm.logger.WithFields(logrus.Fields{
		"user":   userAddress,
		"token":  token,
		"amount": amount.String(),
	}).Info("💰 Balance updated")
}

// GetBalance 获取用户代币余额
func (bm *BalanceManager) GetBalance(userAddress, token string) decimal.Decimal {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	if bm.balances[userAddress] == nil || bm.balances[userAddress][token] == nil {
		return decimal.Zero
	}
	return *bm.balances[userAddress][token]
}

// GetAvailableBalance 获取用户可用余额（总余额 - 锁定资金）
func (bm *BalanceManager) GetAvailableBalance(userAddress, token string) decimal.Decimal {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	totalBalance := decimal.Zero
	lockedAmount := decimal.Zero

	if bm.balances[userAddress] != nil && bm.balances[userAddress][token] != nil {
		totalBalance = *bm.balances[userAddress][token]
	}

	if bm.lockedFunds[userAddress] != nil && bm.lockedFunds[userAddress][token] != nil {
		lockedAmount = *bm.lockedFunds[userAddress][token]
	}

	return totalBalance.Sub(lockedAmount)
}

// LockFundsForOrder 为订单锁定资金
func (bm *BalanceManager) LockFundsForOrder(order *types.SignedOrder) error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	var tokenToLock string
	var amountToLock decimal.Decimal

	// 确定需要锁定的代币和数量
	if order.Side == types.OrderSideBuy {
		// 买单锁定报价代币（如USDC）
		tokenToLock = order.QuoteToken
		// 锁定金额 = 价格 × 数量
		amountToLock = order.Price.Mul(order.Amount)
	} else {
		// 卖单锁定基础代币（如WETH）
		tokenToLock = order.BaseToken
		amountToLock = order.Amount
	}

	// 检查可用余额
	availableBalance := bm.getAvailableBalanceUnsafe(order.UserAddress, tokenToLock)
	if availableBalance.LessThan(amountToLock) {
		return fmt.Errorf("insufficient balance: need %s, available %s", 
			amountToLock.String(), availableBalance.String())
	}

	// 初始化锁定资金映射
	if bm.lockedFunds[order.UserAddress] == nil {
		bm.lockedFunds[order.UserAddress] = make(map[string]*decimal.Decimal)
	}
	if bm.lockedFunds[order.UserAddress][tokenToLock] == nil {
		zero := decimal.Zero
		bm.lockedFunds[order.UserAddress][tokenToLock] = &zero
	}

	// 增加锁定金额
	currentLocked := *bm.lockedFunds[order.UserAddress][tokenToLock]
	newLocked := currentLocked.Add(amountToLock)
	bm.lockedFunds[order.UserAddress][tokenToLock] = &newLocked

	// 记录订单锁定信息
	orderID := fmt.Sprintf("%s_%d", order.UserAddress, order.Nonce)
	
	var expiresAt *time.Time
	if order.ExpiresAt != nil {
		expiresAt = order.ExpiresAt
	}

	bm.orderLocks[orderID] = &OrderLock{
		OrderID:     orderID,
		UserAddress: order.UserAddress,
		Token:       tokenToLock,
		Amount:      amountToLock,
		CreatedAt:   time.Now(),
		ExpiresAt:   expiresAt,
	}

	bm.logger.WithFields(logrus.Fields{
		"order_id": orderID,
		"user":     order.UserAddress,
		"token":    tokenToLock,
		"amount":   amountToLock.String(),
		"side":     order.Side,
	}).Info("🔒 Funds locked for order")

	return nil
}

// UnlockFundsForOrder 解锁订单资金（订单取消时）
func (bm *BalanceManager) UnlockFundsForOrder(orderID string) error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	lock, exists := bm.orderLocks[orderID]
	if !exists {
		return fmt.Errorf("order lock not found: %s", orderID)
	}

	// 减少锁定金额
	if bm.lockedFunds[lock.UserAddress] != nil && 
	   bm.lockedFunds[lock.UserAddress][lock.Token] != nil {
		
		currentLocked := *bm.lockedFunds[lock.UserAddress][lock.Token]
		newLocked := currentLocked.Sub(lock.Amount)
		
		// 确保不会出现负数
		if newLocked.IsNegative() {
			newLocked = decimal.Zero
		}
		
		bm.lockedFunds[lock.UserAddress][lock.Token] = &newLocked
	}

	// 删除锁定记录
	delete(bm.orderLocks, orderID)

	bm.logger.WithFields(logrus.Fields{
		"order_id": orderID,
		"user":     lock.UserAddress,
		"token":    lock.Token,
		"amount":   lock.Amount.String(),
	}).Info("🔓 Funds unlocked for order")

	return nil
}

// ExecuteTrade 执行交易（转移资金）
func (bm *BalanceManager) ExecuteTrade(
	takerOrder *types.SignedOrder,
	makerOrder *types.SignedOrder,
	fillPrice decimal.Decimal,
	fillAmount decimal.Decimal,
) error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	// 计算交易金额
	quoteAmount := fillPrice.Mul(fillAmount)

	var (
		buyer  string
		seller string
		baseToken  = takerOrder.BaseToken
		quoteToken = takerOrder.QuoteToken
	)

	// 确定买方和卖方
	if takerOrder.Side == types.OrderSideBuy {
		buyer = takerOrder.UserAddress
		seller = makerOrder.UserAddress
	} else {
		buyer = makerOrder.UserAddress
		seller = takerOrder.UserAddress
	}

	// 执行资金转移
	// 买方：基础代币增加，报价代币减少
	if err := bm.transferUnsafe(seller, buyer, baseToken, fillAmount); err != nil {
		return fmt.Errorf("failed to transfer base token: %w", err)
	}
	
	// 卖方：报价代币增加，基础代币减少
	if err := bm.transferUnsafe(buyer, seller, quoteToken, quoteAmount); err != nil {
		// 回滚基础代币转移
		bm.transferUnsafe(buyer, seller, baseToken, fillAmount)
		return fmt.Errorf("failed to transfer quote token: %w", err)
	}

	// 减少相应的锁定资金
	takerOrderID := fmt.Sprintf("%s_%d", takerOrder.UserAddress, takerOrder.Nonce)
	makerOrderID := fmt.Sprintf("%s_%d", makerOrder.UserAddress, makerOrder.Nonce)

	bm.reduceLockForFillUnsafe(takerOrderID, takerOrder, fillAmount)
	bm.reduceLockForFillUnsafe(makerOrderID, makerOrder, fillAmount)

	bm.logger.WithFields(logrus.Fields{
		"buyer":        buyer,
		"seller":       seller,
		"base_token":   baseToken,
		"quote_token":  quoteToken,
		"base_amount":  fillAmount.String(),
		"quote_amount": quoteAmount.String(),
		"price":        fillPrice.String(),
	}).Info("💸 Trade executed - funds transferred")

	return nil
}

// 内部辅助函数

// getAvailableBalanceUnsafe 获取可用余额（不加锁版本）
func (bm *BalanceManager) getAvailableBalanceUnsafe(userAddress, token string) decimal.Decimal {
	totalBalance := decimal.Zero
	lockedAmount := decimal.Zero

	if bm.balances[userAddress] != nil && bm.balances[userAddress][token] != nil {
		totalBalance = *bm.balances[userAddress][token]
	}

	if bm.lockedFunds[userAddress] != nil && bm.lockedFunds[userAddress][token] != nil {
		lockedAmount = *bm.lockedFunds[userAddress][token]
	}

	return totalBalance.Sub(lockedAmount)
}

// transferUnsafe 转移资金（不加锁版本）
func (bm *BalanceManager) transferUnsafe(from, to, token string, amount decimal.Decimal) error {
	// 确保映射存在
	if bm.balances[from] == nil {
		bm.balances[from] = make(map[string]*decimal.Decimal)
	}
	if bm.balances[to] == nil {
		bm.balances[to] = make(map[string]*decimal.Decimal)
	}
	if bm.balances[from][token] == nil {
		zero := decimal.Zero
		bm.balances[from][token] = &zero
	}
	if bm.balances[to][token] == nil {
		zero := decimal.Zero
		bm.balances[to][token] = &zero
	}

	// 检查余额
	fromBalance := *bm.balances[from][token]
	if fromBalance.LessThan(amount) {
		return fmt.Errorf("insufficient balance for transfer")
	}

	// 执行转移
	newFromBalance := fromBalance.Sub(amount)
	toBalance := *bm.balances[to][token]
	newToBalance := toBalance.Add(amount)

	bm.balances[from][token] = &newFromBalance
	bm.balances[to][token] = &newToBalance

	return nil
}

// reduceLockForFillUnsafe 减少订单锁定金额（部分成交时）
func (bm *BalanceManager) reduceLockForFillUnsafe(orderID string, order *types.SignedOrder, fillAmount decimal.Decimal) {
	lock, exists := bm.orderLocks[orderID]
	if !exists {
		return
	}

	var amountToUnlock decimal.Decimal
	if order.Side == types.OrderSideBuy {
		// 买单：解锁 = 成交价格 × 成交数量
		amountToUnlock = order.Price.Mul(fillAmount)
	} else {
		// 卖单：解锁 = 成交数量
		amountToUnlock = fillAmount
	}

	// 更新锁定金额
	newLockAmount := lock.Amount.Sub(amountToUnlock)
	if newLockAmount.IsNegative() || newLockAmount.IsZero() {
		// 完全成交，删除锁定
		delete(bm.orderLocks, orderID)
	} else {
		// 部分成交，更新锁定金额
		lock.Amount = newLockAmount
	}

	// 更新用户锁定资金总额
	if bm.lockedFunds[order.UserAddress] != nil && 
	   bm.lockedFunds[order.UserAddress][lock.Token] != nil {
		
		currentLocked := *bm.lockedFunds[order.UserAddress][lock.Token]
		newLocked := currentLocked.Sub(amountToUnlock)
		
		if newLocked.IsNegative() {
			newLocked = decimal.Zero
		}
		
		bm.lockedFunds[order.UserAddress][lock.Token] = &newLocked
	}
}

// expiredLockCleaner 过期锁定清理器
func (bm *BalanceManager) expiredLockCleaner() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		bm.cleanExpiredLocks()
	}
}

// cleanExpiredLocks 清理过期的锁定
func (bm *BalanceManager) cleanExpiredLocks() {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	now := time.Now()
	var expiredOrders []string

	for orderID, lock := range bm.orderLocks {
		if lock.ExpiresAt != nil && now.After(*lock.ExpiresAt) {
			expiredOrders = append(expiredOrders, orderID)
		}
	}

	for _, orderID := range expiredOrders {
		lock := bm.orderLocks[orderID]
		
		// 减少锁定金额
		if bm.lockedFunds[lock.UserAddress] != nil && 
		   bm.lockedFunds[lock.UserAddress][lock.Token] != nil {
			
			currentLocked := *bm.lockedFunds[lock.UserAddress][lock.Token]
			newLocked := currentLocked.Sub(lock.Amount)
			
			if newLocked.IsNegative() {
				newLocked = decimal.Zero
			}
			
			bm.lockedFunds[lock.UserAddress][lock.Token] = &newLocked
		}

		// 删除过期锁定
		delete(bm.orderLocks, orderID)

		bm.logger.WithFields(logrus.Fields{
			"order_id": orderID,
			"user":     lock.UserAddress,
			"token":    lock.Token,
			"amount":   lock.Amount.String(),
		}).Info("🧹 Expired order lock cleaned up")
	}
}

// GetUserBalances 获取用户所有代币余额
func (bm *BalanceManager) GetUserBalances(userAddress string) map[string]BalanceInfo {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	result := make(map[string]BalanceInfo)

	if bm.balances[userAddress] == nil {
		return result
	}

	for token, balance := range bm.balances[userAddress] {
		locked := decimal.Zero
		if bm.lockedFunds[userAddress] != nil && bm.lockedFunds[userAddress][token] != nil {
			locked = *bm.lockedFunds[userAddress][token]
		}

		result[token] = BalanceInfo{
			Total:     *balance,
			Locked:    locked,
			Available: balance.Sub(locked),
		}
	}

	return result
}

// BalanceInfo 余额信息
type BalanceInfo struct {
	Total     decimal.Decimal `json:"total"`
	Locked    decimal.Decimal `json:"locked"`
	Available decimal.Decimal `json:"available"`
}

// GetOrderLocks 获取所有订单锁定信息（管理接口）
func (bm *BalanceManager) GetOrderLocks() map[string]*OrderLock {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	result := make(map[string]*OrderLock)
	for k, v := range bm.orderLocks {
		result[k] = v
	}
	return result
}