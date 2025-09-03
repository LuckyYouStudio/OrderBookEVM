// 合约ABI文件 - 导出主要合约的接口定义

// ERC20代币标准ABI（简化版，包含测试用的mint函数）
export const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount) external",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)"
]

// OrderBook合约ABI（主要功能）
export const ORDERBOOK_ABI = [
  "function placeOrder(address tokenA, address tokenB, uint256 price, uint256 amount, bool isBuy, uint8 orderType, uint256 expirationTime) external returns (uint256)",
  "function cancelOrder(uint256 orderId) external",
  "function getOrder(uint256 orderId) view returns (tuple(uint256 orderId, address trader, address tokenA, address tokenB, uint256 price, uint256 amount, uint256 filledAmount, uint8 orderType, uint256 timestamp, uint256 expirationTime, uint8 status, bool isBuy))",
  "function getUserOrders(address trader) view returns (uint256[])",
  "function getSellOrdersAtPrice(address tokenA, address tokenB, uint256 price) view returns (uint256[])",
  "function getBuyOrdersAtPrice(address tokenA, address tokenB, uint256 price) view returns (uint256[])",
  "function getBuyPriceLevels(address tokenA, address tokenB, uint256 limit) view returns (uint256[])",
  "function getSellPriceLevels(address tokenA, address tokenB, uint256 limit) view returns (uint256[])",
  "function bestBid(address tokenA, address tokenB) view returns (uint256)",
  "function bestAsk(address tokenA, address tokenB) view returns (uint256)",
  "function settlement() view returns (address)",
  "event OrderPlaced(uint256 indexed orderId, address indexed trader, address indexed tokenA, address tokenB, uint256 price, uint256 amount, bool isBuy, uint8 orderType)",
  "event OrderCancelled(uint256 indexed orderId, address indexed trader)",
  "event OrderFilled(uint256 indexed orderId)",
  "event OrderPartiallyFilled(uint256 indexed orderId, uint256 filledAmount, uint256 remainingAmount)"
]

// Settlement合约ABI（存取款和交易结算）
export const SETTLEMENT_ABI = [
  "function deposit(address token, uint256 amount) external",
  "function withdraw(address token, uint256 amount) external",
  "function batchDeposit(address[] tokens, uint256[] amounts) external",
  "function batchWithdraw(address[] tokens, uint256[] amounts) external",
  "function getUserBalance(address user, address token) view returns (uint256)",
  "function executeTrade(address buyer, address seller, address tokenA, address tokenB, uint256 amount, uint256 price, bool buyerIsMaker) external",
  "function requestEmergencyWithdrawal() external",
  "function executeEmergencyWithdrawal(address token) external",
  "function collectedFees(address token) view returns (uint256)",
  "function makerFee() view returns (uint256)",
  "function takerFee() view returns (uint256)",
  "event Deposit(address indexed user, address indexed token, uint256 amount)",
  "event Withdrawal(address indexed user, address indexed token, uint256 amount)",
  "event TradeExecuted(address indexed buyer, address indexed seller, address indexed tokenA, address tokenB, uint256 amount, uint256 price)"
]

// TokenRegistry合约ABI（代币管理）
export const TOKEN_REGISTRY_ABI = [
  "function addToken(address token, uint256 minOrderSize, uint256 maxOrderSize, uint256 dailyLimit, bool kycRequired) external",
  "function removeToken(address token) external",
  "function addTradingPair(address baseToken, address quoteToken, uint256 minNotional, uint256 maxNotional, uint256 tickSize) external",
  "function removeTradingPair(address baseToken, address quoteToken) external",
  "function isTokenListed(address token) view returns (bool)",
  "function isTradingPairActive(address baseToken, address quoteToken) view returns (bool)",
  "function getTokenInfo(address token) view returns (tuple(uint256 minOrderSize, uint256 maxOrderSize, uint256 dailyLimit, bool kycRequired, bool isActive))",
  "function getTradingPairInfo(address baseToken, address quoteToken) view returns (tuple(uint256 minNotional, uint256 maxNotional, uint256 tickSize, bool isActive))",
  "event TokenAdded(address indexed token)",
  "event TokenRemoved(address indexed token)",
  "event TradingPairAdded(address indexed baseToken, address indexed quoteToken)",
  "event TradingPairRemoved(address indexed baseToken, address indexed quoteToken)"
]