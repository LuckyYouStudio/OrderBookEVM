import React, { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { useWallet } from '../hooks/useWallet'
import './OrderForm.css'

const OrderForm = ({ pair, connected }) => {
  const { signer } = useWallet()
  const [orderType, setOrderType] = useState('limit')
  const [side, setSide] = useState('buy')
  const [price, setPrice] = useState('')
  const [amount, setAmount] = useState('')
  const [total, setTotal] = useState('')
  const [loading, setLoading] = useState(false)
  const [balances, setBalances] = useState({
    base: '0.0000',
    quote: '0.0000'
  })

  // Calculate total when price or amount changes
  useEffect(() => {
    if (price && amount) {
      const calculatedTotal = (parseFloat(price) * parseFloat(amount)).toFixed(2)
      setTotal(calculatedTotal)
    } else {
      setTotal('')
    }
  }, [price, amount])

  // Mock balance loading
  useEffect(() => {
    if (connected) {
      setBalances({
        base: '5.2345',
        quote: '10,245.67'
      })
    } else {
      setBalances({
        base: '0.0000',
        quote: '0.0000'
      })
    }
  }, [connected])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!connected) return

    setLoading(true)
    try {
      // Here you would interact with your smart contracts
      console.log('Placing order:', {
        type: orderType,
        side,
        price,
        amount,
        total,
        pair
      })
      
      // Simulate transaction delay
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      // Reset form
      setPrice('')
      setAmount('')
      setTotal('')
      
      alert('Order placed successfully!')
    } catch (error) {
      console.error('Error placing order:', error)
      alert('Error placing order')
    } finally {
      setLoading(false)
    }
  }

  const fillPercentage = (percentage) => {
    if (!connected) return
    
    const availableBalance = side === 'buy' ? 
      parseFloat(balances.quote.replace(',', '')) : 
      parseFloat(balances.base)
    
    if (side === 'buy' && price) {
      const maxAmount = (availableBalance * percentage / 100) / parseFloat(price)
      setAmount(maxAmount.toFixed(4))
    } else if (side === 'sell') {
      const sellAmount = availableBalance * percentage / 100
      setAmount(sellAmount.toFixed(4))
    }
  }

  const getCurrentPrice = () => '2045.67' // Mock current price

  return (
    <div className="order-form">
      <div className="form-header">
        <h3 className="section-title">Place Order</h3>
        <div className="order-type-tabs">
          <button
            className={`tab-btn ${orderType === 'limit' ? 'active' : ''}`}
            onClick={() => setOrderType('limit')}
          >
            Limit
          </button>
          <button
            className={`tab-btn ${orderType === 'market' ? 'active' : ''}`}
            onClick={() => setOrderType('market')}
          >
            Market
          </button>
        </div>
      </div>

      <div className="side-selector">
        <button
          className={`side-btn buy-btn ${side === 'buy' ? 'active' : ''}`}
          onClick={() => setSide('buy')}
        >
          Buy {pair.base}
        </button>
        <button
          className={`side-btn sell-btn ${side === 'sell' ? 'active' : ''}`}
          onClick={() => setSide('sell')}
        >
          Sell {pair.base}
        </button>
      </div>

      {!connected && (
        <div className="connection-warning">
          <p>Connect your wallet to start trading</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className={!connected ? 'disabled' : ''}>
        {orderType === 'limit' && (
          <div className="input-group">
            <label>Price ({pair.quote})</label>
            <div className="input-with-button">
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                step="0.01"
                disabled={!connected}
              />
              <button
                type="button"
                className="market-price-btn"
                onClick={() => setPrice(getCurrentPrice())}
                disabled={!connected}
              >
                Market
              </button>
            </div>
          </div>
        )}

        <div className="input-group">
          <label>Amount ({pair.base})</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0000"
            step="0.0001"
            disabled={!connected}
          />
          <div className="percentage-buttons">
            {[25, 50, 75, 100].map((percentage) => (
              <button
                key={percentage}
                type="button"
                className="percentage-btn"
                onClick={() => fillPercentage(percentage)}
                disabled={!connected}
              >
                {percentage}%
              </button>
            ))}
          </div>
        </div>

        {orderType === 'limit' && (
          <div className="input-group">
            <label>Total ({pair.quote})</label>
            <input
              type="number"
              value={total}
              onChange={(e) => {
                setTotal(e.target.value)
                if (price && e.target.value) {
                  setAmount((parseFloat(e.target.value) / parseFloat(price)).toFixed(4))
                }
              }}
              placeholder="0.00"
              step="0.01"
              disabled={!connected}
            />
          </div>
        )}

        <div className="balance-info">
          <div className="balance-item">
            <span>Available {pair.base}:</span>
            <span>{balances.base}</span>
          </div>
          <div className="balance-item">
            <span>Available {pair.quote}:</span>
            <span>{balances.quote}</span>
          </div>
        </div>

        <button
          type="submit"
          className={`submit-btn ${side === 'buy' ? 'buy' : 'sell'}`}
          disabled={!connected || loading || !amount || (orderType === 'limit' && !price)}
        >
          {loading ? (
            'Processing...'
          ) : (
            `${side === 'buy' ? 'Buy' : 'Sell'} ${pair.base}`
          )}
        </button>
      </form>
    </div>
  )
}

export default OrderForm