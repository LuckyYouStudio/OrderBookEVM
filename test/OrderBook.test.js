// OrderBook合约测试套件
// 测试订单簿的核心功能：下单、取消、订单管理等
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("OrderBook", function () {
  // 合约实例
  let orderBook, settlement, orderMatching, tokenRegistry;
  // 模拟代币（USDC和WETH）
  let usdc, weth;
  // 测试账户
  let owner, trader1, trader2;

  beforeEach(async function () {
    // 获取测试账户
    [owner, trader1, trader2] = await ethers.getSigners();

    // 部署模拟ERC20代币
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    // USDC: 6位小数，总供应量100万
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6, ethers.parseUnits("1000000", 6));
    // WETH: 18位小数，总供应量1万
    weth = await MockERC20.deploy("Wrapped Ether", "WETH", 18, ethers.parseEther("10000"));

    // 部署主要合约（使用可升级代理）
    const TokenRegistry = await ethers.getContractFactory("TokenRegistry");
    tokenRegistry = await upgrades.deployProxy(TokenRegistry, []);

    const OrderBook = await ethers.getContractFactory("OrderBook");
    orderBook = await upgrades.deployProxy(OrderBook, []);

    // 部署结算合约，设置手续费收取者和操作员
    const Settlement = await ethers.getContractFactory("Settlement");
    settlement = await upgrades.deployProxy(Settlement, [owner.address, owner.address]);

    // OrderMatching合约由于堆栈深度问题暂时禁用
    // const OrderMatching = await ethers.getContractFactory("OrderMatching");
    // orderMatching = await upgrades.deployProxy(OrderMatching, [
    //   await orderBook.getAddress(),
    //   await settlement.getAddress()
    // ]);

    // 设置合约地址关联（orderMatching暂时使用零地址）
    await orderBook.setContracts(
      ethers.ZeroAddress,                    // orderMatching地址（暂时禁用）
      await settlement.getAddress(),         // 结算合约地址
      await tokenRegistry.getAddress()       // 代币注册表地址
    );

    // Settlement合约没有setContracts函数
    // await settlement.setContracts(
    //   await orderBook.getAddress(),
    //   await orderMatching.getAddress()
    // );

    // 向交易者转账测试代币
    await usdc.transfer(trader1.address, ethers.parseUnits("10000", 6));  // 10000 USDC
    await weth.transfer(trader1.address, ethers.parseEther("10"));        // 10 WETH
    await usdc.transfer(trader2.address, ethers.parseUnits("10000", 6));  // 10000 USDC
    await weth.transfer(trader2.address, ethers.parseEther("10"));        // 10 WETH
  });

  describe("订单下单功能", function () {
    it("应该能够下限价单", async function () {
      // 设置订单参数：价格2000 USDC，数量1 WETH
      const price = ethers.parseUnits("2000", 6);
      const amount = ethers.parseEther("1");

      // 下卖单：卖出1 WETH，价格2000 USDC
      const tx = await orderBook.connect(trader1).placeOrder(
        await weth.getAddress(),  // 基础代币（卖出的代币）
        await usdc.getAddress(),  // 报价代币（收取的代币）
        price,                    // 价格
        amount,                   // 数量
        false,                    // 卖单
        0,                        // 限价单
        0                         // 不过期
      );

      // 等待交易确认并解析事件
      const receipt = await tx.wait();
      const events = receipt.logs.filter(log => {
        try {
          return orderBook.interface.parseLog(log).name === 'OrderPlaced';
        } catch {
          return false;
        }
      });

      // 验证事件发出
      expect(events).to.have.length(1);
      
      // 验证订单信息
      const order = await orderBook.getOrder(1);
      expect(order.trader).to.equal(trader1.address);  // 交易者地址
      expect(order.price).to.equal(price);              // 价格
      expect(order.amount).to.equal(amount);            // 数量
      expect(order.isBuy).to.equal(false);              // 卖单
    });

    it("应该拒绝零价格订单", async function () {
      // 尝试下零价格订单，应该被拒绝
      await expect(
        orderBook.connect(trader1).placeOrder(
          await weth.getAddress(),
          await usdc.getAddress(),
          0,                        // 零价格
          ethers.parseEther("1"),
          true,
          0,
          0
        )
      ).to.be.revertedWith("Invalid price");
    });

    it("应该拒绝低于最小规模的订单", async function () {
      // 尝试下非常小的订单，应该被拒绝
      await expect(
        orderBook.connect(trader1).placeOrder(
          await weth.getAddress(),
          await usdc.getAddress(),
          ethers.parseUnits("2000", 6),
          1000,                     // 非常小的数量，低于最小限制
          true,
          0,
          0
        )
      ).to.be.revertedWith("Order too small");
    });

    it("应该拒绝相同代币对的订单", async function () {
      // 尝试使用相同代币作为交易对，应该被拒绝
      await expect(
        orderBook.connect(trader1).placeOrder(
          await weth.getAddress(),  // 基础代币
          await weth.getAddress(),  // 报价代币（与基础代币相同）
          ethers.parseUnits("2000", 6),
          ethers.parseEther("1"),
          true,
          0,
          0
        )
      ).to.be.revertedWith("Same token pair");
    });
  });

  describe("订单取消功能", function () {
    it("应该能够取消未成交订单", async function () {
      // 先下一个订单
      await orderBook.connect(trader1).placeOrder(
        await weth.getAddress(),
        await usdc.getAddress(),
        ethers.parseUnits("2000", 6),
        ethers.parseEther("1"),
        false,  // 卖单
        0,      // 限价单
        0       // 不过期
      );

      // 取消订单
      await orderBook.connect(trader1).cancelOrder(1);

      // 验证订单状态为已取消
      const order = await orderBook.getOrder(1);
      expect(order.status).to.equal(3); // CANCELLED
    });

    it("应该拒绝非所有者取消订单", async function () {
      // trader1下单
      await orderBook.connect(trader1).placeOrder(
        await weth.getAddress(),
        await usdc.getAddress(),
        ethers.parseUnits("2000", 6),
        ethers.parseEther("1"),
        false,
        0,
        0
      );

      // trader2尝试取消trader1的订单，应该被拒绝
      await expect(
        orderBook.connect(trader2).cancelOrder(1)
      ).to.be.revertedWith("Not order owner");
    });
  });

  describe("订单簿管理功能", function () {
    beforeEach(async function () {
      // 在不同价格水平下多个订单
      
      // trader1下2000 USDC的卖单（1 WETH）
      await orderBook.connect(trader1).placeOrder(
        await weth.getAddress(),
        await usdc.getAddress(),
        ethers.parseUnits("2000", 6),
        ethers.parseEther("1"),
        false,  // 卖单
        0,
        0
      );

      // trader1下2100 USDC的卖单（0.5 WETH）
      await orderBook.connect(trader1).placeOrder(
        await weth.getAddress(),
        await usdc.getAddress(),
        ethers.parseUnits("2100", 6),
        ethers.parseEther("0.5"),
        false,  // 卖单
        0,
        0
      );

      // trader2下1900 USDC的买单（2 WETH）
      await orderBook.connect(trader2).placeOrder(
        await weth.getAddress(),
        await usdc.getAddress(),
        ethers.parseUnits("1900", 6),
        ethers.parseEther("2"),
        true,   // 买单
        0,
        0
      );
    });

    it("应该能够查询特定价格水平的订单", async function () {
      // 查询2000 USDC价格水平的卖单
      const sellOrders = await orderBook.getSellOrdersAtPrice(
        await weth.getAddress(),
        await usdc.getAddress(),
        ethers.parseUnits("2000", 6)
      );

      // 验证该价格水平有一个订单，ID为1
      expect(sellOrders).to.have.length(1);
      expect(sellOrders[0]).to.equal(1n);
    });

    it("应该能够跟踪用户订单", async function () {
      // 查询用户的订单列表
      const trader1Orders = await orderBook.getUserOrders(trader1.address);
      const trader2Orders = await orderBook.getUserOrders(trader2.address);

      // 验证订单数量
      expect(trader1Orders).to.have.length(2);  // trader1有2个订单
      expect(trader2Orders).to.have.length(1);  // trader2有1个订单
    });

    it("应该能够更新最佳买价和卖价", async function () {
      // 查询最佳买价（最高买价）
      const bestBid = await orderBook.bestBid(
        await weth.getAddress(),
        await usdc.getAddress()
      );
      // 查询最佳卖价（最低卖价）
      const bestAsk = await orderBook.bestAsk(
        await weth.getAddress(),
        await usdc.getAddress()
      );

      // 验证价格
      expect(bestBid).to.equal(ethers.parseUnits("1900", 6));  // 最高买价
      expect(bestAsk).to.equal(ethers.parseUnits("2000", 6));  // 最低卖价
    });
  });

  describe("访问控制功能", function () {
    it("只允许授权合约更新订单状态", async function () {
      // 下一个测试订单
      await orderBook.connect(trader1).placeOrder(
        await weth.getAddress(),
        await usdc.getAddress(),
        ethers.parseUnits("2000", 6),
        ethers.parseEther("1"),
        false,
        0,
        0
      );

      // 非授权用户尝试更新订单状态，应该被拒绝
      await expect(
        orderBook.connect(trader2).updateOrderStatus(1, 1, ethers.parseEther("0.5"))
      ).to.be.revertedWith("Unauthorized");
    });

    it("应该允许所有者暂停和恢复合约", async function () {
      // 暂停合约
      await orderBook.pause();
      
      // 暂停期间不能下单
      await expect(
        orderBook.connect(trader1).placeOrder(
          await weth.getAddress(),
          await usdc.getAddress(),
          ethers.parseUnits("2000", 6),
          ethers.parseEther("1"),
          false,
          0,
          0
        )
      ).to.be.reverted;

      // 恢复合约
      await orderBook.unpause();
      
      // 恢复后可以正常下单
      await expect(
        orderBook.connect(trader1).placeOrder(
          await weth.getAddress(),
          await usdc.getAddress(),
          ethers.parseUnits("2000", 6),
          ethers.parseEther("1"),
          false,
          0,
          0
        )
      ).to.not.be.reverted;
    });
  });
});