const { ethers } = require("hardhat");

async function main() {
  // Contract addresses (update these after deployment)
  const addresses = {
    tokenRegistry: process.env.TOKEN_REGISTRY_ADDRESS,
    orderBook: process.env.ORDER_BOOK_ADDRESS,
    settlement: process.env.SETTLEMENT_ADDRESS,
    orderMatching: process.env.ORDER_MATCHING_ADDRESS,
    usdc: process.env.USDC_ADDRESS,
    weth: process.env.WETH_ADDRESS
  };

  const [signer] = await ethers.getSigners();
  console.log("Interacting with contracts as:", signer.address);

  // Get contract instances
  const OrderBook = await ethers.getContractFactory("OrderBook");
  const orderBook = OrderBook.attach(addresses.orderBook);

  const Settlement = await ethers.getContractFactory("Settlement");
  const settlement = Settlement.attach(addresses.settlement);

  const OrderMatching = await ethers.getContractFactory("OrderMatching");
  const orderMatching = OrderMatching.attach(addresses.orderMatching);

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = MockERC20.attach(addresses.usdc);
  const weth = MockERC20.attach(addresses.weth);

  console.log("\n=== Token Balances ===");
  const usdcBalance = await usdc.balanceOf(signer.address);
  const wethBalance = await weth.balanceOf(signer.address);
  console.log("USDC Balance:", ethers.formatUnits(usdcBalance, 6));
  console.log("WETH Balance:", ethers.formatEther(wethBalance));

  // Deposit tokens to settlement contract
  console.log("\n=== Depositing Tokens ===");
  const depositAmount = ethers.parseUnits("1000", 6); // 1000 USDC
  
  await usdc.approve(addresses.settlement, depositAmount);
  await settlement.deposit(addresses.usdc, depositAmount);
  console.log("Deposited 1000 USDC to settlement contract");

  const wethDepositAmount = ethers.parseEther("1"); // 1 WETH
  await weth.approve(addresses.settlement, wethDepositAmount);
  await settlement.deposit(addresses.weth, wethDepositAmount);
  console.log("Deposited 1 WETH to settlement contract");

  // Check settlement balances
  const settlementUsdcBalance = await settlement.getUserBalance(signer.address, addresses.usdc);
  const settlementWethBalance = await settlement.getUserBalance(signer.address, addresses.weth);
  console.log("Settlement USDC Balance:", ethers.formatUnits(settlementUsdcBalance, 6));
  console.log("Settlement WETH Balance:", ethers.formatEther(settlementWethBalance));

  // Place a limit order
  console.log("\n=== Placing Limit Orders ===");
  const price = ethers.parseUnits("2000", 6); // 2000 USDC per WETH
  const amount = ethers.parseUnits("0.1", 18); // 0.1 WETH

  const tx = await orderBook.placeOrder(
    addresses.weth, // tokenA (selling WETH)
    addresses.usdc, // tokenB (for USDC)
    price,
    amount,
    false, // sell order
    0, // LIMIT order type
    0 // no expiration
  );
  
  const receipt = await tx.wait();
  console.log("Sell order placed. Transaction:", receipt.hash);

  // Place a buy order
  const buyAmount = ethers.parseUnits("0.05", 18); // 0.05 WETH
  const buyPrice = ethers.parseUnits("1900", 6); // 1900 USDC per WETH

  const buyTx = await orderBook.placeOrder(
    addresses.weth, // tokenA (buying WETH)
    addresses.usdc, // tokenB (with USDC)
    buyPrice,
    buyAmount,
    true, // buy order
    0, // LIMIT order type
    0 // no expiration
  );
  
  const buyReceipt = await buyTx.wait();
  console.log("Buy order placed. Transaction:", buyReceipt.hash);

  // Get user orders
  console.log("\n=== User Orders ===");
  const userOrders = await orderBook.getUserOrders(signer.address);
  console.log("User has", userOrders.length, "orders");

  for (let i = 0; i < userOrders.length; i++) {
    const order = await orderBook.getOrder(userOrders[i]);
    console.log(`Order ${i + 1}:`, {
      id: order.orderId.toString(),
      isBuy: order.isBuy,
      price: ethers.formatUnits(order.price, 6),
      amount: ethers.formatEther(order.amount),
      status: order.status
    });
  }

  // Try to match orders
  console.log("\n=== Matching Orders ===");
  const matchTx = await orderMatching.matchOrders(addresses.weth, addresses.usdc);
  const matchReceipt = await matchTx.wait();
  console.log("Order matching attempted. Transaction:", matchReceipt.hash);

  // Check updated balances
  console.log("\n=== Updated Balances ===");
  const updatedUsdcBalance = await settlement.getUserBalance(signer.address, addresses.usdc);
  const updatedWethBalance = await settlement.getUserBalance(signer.address, addresses.weth);
  console.log("Settlement USDC Balance:", ethers.formatUnits(updatedUsdcBalance, 6));
  console.log("Settlement WETH Balance:", ethers.formatEther(updatedWethBalance));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });