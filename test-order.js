const { ethers } = require("hardhat");

async function testPlaceOrder() {
    try {
        console.log("Testing order placement...");
        
        // Get deployed contracts
        const orderBookAddress = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
        const usdcAddress = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853";
        const wethAddress = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";
        const settlementAddress = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";
        
        // Get signers
        const [signer] = await ethers.getSigners();
        console.log("Using account:", signer.address);
        
        // Connect to contracts
        const OrderBook = await ethers.getContractFactory("OrderBook");
        const orderBook = OrderBook.attach(orderBookAddress);
        
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const usdc = MockERC20.attach(usdcAddress);
        const weth = MockERC20.attach(wethAddress);
        
        // Mint tokens if needed
        console.log("\n=== Minting tokens ===");
        const usdcAmount = ethers.parseUnits("10000", 6); // 10000 USDC
        const wethAmount = ethers.parseEther("10"); // 10 WETH
        
        await usdc.mint(signer.address, usdcAmount);
        await weth.mint(signer.address, wethAmount);
        console.log("Minted tokens");
        
        // Approve Settlement contract
        console.log("\n=== Approving tokens ===");
        await usdc.approve(settlementAddress, ethers.MaxUint256);
        await weth.approve(settlementAddress, ethers.MaxUint256);
        console.log("Approved tokens");
        
        // Place buy order: Buy 0.5 WETH at 2000 USDC each
        console.log("\n=== Placing buy order ===");
        const buyPrice = ethers.parseUnits("2000", 6); // 2000 USDC (6 decimals)
        const buyAmount = ethers.parseEther("0.5"); // 0.5 WETH (18 decimals)
        
        console.log("Buy order params:");
        console.log("- tokenA (WETH):", wethAddress);
        console.log("- tokenB (USDC):", usdcAddress);
        console.log("- price:", ethers.formatUnits(buyPrice, 6), "USDC");
        console.log("- amount:", ethers.formatEther(buyAmount), "WETH");
        console.log("- isBuy: true");
        
        const buyTx = await orderBook.placeOrder(
            wethAddress, // tokenA
            usdcAddress, // tokenB
            buyPrice,
            buyAmount,
            true, // isBuy
            0, // OrderType.LIMIT
            0  // never expires
        );
        const buyReceipt = await buyTx.wait();
        console.log("Buy order placed, tx:", buyReceipt.hash);
        
        // Place sell order: Sell 0.3 WETH at 2100 USDC each
        console.log("\n=== Placing sell order ===");
        const sellPrice = ethers.parseUnits("2100", 6); // 2100 USDC (6 decimals)
        const sellAmount = ethers.parseEther("0.3"); // 0.3 WETH (18 decimals)
        
        console.log("Sell order params:");
        console.log("- tokenA (WETH):", wethAddress);
        console.log("- tokenB (USDC):", usdcAddress);
        console.log("- price:", ethers.formatUnits(sellPrice, 6), "USDC");
        console.log("- amount:", ethers.formatEther(sellAmount), "WETH");
        console.log("- isBuy: false");
        
        const sellTx = await orderBook.placeOrder(
            wethAddress, // tokenA
            usdcAddress, // tokenB
            sellPrice,
            sellAmount,
            false, // isBuy
            0, // OrderType.LIMIT
            0  // never expires
        );
        const sellReceipt = await sellTx.wait();
        console.log("Sell order placed, tx:", sellReceipt.hash);
        
        // Check orderbook state
        console.log("\n=== Checking orderbook ===");
        const bestBid = await orderBook.bestBid(wethAddress, usdcAddress);
        const bestAsk = await orderBook.bestAsk(wethAddress, usdcAddress);
        
        console.log("Best bid:", ethers.formatUnits(bestBid, 6), "USDC");
        console.log("Best ask:", ethers.formatUnits(bestAsk, 6), "USDC");
        
        // Check price levels
        const buyLevels = await orderBook.getBuyPriceLevels(wethAddress, usdcAddress, 5);
        const sellLevels = await orderBook.getSellPriceLevels(wethAddress, usdcAddress, 5);
        
        console.log("Buy price levels:", buyLevels.map(l => ethers.formatUnits(l, 6)));
        console.log("Sell price levels:", sellLevels.map(l => ethers.formatUnits(l, 6)));
        
        console.log("\n✅ Orders placed successfully!");
        
    } catch (error) {
        console.error("❌ Test failed:", error);
        process.exit(1);
    }
}

testPlaceOrder();