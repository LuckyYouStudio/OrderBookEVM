import React, { useState, useEffect } from 'react'
import './OpenOrders.css'

const OpenOrders = ({ connected }) => {
  const [orders, setOrders] = useState([])
  const [activeTab, setActiveTab] = useState('open')
  const [loading, setLoading] = useState(false)

  // Mock orders data
  useEffect(() => {
    if (connected) {
      const mockOrders = [
        {
          id: '1',
          pair: 'WETH/USDC',
          side: 'buy',
          type: 'limit',
          amount: '0.5000',
          price: '1995.50',
          filled: '0.0000',
          status: 'open',
          timestamp: Date.now() - 300000,
        },
        {
          id: '2',
          pair: 'WETH/USDC',
          side: 'sell',
          type: 'limit',
          amount: '1.2500',
          price: '2055.00',
          filled: '0.3750',
          status: 'partially_filled',
          timestamp: Date.now() - 600000,
        },
        {
          id: '3',
          pair: 'WETH/USDC',
          side: 'buy',
          type: 'market',
          amount: '0.2500',
          price: '2048.75',
          filled: '0.2500',
          status: 'filled',
          timestamp: Date.now() - 1800000,
        },
      ]
      setOrders(mockOrders)
    } else {
      setOrders([])
    }
  }, [connected])

  const formatTime = (timestamp) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const formatDate = (timestamp) => {
    const date = new Date(timestamp)
    return date.toLocaleDateString()
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'open':
        return '#3b82f6'
      case 'partially_filled':
        return '#f59e0b'
      case 'filled':
        return '#10b981'
      case 'cancelled':
        return '#64748b'
      default:
        return '#64748b'
    }
  }

  const getStatusText = (status) => {
    switch (status) {
      case 'open':
        return 'Open'
      case 'partially_filled':
        return 'Partial'
      case 'filled':
        return 'Filled'
      case 'cancelled':
        return 'Cancelled'
      default:
        return status
    }
  }

  const filteredOrders = orders.filter(order => {
    switch (activeTab) {
      case 'open':
        return order.status === 'open' || order.status === 'partially_filled'
      case 'history':
        return order.status === 'filled' || order.status === 'cancelled'
      default:
        return true
    }
  })

  const handleCancelOrder = (orderId) => {
    setLoading(true)
    // Simulate API call
    setTimeout(() => {
      setOrders(orders.map(order => 
        order.id === orderId 
          ? { ...order, status: 'cancelled' }
          : order
      ))
      setLoading(false)
    }, 1000)
  }

  const calculateProgress = (filled, total) => {
    return (parseFloat(filled) / parseFloat(total)) * 100
  }

  return (
    <div className="open-orders">
      <div className="orders-header">
        <h3 className="section-title">Orders</h3>
        <div className="orders-tabs">
          <button
            className={`tab-btn ${activeTab === 'open' ? 'active' : ''}`}
            onClick={() => setActiveTab('open')}
          >
            Open ({orders.filter(o => o.status === 'open' || o.status === 'partially_filled').length})
          </button>
          <button
            className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            History
          </button>
        </div>
      </div>

      <div className="orders-content">
        {!connected ? (
          <div className="empty-state">
            <p>Connect your wallet to view orders</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="empty-state">
            <p>No {activeTab === 'open' ? 'open orders' : 'order history'}</p>
          </div>
        ) : (
          <div className="orders-list">
            <div className="orders-table-header">
              <span>Pair</span>
              <span>Type</span>
              <span>Side</span>
              <span>Amount</span>
              <span>Price</span>
              <span>Filled</span>
              <span>Status</span>
              <span>Time</span>
              {activeTab === 'open' && <span>Action</span>}
            </div>
            
            {filteredOrders.map((order) => (
              <div key={order.id} className="order-row">
                <span className="pair">{order.pair}</span>
                <span className="type">{order.type.toUpperCase()}</span>
                <span className={`side ${order.side}`}>
                  {order.side.toUpperCase()}
                </span>
                <span className="amount">{order.amount}</span>
                <span className="price">
                  {order.type === 'market' ? 'Market' : `$${order.price}`}
                </span>
                <span className="filled">
                  <div className="filled-container">
                    <span className="filled-text">
                      {order.filled}/{order.amount}
                    </span>
                    {order.status === 'partially_filled' && (
                      <div className="progress-bar">
                        <div 
                          className="progress-fill"
                          style={{ 
                            width: `${calculateProgress(order.filled, order.amount)}%` 
                          }}
                        />
                      </div>
                    )}
                  </div>
                </span>
                <span 
                  className="status"
                  style={{ color: getStatusColor(order.status) }}
                >
                  {getStatusText(order.status)}
                </span>
                <span className="time">
                  <div className="time-container">
                    <span className="time-value">{formatTime(order.timestamp)}</span>
                    <span className="date-value">{formatDate(order.timestamp)}</span>
                  </div>
                </span>
                {activeTab === 'open' && (
                  <span className="action">
                    {(order.status === 'open' || order.status === 'partially_filled') && (
                      <button
                        className="cancel-btn"
                        onClick={() => handleCancelOrder(order.id)}
                        disabled={loading}
                      >
                        Cancel
                      </button>
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default OpenOrders