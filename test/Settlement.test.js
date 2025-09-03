const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Settlement", function () {
  let settlement, usdc, weth;
  let owner, user1, user2, orderBook, orderMatching;

  beforeEach(async function () {
    [owner, user1, user2, orderBook, orderMatching] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6, ethers.parseUnits("1000000", 6));
    weth = await MockERC20.deploy("Wrapped Ether", "WETH", 18, ethers.parseEther("10000"));

    // Deploy Settlement contract
    const Settlement = await ethers.getContractFactory("Settlement");
    settlement = await upgrades.deployProxy(Settlement, [owner.address, orderMatching.address]);

    // Settlement contract doesn't have setContracts function
    // await settlement.setContracts(orderBook.address, orderMatching.address);

    // Transfer tokens to users
    await usdc.transfer(user1.address, ethers.parseUnits("10000", 6));
    await weth.transfer(user1.address, ethers.parseEther("10"));
    await usdc.transfer(user2.address, ethers.parseUnits("10000", 6));
    await weth.transfer(user2.address, ethers.parseEther("10"));
  });

  describe("Deposits and Withdrawals", function () {
    it("Should allow users to deposit tokens", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      
      await usdc.connect(user1).approve(await settlement.getAddress(), depositAmount);
      await settlement.connect(user1).deposit(await usdc.getAddress(), depositAmount);

      const balance = await settlement.getUserBalance(user1.address, await usdc.getAddress());
      expect(balance).to.equal(depositAmount);
    });

    it("Should allow users to withdraw tokens", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      const withdrawAmount = ethers.parseUnits("500", 6);
      
      await usdc.connect(user1).approve(await settlement.getAddress(), depositAmount);
      await settlement.connect(user1).deposit(await usdc.getAddress(), depositAmount);

      await settlement.connect(user1).withdraw(await usdc.getAddress(), withdrawAmount);

      const balance = await settlement.getUserBalance(user1.address, await usdc.getAddress());
      expect(balance).to.equal(depositAmount - withdrawAmount);
    });

    it("Should reject withdrawal with insufficient balance", async function () {
      const withdrawAmount = ethers.parseUnits("1000", 6);
      
      await expect(
        settlement.connect(user1).withdraw(await usdc.getAddress(), withdrawAmount)
      ).to.be.revertedWith("Insufficient balance");
    });

    it("Should emit deposit and withdrawal events", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      
      await usdc.connect(user1).approve(await settlement.getAddress(), depositAmount);
      
      await expect(
        settlement.connect(user1).deposit(await usdc.getAddress(), depositAmount)
      ).to.emit(settlement, "Deposit")
        .withArgs(user1.address, await usdc.getAddress(), depositAmount);

      await expect(
        settlement.connect(user1).withdraw(await usdc.getAddress(), depositAmount)
      ).to.emit(settlement, "Withdrawal")
        .withArgs(user1.address, await usdc.getAddress(), depositAmount);
    });
  });

  describe("Batch Operations", function () {
    it("Should allow batch deposits", async function () {
      const amounts = [ethers.parseUnits("1000", 6), ethers.parseEther("1")];
      const tokens = [await usdc.getAddress(), await weth.getAddress()];
      
      await usdc.connect(user1).approve(await settlement.getAddress(), amounts[0]);
      await weth.connect(user1).approve(await settlement.getAddress(), amounts[1]);
      
      await settlement.connect(user1).batchDeposit(tokens, amounts);

      const usdcBalance = await settlement.getUserBalance(user1.address, await usdc.getAddress());
      const wethBalance = await settlement.getUserBalance(user1.address, await weth.getAddress());
      
      expect(usdcBalance).to.equal(amounts[0]);
      expect(wethBalance).to.equal(amounts[1]);
    });

    it("Should allow batch withdrawals", async function () {
      const amounts = [ethers.parseUnits("1000", 6), ethers.parseEther("1")];
      const tokens = [await usdc.getAddress(), await weth.getAddress()];
      
      // First deposit
      await usdc.connect(user1).approve(await settlement.getAddress(), amounts[0]);
      await weth.connect(user1).approve(await settlement.getAddress(), amounts[1]);
      await settlement.connect(user1).batchDeposit(tokens, amounts);

      // Then withdraw
      await settlement.connect(user1).batchWithdraw(tokens, amounts);

      const usdcBalance = await settlement.getUserBalance(user1.address, await usdc.getAddress());
      const wethBalance = await settlement.getUserBalance(user1.address, await weth.getAddress());
      
      expect(usdcBalance).to.equal(0);
      expect(wethBalance).to.equal(0);
    });

    it("Should reject batch operations with mismatched arrays", async function () {
      const amounts = [ethers.parseUnits("1000", 6)];
      const tokens = [await usdc.getAddress(), await weth.getAddress()];
      
      await expect(
        settlement.connect(user1).batchDeposit(tokens, amounts)
      ).to.be.revertedWith("Arrays length mismatch");
    });
  });

  describe("Trade Execution", function () {
    beforeEach(async function () {
      // Setup balances for trading
      const usdcAmount = ethers.parseUnits("5000", 6);
      const wethAmount = ethers.parseEther("2");
      
      await usdc.connect(user1).approve(await settlement.getAddress(), usdcAmount);
      await weth.connect(user1).approve(await settlement.getAddress(), wethAmount);
      await settlement.connect(user1).deposit(await usdc.getAddress(), usdcAmount);
      await settlement.connect(user1).deposit(await weth.getAddress(), wethAmount);
      
      await usdc.connect(user2).approve(await settlement.getAddress(), usdcAmount);
      await weth.connect(user2).approve(await settlement.getAddress(), wethAmount);
      await settlement.connect(user2).deposit(await usdc.getAddress(), usdcAmount);
      await settlement.connect(user2).deposit(await weth.getAddress(), wethAmount);
    });

    it("Should execute trades between users", async function () {
      const tradeAmount = ethers.parseEther("1"); // 1 WETH
      const price = ethers.parseUnits("2", 6); // 2 USDC per WETH (to reduce calculation load)

      await settlement.connect(orderMatching).executeTrade(
        user1.address, // buyer
        user2.address, // seller
        await weth.getAddress(), // tokenA (WETH)
        await usdc.getAddress(), // tokenB (USDC)
        tradeAmount,
        price,
        true // buyer is maker
      );

      // Check balances after trade
      const user1WethBalance = await settlement.getUserBalance(user1.address, await weth.getAddress());
      const user1UsdcBalance = await settlement.getUserBalance(user1.address, await usdc.getAddress());
      const user2WethBalance = await settlement.getUserBalance(user2.address, await weth.getAddress());
      const user2UsdcBalance = await settlement.getUserBalance(user2.address, await usdc.getAddress());

      // User1 (buyer) should have more WETH, less USDC
      expect(user1WethBalance).to.be.gt(ethers.parseEther("2"));
      expect(user1UsdcBalance).to.be.lt(ethers.parseUnits("5000", 6));

      // User2 (seller) should have less WETH, more USDC
      expect(user2WethBalance).to.be.lt(ethers.parseEther("2"));
      expect(user2UsdcBalance).to.be.gt(ethers.parseUnits("5000", 6));
    });

    it("Should collect trading fees", async function () {
      const tradeAmount = ethers.parseEther("1");
      const price = ethers.parseUnits("2", 6);

      const initialFees = await settlement.collectedFees(await usdc.getAddress());

      await settlement.connect(orderMatching).executeTrade(
        user1.address,
        user2.address,
        await weth.getAddress(),
        await usdc.getAddress(),
        tradeAmount,
        price,
        true
      );

      const finalFees = await settlement.collectedFees(await usdc.getAddress());
      expect(finalFees).to.be.gt(initialFees);
    });

    it("Should reject unauthorized trade execution", async function () {
      await expect(
        settlement.connect(user1).executeTrade(
          user1.address,
          user2.address,
          await weth.getAddress(),
          await usdc.getAddress(),
          ethers.parseEther("1"),
          ethers.parseUnits("2", 6),
          true
        )
      ).to.be.revertedWith("Unauthorized operator");
    });
  });

  describe("Emergency Withdrawals", function () {
    it("Should allow emergency withdrawal after delay", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      
      // Deposit tokens
      await usdc.connect(user1).approve(await settlement.getAddress(), depositAmount);
      await settlement.connect(user1).deposit(await usdc.getAddress(), depositAmount);

      // Request emergency withdrawal
      await settlement.connect(user1).requestEmergencyWithdrawal();

      // Fast forward time (simulate 24 hours)
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");

      // Execute emergency withdrawal
      await settlement.connect(user1).executeEmergencyWithdrawal(await usdc.getAddress());

      const balance = await settlement.getUserBalance(user1.address, await usdc.getAddress());
      expect(balance).to.equal(0);
    });

    it("Should reject emergency withdrawal before delay", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      
      await usdc.connect(user1).approve(await settlement.getAddress(), depositAmount);
      await settlement.connect(user1).deposit(await usdc.getAddress(), depositAmount);

      await settlement.connect(user1).requestEmergencyWithdrawal();

      await expect(
        settlement.connect(user1).executeEmergencyWithdrawal(await usdc.getAddress())
      ).to.be.revertedWith("Emergency delay not met");
    });
  });

  describe("Fee Management", function () {
    it("Should allow owner to collect fees", async function () {
      // First execute a trade to generate fees
      const tradeAmount = ethers.parseEther("1");
      const price = ethers.parseUnits("2", 6);
      
      // Setup balances
      await usdc.connect(user1).approve(await settlement.getAddress(), ethers.parseUnits("5000", 6));
      await settlement.connect(user1).deposit(await usdc.getAddress(), ethers.parseUnits("5000", 6));
      await weth.connect(user2).approve(await settlement.getAddress(), ethers.parseEther("2"));
      await settlement.connect(user2).deposit(await weth.getAddress(), ethers.parseEther("2"));

      await settlement.connect(orderMatching).executeTrade(
        user1.address,
        user2.address,
        await weth.getAddress(),
        await usdc.getAddress(),
        tradeAmount,
        price,
        true
      );

      const feesBeforeCollection = await settlement.collectedFees(await usdc.getAddress());
      expect(feesBeforeCollection).to.be.gt(0);

      await settlement.collectFees(await usdc.getAddress());

      const feesAfterCollection = await settlement.collectedFees(await usdc.getAddress());
      expect(feesAfterCollection).to.equal(0);
    });

    it("Should update fee parameters", async function () {
      await settlement.setFees(5, 15); // 0.05% maker, 0.15% taker

      expect(await settlement.makerFee()).to.equal(5);
      expect(await settlement.takerFee()).to.equal(15);
    });
  });
});