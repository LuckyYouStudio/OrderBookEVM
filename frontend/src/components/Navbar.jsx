import React from 'react'
import { useWallet } from '../hooks/useWallet'
import { NETWORK_CONFIG } from '../config/contracts'
import './Navbar.css'

const Navbar = () => {
  const { account, connectWallet, disconnectWallet, isCorrectNetwork, networkError } = useWallet()

  const formatAddress = (address) => {
    if (!address) return ''
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <div className="navbar-brand">
          <h1>OrderBook DEX</h1>
        </div>
        
        <div className="navbar-nav">
          <div className="nav-item">
            <span className="nav-link">Trade</span>
          </div>
        </div>

        <div className="navbar-wallet">
          {account ? (
            <div className="wallet-connected">
              <div className="network-status">
                <span className={`network-indicator ${isCorrectNetwork ? 'connected' : 'error'}`}>
                  ●
                </span>
                <span className="network-name">
                  {isCorrectNetwork ? NETWORK_CONFIG.name : 'Wrong Network'}
                </span>
              </div>
              <span className="wallet-address">{formatAddress(account)}</span>
              <button 
                className="btn btn-outline"
                onClick={disconnectWallet}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button 
              className="btn btn-primary"
              onClick={connectWallet}
            >
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </nav>
  )
}

export default Navbar