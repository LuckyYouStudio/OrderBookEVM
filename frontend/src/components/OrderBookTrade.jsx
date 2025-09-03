import React, { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { useWallet } from '../hooks/useWallet'
import { useContracts } from '../hooks/useContracts'
import { TOKEN_ADDRESSES } from '../config/contracts'
import orderbookEngineAPI from '../services/orderbookEngine'
import './OrderBookTrade.css'

const OrderBookTrade = () => {
  const { account, signer, isCorrectNetwork } = useWallet()
  const { contracts, isReady } = useContracts()
  const { orderBook, tokenRegistry, tokens } = contracts
  
  // 状态管理
  const [activeTab, setActiveTab] = useState('limit') // limit, market
  const [orderSide, setOrderSide] = useState('buy') // buy, sell
  const [price, setPrice] = useState('')
  const [amount, setAmount] = useState('')
  const [selectedPair, setSelectedPair] = useState({ tokenA: '', tokenB: '' })
  const [buyOrders, setBuyOrders] = useState([])
  const [sellOrders, setSellOrders] = useState([])
  const [myOrders, setMyOrders] = useState([])
  const [bestBid, setBestBid] = useState('0')
  const [bestAsk, setBestAsk] = useState('0')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [useEngine, setUseEngine] = useState(false)
  const [engineStatus, setEngineStatus] = useState('disconnected')

  // 代币对配置
  const pairs = [
    { 
      name: 'WETH/USDC', 
      tokenA: TOKEN_ADDRESSES.WETH.address,
      tokenB: TOKEN_ADDRESSES.USDC.address,
      tokenASymbol: 'WETH',
      tokenBSymbol: 'USDC'
    }
  ]

  // 初始化选择的交易对
  useEffect(() => {
    setSelectedPair({
      tokenA: TOKEN_ADDRESSES.WETH.address,
      tokenB: TOKEN_ADDRESSES.USDC.address,
      tokenASymbol: 'WETH',
      tokenBSymbol: 'USDC'
    })
  }, [])

  // OrderBook Engine 集成
  const initializeEngine = async () => {
    try {
      setLoading(true)
      setMessage('正在连接OrderBook引擎...')
      
      // 健康检查
      const health = await orderbookEngineAPI.healthCheck()
      if (!health) {
        throw new Error('OrderBook引擎不可用')
      }
      
      // 设置WebSocket事件监听
      orderbookEngineAPI.on('connected', () => {
        setEngineStatus('connected')
        setMessage('OrderBook引擎已连接')
        
        // 订阅当前交易对
        const tradingPair = `${selectedPair.tokenA}-${selectedPair.tokenB}`
        orderbookEngineAPI.subscribe(tradingPair)
      })
      
      orderbookEngineAPI.on('disconnected', () => {
        setEngineStatus('disconnected')
        setMessage('OrderBook引擎已断开')
      })
      
      orderbookEngineAPI.on('orderbook_update', (data) => {
        console.log('OrderBook update:', data)
        updateOrderBookFromEngine(data)
      })
      
      orderbookEngineAPI.on('trade_update', (data) => {
        console.log('Trade update:', data)
        setMessage(`新交易: ${data.trade.amount} @ ${data.trade.price}`)
      })
      
      // 连接WebSocket
      orderbookEngineAPI.connectWebSocket()
      setUseEngine(true)
      
    } catch (error) {
      console.error('引擎初始化失败:', error)
      setMessage(`引擎连接失败: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const stopEngine = () => {
    orderbookEngineAPI.disconnect()
    setUseEngine(false)
    setEngineStatus('disconnected')
    setMessage('OrderBook引擎已停用')
  }

  // 从引擎数据更新订单簿
  const updateOrderBookFromEngine = (data) => {
    try {
      // 转换引擎数据格式为前端格式
      const buyOrdersData = data.bids.map(level => ({
        price: level.price,
        amount: level.amount,
        total: (parseFloat(level.price) * parseFloat(level.amount)).toFixed(2)
      }))
      
      const sellOrdersData = data.asks.map(level => ({
        price: level.price,
        amount: level.amount,
        total: (parseFloat(level.price) * parseFloat(level.amount)).toFixed(2)
      }))
      
      setBuyOrders(buyOrdersData)
      setSellOrders(sellOrdersData)
      
      // 更新最佳买卖价
      if (buyOrdersData.length > 0) {
        setBestBid(buyOrdersData[0].price)
      }
      if (sellOrdersData.length > 0) {
        setBestAsk(sellOrdersData[0].price)
      }
      
    } catch (error) {
      console.error('更新订单簿失败:', error)
    }
  }

  // 获取订单簿数据
  const fetchOrderBook = async () => {
    if (!orderBook || !selectedPair.tokenA || !selectedPair.tokenB) return
    
    try {
      console.log('Fetching orderbook data...')
      
      // 获取买单价格水平
      const buyLevels = await orderBook.getBuyPriceLevels(
        selectedPair.tokenA,
        selectedPair.tokenB,
        10
      )
      
      // 获取卖单价格水平
      const sellLevels = await orderBook.getSellPriceLevels(
        selectedPair.tokenA,
        selectedPair.tokenB,
        10
      )
      
      console.log('Buy levels:', buyLevels.map(l => l.toString()))
      console.log('Sell levels:', sellLevels.map(l => l.toString()))
      
      // 获取最佳买卖价 - 使用USDC精度格式化
      const bid = await orderBook.bestBid(selectedPair.tokenA, selectedPair.tokenB)
      const ask = await orderBook.bestAsk(selectedPair.tokenA, selectedPair.tokenB)
      
      console.log('Raw bid:', bid.toString())
      console.log('Raw ask:', ask.toString())
      
      setBestBid(bid > 0 ? ethers.formatUnits(bid, TOKEN_ADDRESSES.USDC.decimals) : '0')
      setBestAsk(ask > 0 ? ethers.formatUnits(ask, TOKEN_ADDRESSES.USDC.decimals) : '0')
      
      // 获取每个价格水平的订单
      const buyOrdersData = []
      for (const level of buyLevels) {
        if (level > 0) {
          const orderIds = await orderBook.getBuyOrdersAtPrice(
            selectedPair.tokenA,
            selectedPair.tokenB,
            level
          )
          
          let totalAmount = 0n
          for (const orderId of orderIds) {
            const order = await orderBook.getOrder(orderId)
            totalAmount += order.amount - order.filledAmount
          }
          
          buyOrdersData.push({
            price: ethers.formatUnits(level, TOKEN_ADDRESSES.USDC.decimals),
            amount: ethers.formatUnits(totalAmount, TOKEN_ADDRESSES.WETH.decimals),
            total: ethers.formatUnits(level * totalAmount / (10n ** 18n), TOKEN_ADDRESSES.USDC.decimals)
          })
        }
      }
      
      const sellOrdersData = []
      for (const level of sellLevels) {
        if (level > 0) {
          const orderIds = await orderBook.getSellOrdersAtPrice(
            selectedPair.tokenA,
            selectedPair.tokenB,
            level
          )
          
          let totalAmount = 0n
          for (const orderId of orderIds) {
            const order = await orderBook.getOrder(orderId)
            totalAmount += order.amount - order.filledAmount
          }
          
          sellOrdersData.push({
            price: ethers.formatUnits(level, TOKEN_ADDRESSES.USDC.decimals),
            amount: ethers.formatUnits(totalAmount, TOKEN_ADDRESSES.WETH.decimals),
            total: ethers.formatUnits(level * totalAmount / (10n ** 18n), TOKEN_ADDRESSES.USDC.decimals)
          })
        }
      }
      
      setBuyOrders(buyOrdersData)
      setSellOrders(sellOrdersData)
      
    } catch (error) {
      console.error('获取订单簿失败:', error)
    }
  }

  // 获取我的订单
  const fetchMyOrders = async () => {
    if (!orderBook || !account) {
      console.log('fetchMyOrders: missing orderBook or account')
      return
    }
    
    try {
      console.log('Fetching my orders for account:', account)
      const orderIds = await orderBook.getUserOrders(account)
      console.log('Found order IDs:', orderIds.map(id => id.toString()))
      
      const orders = []
      
      for (const orderId of orderIds) {
        const order = await orderBook.getOrder(orderId)
        console.log(`Order ${orderId}:`, {
          trader: order.trader,
          tokenA: order.tokenA,
          tokenB: order.tokenB,
          price: order.price.toString(),
          amount: order.amount.toString(),
          filledAmount: order.filledAmount.toString(),
          status: order.status,
          isBuy: order.isBuy
        })
        
        // 显示所有订单（包括已完成的）
        let statusText = '未知'
        if (Number(order.status) === 0) statusText = '挂单中'
        else if (Number(order.status) === 1) statusText = '部分成交'  
        else if (Number(order.status) === 2) statusText = '已完成'
        else if (Number(order.status) === 3) statusText = '已取消'
        
        orders.push({
          id: orderId.toString(),
          type: order.isBuy ? '买入' : '卖出',
          price: ethers.formatUnits(order.price, TOKEN_ADDRESSES.USDC.decimals),
          amount: ethers.formatUnits(order.amount, TOKEN_ADDRESSES.WETH.decimals),
          filled: ethers.formatUnits(order.filledAmount, TOKEN_ADDRESSES.WETH.decimals),
          status: statusText,
          tokenPair: `${selectedPair.tokenASymbol}/${selectedPair.tokenBSymbol}`,
          rawStatus: Number(order.status)
        })
      }
      
      console.log('Processed orders:', orders)
      setMyOrders(orders)
    } catch (error) {
      console.error('获取我的订单失败:', error)
    }
  }

  // 下单
  const placeOrder = async () => {
    if (!orderBook || !signer || !price || !amount) {
      setMessage('请填写价格和数量')
      return
    }
    
    if (!tokens?.usdc || !tokens?.weth) {
      setMessage('代币合约未加载，请刷新页面')
      return
    }
    
    setLoading(true)
    setMessage('')
    
    try {
      console.log('开始下单流程...')
      console.log('Account:', account)
      console.log('OrderBook address:', await orderBook.getAddress())
      console.log('USDC address:', await tokens.usdc.getAddress())
      console.log('WETH address:', await tokens.weth.getAddress())
      
      // 先授权代币
      const tokenToApprove = orderSide === 'buy' ? tokens.usdc : tokens.weth
      
      // 根据代币类型使用正确的精度
      const amountToApprove = orderSide === 'buy' 
        ? ethers.parseUnits((parseFloat(price) * parseFloat(amount)).toString(), TOKEN_ADDRESSES.USDC.decimals)
        : ethers.parseUnits(amount, TOKEN_ADDRESSES.WETH.decimals)
      
      console.log('Token to approve:', await tokenToApprove.getAddress())
      console.log('Amount to approve:', orderSide === 'buy' 
        ? ethers.formatUnits(amountToApprove, TOKEN_ADDRESSES.USDC.decimals)
        : ethers.formatUnits(amountToApprove, TOKEN_ADDRESSES.WETH.decimals))
      
      // 检查余额
      console.log('检查余额...')
      const balance = await tokenToApprove.balanceOf(account)
      console.log('Current balance:', orderSide === 'buy' 
        ? ethers.formatUnits(balance, TOKEN_ADDRESSES.USDC.decimals)
        : ethers.formatUnits(balance, TOKEN_ADDRESSES.WETH.decimals))
      
      if (balance < amountToApprove) {
        // 如果余额不足，尝试mint一些代币（测试用）
        console.log('余额不足，开始铸造代币...')
        const mintAmount = amountToApprove * 10n // 铸造10倍的量
        const mintTx = await tokenToApprove.mint(account, mintAmount)
        await mintTx.wait()
        setMessage('已为您铸造测试代币')
        console.log('代币铸造成功')
      }
      
      // 授权结算合约
      const settlementAddress = await orderBook.settlement()
      const allowance = await tokenToApprove.allowance(account, settlementAddress)
      
      if (allowance < amountToApprove) {
        const approveTx = await tokenToApprove.approve(settlementAddress, ethers.MaxUint256)
        await approveTx.wait()
        setMessage('代币授权成功')
      }
      
      // 将代币存入Settlement合约（托管模式）
      console.log('检查Settlement合约余额...')
      const settlementContract = contracts.settlement
      const settlementBalance = await settlementContract.getUserBalance(account, await tokenToApprove.getAddress())
      console.log('Settlement balance:', orderSide === 'buy' 
        ? ethers.formatUnits(settlementBalance, TOKEN_ADDRESSES.USDC.decimals)
        : ethers.formatUnits(settlementBalance, TOKEN_ADDRESSES.WETH.decimals))
      
      if (settlementBalance < amountToApprove) {
        console.log('Settlement余额不足，存入代币...')
        const depositAmount = amountToApprove * 2n // 存入2倍的量
        const depositTx = await settlementContract.deposit(await tokenToApprove.getAddress(), depositAmount)
        await depositTx.wait()
        setMessage('代币已存入交易合约')
        console.log('代币存入成功')
      }
      
      // 下单 - 使用正确的精度
      const priceInWei = ethers.parseUnits(price, TOKEN_ADDRESSES.USDC.decimals) // 价格用USDC精度
      const amountInWei = ethers.parseUnits(amount, TOKEN_ADDRESSES.WETH.decimals) // 数量用WETH精度
      
      console.log('Place order params:', {
        tokenA: selectedPair.tokenA,
        tokenB: selectedPair.tokenB,
        price: ethers.formatUnits(priceInWei, TOKEN_ADDRESSES.USDC.decimals),
        amount: ethers.formatUnits(amountInWei, TOKEN_ADDRESSES.WETH.decimals),
        isBuy: orderSide === 'buy'
      })
      
      const tx = await orderBook.placeOrder(
        selectedPair.tokenA,
        selectedPair.tokenB,
        priceInWei,
        amountInWei,
        orderSide === 'buy',
        0, // OrderType.LIMIT
        0  // 永不过期
      )
      
      await tx.wait()
      setMessage(`${orderSide === 'buy' ? '买单' : '卖单'}下单成功！`)
      
      // 刷新数据
      fetchOrderBook()
      fetchMyOrders()
      
      // 清空输入
      setPrice('')
      setAmount('')
      
    } catch (error) {
      console.error('下单失败:', error)
      setMessage(`下单失败: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  // 取消订单
  const cancelOrder = async (orderId) => {
    if (!orderBook || !signer) return
    
    setLoading(true)
    setMessage('')
    
    try {
      const tx = await orderBook.cancelOrder(orderId)
      await tx.wait()
      setMessage('订单取消成功')
      
      // 刷新数据
      fetchOrderBook()
      fetchMyOrders()
      
    } catch (error) {
      console.error('取消订单失败:', error)
      setMessage(`取消订单失败: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  // 手动匹配订单 - 提供详细指导
  const matchOrders = async () => {
    setLoading(true)
    setMessage('正在检查可匹配订单...')
    
    try {
      // 检查是否有可匹配的订单
      const buyLevels = await orderBook.getBuyPriceLevels(selectedPair.tokenA, selectedPair.tokenB, 10)
      const sellLevels = await orderBook.getSellPriceLevels(selectedPair.tokenA, selectedPair.tokenB, 10)
      
      let hasMatches = false
      let matchInfo = []
      
      for (const buyPrice of buyLevels) {
        for (const sellPrice of sellLevels) {
          if (buyPrice >= sellPrice && buyPrice > 0 && sellPrice > 0) {
            hasMatches = true
            matchInfo.push(`买价 ${ethers.formatUnits(buyPrice, 6)} >= 卖价 ${ethers.formatUnits(sellPrice, 6)}`)
          }
        }
      }
      
      if (hasMatches) {
        setMessage(`发现可匹配订单！正在执行撮合...`)
        
        try {
          // 调用后端API执行撮合
          const response = await fetch('/api/match-orders', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              tokenA: selectedPair.tokenA,
              tokenB: selectedPair.tokenB
            })
          })
          
          if (response.ok) {
            const result = await response.json()
            setMessage(`✅ 撮合成功！执行了 ${result.matches || 0} 笔交易`)
            
            // 刷新数据
            setTimeout(() => {
              fetchOrderBook()
              fetchMyOrders()
            }, 2000)
          } else {
            throw new Error('撮合API调用失败')
          }
        } catch (apiError) {
          console.log('API撮合失败，使用命令行方式：', apiError)
          setMessage(`发现可匹配订单！匹配信息: ${matchInfo.join(', ')}。请运行命令行工具撮合。`)
          
          // 在控制台显示详细说明
          console.log('\n=== 订单匹配说明 ===')
          console.log('1. 保持此前端页面运行')
          console.log('2. 打开新的命令行窗口')  
          console.log('3. 进入项目目录：D:\\WorkProjecks\\OrderBookEVM')
          console.log('4. 运行命令：npx hardhat run match-orders.js --network localhost')
          console.log('5. 等待匹配完成后刷新此页面查看结果')
          console.log('======================')
          
          // 创建复制命令的功能
          if (navigator.clipboard) {
            try {
              await navigator.clipboard.writeText('npx hardhat run match-orders.js --network localhost')
              console.log('✅ 匹配命令已复制到剪贴板')
            } catch (err) {
              console.log('❌ 无法复制到剪贴板')
            }
          }
        }
      } else {
        setMessage('当前没有可匹配的订单。请先下单或等待其他用户下单。')
      }
      
    } catch (error) {
      console.error('检查订单失败:', error)
      setMessage(`检查失败: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  // 定时刷新数据
  useEffect(() => {
    if (isCorrectNetwork && orderBook) {
      fetchOrderBook()
      fetchMyOrders()
      
      const interval = setInterval(() => {
        fetchOrderBook()
        fetchMyOrders()
      }, 5000)
      
      return () => clearInterval(interval)
    }
  }, [isCorrectNetwork, orderBook, selectedPair, account])

  if (!isCorrectNetwork) {
    return (
      <div className="orderbook-trade-container">
        <div className="warning-message">
          请先连接到本地Hardhat网络
        </div>
      </div>
    )
  }

  return (
    <div className="orderbook-trade-container">
      <div className="orderbook-header">
        <h1>订单簿交易</h1>
        <div className="header-controls">
          <div className="pair-selector">
            <select 
              value={`${selectedPair.tokenA}-${selectedPair.tokenB}`}
              onChange={(e) => {
                const pair = pairs.find(p => `${p.tokenA}-${p.tokenB}` === e.target.value)
                if (pair) setSelectedPair(pair)
              }}
            >
              {pairs.map((pair, index) => (
                <option key={index} value={`${pair.tokenA}-${pair.tokenB}`}>
                  {pair.name}
                </option>
              ))}
            </select>
          </div>
          <button 
            className="match-orders-btn"
            onClick={matchOrders}
            disabled={loading || !account}
          >
            {loading ? '检查中...' : '🔍 检查可匹配订单'}
          </button>
          
          <button 
            className={`engine-btn ${useEngine ? 'active' : ''}`}
            onClick={useEngine ? stopEngine : initializeEngine}
            disabled={loading}
            title={useEngine ? 'OrderBook引擎已启用' : '启用OrderBook引擎实现自动撮合'}
          >
            {useEngine ? (
              <span>
                🚀 引擎 
                <span className={`status-dot ${engineStatus}`}></span>
              </span>
            ) : (
              '⚡ 启用引擎'
            )}
          </button>
        </div>
      </div>

      <div className="orderbook-content">
        {/* 订单簿深度 */}
        <div className="orderbook-depth">
          <div className="depth-section">
            <h3>卖单</h3>
            <div className="depth-header">
              <span>价格(USDC)</span>
              <span>数量(WETH)</span>
              <span>总计(USDC)</span>
            </div>
            <div className="sell-orders">
              {sellOrders.length > 0 ? (
                sellOrders.slice(0, 10).reverse().map((order, index) => (
                  <div key={index} className="order-row sell">
                    <span>{parseFloat(order.price).toFixed(2)}</span>
                    <span>{parseFloat(order.amount).toFixed(4)}</span>
                    <span>{parseFloat(order.total).toFixed(2)}</span>
                  </div>
                ))
              ) : (
                <div className="no-orders">暂无卖单</div>
              )}
            </div>
          </div>

          <div className="spread">
            <div className="spread-info">
              <span>买一: {parseFloat(bestBid).toFixed(2)} USDC</span>
              <span>卖一: {parseFloat(bestAsk).toFixed(2)} USDC</span>
            </div>
          </div>

          <div className="depth-section">
            <h3>买单</h3>
            <div className="depth-header">
              <span>价格(USDC)</span>
              <span>数量(WETH)</span>
              <span>总计(USDC)</span>
            </div>
            <div className="buy-orders">
              {buyOrders.length > 0 ? (
                buyOrders.slice(0, 10).map((order, index) => (
                  <div key={index} className="order-row buy">
                    <span>{parseFloat(order.price).toFixed(2)}</span>
                    <span>{parseFloat(order.amount).toFixed(4)}</span>
                    <span>{parseFloat(order.total).toFixed(2)}</span>
                  </div>
                ))
              ) : (
                <div className="no-orders">暂无买单</div>
              )}
            </div>
          </div>
        </div>

        {/* 下单面板 */}
        <div className="trading-panel">
          <div className="order-tabs">
            <button 
              className={activeTab === 'limit' ? 'active' : ''}
              onClick={() => setActiveTab('limit')}
            >
              限价单
            </button>
            <button 
              className={activeTab === 'market' ? 'active' : ''}
              onClick={() => setActiveTab('market')}
              disabled
            >
              市价单
            </button>
          </div>

          <div className="order-side-selector">
            <button 
              className={`buy-btn ${orderSide === 'buy' ? 'active' : ''}`}
              onClick={() => setOrderSide('buy')}
            >
              买入
            </button>
            <button 
              className={`sell-btn ${orderSide === 'sell' ? 'active' : ''}`}
              onClick={() => setOrderSide('sell')}
            >
              卖出
            </button>
          </div>

          <div className="order-form">
            <div className="form-group">
              <label>价格 (USDC)</label>
              <input 
                type="number" 
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                step="0.01"
              />
            </div>
            
            <div className="form-group">
              <label>数量 (WETH)</label>
              <input 
                type="number" 
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                step="0.0001"
              />
            </div>

            <div className="form-group">
              <label>总计 (USDC)</label>
              <input 
                type="text" 
                value={price && amount ? (parseFloat(price) * parseFloat(amount)).toFixed(2) : '0.00'}
                disabled
              />
            </div>

            <button 
              className={`place-order-btn ${orderSide}`}
              onClick={placeOrder}
              disabled={loading || !account}
            >
              {loading ? '处理中...' : (account ? `${orderSide === 'buy' ? '买入' : '卖出'} WETH` : '请先连接钱包')}
            </button>

            {message && (
              <div className={`message ${message.includes('失败') ? 'error' : 'success'}`}>
                {message}
              </div>
            )}
          </div>
        </div>

        {/* 我的订单 */}
        <div className="my-orders">
          <h3>我的订单</h3>
          <div className="orders-table">
            <div className="table-header">
              <span>交易对</span>
              <span>类型</span>
              <span>价格</span>
              <span>数量</span>
              <span>已成交</span>
              <span>状态</span>
              <span>操作</span>
            </div>
            <div className="table-body">
              {myOrders.length > 0 ? (
                myOrders.map((order) => (
                  <div key={order.id} className="table-row">
                    <span>{order.tokenPair}</span>
                    <span className={order.type === '买入' ? 'buy' : 'sell'}>
                      {order.type}
                    </span>
                    <span>{order.price}</span>
                    <span>{order.amount}</span>
                    <span>{order.filled}</span>
                    <span>{order.status}</span>
                    <span>
                      <button 
                        className="cancel-btn"
                        onClick={() => cancelOrder(order.id)}
                        disabled={loading}
                      >
                        取消
                      </button>
                    </span>
                  </div>
                ))
              ) : (
                <div className="no-orders">暂无挂单</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default OrderBookTrade