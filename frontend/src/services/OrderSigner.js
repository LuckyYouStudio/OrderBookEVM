import { ethers } from 'ethers';

/**
 * OrderSigner - EIP-712 订单签名器
 * 支持 Maker/Taker 客户端的链下签名挂单/吃单
 */
class OrderSigner {
  constructor(chainId = 31337, contractAddress = '') {
    this.domain = {
      name: 'OrderBook DEX',
      version: '1.0',
      chainId,
      verifyingContract: contractAddress
    };

    this.orderTypes = {
      Order: [
        { name: 'userAddress', type: 'address' },
        { name: 'tradingPair', type: 'string' },
        { name: 'baseToken', type: 'address' },
        { name: 'quoteToken', type: 'address' },
        { name: 'side', type: 'uint8' },
        { name: 'orderType', type: 'uint8' },
        { name: 'price', type: 'uint256' },
        { name: 'amount', type: 'uint256' },
        { name: 'expiresAt', type: 'uint256' },
        { name: 'nonce', type: 'uint256' }
      ]
    };
  }

  /**
   * 签名订单
   * @param {Object} order - 订单对象
   * @param {Object} signer - ethers Signer
   * @returns {Promise<{signature: string, hash: string}>}
   */
  async signOrder(order, signer) {
    try {
      const orderStruct = this.formatOrderForSigning(order);
      const signature = await signer._signTypedData(
        this.domain,
        this.orderTypes,
        orderStruct
      );
      
      const hash = ethers.utils._TypedDataEncoder.hash(
        this.domain,
        this.orderTypes,
        orderStruct
      );
      
      return { signature, hash };
    } catch (error) {
      throw new Error(`订单签名失败: ${error.message}`);
    }
  }

  /**
   * 验证订单签名
   * @param {Object} order - 订单对象
   * @param {string} signature - 签名
   * @param {string} expectedSigner - 期望的签名者地址
   * @returns {boolean}
   */
  verifyOrderSignature(order, signature, expectedSigner) {
    try {
      const orderStruct = this.formatOrderForSigning(order);
      const recoveredAddress = ethers.utils.verifyTypedData(
        this.domain,
        this.orderTypes,
        orderStruct,
        signature
      );
      
      return recoveredAddress.toLowerCase() === expectedSigner.toLowerCase();
    } catch (error) {
      console.error('签名验证失败:', error);
      return false;
    }
  }

  /**
   * 计算订单哈希
   * @param {Object} order - 订单对象
   * @returns {string}
   */
  getOrderHash(order) {
    const orderStruct = this.formatOrderForSigning(order);
    return ethers.utils._TypedDataEncoder.hash(
      this.domain,
      this.orderTypes,
      orderStruct
    );
  }

  /**
   * 格式化订单用于签名
   * @param {Object} order - 订单对象
   * @returns {Object}
   */
  formatOrderForSigning(order) {
    return {
      userAddress: order.userAddress,
      tradingPair: order.tradingPair,
      baseToken: order.baseToken,
      quoteToken: order.quoteToken,
      side: order.side === 'buy' ? 0 : 1,
      orderType: this.getOrderTypeValue(order.type),
      price: ethers.utils.parseUnits(order.price.toString(), 'ether'),
      amount: ethers.utils.parseUnits(order.amount.toString(), 'ether'),
      expiresAt: order.expiresAt || 0,
      nonce: order.nonce || 0
    };
  }

  /**
   * 获取订单类型的数值
   * @param {string} type - 订单类型
   * @returns {number}
   */
  getOrderTypeValue(type) {
    const types = {
      'limit': 0,
      'market': 1,
      'stop_loss': 2,
      'take_profit': 3
    };
    return types[type] || 0;
  }

  /**
   * 批量签名订单
   * @param {Array} orders - 订单数组
   * @param {Object} signer - ethers Signer
   * @returns {Promise<Array>} - 签名结果数组
   */
  async signBatchOrders(orders, signer) {
    const results = [];
    for (const order of orders) {
      try {
        const result = await this.signOrder(order, signer);
        results.push({
          ...order,
          signature: result.signature,
          hash: result.hash,
          success: true
        });
      } catch (error) {
        results.push({
          ...order,
          error: error.message,
          success: false
        });
      }
    }
    return results;
  }
}

export default OrderSigner;
