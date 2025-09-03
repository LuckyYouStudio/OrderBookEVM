const { ethers, upgrades } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // Deploy TokenRegistry
  console.log("\nDeploying TokenRegistry...");
  const TokenRegistry = await ethers.getContractFactory("TokenRegistry");
  const tokenRegistry = await upgrades.deployProxy(TokenRegistry, [], {
    initializer: "initialize"
  });
  await tokenRegistry.waitForDeployment();
  console.log("TokenRegistry deployed to:", await tokenRegistry.getAddress());

  // Deploy OptimizedSettlement (核心结算合约)
  console.log("\nDeploying OptimizedSettlement...");
  const Settlement = await ethers.getContractFactory("OptimizedSettlement");
  const settlement = await upgrades.deployProxy(Settlement, [deployer.address, deployer.address], {
    initializer: "initialize"
  });
  await settlement.waitForDeployment();
  console.log("Settlement deployed to:", await settlement.getAddress());

  // OrderMatching contract was removed, using zero address for now
  const orderMatchingAddress = ethers.ZeroAddress;
  console.log("OrderMatching address set to:", orderMatchingAddress, "(disabled)");

  // Contract configuration
  console.log("\nContract setup completed:");
  console.log("- TokenRegistry: Token management");
  console.log("- OptimizedSettlement: EIP-712 verification & atomic swaps");
  console.log("- OrderBook: Handled by off-chain matching engine");

  // Deploy mock tokens for testing
  let usdc, weth;
  if (network.name === "hardhat" || network.name === "localhost") {
    console.log("\nDeploying mock tokens...");
    
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    
    usdc = await MockERC20.deploy(
      "USD Coin",
      "USDC",
      6,
      ethers.parseUnits("1000000", 6)
    );
    await usdc.waitForDeployment();
    console.log("Mock USDC deployed to:", await usdc.getAddress());

    weth = await MockERC20.deploy(
      "Wrapped Ether",
      "WETH",
      18,
      ethers.parseEther("10000")
    );
    await weth.waitForDeployment();
    console.log("Mock WETH deployed to:", await weth.getAddress());

    // Add tokens to registry
    await tokenRegistry.addToken(
      await usdc.getAddress(),
      ethers.parseUnits("1", 6),
      ethers.parseUnits("1000000", 6),
      ethers.parseUnits("10000000", 6),
      false
    );

    await tokenRegistry.addToken(
      await weth.getAddress(),
      ethers.parseUnits("0.001", 18),
      ethers.parseUnits("1000", 18),
      ethers.parseUnits("10000", 18),
      false
    );

    // Add trading pair
    await tokenRegistry.addTradingPair(
      await weth.getAddress(),
      await usdc.getAddress(),
      ethers.parseUnits("1000", 6),
      ethers.parseUnits("10000", 6),
      ethers.parseUnits("0.01", 6)
    );

    console.log("Mock tokens added to registry");
  }

  console.log("\nDeployment Summary:");
  console.log("==================");
  console.log("TokenRegistry:", await tokenRegistry.getAddress());
  console.log("OptimizedSettlement:", await settlement.getAddress());
  console.log("OrderBook: Off-chain (Matching Engine)");
  
  if (network.name === "hardhat" || network.name === "localhost") {
    console.log("Mock USDC:", await usdc.getAddress());
    console.log("Mock WETH:", await weth.getAddress());
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });