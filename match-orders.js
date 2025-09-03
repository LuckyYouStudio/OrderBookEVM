const { ethers } = require("hardhat");

async function matchOrders() {
    try {
        console.log("Starting manual order matching...");
        
        // Get deployed contracts
        const orderBookAddress = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
        const settlementAddress = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";
        const usdcAddress = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853";
        const wethAddress = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";
        
        // Get signers
        const [deployer] = await ethers.getSigners();
        console.log("Using account:", deployer.address);
        
        // Connect to contracts
        const OrderBook = await ethers.getContractFactory("OrderBook");
        const orderBook = OrderBook.attach(orderBookAddress);
        
        const Settlement = await ethers.getContractFactory("Settlement");
        const settlement = Settlement.attach(settlementAddress);
        
        // Get price levels
        console.log("\n=== Getting price levels ===");
        const buyLevels = await orderBook.getBuyPriceLevels(wethAddress, usdcAddress, 10);
        const sellLevels = await orderBook.getSellPriceLevels(wethAddress, usdcAddress, 10);
        
        console.log("Buy levels:", buyLevels.map(l => ethers.formatUnits(l, 6)));
        console.log("Sell levels:", sellLevels.map(l => ethers.formatUnits(l, 6)));
        
        // Find matching prices
        for (const buyPrice of buyLevels) {
            for (const sellPrice of sellLevels) {
                if (buyPrice >= sellPrice && buyPrice > 0 && sellPrice > 0) {
                    console.log(`\nFound matching price: Buy ${ethers.formatUnits(buyPrice, 6)} >= Sell ${ethers.formatUnits(sellPrice, 6)}`);
                    
                    // Get orders at these prices
                    const buyOrderIds = await orderBook.getBuyOrdersAtPrice(wethAddress, usdcAddress, buyPrice);
                    const sellOrderIds = await orderBook.getSellOrdersAtPrice(wethAddress, usdcAddress, sellPrice);
                    
                    console.log("Buy orders:", buyOrderIds.map(id => id.toString()));
                    console.log("Sell orders:", sellOrderIds.map(id => id.toString()));
                    
                    // Try to match orders
                    for (const buyOrderId of buyOrderIds) {
                        for (const sellOrderId of sellOrderIds) {
                            const buyOrder = await orderBook.getOrder(buyOrderId);
                            const sellOrder = await orderBook.getOrder(sellOrderId);
                            
                            // Check if orders can be matched (OPEN or PARTIALLY_FILLED)
                            if ((Number(buyOrder.status) === 0 || Number(buyOrder.status) === 1) && 
                                (Number(sellOrder.status) === 0 || Number(sellOrder.status) === 1)) {
                                const tradePrice = sellPrice; // Use sell price (maker gets better price)
                                const buyerRemainingAmount = buyOrder.amount - buyOrder.filledAmount;
                                const sellerRemainingAmount = sellOrder.amount - sellOrder.filledAmount;
                                const maxAmount = buyerRemainingAmount < sellerRemainingAmount ? buyerRemainingAmount : sellerRemainingAmount;
                                
                                // Skip if no remaining amount to trade
                                if (maxAmount <= 0) {
                                    console.log(`Skipping orders ${buyOrderId}/${sellOrderId}: no remaining amount`);
                                    continue;
                                }
                                
                                console.log(`\nTrying to match:`);
                                console.log(`- Buy Order ${buyOrderId}: ${ethers.formatUnits(buyOrder.amount, 18)} WETH @ ${ethers.formatUnits(buyOrder.price, 6)} USDC`);
                                console.log(`- Sell Order ${sellOrderId}: ${ethers.formatUnits(sellOrder.amount, 18)} WETH @ ${ethers.formatUnits(sellOrder.price, 6)} USDC`);
                                console.log(`- Trade Amount: ${ethers.formatUnits(maxAmount, 18)} WETH`);
                                console.log(`- Trade Price: ${ethers.formatUnits(tradePrice, 6)} USDC`);
                                
                                try {
                                    // Execute trade through Settlement contract
                                    const tx = await settlement.executeTrade(
                                        buyOrder.trader,  // buyer
                                        sellOrder.trader, // seller
                                        wethAddress,      // tokenA (WETH)
                                        usdcAddress,      // tokenB (USDC) 
                                        maxAmount,        // amount of WETH
                                        tradePrice,       // price in USDC
                                        false             // buyerIsMaker (sell order came first)
                                    );
                                    
                                    const receipt = await tx.wait();
                                    console.log(`✅ Trade executed! TX: ${receipt.hash}`);
                                    
                                    // Update order status
                                    const remainingBuyAmount = buyOrder.amount - maxAmount;
                                    const remainingSellAmount = sellOrder.amount - maxAmount;
                                    
                                    if (remainingBuyAmount === 0n) {
                                        await orderBook.updateOrderStatus(buyOrderId, 2, buyOrder.amount); // FILLED
                                        console.log(`Buy order ${buyOrderId} fully filled`);
                                    } else {
                                        await orderBook.updateOrderStatus(buyOrderId, 1, maxAmount); // PARTIALLY_FILLED
                                        console.log(`Buy order ${buyOrderId} partially filled`);
                                    }
                                    
                                    if (remainingSellAmount === 0n) {
                                        await orderBook.updateOrderStatus(sellOrderId, 2, sellOrder.amount); // FILLED
                                        console.log(`Sell order ${sellOrderId} fully filled`);
                                    } else {
                                        await orderBook.updateOrderStatus(sellOrderId, 1, maxAmount); // PARTIALLY_FILLED
                                        console.log(`Sell order ${sellOrderId} partially filled`);
                                    }
                                    
                                } catch (error) {
                                    console.log(`❌ Trade failed: ${error.message}`);
                                    console.log("This might be due to insufficient balances in Settlement contract");
                                }
                            }
                        }
                    }
                }
            }
        }
        
        console.log("\n✅ Matching complete!");
        
    } catch (error) {
        console.error("❌ Matching failed:", error);
        process.exit(1);
    }
}

matchOrders();