package websocket

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/sirupsen/logrus"

	"orderbook-engine/internal/types"
)

// Hub WebSocket连接管理中心
type Hub struct {
	clients       map[*Client]bool
	broadcast     chan []byte
	register      chan *Client
	unregister    chan *Client
	subscriptions map[string]map[*Client]bool // topic -> clients
	mu            sync.RWMutex
	logger        *logrus.Logger
}

// Client WebSocket客户端
type Client struct {
	hub          *Hub
	conn         *websocket.Conn
	send         chan []byte
	subscriptions map[string]bool
	mu           sync.RWMutex
}

// Message WebSocket消息
type Message struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// SubscribeMessage 订阅消息
type SubscribeMessage struct {
	Action  string `json:"action"` // subscribe/unsubscribe
	Channel string `json:"channel"`
	Symbol  string `json:"symbol,omitempty"`
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // 允许跨域连接
	},
}

// NewHub 创建WebSocket Hub
func NewHub(logger *logrus.Logger) *Hub {
	return &Hub{
		clients:       make(map[*Client]bool),
		broadcast:     make(chan []byte, 256),
		register:      make(chan *Client),
		unregister:    make(chan *Client),
		subscriptions: make(map[string]map[*Client]bool),
		logger:        logger,
	}
}

// Run 启动Hub
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			h.logger.Info("Client connected")
			
			// 发送连接确认消息
			welcome := Message{
				Type: "connected",
				Data: map[string]interface{}{
					"timestamp": time.Now(),
					"message":   "Connected to OrderBook WebSocket",
				},
			}
			if data, err := json.Marshal(welcome); err == nil {
				select {
				case client.send <- data:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				
				// 从所有订阅中移除客户端
				for topic, clients := range h.subscriptions {
					delete(clients, client)
					if len(clients) == 0 {
						delete(h.subscriptions, topic)
					}
				}
			}
			h.mu.Unlock()
			h.logger.Info("Client disconnected")

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

// HandleWebSocket 处理WebSocket连接
func (h *Hub) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.WithError(err).Error("WebSocket upgrade failed")
		return
	}

	client := &Client{
		hub:           h,
		conn:          conn,
		send:          make(chan []byte, 256),
		subscriptions: make(map[string]bool),
	}

	client.hub.register <- client

	// 启动读写协程
	go client.writePump()
	go client.readPump()
}

// Subscribe 订阅主题
func (h *Hub) Subscribe(client *Client, topic string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.subscriptions[topic] == nil {
		h.subscriptions[topic] = make(map[*Client]bool)
	}
	h.subscriptions[topic][client] = true

	client.mu.Lock()
	client.subscriptions[topic] = true
	client.mu.Unlock()

	h.logger.WithFields(logrus.Fields{
		"topic": topic,
	}).Info("Client subscribed to topic")
}

// Unsubscribe 取消订阅
func (h *Hub) Unsubscribe(client *Client, topic string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if clients, exists := h.subscriptions[topic]; exists {
		delete(clients, client)
		if len(clients) == 0 {
			delete(h.subscriptions, topic)
		}
	}

	client.mu.Lock()
	delete(client.subscriptions, topic)
	client.mu.Unlock()

	h.logger.WithFields(logrus.Fields{
		"topic": topic,
	}).Info("Client unsubscribed from topic")
}

// PublishOrderBookUpdate 发布订单簿更新
func (h *Hub) PublishOrderBookUpdate(update *types.OrderBookUpdate) {
	topic := "orderbook." + update.TradingPair
	message := Message{
		Type: "orderbook_update",
		Data: update,
	}

	h.publishToTopic(topic, message)
}

// PublishTradeUpdate 发布交易更新
func (h *Hub) PublishTradeUpdate(update *types.TradeUpdate) {
	topic := "trades." + update.Trade.TradingPair
	message := Message{
		Type: "trade_update",
		Data: update,
	}

	h.publishToTopic(topic, message)
}

// PublishOrderUpdate 发布订单更新
func (h *Hub) PublishOrderUpdate(update *types.OrderUpdate) {
	// 发送给订单所有者
	userTopic := "orders." + update.Order.UserAddress
	message := Message{
		Type: "order_update",
		Data: update,
	}

	h.publishToTopic(userTopic, message)
}

// publishToTopic 发布消息到指定主题
func (h *Hub) publishToTopic(topic string, message Message) {
	data, err := json.Marshal(message)
	if err != nil {
		h.logger.WithError(err).Error("Failed to marshal message")
		return
	}

	h.mu.RLock()
	clients, exists := h.subscriptions[topic]
	if !exists {
		h.mu.RUnlock()
		return
	}

	// 复制客户端列表以避免死锁
	targetClients := make([]*Client, 0, len(clients))
	for client := range clients {
		targetClients = append(targetClients, client)
	}
	h.mu.RUnlock()

	// 发送给所有订阅客户端
	for _, client := range targetClients {
		select {
		case client.send <- data:
		default:
			// 客户端发送缓冲区满，关闭连接
			h.unregister <- client
		}
	}
}

// readPump 读取WebSocket消息
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(512)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		// 处理订阅消息
		var subMsg SubscribeMessage
		if err := json.Unmarshal(message, &subMsg); err != nil {
			continue
		}

		c.handleSubscriptionMessage(&subMsg)
	}
}

// writePump 写入WebSocket消息
func (c *Client) writePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// 批量发送队列中的消息
			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// handleSubscriptionMessage 处理订阅消息
func (c *Client) handleSubscriptionMessage(msg *SubscribeMessage) {
	var topic string

	switch msg.Channel {
	case "orderbook":
		if msg.Symbol == "" {
			return
		}
		topic = "orderbook." + msg.Symbol
	case "trades":
		if msg.Symbol == "" {
			return
		}
		topic = "trades." + msg.Symbol
	case "orders":
		// 需要用户地址验证
		return
	default:
		return
	}

	switch msg.Action {
	case "subscribe":
		c.hub.Subscribe(c, topic)
		
		// 发送订阅确认
		response := Message{
			Type: "subscription_success",
			Data: map[string]interface{}{
				"channel": msg.Channel,
				"symbol":  msg.Symbol,
				"topic":   topic,
			},
		}
		if data, err := json.Marshal(response); err == nil {
			select {
			case c.send <- data:
			default:
			}
		}

	case "unsubscribe":
		c.hub.Unsubscribe(c, topic)
		
		// 发送取消订阅确认
		response := Message{
			Type: "unsubscription_success",
			Data: map[string]interface{}{
				"channel": msg.Channel,
				"symbol":  msg.Symbol,
				"topic":   topic,
			},
		}
		if data, err := json.Marshal(response); err == nil {
			select {
			case c.send <- data:
			default:
			}
		}
	}
}

// GetConnectedClients 获取连接的客户端数量
func (h *Hub) GetConnectedClients() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// GetSubscriptionStats 获取订阅统计
func (h *Hub) GetSubscriptionStats() map[string]int {
	h.mu.RLock()
	defer h.mu.RUnlock()

	stats := make(map[string]int)
	for topic, clients := range h.subscriptions {
		stats[topic] = len(clients)
	}
	return stats
}