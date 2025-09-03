package blockchain

import (
	"context"
	"crypto/ecdsa"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/sirupsen/logrus"
)

// Client Ethereum客户端
type Client struct {
	client           *ethclient.Client
	chainID          *big.Int
	privateKey       *ecdsa.PrivateKey
	address          common.Address
	orderBookAddress common.Address
	settlementAddress common.Address
	logger           *logrus.Logger
	
	orderBookABI abi.ABI
	settlementABI abi.ABI
}

// OrderEvent 订单事件
type OrderEvent struct {
	OrderID     *big.Int
	Trader      common.Address
	TokenA      common.Address
	TokenB      common.Address
	Price       *big.Int
	Amount      *big.Int
	IsBuy       bool
	OrderType   uint8
	Timestamp   uint64
}

// TradeEvent 交易事件
type TradeEvent struct {
	OrderID     *big.Int
	Buyer       common.Address
	Seller      common.Address
	TokenA      common.Address
	TokenB      common.Address
	Amount      *big.Int
	Price       *big.Int
	Timestamp   uint64
}

// NewClient 创建区块链客户端
func NewClient(rpcURL string, chainID *big.Int, privateKeyHex string, orderBookAddr, settlementAddr string, logger *logrus.Logger) (*Client, error) {
	// 连接到以太坊节点
	client, err := ethclient.Dial(rpcURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to ethereum node: %v", err)
	}

	// 解析私钥
	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		return nil, fmt.Errorf("invalid private key: %v", err)
	}

	// 获取地址
	publicKey := privateKey.Public()
	publicKeyECDSA, ok := publicKey.(*ecdsa.PublicKey)
	if !ok {
		return nil, fmt.Errorf("cannot assert type: publicKey is not of type *ecdsa.PublicKey")
	}
	address := crypto.PubkeyToAddress(*publicKeyECDSA)

	// 解析ABI
	orderBookABI, err := parseOrderBookABI()
	if err != nil {
		return nil, fmt.Errorf("failed to parse OrderBook ABI: %v", err)
	}

	settlementABI, err := parseSettlementABI()
	if err != nil {
		return nil, fmt.Errorf("failed to parse Settlement ABI: %v", err)
	}

	return &Client{
		client:            client,
		chainID:           chainID,
		privateKey:        privateKey,
		address:           address,
		orderBookAddress:  common.HexToAddress(orderBookAddr),
		settlementAddress: common.HexToAddress(settlementAddr),
		logger:            logger,
		orderBookABI:      orderBookABI,
		settlementABI:     settlementABI,
	}, nil
}

// ExecuteTrade 执行交易
func (c *Client) ExecuteTrade(buyer, seller common.Address, tokenA, tokenB common.Address, amount, price *big.Int, buyerIsMaker bool) (*types.Transaction, error) {
	auth, err := c.getTransactOpts()
	if err != nil {
		return nil, err
	}

	// 调用Settlement合约的executeTrade方法
	data, err := c.settlementABI.Pack("executeTrade", buyer, seller, tokenA, tokenB, amount, price, buyerIsMaker)
	if err != nil {
		return nil, fmt.Errorf("failed to pack transaction data: %v", err)
	}

	tx := types.NewTransaction(
		auth.Nonce.Uint64(),
		c.settlementAddress,
		big.NewInt(0),
		auth.GasLimit,
		auth.GasPrice,
		data,
	)

	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(c.chainID), c.privateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to sign transaction: %v", err)
	}

	err = c.client.SendTransaction(context.Background(), signedTx)
	if err != nil {
		return nil, fmt.Errorf("failed to send transaction: %v", err)
	}

	c.logger.WithFields(logrus.Fields{
		"tx_hash": signedTx.Hash().Hex(),
		"buyer":   buyer.Hex(),
		"seller":  seller.Hex(),
		"amount":  amount.String(),
		"price":   price.String(),
	}).Info("Trade transaction sent")

	return signedTx, nil
}

// UpdateOrderStatus 更新订单状态
func (c *Client) UpdateOrderStatus(orderID *big.Int, status uint8, filledAmount *big.Int) (*types.Transaction, error) {
	auth, err := c.getTransactOpts()
	if err != nil {
		return nil, err
	}

	data, err := c.orderBookABI.Pack("updateOrderStatus", orderID, status, filledAmount)
	if err != nil {
		return nil, fmt.Errorf("failed to pack transaction data: %v", err)
	}

	tx := types.NewTransaction(
		auth.Nonce.Uint64(),
		c.orderBookAddress,
		big.NewInt(0),
		auth.GasLimit,
		auth.GasPrice,
		data,
	)

	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(c.chainID), c.privateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to sign transaction: %v", err)
	}

	err = c.client.SendTransaction(context.Background(), signedTx)
	if err != nil {
		return nil, fmt.Errorf("failed to send transaction: %v", err)
	}

	return signedTx, nil
}

// SubscribeToOrderEvents 监听订单事件
func (c *Client) SubscribeToOrderEvents(ctx context.Context, eventChan chan<- *OrderEvent) error {
	query := ethereum.FilterQuery{
		Addresses: []common.Address{c.orderBookAddress},
		Topics: [][]common.Hash{
			{crypto.Keccak256Hash([]byte("OrderPlaced(uint256,address,address,address,uint256,uint256,bool,uint8,uint256)"))},
		},
	}

	logs := make(chan types.Log)
	sub, err := c.client.SubscribeFilterLogs(ctx, query, logs)
	if err != nil {
		return fmt.Errorf("failed to subscribe to logs: %v", err)
	}

	go func() {
		defer sub.Unsubscribe()
		for {
			select {
			case err := <-sub.Err():
				c.logger.WithError(err).Error("Subscription error")
				return
			case vLog := <-logs:
				event, err := c.parseOrderEvent(vLog)
				if err != nil {
					c.logger.WithError(err).Error("Failed to parse order event")
					continue
				}
				
				select {
				case eventChan <- event:
				case <-ctx.Done():
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	return nil
}

// getTransactOpts 获取交易选项
func (c *Client) getTransactOpts() (*bind.TransactOpts, error) {
	nonce, err := c.client.PendingNonceAt(context.Background(), c.address)
	if err != nil {
		return nil, err
	}

	gasPrice, err := c.client.SuggestGasPrice(context.Background())
	if err != nil {
		return nil, err
	}

	auth, err := bind.NewKeyedTransactorWithChainID(c.privateKey, c.chainID)
	if err != nil {
		return nil, err
	}

	auth.Nonce = big.NewInt(int64(nonce))
	auth.Value = big.NewInt(0)
	auth.GasLimit = uint64(500000)
	auth.GasPrice = gasPrice

	return auth, nil
}

// parseOrderEvent 解析订单事件
func (c *Client) parseOrderEvent(vLog types.Log) (*OrderEvent, error) {
	event := &OrderEvent{}
	
	err := c.orderBookABI.UnpackIntoInterface(event, "OrderPlaced", vLog.Data)
	if err != nil {
		return nil, err
	}

	// 从topics中提取indexed参数
	if len(vLog.Topics) > 1 {
		event.OrderID = new(big.Int).SetBytes(vLog.Topics[1].Bytes())
	}

	return event, nil
}

// parseOrderBookABI 解析OrderBook合约ABI
func parseOrderBookABI() (abi.ABI, error) {
	abiJSON := `[
		{
			"inputs": [
				{"indexed": true, "internalType": "uint256", "name": "orderId", "type": "uint256"},
				{"indexed": false, "internalType": "address", "name": "trader", "type": "address"},
				{"indexed": false, "internalType": "address", "name": "tokenA", "type": "address"},
				{"indexed": false, "internalType": "address", "name": "tokenB", "type": "address"},
				{"indexed": false, "internalType": "uint256", "name": "price", "type": "uint256"},
				{"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"},
				{"indexed": false, "internalType": "bool", "name": "isBuy", "type": "bool"},
				{"indexed": false, "internalType": "uint8", "name": "orderType", "type": "uint8"},
				{"indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256"}
			],
			"name": "OrderPlaced",
			"type": "event"
		},
		{
			"inputs": [
				{"internalType": "uint256", "name": "orderId", "type": "uint256"},
				{"internalType": "uint8", "name": "status", "type": "uint8"},
				{"internalType": "uint256", "name": "filledAmount", "type": "uint256"}
			],
			"name": "updateOrderStatus",
			"outputs": [],
			"stateMutability": "nonpayable",
			"type": "function"
		}
	]`
	
	return abi.JSON(strings.NewReader(abiJSON))
}

// parseSettlementABI 解析Settlement合约ABI
func parseSettlementABI() (abi.ABI, error) {
	abiJSON := `[
		{
			"inputs": [
				{"internalType": "address", "name": "buyer", "type": "address"},
				{"internalType": "address", "name": "seller", "type": "address"},
				{"internalType": "address", "name": "tokenA", "type": "address"},
				{"internalType": "address", "name": "tokenB", "type": "address"},
				{"internalType": "uint256", "name": "amount", "type": "uint256"},
				{"internalType": "uint256", "name": "price", "type": "uint256"},
				{"internalType": "bool", "name": "buyerIsMaker", "type": "bool"}
			],
			"name": "executeTrade",
			"outputs": [],
			"stateMutability": "nonpayable",
			"type": "function"
		}
	]`
	
	return abi.JSON(strings.NewReader(abiJSON))
}

// Close 关闭客户端
func (c *Client) Close() {
	if c.client != nil {
		c.client.Close()
	}
}