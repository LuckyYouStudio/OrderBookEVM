import React, { useState } from 'react'
import './OrderBook.css'

const OrderBook = ({ data, pair }) => {
  const [precision, setPrecision] = useState(2)
  
  const formatPrice = (price) => {
    return parseFloat(price).toFixed(precision)
  }

  const formatAmount = (amount) => {
    return parseFloat(amount).toFixed(4)
  }

  const calculateSpread = () => {
    if (data.asks.length && data.bids.length) {
      const bestAsk = parseFloat(data.asks[0]?.price || 0)
      const bestBid = parseFloat(data.bids[0]?.price || 0)
      const spread = bestAsk - bestBid
      const spreadPercent = ((spread / bestAsk) * 100).toFixed(3)
      return { spread: spread.toFixed(2), spreadPercent }
    }
    return { spread: '0.00', spreadPercent: '0.000' }
  }

  const { spread, spreadPercent } = calculateSpread()

  return (
    <div className="order-book">
      <div className="order-book-header">
        <h3 className="section-title">Order Book</h3>
        <div className="order-book-controls">
          <select 
            value={precision} 
            onChange={(e) => setPrecision(Number(e.target.value))}
            className="precision-select"
          >
            <option value={1}>0.1</option>
            <option value={2}>0.01</option>
            <option value={3}>0.001</option>
          </select>
        </div>
      </div>

      <div className="order-book-spread">
        <span className="spread-label">Spread:</span>
        <span className="spread-value">${spread} ({spreadPercent}%)</span>
      </div>

      <div className="order-book-headers">
        <span>Price ({pair.quote})</span>
        <span>Amount ({pair.base})</span>
        <span>Total ({pair.quote})</span>
      </div>

      <div className="order-book-content">
        {/* Asks (Sell Orders) */}
        <div className="asks-section">
          {data.asks.slice(0, 15).reverse().map((ask, index) => (
            <div key={`ask-${index}`} className="order-row ask-row">
              <span className="price ask-price">{formatPrice(ask.price)}</span>
              <span className="amount">{formatAmount(ask.amount)}</span>
              <span className="total">{ask.total}</span>
              <div 
                className="depth-bar ask-bar"
                style={{ width: `${Math.min((parseFloat(ask.amount) / 5) * 100, 100)}%` }}
              />
            </div>
          ))}
        </div>

        {/* Current Price */}
        <div className="current-price-section">
          <div className="current-price">
            <span className="current-price-value">
              ${data.asks[0] ? formatPrice(data.asks[0].price) : '0.00'}
            </span>
            <span className="current-price-change positive">
              ↗ ${((Math.random() - 0.5) * 10).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Bids (Buy Orders) */}
        <div className="bids-section">
          {data.bids.slice(0, 15).map((bid, index) => (
            <div key={`bid-${index}`} className="order-row bid-row">
              <span className="price bid-price">{formatPrice(bid.price)}</span>
              <span className="amount">{formatAmount(bid.amount)}</span>
              <span className="total">{bid.total}</span>
              <div 
                className="depth-bar bid-bar"
                style={{ width: `${Math.min((parseFloat(bid.amount) / 5) * 100, 100)}%` }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="order-book-footer">
        <div className="market-info">
          <div className="info-item">
            <span className="info-label">24h Vol:</span>
            <span className="info-value">1,234.56 {pair.base}</span>
          </div>
          <div className="info-item">
            <span className="info-label">24h Change:</span>
            <span className="info-value positive">+2.34%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default OrderBook