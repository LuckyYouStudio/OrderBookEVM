const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("OrderBook", function () {
  let orderBook, settlement, orderMatching, tokenRegistry;
  let usdc, weth;
  let owner, trader1, trader2;

  beforeEach(async function () {
    [owner, trader1, trader2] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6, ethers.parseUnits("1000000", 6));
    weth = await MockERC20.deploy("Wrapped Ether", "WETH", 18, ethers.parseEther("10000"));

    // Deploy contracts
    const TokenRegistry = await ethers.getContractFactory("TokenRegistry");
    tokenRegistry = await upgrades.deployProxy(TokenRegistry, []);

    const OrderBook = await ethers.getContractFactory("OrderBook");
    orderBook = await upgrades.deployProxy(OrderBook, []);

    const Settlement = await ethers.getContractFactory("Settlement");
    settlement = await upgrades.deployProxy(Settlement, [owner.address]);

    const OrderMatching = await ethers.getContractFactory("OrderMatching");
    orderMatching = await upgrades.deployProxy(OrderMatching, [
      await orderBook.getAddress(),
      await settlement.getAddress()
    ]);

    // Set contract addresses
    await orderBook.setContracts(
      await orderMatching.getAddress(),
      await settlement.getAddress(),
      await tokenRegistry.getAddress()
    );

    await settlement.setContracts(
      await orderBook.getAddress(),
      await orderMatching.getAddress()
    );

    // Transfer tokens to traders
    await usdc.transfer(trader1.address, ethers.parseUnits("10000", 6));
    await weth.transfer(trader1.address, ethers.parseEther("10"));
    await usdc.transfer(trader2.address, ethers.parseUnits("10000", 6));
    await weth.transfer(trader2.address, ethers.parseEther("10"));
  });

  describe("Order Placement", function () {
    it("Should place a limit order", async function () {
      const price = ethers.parseUnits("2000", 6);
      const amount = ethers.parseEther("1");

      const tx = await orderBook.connect(trader1).placeOrder(
        await weth.getAddress(),
        await usdc.getAddress(),
        price,
        amount,
        false, // sell
        0, // LIMIT
        0 // no expiration
      );

      const receipt = await tx.wait();
      const events = receipt.logs.filter(log => {
        try {
          return orderBook.interface.parseLog(log).name === 'OrderPlaced';
        } catch {
          return false;
        }
      });

      expect(events).to.have.length(1);
      
      const order = await orderBook.getOrder(1);
      expect(order.trader).to.equal(trader1.address);
      expect(order.price).to.equal(price);
      expect(order.amount).to.equal(amount);
      expect(order.isBuy).to.equal(false);
    });

    it("Should reject orders with zero price", async function () {
      await expect(
        orderBook.connect(trader1).placeOrder(
          await weth.getAddress(),
          await usdc.getAddress(),
          0,
          ethers.parseEther("1"),
          true,
          0,
          0
        )
      ).to.be.revertedWith("Invalid price");
    });

    it("Should reject orders below minimum size", async function () {
      await expect(
        orderBook.connect(trader1).placeOrder(
          await weth.getAddress(),
          await usdc.getAddress(),
          ethers.parseUnits("2000", 6),
          1000, // Very small amount
          true,
          0,
          0
        )
      ).to.be.revertedWith("Order too small");
    });

    it("Should reject orders with same token pair", async function () {
      await expect(
        orderBook.connect(trader1).placeOrder(
          await weth.getAddress(),
          await weth.getAddress(),
          ethers.parseUnits("2000", 6),
          ethers.parseEther("1"),
          true,
          0,
          0
        )
      ).to.be.revertedWith("Same token pair");
    });
  });

  describe("Order Cancellation", function () {
    it("Should cancel an open order", async function () {
      // Place an order
      await orderBook.connect(trader1).placeOrder(
        await weth.getAddress(),
        await usdc.getAddress(),
        ethers.parseUnits("2000", 6),
        ethers.parseEther("1"),
        false,
        0,
        0
      );

      // Cancel the order
      await orderBook.connect(trader1).cancelOrder(1);

      const order = await orderBook.getOrder(1);
      expect(order.status).to.equal(3); // CANCELLED
    });

    it("Should reject cancellation by non-owner", async function () {
      // Place an order
      await orderBook.connect(trader1).placeOrder(
        await weth.getAddress(),
        await usdc.getAddress(),
        ethers.parseUnits("2000", 6),
        ethers.parseEther("1"),
        false,
        0,
        0
      );

      // Try to cancel by different user
      await expect(
        orderBook.connect(trader2).cancelOrder(1)
      ).to.be.revertedWith("Not order owner");
    });
  });

  describe("Order Book Management", function () {
    beforeEach(async function () {
      // Place multiple orders at different prices
      await orderBook.connect(trader1).placeOrder(
        await weth.getAddress(),
        await usdc.getAddress(),
        ethers.parseUnits("2000", 6),
        ethers.parseEther("1"),
        false,
        0,
        0
      );

      await orderBook.connect(trader1).placeOrder(
        await weth.getAddress(),
        await usdc.getAddress(),
        ethers.parseUnits("2100", 6),
        ethers.parseEther("0.5"),
        false,
        0,
        0
      );

      await orderBook.connect(trader2).placeOrder(
        await weth.getAddress(),
        await usdc.getAddress(),
        ethers.parseUnits("1900", 6),
        ethers.parseEther("2"),
        true,
        0,
        0
      );
    });

    it("Should retrieve orders at specific price levels", async function () {
      const sellOrders = await orderBook.getSellOrdersAtPrice(
        await weth.getAddress(),
        await usdc.getAddress(),
        ethers.parseUnits("2000", 6)
      );

      expect(sellOrders).to.have.length(1);
      expect(sellOrders[0]).to.equal(1n);
    });

    it("Should track user orders", async function () {
      const trader1Orders = await orderBook.getUserOrders(trader1.address);
      const trader2Orders = await orderBook.getUserOrders(trader2.address);

      expect(trader1Orders).to.have.length(2);
      expect(trader2Orders).to.have.length(1);
    });

    it("Should update best bid and ask", async function () {
      const bestBid = await orderBook.bestBid(
        await weth.getAddress(),
        await usdc.getAddress()
      );
      const bestAsk = await orderBook.bestAsk(
        await weth.getAddress(),
        await usdc.getAddress()
      );

      expect(bestBid).to.equal(ethers.parseUnits("1900", 6));
      expect(bestAsk).to.equal(ethers.parseUnits("2000", 6));
    });
  });

  describe("Access Control", function () {
    it("Should allow only authorized contracts to update order status", async function () {
      await orderBook.connect(trader1).placeOrder(
        await weth.getAddress(),
        await usdc.getAddress(),
        ethers.parseUnits("2000", 6),
        ethers.parseEther("1"),
        false,
        0,
        0
      );

      await expect(
        orderBook.connect(trader2).updateOrderStatus(1, 1, ethers.parseEther("0.5"))
      ).to.be.revertedWith("Unauthorized");
    });

    it("Should allow owner to pause and unpause", async function () {
      await orderBook.pause();
      
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
      ).to.be.revertedWith("Pausable: paused");

      await orderBook.unpause();
      
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