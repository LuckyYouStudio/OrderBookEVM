import React, { useEffect, useRef, useState } from 'react'
import { createChart, ColorType } from 'lightweight-charts'
import './Chart.css'

const Chart = ({ pair }) => {
  const chartContainerRef = useRef()
  const chart = useRef()
  const candlestickSeries = useRef()
  const [timeframe, setTimeframe] = useState('1h')

  useEffect(() => {
    if (!chartContainerRef.current) return

    // Create chart
    chart.current = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: {
          color: 'rgba(255, 255, 255, 0.1)',
        },
        horzLines: {
          color: 'rgba(255, 255, 255, 0.1)',
        },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.2)',
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.2)',
        timeVisible: true,
        secondsVisible: false,
      },
    })

    // Create candlestick series
    candlestickSeries.current = chart.current.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#10b981',
      wickDownColor: '#ef4444',
      wickUpColor: '#10b981',
    })

    // Generate mock data
    const generateCandleData = () => {
      const data = []
      let price = 2000
      let time = Math.floor(Date.now() / 1000) - 1000 * 24 * 60 * 60 // 1000 days ago
      
      for (let i = 0; i < 1000; i++) {
        const open = price
        const change = (Math.random() - 0.5) * 40
        const high = Math.max(open, open + change) + Math.random() * 20
        const low = Math.min(open, open + change) - Math.random() * 20
        const close = open + change
        
        data.push({
          time: time + i * 60 * 60, // 1 hour intervals
          open: parseFloat(open.toFixed(2)),
          high: parseFloat(high.toFixed(2)),
          low: parseFloat(low.toFixed(2)),
          close: parseFloat(close.toFixed(2)),
        })
        
        price = close
      }
      
      return data
    }

    candlestickSeries.current.setData(generateCandleData())

    // Handle resize
    const handleResize = () => {
      chart.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
      })
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (chart.current) {
        chart.current.remove()
      }
    }
  }, [])

  // Update chart data when pair changes
  useEffect(() => {
    if (candlestickSeries.current) {
      // In a real app, fetch new data for the selected pair
      console.log('Pair changed to:', pair)
    }
  }, [pair])

  const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d']

  return (
    <div className="chart-container">
      <div className="chart-header">
        <div className="chart-title">
          <h3>{pair.base}/{pair.quote}</h3>
          <span className="chart-price">$2,045.67</span>
          <span className="chart-change positive">+1.23%</span>
        </div>
        
        <div className="chart-timeframes">
          {timeframes.map((tf) => (
            <button
              key={tf}
              className={`timeframe-btn ${tf === timeframe ? 'active' : ''}`}
              onClick={() => setTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>
      
      <div 
        className="chart-canvas" 
        ref={chartContainerRef}
      />
    </div>
  )
}

export default Chart