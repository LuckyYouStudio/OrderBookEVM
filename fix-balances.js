const { ethers } = require("hardhat");

async function fixBalances() {
    try {
        console.log("修复Settlement合约余额...");
        
        // 获取合约地址
        const settlementAddress = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";
        const usdcAddress = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853";
        const wethAddress = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";
        
        // 获取签名者（同一个账户）
        const [account] = await ethers.getSigners();
        console.log("使用账户:", account.address);
        
        // 连接合约
        const Settlement = await ethers.getContractFactory("Settlement");
        const settlement = Settlement.attach(settlementAddress);
        
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const usdc = MockERC20.attach(usdcAddress);
        const weth = MockERC20.attach(wethAddress);
        
        console.log("\n=== 检查当前余额 ===");
        
        // 检查钱包余额
        const walletUsdcBalance = await usdc.balanceOf(account.address);
        const walletWethBalance = await weth.balanceOf(account.address);
        console.log("钱包USDC余额:", ethers.formatUnits(walletUsdcBalance, 6));
        console.log("钱包WETH余额:", ethers.formatUnits(walletWethBalance, 18));
        
        // 检查Settlement余额
        const settlementUsdcBalance = await settlement.getUserBalance(account.address, usdcAddress);
        const settlementWethBalance = await settlement.getUserBalance(account.address, wethAddress);
        console.log("Settlement USDC余额:", ethers.formatUnits(settlementUsdcBalance, 6));
        console.log("Settlement WETH余额:", ethers.formatUnits(settlementWethBalance, 18));
        
        console.log("\n=== 铸造和存入代币 ===");
        
        // 铸造更多代币
        const mintUsdcAmount = ethers.parseUnits("50000", 6); // 50,000 USDC
        const mintWethAmount = ethers.parseEther("50"); // 50 WETH
        
        await usdc.mint(account.address, mintUsdcAmount);
        await weth.mint(account.address, mintWethAmount);
        console.log("铸造了50,000 USDC 和 50 WETH");
        
        // 授权Settlement合约
        await usdc.approve(settlementAddress, ethers.MaxUint256);
        await weth.approve(settlementAddress, ethers.MaxUint256);
        console.log("授权完成");
        
        // 存入大量代币到Settlement合约
        const depositUsdcAmount = ethers.parseUnits("20000", 6); // 20,000 USDC
        const depositWethAmount = ethers.parseEther("20"); // 20 WETH
        
        await settlement.deposit(usdcAddress, depositUsdcAmount);
        console.log("存入了20,000 USDC到Settlement合约");
        
        await settlement.deposit(wethAddress, depositWethAmount);
        console.log("存入了20 WETH到Settlement合约");
        
        console.log("\n=== 验证最终余额 ===");
        
        const finalSettlementUsdcBalance = await settlement.getUserBalance(account.address, usdcAddress);
        const finalSettlementWethBalance = await settlement.getUserBalance(account.address, wethAddress);
        
        console.log("最终Settlement USDC余额:", ethers.formatUnits(finalSettlementUsdcBalance, 6));
        console.log("最终Settlement WETH余额:", ethers.formatUnits(finalSettlementWethBalance, 18));
        
        console.log("\n✅ 余额修复完成！");
        console.log("现在可以进行订单匹配了");
        
    } catch (error) {
        console.error("❌ 修复失败:", error);
        process.exit(1);
    }
}

fixBalances();