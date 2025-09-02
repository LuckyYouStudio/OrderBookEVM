# OrderBook DEX

A decentralized exchange (DEX) built on Ethereum with an on-chain order book system. This project implements a fully functional trading platform with smart contracts for order management, matching, settlement, and token registry, along with a React-based frontend interface.

## 🏗️ 混合架构设计

### 链下订单引擎 (Go)
- **高性能撮合引擎** - 内存撮合，毫秒级响应
- **WebSocket实时推送** - 订单簿、交易、状态实时更新  
- **EIP-712签名验证** - 安全的订单签名机制
- **RESTful API** - 完整的订单管理接口

### 链上清算合约 (Solidity)
- **批量结算合约** - 链下撮合后批量上链清算
- **EIP-712签名验证** - 链上验证订单签名安全性
- **Gas优化** - 批量处理降低交易成本
- **资产托管** - 去中心化资产安全保障

### 前端界面 (React)
- **专业交易界面** - TradingView风格图表
- **实时数据** - WebSocket连接链下引擎
- **钱包集成** - MetaMask等钱包支持
- **响应式设计** - 多设备适配

## 🚀 Features

### Core Trading Features
- ✅ Limit and Market orders
- ✅ Stop-loss and Take-profit orders
- ✅ Partial order fills
- ✅ Order cancellation
- ✅ Real-time order book updates
- ✅ Price-time priority matching

### Advanced Features
- ✅ Slippage protection
- ✅ Gas-optimized matching
- ✅ Upgradeable contracts via OpenZeppelin
- ✅ Emergency pause functionality
- ✅ Multi-signature admin controls
- ✅ Maker/taker fee structure

### Security Features
- ✅ Reentrancy protection
- ✅ Integer overflow protection
- ✅ Front-running mitigation
- ✅ Circuit breakers
- ✅ Emergency withdrawal system

## 📁 Project Structure

```
OrderBookEVM/
├── contracts/                    # 智能合约
│   ├── interfaces/
│   ├── mocks/
│   └── Settlement.sol            # 重构后的批量清算合约
├── orderbook-engine/             # Go链下订单引擎
│   ├── cmd/                      # 主程序入口
│   ├── internal/
│   │   ├── api/                  # REST API
│   │   ├── matching/             # 撮合引擎
│   │   ├── storage/              # 数据存储
│   │   ├── websocket/            # WebSocket服务
│   │   └── types/                # 数据类型
│   ├── pkg/
│   │   └── crypto/               # 签名验证
│   ├── configs/                  # 配置文件
│   ├── .env.example              # 环境变量模板
│   └── go.mod
├── frontend/                     # React前端
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── utils/
│   └── package.json
├── scripts/                      # 部署脚本
├── test/                         # 智能合约测试
├── .gitignore                    # Git忽略文件
├── hardhat.config.js
└── README.md
```

## 🛠️ Installation

### Prerequisites
- Node.js v16+
- Go 1.21+
- npm or yarn
- Git
- PostgreSQL (可选，用于生产环境)
- Redis (可选，用于缓存)

### Setup

1. **Clone the repository**
```bash
git clone https://github.com/LuckyYouStudio/OrderBookEVM.git
cd OrderBookEVM
```

2. **Install dependencies**
```bash
# 安装智能合约依赖
npm install

# 安装前端依赖
cd frontend && npm install && cd ..

# 安装Go依赖
cd orderbook-engine && go mod tidy && cd ..
```

3. **配置环境变量**
```bash
# 智能合约环境变量
cp .env.example .env

# Go服务环境变量  
cd orderbook-engine
cp .env.example .env
# 编辑 .env 文件配置数据库、区块链等参数
cd ..
```

⚠️ **重要**: 请勿将 `.env` 文件提交到版本控制系统，它们包含敏感信息如私钥、API密钥等。

## 🚀 Deployment

### 混合架构本地开发

1. **启动本地Hardhat网络**
```bash
npm run node
```

2. **部署智能合约** (新终端)
```bash
npm run deploy:localhost
```

3. **启动Go链下订单引擎** (新终端)
```bash
cd orderbook-engine
go run cmd/main.go
```

4. **启动前端界面** (新终端)
```bash
npm run frontend
```

现在你可以访问:
- 前端界面: http://localhost:3000
- API文档: http://localhost:8080/api/v1/health
- WebSocket: ws://localhost:8080/ws

### Testnet Deployment

1. **Configure your .env file** with testnet RPC URLs and private key

2. **Deploy to Sepolia**
```bash
npx hardhat run scripts/deploy.js --network sepolia
```

3. **Verify contracts** (optional)
```bash
npx hardhat verify --network sepolia DEPLOYED_CONTRACT_ADDRESS
```

## 📝 Smart Contract Usage

### OrderBook Contract

```solidity
// Place a limit order
function placeOrder(
    address tokenA,
    address tokenB,
    uint256 price,
    uint256 amount,
    bool isBuy,
    OrderType orderType,
    uint256 expirationTime
) external returns (uint256 orderId);

// Cancel an order
function cancelOrder(uint256 orderId) external;

// Get order details
function getOrder(uint256 orderId) external view returns (Order memory);
```

### Settlement Contract

```solidity
// Deposit tokens for trading
function deposit(address token, uint256 amount) external;

// Withdraw tokens
function withdraw(address token, uint256 amount) external;

// Check balance
function getUserBalance(address user, address token) external view returns (uint256);
```

## 🧪 Testing

Run the comprehensive test suite:

```bash
npm test
```

Test individual contracts:
```bash
npx hardhat test test/OrderBook.test.js
npx hardhat test test/Settlement.test.js
```

Run tests with gas reporting:
```bash
REPORT_GAS=true npm test
```

## 📊 Frontend Usage

### Connecting Wallet
1. Click "Connect Wallet" in the navigation
2. Approve MetaMask connection
3. Switch to the correct network if needed

### Trading
1. **Deposit tokens** into the settlement contract
2. **Place orders** using the order form
   - Select Limit or Market order type
   - Choose Buy or Sell
   - Enter price and amount
   - Submit transaction
3. **Monitor orders** in the "Open Orders" section
4. **Cancel orders** if needed before they're filled

### Order Book
- Real-time order book with bid/ask spreads
- Click on prices to auto-fill order form
- Visual depth representation
- Current spread information

## ⚙️ Configuration

### Contract Parameters
- Minimum order size: 0.001 ETH equivalent
- Maximum slippage: 5%
- Maker fee: 0.1%
- Taker fee: 0.25%
- Emergency withdrawal delay: 24 hours

### Supported Networks
- Hardhat (local development)
- Sepolia (testnet)
- Mumbai (Polygon testnet)
- Mainnet (production)

## 🔒 Security Considerations

### Auditing Checklist
- [ ] Smart contract audit by professional firm
- [ ] Formal verification of critical functions
- [ ] Economic model validation
- [ ] Front-end security assessment
- [ ] Infrastructure security review

### Risk Mitigation
- Circuit breakers for unusual market conditions
- Time-locked admin functions
- Multi-signature controls for critical operations
- Emergency pause functionality
- Slippage protection for market orders

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- Create an issue for bugs or feature requests
- Join our Discord community for discussions
- Check the documentation wiki for detailed guides

## 🗺️ Roadmap

### Phase 1 (Completed) ✅
- Core order book functionality
- Basic trading interface
- Local development setup

### Phase 2 (In Progress) 🚧
- Advanced order types
- Mobile-responsive design
- Performance optimizations

### Phase 3 (Planned) 📋
- Layer 2 integration
- Liquidity mining
- Advanced charting tools
- API for programmatic trading

### Phase 4 (Future) 🔮
- Cross-chain trading
- Automated market making
- Governance token
- DAO governance system

## 📈 Performance

- Gas-optimized matching algorithm
- Batch operations for multiple orders
- Event-based order book updates
- Lazy loading for better UX

## 🔧 Development Commands

```bash
# Compile contracts
npm run compile

# Run local node
npm run node

# Deploy contracts
npm run deploy

# Run tests
npm test

# Start frontend
npm run frontend

# Interact with deployed contracts
npm run interact
```

---

**⚠️ Disclaimer**: This is experimental software. Use at your own risk. Always test thoroughly on testnets before mainnet deployment.