/**
 * OrderBook Engine API Integration
 * 连接到Go订单簿引擎的API服务
 */

class OrderBookEngineAPI {
  constructor(baseURL = 'http://localhost:8080') {
    this.baseURL = baseURL;
    this.wsConnection = null;
    this.eventListeners = new Map();
  }

  // ==================== HTTP API 方法 ====================

  /**
   * 健康检查
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this.baseURL}/api/v1/health`);
      return await response.json();
    } catch (error) {
      console.error('Health check failed:', error);
      return null;
    }
  }

  /**
   * 获取订单簿快照
   * @param {string} tradingPair 交易对，格式: "TokenA-TokenB"
   * @param {number} depth 深度，默认20
   */
  async getOrderBook(tradingPair, depth = 20) {
    try {
      const response = await fetch(
        `${this.baseURL}/api/v1/orderbook/${encodeURIComponent(tradingPair)}?depth=${depth}`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Failed to get orderbook:', error);
      throw error;
    }
  }

  /**
   * 获取用户订单
   * @param {string} userAddress 用户地址
   * @param {string} tradingPair 可选，交易对过滤
   * @param {string} status 可选，状态过滤
   * @param {number} limit 限制数量
   * @param {number} offset 偏移量
   */
  async getUserOrders(userAddress, tradingPair = '', status = '', limit = 50, offset = 0) {
    try {
      const params = new URLSearchParams({
        user_address: userAddress,
        limit: limit.toString(),
        offset: offset.toString()
      });
      
      if (tradingPair) params.append('trading_pair', tradingPair);
      if (status) params.append('status', status);
      
      const response = await fetch(`${this.baseURL}/api/v1/orders?${params}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Failed to get user orders:', error);
      throw error;
    }
  }

  /**
   * 获取交易历史
   * @param {string} tradingPair 可选，交易对过滤
   * @param {number} limit 限制数量
   */
  async getTrades(tradingPair = '', limit = 50) {
    try {
      const params = new URLSearchParams({
        limit: limit.toString()
      });
      
      if (tradingPair) params.append('trading_pair', tradingPair);
      
      const response = await fetch(`${this.baseURL}/api/v1/trades?${params}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Failed to get trades:', error);
      throw error;
    }
  }

  /**
   * 获取交易对统计
   * @param {string} tradingPair 交易对
   */
  async getStats(tradingPair) {
    try {
      const response = await fetch(
        `${this.baseURL}/api/v1/stats/${encodeURIComponent(tradingPair)}`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Failed to get stats:', error);
      throw error;
    }
  }

  // ==================== WebSocket 方法 ====================

  /**
   * 连接WebSocket
   */
  connectWebSocket() {
    if (this.wsConnection) {
      this.wsConnection.close();
    }

    const wsURL = this.baseURL.replace('http', 'ws') + '/ws';
    console.log('Connecting to WebSocket:', wsURL);
    
    this.wsConnection = new WebSocket(wsURL);
    
    this.wsConnection.onopen = (event) => {
      console.log('WebSocket connected');
      this.emit('connected', event);
    };
    
    this.wsConnection.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleWebSocketMessage(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };
    
    this.wsConnection.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', error);
    };
    
    this.wsConnection.onclose = (event) => {
      console.log('WebSocket disconnected:', event.code, event.reason);
      this.emit('disconnected', event);
      
      // 自动重连
      if (!event.wasClean) {
        setTimeout(() => {
          console.log('Attempting to reconnect...');
          this.connectWebSocket();
        }, 5000);
      }
    };
  }

  /**
   * 处理WebSocket消息
   */
  handleWebSocketMessage(data) {
    const { type, payload } = data;
    
    switch (type) {
      case 'orderbook_update':
        this.emit('orderbook_update', payload);
        break;
      case 'trade_update':
        this.emit('trade_update', payload);
        break;
      case 'order_update':
        this.emit('order_update', payload);
        break;
      default:
        console.log('Unknown WebSocket message type:', type, payload);
    }
  }

  /**
   * 订阅交易对
   * @param {string} tradingPair 交易对
   */
  subscribe(tradingPair) {
    if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
      this.wsConnection.send(JSON.stringify({
        action: 'subscribe',
        trading_pair: tradingPair
      }));
    }
  }

  /**
   * 取消订阅交易对
   * @param {string} tradingPair 交易对
   */
  unsubscribe(tradingPair) {
    if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
      this.wsConnection.send(JSON.stringify({
        action: 'unsubscribe',
        trading_pair: tradingPair
      }));
    }
  }

  /**
   * 关闭WebSocket连接
   */
  disconnect() {
    if (this.wsConnection) {
      this.wsConnection.close(1000, 'Client disconnect');
      this.wsConnection = null;
    }
  }

  // ==================== 事件系统 ====================

  /**
   * 添加事件监听器
   * @param {string} event 事件名
   * @param {function} callback 回调函数
   */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  /**
   * 移除事件监听器
   * @param {string} event 事件名
   * @param {function} callback 回调函数
   */
  off(event, callback) {
    if (this.eventListeners.has(event)) {
      const listeners = this.eventListeners.get(event);
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * 触发事件
   * @param {string} event 事件名
   * @param {*} data 事件数据
   */
  emit(event, data) {
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 格式化交易对名称
   * @param {string} tokenA Token A 地址
   * @param {string} tokenB Token B 地址
   */
  static formatTradingPair(tokenA, tokenB) {
    return `${tokenA}-${tokenB}`;
  }

  /**
   * 解析交易对名称
   * @param {string} tradingPair 交易对字符串
   */
  static parseTradingPair(tradingPair) {
    const [tokenA, tokenB] = tradingPair.split('-');
    return { tokenA, tokenB };
  }
}

// 创建单例实例
const orderbookEngineAPI = new OrderBookEngineAPI();

export default orderbookEngineAPI;
export { OrderBookEngineAPI };