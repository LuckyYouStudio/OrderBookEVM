package riskcontrol

import (
	"fmt"
	"sync"
	"time"

	"github.com/shopspring/decimal"
	"github.com/sirupsen/logrus"

	"orderbook-engine/internal/storage"
	"orderbook-engine/internal/types"
)

// RiskController 风控控制器
type RiskController struct {
	mu       sync.RWMutex
	cache    *storage.RedisCache
	config   *RiskConfig
	logger   *logrus.Logger
	blacklist map[string]*BlacklistEntry // 内存黑名单缓存
}

// RiskConfig 风控配置
type RiskConfig struct {
	// 订单限制
	MinOrderAmount      decimal.Decimal `json:"min_order_amount"`      // 最小订单金额
	MaxOrderAmount      decimal.Decimal `json:"max_order_amount"`      // 最大订单金额
	MaxPriceDeviation   decimal.Decimal `json:"max_price_deviation"`   // 最大价格偏差(百分比)
	MaxOrdersPerUser    int             `json:"max_orders_per_user"`   // 单用户最大订单数
	OrderValidityPeriod time.Duration   `json:"order_validity_period"` // 订单有效期

	// 限率控制
	OrderRateLimit    int           `json:"order_rate_limit"`    // 订单限率(每分钟)
	CancelRateLimit   int           `json:"cancel_rate_limit"`   // 取消限率(每分钟)
	RateLimitWindow   time.Duration `json:"rate_limit_window"`   // 限率窗口
	MaxCancelRatio    decimal.Decimal `json:"max_cancel_ratio"`    // 最大取消率

	// 资金检查
	EnableBalanceCheck bool            `json:"enable_balance_check"` // 是否启用资金检查
	MinBalance         decimal.Decimal `json:"min_balance"`          // 最小账户余额
	MaxExposure        decimal.Decimal `json:"max_exposure"`         // 最大风险暴露

	// 黑名单
	BlacklistDuration time.Duration `json:"blacklist_duration"` // 黑名单时长
	AutoBlacklist     bool          `json:"auto_blacklist"`     // 自动拉黑
}

// BlacklistEntry 黑名单条目
type BlacklistEntry struct {
	UserAddress string    `json:"user_address"`
	Reason      string    `json:"reason"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`
}

// RiskCheckResult 风控检查结果
type RiskCheckResult struct {
	Allowed bool   `json:"allowed"`
	Reason  string `json:"reason,omitempty"`
	Code    string `json:"code,omitempty"`
}

// NewRiskController 创建风控控制器
func NewRiskController(cache *storage.RedisCache, config *RiskConfig, logger *logrus.Logger) *RiskController {
	return &RiskController{
		cache:     cache,
		config:    config,
		logger:    logger,
		blacklist: make(map[string]*BlacklistEntry),
	}
}

// CheckOrderRisk 检查订单风险
func (rc *RiskController) CheckOrderRisk(order *types.Order, userBalance map[string]decimal.Decimal) *RiskCheckResult {
	// 1. 检查黑名单
	if rc.isBlacklisted(order.UserAddress) {
		return &RiskCheckResult{
			Allowed: false,
			Reason:  "用户在黑名单中",
			Code:    "BLACKLISTED",
		}
	}

	// 2. 检查订单金额
	if result := rc.checkOrderAmount(order); !result.Allowed {
		return result
	}

	// 3. 检查价格偏差
	if result := rc.checkPriceDeviation(order); !result.Allowed {
		return result
	}

	// 4. 检查订单限率
	if result := rc.checkOrderRate(order.UserAddress); !result.Allowed {
		return result
	}

	// 5. 检查用户订单数量
	if result := rc.checkUserOrderCount(order.UserAddress); !result.Allowed {
		return result
	}

	// 6. 检查资金余额
	if rc.config.EnableBalanceCheck {
		if result := rc.checkBalance(order, userBalance); !result.Allowed {
			return result
		}
	}

	// 7. 检查订单有效期
	if result := rc.checkOrderValidity(order); !result.Allowed {
		return result
	}

	return &RiskCheckResult{Allowed: true}
}

// checkOrderAmount 检查订单金额
func (rc *RiskController) checkOrderAmount(order *types.Order) *RiskCheckResult {
	orderValue := order.Amount.Mul(order.Price)

	if orderValue.LessThan(rc.config.MinOrderAmount) {
		return &RiskCheckResult{
			Allowed: false,
			Reason:  fmt.Sprintf("订单金额太小，最小%s", rc.config.MinOrderAmount.String()),
			Code:    "ORDER_TOO_SMALL",
		}
	}

	if orderValue.GreaterThan(rc.config.MaxOrderAmount) {
		return &RiskCheckResult{
			Allowed: false,
			Reason:  fmt.Sprintf("订单金额过大，最大%s", rc.config.MaxOrderAmount.String()),
			Code:    "ORDER_TOO_LARGE",
		}
	}

	return &RiskCheckResult{Allowed: true}
}

// checkPriceDeviation 检查价格偏差
func (rc *RiskController) checkPriceDeviation(order *types.Order) *RiskCheckResult {
	// 这里需要获取市场价格（从缓存或外部API）
	// 简化处理，假设市场价格为1000
	marketPrice := decimal.NewFromInt(1000)

	deviation := order.Price.Sub(marketPrice).Div(marketPrice).Abs()
	maxDeviation := rc.config.MaxPriceDeviation.Div(decimal.NewFromInt(100))

	if deviation.GreaterThan(maxDeviation) {
		return &RiskCheckResult{
			Allowed: false,
			Reason:  fmt.Sprintf("价格偏差过大：%.2f%%，最大允许%.2f%%", deviation.Mul(decimal.NewFromInt(100)), rc.config.MaxPriceDeviation),
			Code:    "PRICE_DEVIATION_TOO_LARGE",
		}
	}

	return &RiskCheckResult{Allowed: true}
}

// checkOrderRate 检查订单限率
func (rc *RiskController) checkOrderRate(userAddress string) *RiskCheckResult {
	allowed, err := rc.cache.RateLimitCheck(userAddress, "order", rc.config.OrderRateLimit, rc.config.RateLimitWindow)
	if err != nil {
		rc.logger.WithError(err).Error("Failed to check order rate limit")
		// 错误时默认允许
		return &RiskCheckResult{Allowed: true}
	}

	if !allowed {
		return &RiskCheckResult{
			Allowed: false,
			Reason:  fmt.Sprintf("订单频率过高，最大%d次/%s", rc.config.OrderRateLimit, rc.config.RateLimitWindow.String()),
			Code:    "ORDER_RATE_LIMIT_EXCEEDED",
		}
	}

	return &RiskCheckResult{Allowed: true}
}

// checkUserOrderCount 检查用户订单数量
func (rc *RiskController) checkUserOrderCount(userAddress string) *RiskCheckResult {
	// 这里需要从数据库查询用户当前活跃订单数
	// 简化处理，假设当前有订单0个
	currentOrderCount := 0

	if currentOrderCount >= rc.config.MaxOrdersPerUser {
		return &RiskCheckResult{
			Allowed: false,
			Reason:  fmt.Sprintf("用户订单数过多，最大%d个", rc.config.MaxOrdersPerUser),
			Code:    "TOO_MANY_ORDERS",
		}
	}

	return &RiskCheckResult{Allowed: true}
}

// checkBalance 检查资金余额
func (rc *RiskController) checkBalance(order *types.Order, userBalance map[string]decimal.Decimal) *RiskCheckResult {
	var requiredToken string
	var requiredAmount decimal.Decimal

	if order.Side == types.OrderSideBuy {
		// 买单需要报价代币
		requiredToken = order.QuoteToken
		requiredAmount = order.Amount.Mul(order.Price)
	} else {
		// 卖单需要基础代币
		requiredToken = order.BaseToken
		requiredAmount = order.Amount
	}

	availableBalance, exists := userBalance[requiredToken]
	if !exists {
		availableBalance = decimal.Zero
	}

	if availableBalance.LessThan(requiredAmount) {
		return &RiskCheckResult{
			Allowed: false,
			Reason:  fmt.Sprintf("余额不足：需要%s %s，可用%s", requiredAmount.String(), requiredToken, availableBalance.String()),
			Code:    "INSUFFICIENT_BALANCE",
		}
	}

	return &RiskCheckResult{Allowed: true}
}

// checkOrderValidity 检查订单有效期
func (rc *RiskController) checkOrderValidity(order *types.Order) *RiskCheckResult {
	if order.ExpiresAt != nil && time.Now().After(*order.ExpiresAt) {
		return &RiskCheckResult{
			Allowed: false,
			Reason:  "订单已过期",
			Code:    "ORDER_EXPIRED",
		}
	}

	// 检查订单时间是否过久
	orderAge := time.Since(order.CreatedAt)
	if orderAge > rc.config.OrderValidityPeriod {
		return &RiskCheckResult{
			Allowed: false,
			Reason:  fmt.Sprintf("订单时间过久：%s，最大允许%s", orderAge.String(), rc.config.OrderValidityPeriod.String()),
			Code:    "ORDER_TOO_OLD",
		}
	}

	return &RiskCheckResult{Allowed: true}
}

// CheckCancelRisk 检查取消订单风险
func (rc *RiskController) CheckCancelRisk(userAddress string, orderID string) *RiskCheckResult {
	// 1. 检查黑名单
	if rc.isBlacklisted(userAddress) {
		return &RiskCheckResult{
			Allowed: false,
			Reason:  "用户在黑名单中",
			Code:    "BLACKLISTED",
		}
	}

	// 2. 检查取消限率
	allowed, err := rc.cache.RateLimitCheck(userAddress, "cancel", rc.config.CancelRateLimit, rc.config.RateLimitWindow)
	if err != nil {
		rc.logger.WithError(err).Error("Failed to check cancel rate limit")
		return &RiskCheckResult{Allowed: true}
	}

	if !allowed {
		return &RiskCheckResult{
			Allowed: false,
			Reason:  fmt.Sprintf("取消频率过高，最大%d次/%s", rc.config.CancelRateLimit, rc.config.RateLimitWindow.String()),
			Code:    "CANCEL_RATE_LIMIT_EXCEEDED",
		}
	}

	// 3. 检查取消率（防止恶意取消）
	if result := rc.checkCancelRatio(userAddress); !result.Allowed {
		return result
	}

	return &RiskCheckResult{Allowed: true}
}

// checkCancelRatio 检查取消率
func (rc *RiskController) checkCancelRatio(userAddress string) *RiskCheckResult {
	// 这里需要从数据库查询用户的订单和取消统计
	// 简化处理，假设取消率为10%
	cancelRatio := decimal.NewFromFloat(0.1)

	if cancelRatio.GreaterThan(rc.config.MaxCancelRatio) {
		return &RiskCheckResult{
			Allowed: false,
			Reason:  fmt.Sprintf("取消率过高：%.2f%%，最大允许%.2f%%", cancelRatio.Mul(decimal.NewFromInt(100)), rc.config.MaxCancelRatio.Mul(decimal.NewFromInt(100))),
			Code:    "CANCEL_RATIO_TOO_HIGH",
		}
	}

	return &RiskCheckResult{Allowed: true}
}

// AddToBlacklist 添加到黑名单
func (rc *RiskController) AddToBlacklist(userAddress string, reason string, duration time.Duration) error {
	rc.mu.Lock()
	defer rc.mu.Unlock()

	entry := &BlacklistEntry{
		UserAddress: userAddress,
		Reason:      reason,
		CreatedAt:   time.Now(),
		ExpiresAt:   time.Now().Add(duration),
	}

	rc.blacklist[userAddress] = entry

	// 同步到 Redis
	if err := rc.cache.AddToBlacklist(userAddress, reason, duration); err != nil {
		rc.logger.WithError(err).Error("Failed to add to Redis blacklist")
	}

	rc.logger.WithFields(logrus.Fields{
		"user_address": userAddress,
		"reason":       reason,
		"duration":     duration.String(),
	}).Warn("User added to blacklist")

	return nil
}

// RemoveFromBlacklist 从黑名单移除
func (rc *RiskController) RemoveFromBlacklist(userAddress string) {
	rc.mu.Lock()
	defer rc.mu.Unlock()

	delete(rc.blacklist, userAddress)
	rc.logger.WithField("user_address", userAddress).Info("User removed from blacklist")
}

// isBlacklisted 检查是否在黑名单中
func (rc *RiskController) isBlacklisted(userAddress string) bool {
	rc.mu.RLock()
	defer rc.mu.RUnlock()

	// 先检查内存缓存
	entry, exists := rc.blacklist[userAddress]
	if exists {
		if time.Now().Before(entry.ExpiresAt) {
			return true
		}
		// 过期了，清理
		delete(rc.blacklist, userAddress)
	}

	// 检查 Redis
	blacklisted, err := rc.cache.IsBlacklisted(userAddress)
	if err != nil {
		rc.logger.WithError(err).Error("Failed to check Redis blacklist")
		return false
	}

	return blacklisted
}

// AutoBlacklistCheck 自动黑名单检查
func (rc *RiskController) AutoBlacklistCheck(userAddress string, violations []string) {
	if !rc.config.AutoBlacklist {
		return
	}

	if len(violations) >= 3 { // 3次违规就拉黑
		reason := fmt.Sprintf("多次违规: %v", violations)
		rc.AddToBlacklist(userAddress, reason, rc.config.BlacklistDuration)
	}
}

// GetBlacklistStatus 获取黑名单状态
func (rc *RiskController) GetBlacklistStatus(userAddress string) (*BlacklistEntry, bool) {
	rc.mu.RLock()
	defer rc.mu.RUnlock()

	entry, exists := rc.blacklist[userAddress]
	if !exists || time.Now().After(entry.ExpiresAt) {
		return nil, false
	}

	return entry, true
}

// GetRiskStats 获取风控统计
func (rc *RiskController) GetRiskStats() map[string]interface{} {
	rc.mu.RLock()
	defer rc.mu.RUnlock()

	activeBans := 0
	for _, entry := range rc.blacklist {
		if time.Now().Before(entry.ExpiresAt) {
			activeBans++
		}
	}

	return map[string]interface{}{
		"active_bans":       activeBans,
		"total_blacklist":   len(rc.blacklist),
		"auto_blacklist":    rc.config.AutoBlacklist,
		"min_order_amount": rc.config.MinOrderAmount.String(),
		"max_order_amount": rc.config.MaxOrderAmount.String(),
		"order_rate_limit": rc.config.OrderRateLimit,
		"cancel_rate_limit": rc.config.CancelRateLimit,
	}
}

// CleanupExpiredBlacklist 清理过期的黑名单条目
func (rc *RiskController) CleanupExpiredBlacklist() {
	rc.mu.Lock()
	defer rc.mu.Unlock()

	now := time.Now()
	for userAddress, entry := range rc.blacklist {
		if now.After(entry.ExpiresAt) {
			delete(rc.blacklist, userAddress)
			rc.logger.WithField("user_address", userAddress).Debug("Expired blacklist entry removed")
		}
	}
}

// StartCleanupTicker 启动清理定时器
func (rc *RiskController) StartCleanupTicker() {
	ticker := time.NewTicker(time.Hour) // 每小时清理一次
	go func() {
		for range ticker.C {
			rc.CleanupExpiredBlacklist()
		}
	}()
}

// DefaultRiskConfig 默认风控配置
func DefaultRiskConfig() *RiskConfig {
	return &RiskConfig{
		MinOrderAmount:      decimal.NewFromFloat(0.01),   // 0.01 ETH
		MaxOrderAmount:      decimal.NewFromFloat(1000),   // 1000 ETH
		MaxPriceDeviation:   decimal.NewFromFloat(10),     // 10%
		MaxOrdersPerUser:    100,                          // 100个订单
		OrderValidityPeriod: 24 * time.Hour,               // 24小时

		OrderRateLimit:    60,              // 60次/分钟
		CancelRateLimit:   30,              // 30次/分钟
		RateLimitWindow:   time.Minute,     // 1分钟窗口
		MaxCancelRatio:    decimal.NewFromFloat(0.3), // 30%

		EnableBalanceCheck: true,
		MinBalance:         decimal.NewFromFloat(0.001), // 0.001 ETH
		MaxExposure:        decimal.NewFromFloat(100),   // 100 ETH

		BlacklistDuration: 24 * time.Hour, // 24小时
		AutoBlacklist:     true,
	}
}
