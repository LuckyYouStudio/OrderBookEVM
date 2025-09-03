// 合约配置文件 - 连接本地Hardhat网络
export const NETWORK_CONFIG = {
  chainId: 31337,
  name: 'Localhost 8545',
  rpcUrl: 'http://127.0.0.1:8545',
  nativeCurrency: {
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18,
  },
}

// 合约地址（从部署中获取）
export const CONTRACT_ADDRESSES = {
  TokenRegistry: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  OrderBook: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  Settlement: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
  OrderMatching: '0x0000000000000000000000000000000000000000', // 禁用
}

// 代币地址
export const TOKEN_ADDRESSES = {
  USDC: {
    address: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
    decimals: 6,
    symbol: 'USDC',
    name: 'USD Coin',
  },
  WETH: {
    address: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
    decimals: 18,
    symbol: 'WETH',
    name: 'Wrapped Ether',
  },
}

// 测试账户（用于开发）
export const TEST_ACCOUNTS = [
  {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  },
  {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  },
]

// 添加本地网络到钱包的函数
export const addLocalNetwork = async () => {
  if (typeof window.ethereum === 'undefined') {
    throw new Error('请安装 MetaMask')
  }

  try {
    // 尝试切换到本地网络
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${NETWORK_CONFIG.chainId.toString(16)}` }],
    })
    console.log('成功切换到本地网络')
  } catch (switchError) {
    // 如果网络不存在，添加它
    if (switchError.code === 4902) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: `0x${NETWORK_CONFIG.chainId.toString(16)}`,
              chainName: NETWORK_CONFIG.name,
              rpcUrls: [NETWORK_CONFIG.rpcUrl],
              nativeCurrency: NETWORK_CONFIG.nativeCurrency,
            },
          ],
        })
        console.log('成功添加本地网络')
      } catch (addError) {
        console.error('添加网络失败:', addError)
        // 如果添加失败，可能是因为网络已存在但RPC URL不同，尝试直接切换
        if (addError.code === -32000) {
          console.log('网络可能已存在，尝试直接使用')
          return
        }
        throw new Error(`添加网络失败: ${addError.message || '未知错误'}`)
      }
    } else {
      console.error('切换网络失败:', switchError)
      throw switchError
    }
  }
}

// 检查是否在正确的网络上
export const checkNetwork = async (provider) => {
  if (!provider) return false
  
  const network = await provider.getNetwork()
  return Number(network.chainId) === NETWORK_CONFIG.chainId
}