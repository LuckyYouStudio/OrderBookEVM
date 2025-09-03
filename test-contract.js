const { ethers } = require("hardhat");

async function testContracts() {
    try {
        console.log("Testing contract deployment...");
        
        // Get deployed contracts
        const usdcAddress = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853";
        const wethAddress = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";
        
        // Get signers
        const [signer] = await ethers.getSigners();
        console.log("Using account:", signer.address);
        
        // Connect to USDC contract
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const usdc = MockERC20.attach(usdcAddress);
        const weth = MockERC20.attach(wethAddress);
        
        // Test basic calls
        console.log("\n=== Testing USDC ===");
        const usdcName = await usdc.name();
        const usdcSymbol = await usdc.symbol();
        const usdcDecimals = await usdc.decimals();
        console.log(`Name: ${usdcName}, Symbol: ${usdcSymbol}, Decimals: ${usdcDecimals}`);
        
        console.log("\n=== Testing WETH ===");
        const wethName = await weth.name();
        const wethSymbol = await weth.symbol();
        const wethDecimals = await weth.decimals();
        console.log(`Name: ${wethName}, Symbol: ${wethSymbol}, Decimals: ${wethDecimals}`);
        
        // Test balance
        console.log("\n=== Testing Balances ===");
        const usdcBalance = await usdc.balanceOf(signer.address);
        const wethBalance = await weth.balanceOf(signer.address);
        console.log(`USDC Balance: ${ethers.formatUnits(usdcBalance, 6)}`);
        console.log(`WETH Balance: ${ethers.formatEther(wethBalance)}`);
        
        // Test minting
        console.log("\n=== Testing Minting ===");
        const mintAmount = ethers.parseUnits("1000", 6); // 1000 USDC
        const mintTx = await usdc.mint(signer.address, mintAmount);
        await mintTx.wait();
        console.log("Minted 1000 USDC");
        
        const newBalance = await usdc.balanceOf(signer.address);
        console.log(`New USDC Balance: ${ethers.formatUnits(newBalance, 6)}`);
        
        console.log("\n✅ All tests passed!");
        
    } catch (error) {
        console.error("❌ Test failed:", error);
        process.exit(1);
    }
}

testContracts();