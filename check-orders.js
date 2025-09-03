const { ethers } = require("hardhat");

async function checkOrders() {
    try {
        console.log("Checking orders...");
        
        // Get deployed contracts
        const orderBookAddress = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
        
        // Get signers
        const [signer] = await ethers.getSigners();
        console.log("Checking account:", signer.address);
        
        // Connect to OrderBook
        const OrderBook = await ethers.getContractFactory("OrderBook");
        const orderBook = OrderBook.attach(orderBookAddress);
        
        // Get user orders
        const orderIds = await orderBook.getUserOrders(signer.address);
        console.log("Found order IDs:", orderIds.map(id => id.toString()));
        
        for (const orderId of orderIds) {
            const order = await orderBook.getOrder(orderId);
            console.log(`\nOrder ${orderId}:`);
            console.log("- Trader:", order.trader);
            console.log("- TokenA:", order.tokenA);
            console.log("- TokenB:", order.tokenB);
            console.log("- Price:", ethers.formatUnits(order.price, 6), "USDC");
            console.log("- Amount:", ethers.formatUnits(order.amount, 18), "WETH");
            console.log("- Filled:", ethers.formatUnits(order.filledAmount, 18), "WETH");
            console.log("- Status:", order.status, order.status === 0 ? "(OPEN)" : order.status === 1 ? "(PARTIALLY_FILLED)" : "(OTHER)");
            console.log("- Is Buy:", order.isBuy);
        }
        
        // Also check a different account to compare
        const accounts = await ethers.getSigners();
        if (accounts.length > 1) {
            console.log("\n=== Checking second account ===");
            console.log("Account:", accounts[1].address);
            const orderIds2 = await orderBook.getUserOrders(accounts[1].address);
            console.log("Orders:", orderIds2.map(id => id.toString()));
        }
        
        console.log("\n✅ Check complete!");
        
    } catch (error) {
        console.error("❌ Check failed:", error);
        process.exit(1);
    }
}

checkOrders();