import React, { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { ethers } from 'ethers'
import Navbar from './components/Navbar'
import TradingView from './components/TradingView'
import SimpleTestView from './components/SimpleTestView'
import OrderBookTrade from './components/OrderBookTrade'
import { WalletProvider } from './hooks/useWallet'
import { addLocalNetwork, checkNetwork, NETWORK_CONFIG } from './config/contracts'
import './App.css'

function App() {
  const [provider, setProvider] = useState(null)
  const [signer, setSigner] = useState(null)
  const [account, setAccount] = useState('')
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(false)
  const [networkError, setNetworkError] = useState('')

  const connectWallet = async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        // 首先尝试添加/切换到本地网络
        await addLocalNetwork()
        
        // 请求账户连接
        await window.ethereum.request({ method: 'eth_requestAccounts' })
        
        const provider = new ethers.BrowserProvider(window.ethereum)
        const signer = await provider.getSigner()
        const address = await signer.getAddress()
        
        // 检查网络
        const networkOk = await checkNetwork(provider)
        setIsCorrectNetwork(networkOk)
        
        if (networkOk) {
          setProvider(provider)
          setSigner(signer)
          setAccount(address)
          setNetworkError('')
          console.log('已连接到本地网络:', address)
        } else {
          setNetworkError('请切换到本地Hardhat网络 (Chain ID: 31337)')
        }
      } catch (error) {
        console.error('连接钱包失败:', error)
        setNetworkError(error.message)
      }
    } else {
      setNetworkError('请安装MetaMask钱包')
    }
  }

  const disconnectWallet = () => {
    setProvider(null)
    setSigner(null)
    setAccount('')
    setIsCorrectNetwork(false)
    setNetworkError('')
  }

  // 检查网络状态
  const checkNetworkStatus = async () => {
    if (provider) {
      const networkOk = await checkNetwork(provider)
      setIsCorrectNetwork(networkOk)
      if (!networkOk) {
        setNetworkError('请切换到本地Hardhat网络 (Chain ID: 31337)')
      } else {
        setNetworkError('')
      }
    }
  }

  useEffect(() => {
    if (typeof window.ethereum !== 'undefined') {
      window.ethereum.on('accountsChanged', async (accounts) => {
        if (accounts.length === 0) {
          disconnectWallet()
        } else {
          setAccount(accounts[0])
          await checkNetworkStatus()
        }
      })

      window.ethereum.on('chainChanged', async () => {
        await checkNetworkStatus()
      })

      // 初始网络检查
      if (provider) {
        checkNetworkStatus()
      }
    }

    return () => {
      if (typeof window.ethereum !== 'undefined') {
        window.ethereum.removeAllListeners('accountsChanged')
        window.ethereum.removeAllListeners('chainChanged')
      }
    }
  }, [provider])

  return (
    <WalletProvider value={{ 
      provider, 
      signer, 
      account, 
      connectWallet, 
      disconnectWallet,
      isCorrectNetwork,
      networkError,
      addLocalNetwork
    }}>
      <div className="app">
        <Navbar />
        <main className="main-content">
          {networkError && (
            <div className="network-warning" style={{
              background: '#ff6b6b',
              color: 'white',
              padding: '1rem',
              margin: '1rem',
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              <strong>网络错误:</strong> {networkError}
              {!isCorrectNetwork && (
                <button 
                  onClick={addLocalNetwork}
                  style={{
                    marginLeft: '1rem',
                    padding: '0.5rem 1rem',
                    background: 'white',
                    color: '#ff6b6b',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  添加/切换到本地网络
                </button>
              )}
            </div>
          )}
          <Routes>
            <Route path="/" element={<OrderBookTrade />} />
            <Route path="/trade" element={<OrderBookTrade />} />
            <Route path="/test" element={<SimpleTestView />} />
          </Routes>
        </main>
      </div>
    </WalletProvider>
  )
}

export default App