// Hardhat 配置文件
// 配置 Solidity 编译器、网络、插件等
require("@nomicfoundation/hardhat-toolbox");  // Hardhat 工具包
require("@openzeppelin/hardhat-upgrades");      // OpenZeppelin 可升级合约插件

module.exports = {
  // Solidity 编译器配置
  solidity: {
    version: "0.8.20",           // Solidity 版本
    settings: {
      optimizer: {
        enabled: true,          // 启用优化器
        runs: 200               // 优化运行次数（200次适合大多数情况）
      },
      viaIR: true               // 使用中间表示（IR）编译，面对复杂合约时必需
    }
  },
  // 网络配置
  networks: {
    // 本地 Hardhat 网络（用于开发和测试）
    hardhat: {
      chainId: 31337            // 网络 ID
    },
    // Ethereum Sepolia 测试网
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",                         // RPC 节点 URL
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [] // 部署账户私钥
    },
    // Polygon Mumbai 测试网
    mumbai: {
      url: process.env.MUMBAI_RPC_URL || "",                          // RPC 节点 URL
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []  // 部署账户私钥
    }
  },
  // Etherscan 验证配置（用于合约源码验证）
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || ""  // Etherscan API 密钥
  }
};