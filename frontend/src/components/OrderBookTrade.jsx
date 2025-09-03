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
  const [trades, setTrades] = useState([])
  const [bestBid, setBestBid] = useState('0')
  const [bestAsk, setBestAsk] = useState('0')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [useEngine, setUseEngine] = useState(true)
  const [engineStatus, setEngineStatus] = useState('connecting')
  const [wsConnection, setWsConnection] = useState(null)
  const [lastUpdate, setLastUpdate] = useState('')
  const [activeOrderTab, setActiveOrderTab] = useState('orders') // orders, trades, history

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

  // 自动初始化引擎连接
  useEffect(() => {
    const autoInitEngine = async () => {
      try {
        setMessage('🔄 正在连接撮合引擎...')
        
        // 健康检查
        const healthResponse = await fetch('http://localhost:8084/api/v1/health')
        if (!healthResponse.ok) {
          throw new Error('撮合引擎不可用')
        }
        
        // 连接WebSocket进行实时更新
        connectWebSocket()
        
        // 初始加载数据
        await loadOrderbook()
        await loadEngineOrders()
        await loadTrades()
        
        setMessage('✅ 撮合引擎已自动连接')
        
      } catch (error) {
        console.error('自动引擎连接失败:', error)
        setEngineStatus('disconnected')
        setMessage(`❌ 引擎连接失败: ${error.message}`)
        setUseEngine(false)
      }
    }

    // 延迟一秒后自动连接，确保组件完全加载
    setTimeout(autoInitEngine, 1000)
  }, [])

  // WebSocket连接管理
  const connectWebSocket = () => {
    if (wsConnection) {
      wsConnection.close()
    }

    try {
      // 尝试连接WebSocket (如果引擎支持)
      const ws = new WebSocket('ws://localhost:8084/ws')
      
      ws.onopen = () => {
        console.log('WebSocket连接成功')
        setEngineStatus('connected')
        setMessage('✅ 实时连接已建立')
        setLastUpdate(new Date().toLocaleTimeString())
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'orderbook_update') {
            updateOrderBookFromEngine(data.data)
            setLastUpdate(new Date().toLocaleTimeString())
          } else if (data.type === 'trade_update') {
            setMessage(`🔔 新交易: ${data.data.amount} ETH @ ${data.data.price} USDC`)
            setTimeout(() => setMessage(''), 5000)
          }
        } catch (err) {
          console.error('WebSocket消息解析失败:', err)
        }
      }

      ws.onclose = () => {
        console.log('WebSocket连接关闭')
        setEngineStatus('disconnected')
        setWsConnection(null)
      }

      ws.onerror = (error) => {
        console.error('WebSocket错误:', error)
        setEngineStatus('disconnected')
      }

      setWsConnection(ws)
    } catch (err) {
      console.error('WebSocket连接失败:', err)
      setEngineStatus('disconnected')
    }
  }

  // OrderBook Engine 集成
  const initializeEngine = async () => {
    try {
      setLoading(true)
      setMessage('正在连接OrderBook引擎...')
      
      // 健康检查
      const healthResponse = await fetch('http://localhost:8084/api/v1/health')
      if (!healthResponse.ok) {
        throw new Error('OrderBook引擎不可用')
      }
      
      // 连接WebSocket进行实时更新
      connectWebSocket()
      
      // 初始加载数据
      await loadOrderbook()
      await loadEngineOrders()
      await loadTrades()
      
      setUseEngine(true)
      setMessage('✅ OrderBook引擎已启用')
      
    } catch (error) {
      console.error('引擎初始化失败:', error)
      setMessage(`引擎连接失败: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const stopEngine = () => {
    if (wsConnection) {
      wsConnection.close()
      setWsConnection(null)
    }
    setUseEngine(false)
    setEngineStatus('disconnected')
    setMessage('❌ OrderBook引擎已停用')
  }

  // 从引擎数据更新订单簿
  const updateOrderBookFromEngine = (data) => {
    try {
      console.log('Updating orderbook from engine:', data)
      
      // 确保数据存在且为数组
      const bids = Array.isArray(data.bids) ? data.bids : []
      const asks = Array.isArray(data.asks) ? data.asks : []
      
      // 转换引擎数据格式为前端格式
      const buyOrdersData = bids.map(level => ({
        price: level.price,
        amount: level.amount,
        total: (parseFloat(level.price) * parseFloat(level.amount)).toFixed(2)
      }))
      
      const sellOrdersData = asks.map(level => ({
        price: level.price,
        amount: level.amount,
        total: (parseFloat(level.price) * parseFloat(level.amount)).toFixed(2)
      }))
      
      console.log('Setting buy orders:', buyOrdersData)
      console.log('Setting sell orders:', sellOrdersData)
      
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

  // 从引擎加载用户订单
  const loadEngineOrders = async () => {
    if (!account) return

    try {
      const response = await fetch(`http://localhost:8084/api/v1/orders?user_address=${account}`)
      const data = await response.json()
      
      const engineOrders = (data.orders || []).map(order => {
        // 从wei单位转换为可读格式
        const priceInUSDC = parseFloat(ethers.formatUnits(order.price, TOKEN_ADDRESSES.USDC.decimals))
        const amountInWETH = parseFloat(ethers.formatUnits(order.amount, TOKEN_ADDRESSES.WETH.decimals))
        const filledInWETH = order.filled ? parseFloat(ethers.formatUnits(order.filled, TOKEN_ADDRESSES.WETH.decimals)) : 0
        
        return {
          id: order.id,
          type: order.side === 'buy' ? '买入' : '卖出',
          price: priceInUSDC.toFixed(2),
          amount: amountInWETH.toFixed(4),
          filled: filledInWETH.toFixed(4),
          status: order.status === 'open' ? '挂单中' : 
                 order.status === 'filled' ? '已完成' : 
                 order.status === 'cancelled' ? '已取消' : order.status,
          tokenPair: 'WETH/USDC',
          rawStatus: order.status,
          source: 'engine'
        }
      })

      setMyOrders(prev => [...engineOrders, ...prev.filter(o => o.source !== 'engine')])
    } catch (err) {
      console.error('Failed to load engine orders:', err)
    }
  }

  // 加载订单簿数据 (引擎API)
  const loadOrderbook = async () => {
    try {
      const response = await fetch('http://localhost:8084/api/v1/orderbook/WETH-USDC')
      const data = await response.json()
      
      // 转换为组件需要的格式 (从wei单位转换为可读格式)
      const buyOrdersData = (data.bids || []).map(level => {
        // price是USDC的wei单位 (6位小数)，amount是WETH的wei单位 (18位小数)
        const priceInUSDC = parseFloat(ethers.formatUnits(level.price, TOKEN_ADDRESSES.USDC.decimals))
        const amountInWETH = parseFloat(ethers.formatUnits(level.amount, TOKEN_ADDRESSES.WETH.decimals))
        return {
          price: priceInUSDC.toFixed(2),
          amount: amountInWETH.toFixed(4),
          total: (priceInUSDC * amountInWETH).toFixed(2)
        }
      })
      
      const sellOrdersData = (data.asks || []).map(level => {
        const priceInUSDC = parseFloat(ethers.formatUnits(level.price, TOKEN_ADDRESSES.USDC.decimals))
        const amountInWETH = parseFloat(ethers.formatUnits(level.amount, TOKEN_ADDRESSES.WETH.decimals))
        return {
          price: priceInUSDC.toFixed(2),
          amount: amountInWETH.toFixed(4),
          total: (priceInUSDC * amountInWETH).toFixed(2)
        }
      })
      
      setBuyOrders(buyOrdersData)
      setSellOrders(sellOrdersData)
      
      // 更新最佳买卖价
      if (buyOrdersData.length > 0) {
        setBestBid(buyOrdersData[0].price)
      }
      if (sellOrdersData.length > 0) {
        setBestAsk(sellOrdersData[0].price)
      }
      
    } catch (err) {
      console.error('Failed to load orderbook:', err)
    }
  }

  // 加载交易历史
  const loadTrades = async () => {
    try {
      const response = await fetch('http://localhost:8084/api/v1/trades')
      const data = await response.json()
      setTrades(data.trades || [])
    } catch (err) {
      console.error('Failed to load trades:', err)
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

  // 下单 - 使用撮合引擎API (包含EIP-712签名)
  const placeOrderWithEngine = async () => {
    if (!signer || !account || !price || !amount) {
      setMessage('请填写价格和数量并连接钱包')
      return
    }

    setLoading(true)
    setMessage('🔐 正在签名订单...')

    try {
      // 1. 准备订单数据 (匹配Go签名器期望的字段名和格式)
      const orderData = {
        userAddress: account,
        baseToken: TOKEN_ADDRESSES.WETH.address,
        quoteToken: TOKEN_ADDRESSES.USDC.address,
        side: orderSide === 'buy' ? 0 : 1, // 0=买入, 1=卖出
        orderType: 0, // 0=限价单
        price: ethers.parseUnits(price, TOKEN_ADDRESSES.USDC.decimals), // 转换为wei单位
        amount: ethers.parseUnits(amount, TOKEN_ADDRESSES.WETH.decimals), // 转换为wei单位
        expiresAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // Unix时间戳
        nonce: Date.now()
      }

      // 2. EIP-712签名
      setMessage('🔐 请在钱包中签名订单...')
      
      const domain = {
        name: 'OrderBook DEX',
        version: '1.0',
        chainId: await signer.provider.getNetwork().then(n => n.chainId),
        verifyingContract: '0xf4B146FbA71F41E0592668ffbF264F1D186b2Ca8' // 从config.yaml获取的合约地址
      }

      const types = {
        Order: [
          { name: 'userAddress', type: 'address' },
          { name: 'baseToken', type: 'address' },
          { name: 'quoteToken', type: 'address' },
          { name: 'side', type: 'uint8' },
          { name: 'orderType', type: 'uint8' },
          { name: 'price', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
          { name: 'expiresAt', type: 'uint256' },
          { name: 'nonce', type: 'uint256' }
        ]
      }

      const signature = await signer.signTypedData(domain, types, orderData)
      
      // 3. 发送带签名的订单
      setMessage('📡 提交订单到撮合引擎...')
      
      // 创建API格式的订单数据 (必须与签名数据完全一致)
      const apiOrderData = {
        user_address: account,
        trading_pair: "WETH-USDC",
        base_token: TOKEN_ADDRESSES.WETH.address,
        quote_token: TOKEN_ADDRESSES.USDC.address,
        side: orderSide === 'buy' ? 'buy' : 'sell', // 保持字符串格式但确保一致
        type: "limit",
        // 使用与签名相同的数据格式
        price: orderData.price.toString(), // BigInt转字符串
        amount: orderData.amount.toString(), // BigInt转字符串
        expires_at: new Date(orderData.expiresAt * 1000).toISOString(), // 从Unix时间戳转换
        nonce: orderData.nonce,
        signature: signature
      }
      
      const response = await fetch('http://localhost:8084/api/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(apiOrderData)
      })

      const result = await response.json()

      // 检查响应状态码或订单ID存在
      if (response.ok && result.order_id) {
        setMessage(`✅ 订单已提交！订单ID: ${result.order_id}`)
        // 刷新订单簿数据
        await loadOrderbook()
        await loadEngineOrders()
        
        // 清空输入
        setPrice('')
        setAmount('')
      } else {
        setMessage(`❌ 订单提交失败: ${result.message || '未知错误'}`)
      }

    } catch (err) {
      console.error('Engine order failed:', err)
      setMessage(`❌ 引擎订单失败: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  // 传统链上下单
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
    if (isCorrectNetwork && account) {
      // 加载引擎数据
      loadOrderbook()
      loadEngineOrders()
      loadTrades()
      
      // 只有在不使用引擎时才加载链上数据
      if (orderBook && !useEngine) {
        fetchOrderBook()
        fetchMyOrders()
      }
      
      const interval = setInterval(() => {
        loadOrderbook()
        loadEngineOrders()
        loadTrades()
        // 只有在不使用引擎时才读取合约数据
        if (orderBook && !useEngine) {
          fetchOrderBook()
          fetchMyOrders()
        }
      }, 3000)
      
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
        <h1>⚡ OrderBook DEX - 高性能链下撮合</h1>
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
          
          <div className="engine-status-display">
            <span className={`engine-indicator ${engineStatus}`}>
              {engineStatus === 'connected' ? '🟢' : 
               engineStatus === 'connecting' ? '🟡' : '🔴'}
            </span>
            <span className="engine-text">
              {engineStatus === 'connected' ? '撮合引擎' : 
               engineStatus === 'connecting' ? '连接中...' : '引擎离线'}
            </span>
            {engineStatus === 'disconnected' && (
              <button 
                className="reconnect-btn"
                onClick={initializeEngine}
                disabled={loading}
              >
                重连
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="orderbook-content">
        {/* 订单簿深度 */}
        <div className="orderbook-depth">
          <div className="orderbook-header-info">
            <h3>📊 ETH/USDC 订单簿</h3>
            <div className="realtime-status">
              <span className={`status-indicator ${engineStatus}`}>
                {engineStatus === 'connected' ? '🟢 实时' : '🔴 离线'}
              </span>
              {lastUpdate && (
                <span className="last-update">
                  更新: {lastUpdate}
                </span>
              )}
            </div>
          </div>
          
          <div className="depth-section">
            <h3>卖单 ({sellOrders.length})</h3>
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
            <h3>买单 ({buyOrders.length})</h3>
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
              onClick={placeOrderWithEngine}
              disabled={loading || !account || engineStatus !== 'connected'}
            >
              {loading ? '⏳ 处理中...' : 
               !account ? '🔗 请先连接钱包' :
               engineStatus !== 'connected' ? '⚠️ 引擎未连接' :
               `${orderSide === 'buy' ? '🟢 买入' : '🔴 卖出'} ${amount || '0'} WETH`
              }
            </button>

            {message && (
              <div className={`message ${message.includes('失败') ? 'error' : 'success'}`}>
                {message}
              </div>
            )}
          </div>
        </div>

        {/* 我的订单和交易历史 */}
        <div className="my-orders">
          <div className="orders-header">
            <h3>📝 我的交易</h3>
            <div className="orders-stats">
              <span className="stat-item">
                订单: <strong>{myOrders.length}</strong>
              </span>
              <span className="stat-item">
                成交: <strong>{trades.length}</strong>
              </span>
            </div>
          </div>
          
          {/* 标签切换 */}
          <div className="trade-tabs">
            <button 
              className={activeOrderTab === 'orders' ? 'active' : ''}
              onClick={() => setActiveOrderTab('orders')}
            >
              📋 我的订单
            </button>
            <button 
              className={activeOrderTab === 'trades' ? 'active' : ''}
              onClick={() => setActiveOrderTab('trades')}
            >
              📈 交易记录
            </button>
            <button 
              className={activeOrderTab === 'history' ? 'active' : ''}
              onClick={() => setActiveOrderTab('history')}
            >
              📊 市场成交
            </button>
          </div>
          
          {/* 我的订单表格 */}
          {activeOrderTab === 'orders' && (
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
          )}
          
          {/* 交易记录表格 */}
          {activeOrderTab === 'trades' && (
          <div className="trades-table">
            <div className="table-header">
              <span>时间</span>
              <span>交易对</span>
              <span>类型</span>
              <span>价格</span>
              <span>数量</span>
              <span>总计</span>
              <span>状态</span>
            </div>
            <div className="table-body">
              {/* 用户的交易记录 - 这里可以从API获取 */}
              <div className="empty-state">
                <span>🔍 暂无交易记录</span>
                <p>完成首笔交易后将在此显示</p>
              </div>
            </div>
          </div>
          )}
          
          {/* 市场成交历史 */}
          {activeOrderTab === 'history' && (
          <div className="market-trades">
            <div className="trades-header">
              <span>时间</span>
              <span>价格</span>
              <span>数量</span>
              <span>方向</span>
            </div>
            <div className="trades-body">
              {trades.length > 0 ? trades.slice(0, 20).map((trade, i) => (
                <div key={trade.id || i} className="trade-row">
                  <span className="trade-time">
                    {new Date(trade.timestamp).toLocaleTimeString('zh-CN', {
                      hour12: false,
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    })}
                  </span>
                  <span className={`trade-price ${trade.side}`}>
                    {parseFloat(trade.price).toFixed(2)}
                  </span>
                  <span className="trade-amount">
                    {parseFloat(trade.amount).toFixed(4)}
                  </span>
                  <span className={`trade-side ${trade.side}`}>
                    {trade.side === 'buy' ? '📈 买入' : '📉 卖出'}
                  </span>
                </div>
              )) : (
                <div className="empty-state">
                  <span>📊 暂无市场成交</span>
                  <p>等待市场产生交易</p>
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default OrderBookTrade