package types

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// OrderType 订单类型
type OrderType string

const (
	OrderTypeLimit     OrderType = "limit"
	OrderTypeMarket    OrderType = "market"
	OrderTypeStopLoss  OrderType = "stop_loss"
	OrderTypeTakeProfit OrderType = "take_profit"
)

// OrderSide 订单方向
type OrderSide string

const (
	OrderSideBuy  OrderSide = "buy"
	OrderSideSell OrderSide = "sell"
)

// OrderStatus 订单状态
type OrderStatus string

const (
	OrderStatusPending         OrderStatus = "pending"
	OrderStatusOpen            OrderStatus = "open"
	OrderStatusPartiallyFilled OrderStatus = "partially_filled"
	OrderStatusFilled          OrderStatus = "filled"
	OrderStatusCancelled       OrderStatus = "cancelled"
	OrderStatusRejected        OrderStatus = "rejected"
)

// Order 订单结构
type Order struct {
	ID           uuid.UUID       `json:"id" gorm:"primaryKey;type:uuid;default:gen_random_uuid()"`
	UserAddress  string          `json:"user_address" gorm:"not null;index"`
	TradingPair  string          `json:"trading_pair" gorm:"not null;index"`
	BaseToken    string          `json:"base_token" gorm:"not null"`
	QuoteToken   string          `json:"quote_token" gorm:"not null"`
	Side         OrderSide       `json:"side" gorm:"not null"`
	Type         OrderType       `json:"type" gorm:"not null"`
	Price        decimal.Decimal `json:"price" gorm:"type:decimal(36,18)"`
	Amount       decimal.Decimal `json:"amount" gorm:"type:decimal(36,18);not null"`
	FilledAmount decimal.Decimal `json:"filled_amount" gorm:"type:decimal(36,18);default:0"`
	Status       OrderStatus     `json:"status" gorm:"not null;default:'pending'"`
	ExpiresAt    *time.Time      `json:"expires_at"`
	Nonce        uint64          `json:"nonce" gorm:"not null"`
	Signature    string          `json:"signature" gorm:"not null"`
	Hash         string          `json:"hash" gorm:"not null;unique"`
	CreatedAt    time.Time       `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt    time.Time       `json:"updated_at" gorm:"autoUpdateTime"`
}

// SignedOrder 签名订单结构（用于API传输）
type SignedOrder struct {
	UserAddress string          `json:"user_address"`
	TradingPair string          `json:"trading_pair"`
	BaseToken   string          `json:"base_token"`
	QuoteToken  string          `json:"quote_token"`
	Side        OrderSide       `json:"side"`
	Type        OrderType       `json:"type"`
	Price       decimal.Decimal `json:"price"`
	Amount      decimal.Decimal `json:"amount"`
	ExpiresAt   *time.Time      `json:"expires_at"`
	Nonce       uint64          `json:"nonce"`
	Signature   string          `json:"signature"`
}

// Fill 成交记录
type Fill struct {
	ID           uuid.UUID       `json:"id" gorm:"primaryKey;type:uuid;default:gen_random_uuid()"`
	TakerOrderID uuid.UUID       `json:"taker_order_id" gorm:"not null;index"`
	MakerOrderID uuid.UUID       `json:"maker_order_id" gorm:"not null;index"`
	TradingPair  string          `json:"trading_pair" gorm:"not null;index"`
	Price        decimal.Decimal `json:"price" gorm:"type:decimal(36,18);not null"`
	Amount       decimal.Decimal `json:"amount" gorm:"type:decimal(36,18);not null"`
	TakerSide    OrderSide       `json:"taker_side" gorm:"not null"`
	TxHash       string          `json:"tx_hash"`
	CreatedAt    time.Time       `json:"created_at" gorm:"autoCreateTime"`
}

// OrderBook 订单簿快照
type OrderBookSnapshot struct {
	TradingPair string              `json:"trading_pair"`
	Bids        []OrderBookLevel    `json:"bids"`
	Asks        []OrderBookLevel    `json:"asks"`
	Timestamp   time.Time           `json:"timestamp"`
}

// OrderBookLevel 订单簿价格层级
type OrderBookLevel struct {
	Price  decimal.Decimal `json:"price"`
	Amount decimal.Decimal `json:"amount"`
	Count  int             `json:"count"`
}

// Trade 交易信息
type Trade struct {
	ID          uuid.UUID       `json:"id"`
	TradingPair string          `json:"trading_pair"`
	Price       decimal.Decimal `json:"price"`
	Amount      decimal.Decimal `json:"amount"`
	Side        OrderSide       `json:"side"`
	Timestamp   time.Time       `json:"timestamp"`
}

// WebSocketMessage WebSocket消息
type WebSocketMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// OrderUpdate 订单更新消息
type OrderUpdate struct {
	Order     *Order `json:"order"`
	EventType string `json:"event_type"` // created, updated, filled, cancelled
}

// TradeUpdate 交易更新消息
type TradeUpdate struct {
	Trade *Trade `json:"trade"`
}

// OrderBookUpdate 订单簿更新消息
type OrderBookUpdate struct {
	TradingPair string           `json:"trading_pair"`
	Bids        []OrderBookLevel `json:"bids"`
	Asks        []OrderBookLevel `json:"asks"`
	Timestamp   time.Time        `json:"timestamp"`
}

// GetRemainingAmount 获取订单剩余数量
func (o *Order) GetRemainingAmount() decimal.Decimal {
	return o.Amount.Sub(o.FilledAmount)
}

// IsActive 检查订单是否活跃
func (o *Order) IsActive() bool {
	return o.Status == OrderStatusOpen || o.Status == OrderStatusPartiallyFilled
}

// IsExpired 检查订单是否过期
func (o *Order) IsExpired() bool {
	if o.ExpiresAt == nil {
		return false
	}
	return time.Now().After(*o.ExpiresAt)
}

// CanMatch 检查两个订单是否可以撮合
func (o *Order) CanMatch(other *Order) bool {
	if !o.IsActive() || !other.IsActive() {
		return false
	}
	
	if o.IsExpired() || other.IsExpired() {
		return false
	}
	
	if o.TradingPair != other.TradingPair {
		return false
	}
	
	if o.Side == other.Side {
		return false
	}
	
	// 价格匹配检查
	if o.Side == OrderSideBuy {
		return o.Price.GreaterThanOrEqual(other.Price)
	}
	return o.Price.LessThanOrEqual(other.Price)
}