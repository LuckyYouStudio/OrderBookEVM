import React from 'react'
import { useWallet } from '../hooks/useWallet'

const SimpleTestView = () => {
  const { account, connectWallet, disconnectWallet, isCorrectNetwork, networkError } = useWallet()

  return (
    <div style={{ padding: '2rem', color: '#ffffff' }}>
      <h1>OrderBook DEX - 测试页面</h1>
      
      <div style={{ marginTop: '2rem' }}>
        <h2>钱包连接状态</h2>
        {account ? (
          <div>
            <p>✅ 钱包已连接</p>
            <p>账户地址: {account}</p>
            <p>网络状态: {isCorrectNetwork ? '✅ 本地网络' : '❌ 错误网络'}</p>
            {networkError && (
              <div style={{ color: '#ef4444', marginTop: '1rem' }}>
                错误: {networkError}
              </div>
            )}
            <button 
              onClick={disconnectWallet}
              style={{
                padding: '0.5rem 1rem',
                marginTop: '1rem',
                background: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              断开连接
            </button>
          </div>
        ) : (
          <div>
            <p>❌ 钱包未连接</p>
            <button 
              onClick={connectWallet}
              style={{
                padding: '0.5rem 1rem',
                marginTop: '1rem',
                background: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              连接钱包
            </button>
            {networkError && (
              <div style={{ color: '#ef4444', marginTop: '1rem' }}>
                错误: {networkError}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2>合约地址</h2>
        <div style={{ fontFamily: 'monospace', fontSize: '0.9em' }}>
          <p>TokenRegistry: 0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE</p>
          <p>OrderBook: 0x68B1D87F95878fE05B998F19b66F4baba5De1aed</p>
          <p>Settlement: 0x3Aa5ebB10DC797CAC828524e59A333d0A371443c</p>
          <p>Mock USDC: 0x59b670e9fA9D0A427751Af201D676719a970857b</p>
          <p>Mock WETH: 0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1</p>
        </div>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2>网络信息</h2>
        <p>RPC URL: http://127.0.0.1:8545</p>
        <p>Chain ID: 31337</p>
        <p>Network Name: Hardhat Local</p>
      </div>

      <div style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px' }}>
        <h3>使用说明</h3>
        <ol>
          <li>确保Hardhat节点正在运行 (http://127.0.0.1:8545)</li>
          <li>安装MetaMask钱包插件</li>
          <li>点击"连接钱包"按钮</li>
          <li>确认连接到本地Hardhat网络</li>
          <li>开始测试DEX功能</li>
        </ol>
      </div>
    </div>
  )
}

export default SimpleTestView