import { useMemo } from 'react'
import { ethers } from 'ethers'
import { useWallet } from './useWallet'
import { CONTRACT_ADDRESSES, TOKEN_ADDRESSES } from '../config/contracts'
import { ORDERBOOK_ABI, SETTLEMENT_ABI, TOKEN_REGISTRY_ABI, ERC20_ABI } from '../config/abis'

// 合约钩子 - 提供合约实例和相关功能
export const useContracts = () => {
  const { provider, signer, isCorrectNetwork } = useWallet()

  // 创建合约实例
  const contracts = useMemo(() => {
    if (!provider || !isCorrectNetwork) {
      return {
        orderBook: null,
        settlement: null,
        tokenRegistry: null,
        tokens: {
          usdc: null,
          weth: null,
        }
      }
    }

    const signerOrProvider = signer || provider

    return {
      orderBook: new ethers.Contract(
        CONTRACT_ADDRESSES.OrderBook,
        ORDERBOOK_ABI,
        signerOrProvider
      ),
      settlement: new ethers.Contract(
        CONTRACT_ADDRESSES.Settlement,
        SETTLEMENT_ABI,
        signerOrProvider
      ),
      tokenRegistry: new ethers.Contract(
        CONTRACT_ADDRESSES.TokenRegistry,
        TOKEN_REGISTRY_ABI,
        signerOrProvider
      ),
      tokens: {
        usdc: new ethers.Contract(
          TOKEN_ADDRESSES.USDC.address,
          ERC20_ABI,
          signerOrProvider
        ),
        weth: new ethers.Contract(
          TOKEN_ADDRESSES.WETH.address,
          ERC20_ABI,
          signerOrProvider
        ),
      }
    }
  }, [provider, signer, isCorrectNetwork])

  // 获取代币余额
  const getTokenBalance = async (tokenAddress, userAddress) => {
    if (!provider || !isCorrectNetwork) return '0'
    
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
      const balance = await tokenContract.balanceOf(userAddress)
      return balance.toString()
    } catch (error) {
      console.error('获取代币余额失败:', error)
      return '0'
    }
  }

  // 获取用户在Settlement合约中的余额
  const getSettlementBalance = async (tokenAddress, userAddress) => {
    if (!contracts.settlement || !userAddress) return '0'
    
    try {
      const balance = await contracts.settlement.getUserBalance(userAddress, tokenAddress)
      return balance.toString()
    } catch (error) {
      console.error('获取Settlement余额失败:', error)
      return '0'
    }
  }

  // 授权代币给合约
  const approveToken = async (tokenAddress, spenderAddress, amount) => {
    if (!signer) throw new Error('需要连接钱包')
    
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer)
      const tx = await tokenContract.approve(spenderAddress, amount)
      await tx.wait()
      return tx.hash
    } catch (error) {
      console.error('授权失败:', error)
      throw error
    }
  }

  // 检查代币授权额度
  const getAllowance = async (tokenAddress, ownerAddress, spenderAddress) => {
    if (!provider) return '0'
    
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
      const allowance = await tokenContract.allowance(ownerAddress, spenderAddress)
      return allowance.toString()
    } catch (error) {
      console.error('获取授权额度失败:', error)
      return '0'
    }
  }

  // 存入代币到Settlement合约
  const depositToken = async (tokenAddress, amount) => {
    if (!contracts.settlement || !signer) {
      throw new Error('合约未连接或需要连接钱包')
    }
    
    try {
      // 首先检查授权
      const allowance = await getAllowance(
        tokenAddress,
        await signer.getAddress(),
        CONTRACT_ADDRESSES.Settlement
      )
      
      if (ethers.getBigInt(allowance) < ethers.getBigInt(amount)) {
        // 需要授权
        await approveToken(tokenAddress, CONTRACT_ADDRESSES.Settlement, amount)
      }
      
      // 存入
      const tx = await contracts.settlement.deposit(tokenAddress, amount)
      await tx.wait()
      return tx.hash
    } catch (error) {
      console.error('存入失败:', error)
      throw error
    }
  }

  // 从Settlement合约提取代币
  const withdrawToken = async (tokenAddress, amount) => {
    if (!contracts.settlement || !signer) {
      throw new Error('合约未连接或需要连接钱包')
    }
    
    try {
      const tx = await contracts.settlement.withdraw(tokenAddress, amount)
      await tx.wait()
      return tx.hash
    } catch (error) {
      console.error('提取失败:', error)
      throw error
    }
  }

  // 下订单
  const placeOrder = async (baseToken, quoteToken, price, amount, isBuy, orderType = 0, expiresAt = 0) => {
    if (!contracts.orderBook || !signer) {
      throw new Error('合约未连接或需要连接钱包')
    }
    
    try {
      const tx = await contracts.orderBook.placeOrder(
        baseToken,
        quoteToken,
        price,
        amount,
        isBuy,
        orderType,
        expiresAt
      )
      await tx.wait()
      return tx.hash
    } catch (error) {
      console.error('下单失败:', error)
      throw error
    }
  }

  // 取消订单
  const cancelOrder = async (orderId) => {
    if (!contracts.orderBook || !signer) {
      throw new Error('合约未连接或需要连接钱包')
    }
    
    try {
      const tx = await contracts.orderBook.cancelOrder(orderId)
      await tx.wait()
      return tx.hash
    } catch (error) {
      console.error('取消订单失败:', error)
      throw error
    }
  }

  // 获取用户订单
  const getUserOrders = async (userAddress) => {
    if (!contracts.orderBook || !userAddress) return []
    
    try {
      const orderIds = await contracts.orderBook.getUserOrders(userAddress)
      const orders = await Promise.all(
        orderIds.map(async (id) => {
          const order = await contracts.orderBook.getOrder(id)
          return {
            id: order.id.toString(),
            trader: order.trader,
            baseToken: order.baseToken,
            quoteToken: order.quoteToken,
            price: order.price.toString(),
            amount: order.amount.toString(),
            filled: order.filled.toString(),
            isBuy: order.isBuy,
            status: order.status,
            timestamp: order.timestamp.toString(),
          }
        })
      )
      return orders
    } catch (error) {
      console.error('获取用户订单失败:', error)
      return []
    }
  }

  return {
    contracts,
    isReady: !!provider && !!isCorrectNetwork,
    // 代币相关
    getTokenBalance,
    getSettlementBalance,
    approveToken,
    getAllowance,
    depositToken,
    withdrawToken,
    // 订单相关
    placeOrder,
    cancelOrder,
    getUserOrders,
  }
}