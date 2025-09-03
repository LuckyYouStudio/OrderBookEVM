import React, { useState, useEffect } from 'react'
import './OpenOrders.css'

const OpenOrders = ({ connected }) => {
  const [orders, setOrders] = useState([])
  const [activeTab, setActiveTab] = useState('open')
  const [loading, setLoading] = useState(false)

  // Fetch real orders from backend API
  useEffect(() => {
    const fetchOrders = async () => {
      if (connected && window.ethereum?.selectedAddress) {
        setLoading(true)
        try {
          const userAddress = window.ethereum.selectedAddress
          const response = await fetch(`http://localhost:8085/api/v1/orders?user_address=${userAddress}`)
          
          if (response.ok) {
            const data = await response.json()
            // Transform backend data to frontend format
            const transformedOrders = (data.orders || []).map(order => ({
              id: order.id,
              pair: order.trading_pair,
              side: order.side,
              type: order.type,
              amount: order.amount.toString(),
              price: order.price.toString(),
              filled: order.filled_amount?.toString() || '0',
              status: order.status,
              timestamp: new Date(order.created_at).getTime(),
            }))
            setOrders(transformedOrders)
          } else {
            console.error('Failed to fetch orders:', await response.text())
            setOrders([])
          }
        } catch (error) {
          console.error('Error fetching orders:', error)
          setOrders([])
        } finally {
          setLoading(false)
        }
      } else {
        setOrders([])
      }
    }

    fetchOrders()
    
    // Poll for updates every 5 seconds
    const interval = setInterval(fetchOrders, 5000)
    return () => clearInterval(interval)
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

  const handleCancelOrder = async (orderId) => {
    setLoading(true)
    try {
      const response = await fetch(`http://localhost:8085/api/v1/orders/${orderId}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        // Update local state to reflect cancelled order
        setOrders(orders.map(order => 
          order.id === orderId 
            ? { ...order, status: 'cancelled' }
            : order
        ))
      } else {
        console.error('Failed to cancel order:', await response.text())
        alert('Failed to cancel order')
      }
    } catch (error) {
      console.error('Error cancelling order:', error)
      alert('Error cancelling order')
    } finally {
      setLoading(false)
    }
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