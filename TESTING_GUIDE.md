# 🧪 项目测试指南

## 📋 测试概览

本项目包含三个主要组件的测试：
1. **智能合约测试** - Hardhat + Chai
2. **Go后端测试** - Go内置测试框架
3. **前端测试** - React Testing Library
4. **端到端测试** - 完整流程测试

## 🚀 快速开始

### 1. 环境准备

```bash
# 克隆项目
git clone https://github.com/LuckyYouStudio/OrderBookEVM.git
cd OrderBookEVM

# 安装依赖
npm install
cd frontend && npm install && cd ..
cd orderbook-engine && go mod tidy && cd ..

# 复制环境变量
cp .env.example .env
cd orderbook-engine && cp .env.example .env && cd ..
```

## 🔧 分组件测试

### 1️⃣ 智能合约测试

#### 运行测试
```bash
# 运行所有合约测试
npm test

# 运行特定测试文件
npx hardhat test test/Settlement.test.js

# 带Gas报告的测试
REPORT_GAS=true npm test

# 测试覆盖率
npx hardhat coverage
```

#### 测试内容
- ✅ 订单签名验证
- ✅ 批量结算功能
- ✅ 资金存取
- ✅ 紧急提款
- ✅ 费用计算
- ✅ 权限控制

#### 示例测试
```javascript
// test/Settlement.test.js
describe("Settlement", function () {
  it("Should verify order signatures", async function () {
    // 测试EIP-712签名验证
  });
  
  it("Should execute batch settlement", async function () {
    // 测试批量结算
  });
});
```

### 2️⃣ Go后端测试

#### 创建测试文件
```bash
# 在orderbook-engine目录下
cd orderbook-engine

# 运行所有测试
go test ./...

# 运行特定包的测试
go test ./internal/matching

# 带覆盖率的测试
go test -cover ./...

# 生成覆盖率报告
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
```

#### 创建匹配引擎测试
```go
// orderbook-engine/internal/matching/engine_test.go
package matching

import (
    "testing"
    "github.com/stretchr/testify/assert"
)

func TestOrderMatching(t *testing.T) {
    engine := NewMatchingEngine(logger)
    
    // 创建买单
    buyOrder := &types.Order{
        Side: types.OrderSideBuy,
        Price: decimal.NewFromInt(2000),
        Amount: decimal.NewFromInt(1),
    }
    
    // 创建卖单
    sellOrder := &types.Order{
        Side: types.OrderSideSell,
        Price: decimal.NewFromInt(1999),
        Amount: decimal.NewFromInt(1),
    }
    
    // 添加订单
    fills := engine.AddOrder(buyOrder)
    assert.Empty(t, fills)
    
    fills = engine.AddOrder(sellOrder)
    assert.NotEmpty(t, fills)
    assert.Equal(t, 1, len(fills))
}
```

### 3️⃣ 前端测试

#### 创建测试配置
```bash
cd frontend
npm install --save-dev @testing-library/react @testing-library/jest-dom vitest
```

创建 `frontend/vite.config.js` 测试配置：
```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
  },
})
```

#### 运行前端测试
```bash
cd frontend

# 运行测试
npm test

# 监听模式
npm test -- --watch

# 覆盖率
npm test -- --coverage
```

## 🔄 集成测试流程

### 步骤1: 启动本地环境

打开4个终端窗口：

```bash
# 终端1: 启动本地区块链
npm run node

# 终端2: 部署合约
npm run deploy:localhost
# 记录Settlement合约地址

# 终端3: 启动Go后端
cd orderbook-engine
# 修改.env中的SETTLEMENT_CONTRACT_ADDRESS
go run cmd/main.go

# 终端4: 启动前端
npm run frontend
```

### 步骤2: 测试交易流程

#### 2.1 通过前端测试
1. 访问 http://localhost:3000
2. 连接MetaMask钱包
3. 存入测试代币
4. 下单测试
5. 查看订单簿更新
6. 监控WebSocket连接

#### 2.2 通过API测试
```bash
# 健康检查
curl http://localhost:8080/api/v1/health

# 获取订单簿
curl http://localhost:8080/api/v1/orderbook/WETH-USDC

# 下单（需要签名）
curl -X POST http://localhost:8080/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "user_address": "0x...",
    "trading_pair": "WETH-USDC",
    "side": "buy",
    "type": "limit",
    "price": "2000",
    "amount": "1",
    "signature": "0x..."
  }'
```

#### 2.3 WebSocket测试
```javascript
// 测试WebSocket连接
const ws = new WebSocket('ws://localhost:8080/ws');

ws.onopen = () => {
  // 订阅订单簿
  ws.send(JSON.stringify({
    action: 'subscribe',
    channel: 'orderbook',
    symbol: 'WETH-USDC'
  }));
};

ws.onmessage = (event) => {
  console.log('收到消息:', JSON.parse(event.data));
};
```

## 📊 测试场景

### 核心功能测试

| 测试场景 | 测试内容 | 预期结果 |
|---------|---------|----------|
| 订单匹配 | 买卖单价格交叉 | 自动撮合成交 |
| 部分成交 | 订单数量不等 | 部分成交，剩余挂单 |
| 订单取消 | 取消未成交订单 | 订单状态更新为已取消 |
| 批量结算 | 多笔成交上链 | 一次交易完成多笔结算 |
| 紧急提款 | 24小时后提款 | 成功提取所有资金 |

### 性能测试

```bash
# 使用Apache Bench测试API性能
ab -n 1000 -c 10 http://localhost:8080/api/v1/orderbook/WETH-USDC

# 使用wscat测试WebSocket
npm install -g wscat
wscat -c ws://localhost:8080/ws
```

### 安全测试

1. **签名验证测试**
   - 错误签名应被拒绝
   - 过期订单应被拒绝
   - 重复nonce应被拒绝

2. **权限测试**
   - 非owner不能调用管理函数
   - 非operator不能执行批量结算

3. **重入攻击测试**
   - 确保ReentrancyGuard正常工作

## 🐛 常见问题排查

### 问题1: 合约部署失败
```bash
# 检查网络
npx hardhat node --network hardhat

# 清理缓存
npx hardhat clean
rm -rf cache artifacts
```

### 问题2: Go后端启动失败
```bash
# 检查端口占用
lsof -i :8080

# 检查环境变量
cat orderbook-engine/.env

# 查看日志
tail -f orderbook-engine/logs/app.log
```

### 问题3: 前端连接失败
```bash
# 检查MetaMask网络
# 应该连接到 localhost:8545

# 检查合约地址配置
# frontend/src/config/contracts.js
```

## 📈 监控和日志

### 查看Go后端日志
```bash
# 实时查看日志
tail -f orderbook-engine/logs/app.log

# 查看错误日志
grep ERROR orderbook-engine/logs/app.log
```

### 查看合约事件
```javascript
// 监听合约事件
const settlement = await ethers.getContract("Settlement");

settlement.on("TradeExecuted", (taker, maker, price, amount) => {
  console.log(`Trade: ${amount} @ ${price}`);
});
```

## ✅ 测试检查清单

- [ ] 智能合约单元测试通过
- [ ] Go后端单元测试通过
- [ ] 前端组件测试通过
- [ ] 订单签名验证正常
- [ ] WebSocket实时推送正常
- [ ] 批量结算功能正常
- [ ] 紧急提款功能正常
- [ ] Gas消耗在合理范围
- [ ] API响应时间 < 100ms
- [ ] 订单簿更新延迟 < 50ms

## 🚀 自动化测试脚本

创建 `test-all.sh`:
```bash
#!/bin/bash

echo "🧪 运行所有测试..."

# 1. 合约测试
echo "📝 测试智能合约..."
npm test

# 2. Go测试
echo "🔧 测试Go后端..."
cd orderbook-engine && go test ./... && cd ..

# 3. 前端测试
echo "🎨 测试前端..."
cd frontend && npm test && cd ..

echo "✅ 所有测试完成！"
```

## 📚 相关文档

- [README.md](README.md) - 项目说明
- [SECURITY.md](SECURITY.md) - 安全指南
- [ENV_GUIDE.md](ENV_GUIDE.md) - 环境配置

---

**提示**: 在生产环境部署前，确保所有测试都通过，并进行完整的安全审计！