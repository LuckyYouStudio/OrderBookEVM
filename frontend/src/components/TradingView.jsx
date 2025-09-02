import React, { useState, useEffect } from 'react'
import Chart from './Chart'
import OrderBook from './OrderBook'
import OrderForm from './OrderForm'
import OpenOrders from './OpenOrders'
import { useWallet } from '../hooks/useWallet'

const TradingView = () => {
  const { account } = useWallet()
  const [selectedPair, setSelectedPair] = useState({ 
    base: 'WETH', 
    quote: 'USDC' 
  })
  const [orderBookData, setOrderBookData] = useState({
    bids: [],
    asks: []
  })
  
  // Mock order book data
  useEffect(() => {
    // Simulate order book updates
    const interval = setInterval(() => {
      const generateOrders = (side, basePrice, count = 10) => {
        return Array.from({ length: count }, (_, i) => {
          const priceOffset = side === 'bid' ? -i * 5 : i * 5
          const price = basePrice + priceOffset
          const amount = Math.random() * 5 + 0.1
          return {
            price: price.toFixed(2),
            amount: amount.toFixed(4),
            total: (price * amount).toFixed(2)
          }
        })
      }
      
      const midPrice = 2000 + (Math.random() - 0.5) * 20
      
      setOrderBookData({
        bids: generateOrders('bid', midPrice - 2.5),
        asks: generateOrders('ask', midPrice + 2.5)
      })
    }, 2000)
    
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="trading-container">
      <div className="chart-section">
        <Chart pair={selectedPair} />
      </div>
      
      <div className="order-book-section">
        <OrderBook 
          data={orderBookData} 
          pair={selectedPair}
        />
      </div>
      
      <div className="trading-panel">
        <div className="order-form">
          <OrderForm 
            pair={selectedPair} 
            connected={!!account}
          />
        </div>
        
        <div className="open-orders">
          <OpenOrders connected={!!account} />
        </div>
      </div>
    </div>
  )
}

export default TradingView