import OrderSigner from './OrderSigner.js';
import { ethers } from 'ethers';

/**
 * OrderbookClient - 订单簿客户端
 * 支持 Maker/Taker 模式的链下订单管理
 */
class OrderbookClient {
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || 'http://localhost:8080/api/v1';
    this.wsUrl = options.wsUrl || 'ws://localhost:8080/ws';
    this.chainId = options.chainId || 31337;
    this.contractAddress = options.contractAddress || '';
    
    this.signer = new OrderSigner(this.chainId, this.contractAddress);
    this.ws = null;
    this.callbacks = new Map();
    this.userNonce = new Map(); // 用户 nonce 管理
    
    this.initWebSocket();
  }

  /**
   * 初始化 WebSocket 连接
   */
  initWebSocket() {
    try {
      this.ws = new WebSocket(this.wsUrl);
      
      this.ws.onopen = () => {
        console.log('订单簿 WebSocket 已连接');
        this.emit('connected');
      };
      
      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error('解析 WebSocket 消息失败:', error);
        }
      };
      
      this.ws.onclose = () => {
        console.log('订单簿 WebSocket 连接关闭');
        this.emit('disconnected');
        // 3秒后重连
        setTimeout(() => this.initWebSocket(), 3000);
      };
      
      this.ws.onerror = (error) => {
        console.error('订单簿 WebSocket 错误:', error);
        this.emit('error', error);
      };
    } catch (error) {
      console.error('初始化 WebSocket 失败:', error);
    }
  }

  /**
   * 处理 WebSocket 消息
   * @param {Object} message - 消息对象
   */
  handleWebSocketMessage(message) {
    switch (message.type) {
      case 'orderbook_update':
        this.emit('orderbook', message.data);
        break;
      case 'trade_update':
        this.emit('trade', message.data);
        break;
      case 'order_update':
        this.emit('order', message.data);
        break;
      default:
        console.log('未知消息类型:', message.type);
    }
  }

  /**
   * Maker 挂单（链下签名）
   * @param {Object} orderData - 订单数据
   * @param {Object} ethSigner - ethers Signer
   * @returns {Promise<Object>} - 订单结果
   */
  async placeMakerOrder(orderData, ethSigner) {
    try {
      // 1. 获取用户 nonce
      const userAddress = await ethSigner.getAddress();
      const nonce = await this.getUserNextNonce(userAddress);
      
      // 2. 构建订单
      const order = {
        ...orderData,
        userAddress,
        nonce,
        type: 'limit' // Maker 订单默认为限价单
      };
      
      // 3. 签名订单
      const { signature, hash } = await this.signer.signOrder(order, ethSigner);
      
      // 4. 提交到撮合引擎
      const response = await fetch(`${this.apiUrl}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...order,
          signature,
          hash
        })
      });
      
      if (!response.ok) {
        throw new Error(`提交订单失败: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      // 5. 更新 nonce
      this.userNonce.set(userAddress, nonce + 1);
      
      return {
        success: true,
        orderId: result.order_id,
        hash,
        order: result.order
      };
    } catch (error) {
      throw new Error(`Maker 挂单失败: ${error.message}`);
    }
  }

  /**
   * Taker 吃单（链下签名）
   * @param {Object} orderData - 订单数据
   * @param {Object} ethSigner - ethers Signer
   * @returns {Promise<Object>} - 成交结果
   */
  async placeTakerOrder(orderData, ethSigner) {
    try {
      // Taker 订单可以是市价单或限价单
      const userAddress = await ethSigner.getAddress();
      const nonce = await this.getUserNextNonce(userAddress);
      
      const order = {
        ...orderData,
        userAddress,
        nonce
      };
      
      const { signature, hash } = await this.signer.signOrder(order, ethSigner);
      
      const response = await fetch(`${this.apiUrl}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...order,
          signature,
          hash,
          immediate: true // 标记为 Taker 订单
        })
      });
      
      if (!response.ok) {
        throw new Error(`提交订单失败: ${response.statusText}`);
      }
      
      const result = await response.json();
      this.userNonce.set(userAddress, nonce + 1);
      
      return {
        success: true,
        orderId: result.order_id,
        hash,
        fills: result.fills || [],
        order: result.order
      };
    } catch (error) {
      throw new Error(`Taker 吃单失败: ${error.message}`);
    }
  }

  /**
   * 取消订单（不花 Gas）
   * @param {string} orderId - 订单 ID
   * @returns {Promise<Object>}
   */
  async cancelOrder(orderId) {
    try {
      const response = await fetch(`${this.apiUrl}/orders/${orderId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        throw new Error(`取消订单失败: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      throw new Error(`取消订单失败: ${error.message}`);
    }
  }

  /**
   * 获取订单簿
   * @param {string} tradingPair - 交易对
   * @param {number} depth - 深度
   * @returns {Promise<Object>}
   */
  async getOrderbook(tradingPair, depth = 20) {
    try {
      const response = await fetch(`${this.apiUrl}/orderbook/${tradingPair}?depth=${depth}`);
      if (!response.ok) {
        throw new Error(`获取订单簿失败: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      throw new Error(`获取订单簿失败: ${error.message}`);
    }
  }

  /**
   * 获取用户订单
   * @param {string} userAddress - 用户地址
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}
   */
  async getUserOrders(userAddress, options = {}) {
    try {
      const params = new URLSearchParams({
        user_address: userAddress,
        ...options
      });
      
      const response = await fetch(`${this.apiUrl}/orders?${params}`);
      if (!response.ok) {
        throw new Error(`获取用户订单失败: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      throw new Error(`获取用户订单失败: ${error.message}`);
    }
  }

  /**
   * 获取交易历史
   * @param {string} tradingPair - 交易对
   * @param {number} limit - 数量限制
   * @returns {Promise<Array>}
   */
  async getTrades(tradingPair, limit = 50) {
    try {
      const params = new URLSearchParams({
        trading_pair: tradingPair,
        limit
      });
      
      const response = await fetch(`${this.apiUrl}/trades?${params}`);
      if (!response.ok) {
        throw new Error(`获取交易历史失败: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      throw new Error(`获取交易历史失败: ${error.message}`);
    }
  }

  /**
   * 获取用户下一个 nonce
   * @param {string} userAddress - 用户地址
   * @returns {Promise<number>}
   */
  async getUserNextNonce(userAddress) {
    const cached = this.userNonce.get(userAddress);
    if (cached !== undefined) {
      return cached;
    }
    
    // 从服务器获取当前 nonce
    try {
      const response = await fetch(`${this.apiUrl}/users/${userAddress}/nonce`);
      if (response.ok) {
        const data = await response.json();
        this.userNonce.set(userAddress, data.nonce);
        return data.nonce;
      }
    } catch (error) {
      console.warn('获取服务器 nonce 失败，使用默认值:', error);
    }
    
    // 默认从 0 开始
    this.userNonce.set(userAddress, 0);
    return 0;
  }

  /**
   * 订阅交易对更新
   * @param {string} tradingPair - 交易对
   */
  subscribeToPair(tradingPair) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        channel: 'orderbook',
        trading_pair: tradingPair
      }));
    }
  }

  /**
   * 取消订阅
   * @param {string} tradingPair - 交易对
   */
  unsubscribeFromPair(tradingPair) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'unsubscribe',
        channel: 'orderbook',
        trading_pair: tradingPair
      }));
    }
  }

  /**
   * 事件监听
   * @param {string} event - 事件名称
   * @param {Function} callback - 回调函数
   */
  on(event, callback) {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, []);
    }
    this.callbacks.get(event).push(callback);
  }

  /**
   * 移除事件监听
   * @param {string} event - 事件名称
   * @param {Function} callback - 回调函数
   */
  off(event, callback) {
    if (this.callbacks.has(event)) {
      const callbacks = this.callbacks.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * 触发事件
   * @param {string} event - 事件名称
   * @param {*} data - 事件数据
   */
  emit(event, data) {
    if (this.callbacks.has(event)) {
      this.callbacks.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`事件回调错误 [${event}]:`, error);
        }
      });
    }
  }

  /**
   * 关闭连接
   */
  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.callbacks.clear();
    this.userNonce.clear();
  }
}

export default OrderbookClient;
