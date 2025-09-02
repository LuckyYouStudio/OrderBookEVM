import React, { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { ethers } from 'ethers'
import Navbar from './components/Navbar'
import TradingView from './components/TradingView'
import { WalletProvider } from './hooks/useWallet'
import './App.css'

function App() {
  const [provider, setProvider] = useState(null)
  const [signer, setSigner] = useState(null)
  const [account, setAccount] = useState('')

  const connectWallet = async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        await window.ethereum.request({ method: 'eth_requestAccounts' })
        const provider = new ethers.BrowserProvider(window.ethereum)
        const signer = await provider.getSigner()
        const address = await signer.getAddress()
        
        setProvider(provider)
        setSigner(signer)
        setAccount(address)
      } catch (error) {
        console.error('Failed to connect wallet:', error)
      }
    }
  }

  const disconnectWallet = () => {
    setProvider(null)
    setSigner(null)
    setAccount('')
  }

  useEffect(() => {
    if (typeof window.ethereum !== 'undefined') {
      window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length === 0) {
          disconnectWallet()
        } else {
          setAccount(accounts[0])
        }
      })

      window.ethereum.on('chainChanged', () => {
        window.location.reload()
      })
    }
  }, [])

  return (
    <WalletProvider value={{ provider, signer, account, connectWallet, disconnectWallet }}>
      <div className="app">
        <Navbar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<TradingView />} />
            <Route path="/trade" element={<TradingView />} />
          </Routes>
        </main>
      </div>
    </WalletProvider>
  )
}

export default App