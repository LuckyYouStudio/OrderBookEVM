package crypto

import (
	"crypto/ecdsa"
	"encoding/hex"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/crypto/secp256k1"
	"golang.org/x/crypto/sha3"

	"orderbook-engine/internal/types"
)

// OrderSigner 订单签名器
type OrderSigner struct {
	chainID *big.Int
	domainSeparator [32]byte
}

// NewOrderSigner 创建订单签名器
func NewOrderSigner(chainID *big.Int, contractAddress common.Address) *OrderSigner {
	// EIP-712 Domain Separator
	domainTypeHash := crypto.Keccak256Hash([]byte("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"))
	nameHash := crypto.Keccak256Hash([]byte("OrderBook DEX"))
	versionHash := crypto.Keccak256Hash([]byte("1.0"))
	
	domainSeparator := crypto.Keccak256Hash(
		domainTypeHash.Bytes(),
		nameHash.Bytes(),
		versionHash.Bytes(),
		common.LeftPadBytes(chainID.Bytes(), 32),
		contractAddress.Bytes(),
	)

	return &OrderSigner{
		chainID: chainID,
		domainSeparator: domainSeparator,
	}
}

// HashOrder 计算订单哈希
func (s *OrderSigner) HashOrder(order *types.SignedOrder) (common.Hash, error) {
	// Order type hash
	orderTypeHash := crypto.Keccak256Hash([]byte(
		"Order(address userAddress,string tradingPair,address baseToken,address quoteToken,uint8 side,uint8 orderType,uint256 price,uint256 amount,uint256 expiresAt,uint256 nonce)",
	))

	// Convert order data to bytes32
	userAddress := common.HexToAddress(order.UserAddress)
	tradingPairHash := crypto.Keccak256Hash([]byte(order.TradingPair))
	baseToken := common.HexToAddress(order.BaseToken)
	quoteToken := common.HexToAddress(order.QuoteToken)
	
	side := uint8(0)
	if order.Side == types.OrderSideSell {
		side = 1
	}
	
	orderType := uint8(0)
	switch order.Type {
	case types.OrderTypeMarket:
		orderType = 1
	case types.OrderTypeStopLoss:
		orderType = 2
	case types.OrderTypeTakeProfit:
		orderType = 3
	}

	// Convert decimal to wei (18 decimals)
	price := order.Price.Mul(decimal.NewFromInt(1e18)).BigInt()
	amount := order.Amount.Mul(decimal.NewFromInt(1e18)).BigInt()
	
	expiresAt := big.NewInt(0)
	if order.ExpiresAt != nil {
		expiresAt = big.NewInt(order.ExpiresAt.Unix())
	}
	
	nonce := big.NewInt(int64(order.Nonce))

	// Hash struct
	structHash := crypto.Keccak256Hash(
		orderTypeHash.Bytes(),
		userAddress.Bytes(),
		tradingPairHash.Bytes(),
		baseToken.Bytes(),
		quoteToken.Bytes(),
		common.LeftPadBytes([]byte{side}, 32),
		common.LeftPadBytes([]byte{orderType}, 32),
		common.LeftPadBytes(price.Bytes(), 32),
		common.LeftPadBytes(amount.Bytes(), 32),
		common.LeftPadBytes(expiresAt.Bytes(), 32),
		common.LeftPadBytes(nonce.Bytes(), 32),
	)

	// EIP-712 typed data hash
	return crypto.Keccak256Hash(
		[]byte("\x19\x01"),
		s.domainSeparator[:],
		structHash.Bytes(),
	), nil
}

// VerifyOrderSignature 验证订单签名
func (s *OrderSigner) VerifyOrderSignature(order *types.SignedOrder) (bool, error) {
	// 计算订单哈希
	orderHash, err := s.HashOrder(order)
	if err != nil {
		return false, fmt.Errorf("failed to hash order: %w", err)
	}

	// 解码签名
	signature, err := hexutil.Decode(order.Signature)
	if err != nil {
		return false, fmt.Errorf("failed to decode signature: %w", err)
	}

	if len(signature) != 65 {
		return false, fmt.Errorf("invalid signature length: %d", len(signature))
	}

	// 修正 recovery ID
	if signature[64] >= 27 {
		signature[64] -= 27
	}

	// 恢复公钥
	pubkey, err := secp256k1.RecoverPubkey(orderHash.Bytes(), signature)
	if err != nil {
		return false, fmt.Errorf("failed to recover pubkey: %w", err)
	}

	// 获取地址
	recoveredPubkey, err := crypto.UnmarshalPubkey(pubkey)
	if err != nil {
		return false, fmt.Errorf("failed to unmarshal pubkey: %w", err)
	}

	recoveredAddress := crypto.PubkeyToAddress(*recoveredPubkey)
	expectedAddress := common.HexToAddress(order.UserAddress)

	return recoveredAddress == expectedAddress, nil
}

// SignOrder 签名订单（仅用于测试）
func SignOrder(order *types.SignedOrder, privateKey *ecdsa.PrivateKey, signer *OrderSigner) error {
	orderHash, err := signer.HashOrder(order)
	if err != nil {
		return fmt.Errorf("failed to hash order: %w", err)
	}

	signature, err := crypto.Sign(orderHash.Bytes(), privateKey)
	if err != nil {
		return fmt.Errorf("failed to sign order: %w", err)
	}

	// 调整 recovery ID
	if signature[64] < 27 {
		signature[64] += 27
	}

	order.Signature = hexutil.Encode(signature)
	return nil
}

// GenerateOrderHash 生成订单唯一哈希（用于数据库索引）
func GenerateOrderHash(order *types.SignedOrder) string {
	data := fmt.Sprintf("%s%s%s%s%d%d%s%s%d%d",
		order.UserAddress,
		order.TradingPair,
		order.BaseToken,
		order.QuoteToken,
		order.Side,
		order.Type,
		order.Price.String(),
		order.Amount.String(),
		order.ExpiresAt.Unix(),
		order.Nonce,
	)
	
	hash := sha3.NewLegacyKeccak256()
	hash.Write([]byte(data))
	return hex.EncodeToString(hash.Sum(nil))
}