// Package crypto 提供订单签名和验证功能
// 实现EIP-712类型化数据签名标准
package crypto

import (
	"crypto/ecdsa"
	"encoding/hex"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"golang.org/x/crypto/sha3"

	"orderbook-engine/internal/types"
)

// OrderSigner 订单签名器
// 实现EIP-712标准的类型化数据签名
type OrderSigner struct {
	chainID *big.Int         // 区块链网络ID
	domainSeparator [32]byte // EIP-712域分隔符
}

// NewOrderSigner 创建订单签名器
// @param chainID 区块链网络ID
// @param contractAddress 验证合约地址
// @return 订单签名器实例
func NewOrderSigner(chainID *big.Int, contractAddress common.Address) *OrderSigner {
	// 计算EIP-712域分隔符
	// 域类型哈希：EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)
	domainTypeHash := crypto.Keccak256Hash([]byte("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"))
	nameHash := crypto.Keccak256Hash([]byte("OrderBook DEX"))    // DEX名称
	versionHash := crypto.Keccak256Hash([]byte("1.0"))           // 版本号
	
	// 按照EIP-712标准正确计算域分隔符哈希
	// 需要直接连接各个哈希值和数据，而不是分别传递给Keccak256Hash
	var domainData []byte
	domainData = append(domainData, domainTypeHash.Bytes()...)
	domainData = append(domainData, nameHash.Bytes()...)
	domainData = append(domainData, versionHash.Bytes()...)
	domainData = append(domainData, common.LeftPadBytes(chainID.Bytes(), 32)...)
	domainData = append(domainData, common.LeftPadBytes(contractAddress.Bytes(), 32)...)
	domainSeparator := crypto.Keccak256Hash(domainData)

	return &OrderSigner{
		chainID: chainID,
		domainSeparator: domainSeparator,
	}
}

// HashOrder 计算订单哈希
// 使用EIP-712标准计算类型化数据哈希
// @param order 已签名订单
// @return 订单哈希值
func (s *OrderSigner) HashOrder(order *types.SignedOrder) (common.Hash, error) {
	// 订单类型哈希，定义订单结构 - 匹配Solidity合约
	orderTypeHash := crypto.Keccak256Hash([]byte(
		"Order(address userAddress,address baseToken,address quoteToken,uint8 side,uint8 orderType,uint256 price,uint256 amount,uint256 expiresAt,uint256 nonce)",
	))

	// 将订单数据转换为字节数组
	userAddress := common.HexToAddress(order.UserAddress)          // 用户地址
	baseToken := common.HexToAddress(order.BaseToken)              // 基础代币地址
	quoteToken := common.HexToAddress(order.QuoteToken)            // 报价代币地址
	
	// 转换订单方向：0=买入，1=卖出
	side := uint8(0)
	if order.Side == types.OrderSideSell {
		side = 1
	}
	
	// 转换订单类型：0=限价，1=市价，2=止损，3=止盈
	orderType := uint8(0)
	switch order.Type {
	case types.OrderTypeMarket:
		orderType = 1
	case types.OrderTypeStopLoss:
		orderType = 2
	case types.OrderTypeTakeProfit:
		orderType = 3
	}

	// 价格和数量直接使用decimal的BigInt值（前端已处理小数位）
	price := order.Price.BigInt()   // 价格不需要额外转换
	amount := order.Amount.BigInt() // 数量不需要额外转换
	
	// 过期时间转换为Unix时间戳
	expiresAt := big.NewInt(0)
	if order.ExpiresAt != nil {
		expiresAt = big.NewInt(order.ExpiresAt.Unix())
	}
	
	// 随机数
	nonce := big.NewInt(int64(order.Nonce))

	// 计算结构体哈希
	// 按照订单类型定义的顺序组装数据
	var structData []byte
	structData = append(structData, orderTypeHash.Bytes()...)
	structData = append(structData, common.LeftPadBytes(userAddress.Bytes(), 32)...)
	structData = append(structData, common.LeftPadBytes(baseToken.Bytes(), 32)...)
	structData = append(structData, common.LeftPadBytes(quoteToken.Bytes(), 32)...)
	structData = append(structData, common.LeftPadBytes([]byte{side}, 32)...)
	structData = append(structData, common.LeftPadBytes([]byte{orderType}, 32)...)
	structData = append(structData, common.LeftPadBytes(price.Bytes(), 32)...)
	structData = append(structData, common.LeftPadBytes(amount.Bytes(), 32)...)
	structData = append(structData, common.LeftPadBytes(expiresAt.Bytes(), 32)...)
	structData = append(structData, common.LeftPadBytes(nonce.Bytes(), 32)...)
	structHash := crypto.Keccak256Hash(structData)

	// 生成EIP-712类型化数据哈希
	// \x19\x01 是EIP-712的魔数前缀
	var finalData []byte
	finalData = append(finalData, []byte("\x19\x01")...)
	finalData = append(finalData, s.domainSeparator[:]...)
	finalData = append(finalData, structHash.Bytes()...)
	return crypto.Keccak256Hash(finalData), nil
}

// VerifyOrderSignature 验证订单签名
// 通过恢复签名的公钥地址，并与订单中的用户地址比较
// @param order 已签名订单
// @return 签名是否有效
func (s *OrderSigner) VerifyOrderSignature(order *types.SignedOrder) (bool, error) {
	// 计算订单哈希
	orderHash, err := s.HashOrder(order)
	if err != nil {
		return false, fmt.Errorf("failed to hash order: %w", err)
	}

	// 解码十六进制签名
	signature, err := hexutil.Decode(order.Signature)
	if err != nil {
		return false, fmt.Errorf("failed to decode signature: %w", err)
	}

	// 验证签名长度：65字节（r:32 + s:32 + v:1）
	if len(signature) != 65 {
		return false, fmt.Errorf("invalid signature length: %d", len(signature))
	}

	// 修正recovery ID（v值）
	// 以太坊签名的v值通常是27或28，需要转换为0或1
	if signature[64] >= 27 {
		signature[64] -= 27
	}

	// 从签名中恢复公钥
	pubkey, err := crypto.Ecrecover(orderHash.Bytes(), signature)
	if err != nil {
		return false, fmt.Errorf("failed to recover pubkey: %w", err)
	}

	// 解析公钥
	recoveredPubkey, err := crypto.UnmarshalPubkey(pubkey)
	if err != nil {
		return false, fmt.Errorf("failed to unmarshal pubkey: %w", err)
	}

	// 从公钥推导出地址
	recoveredAddress := crypto.PubkeyToAddress(*recoveredPubkey)
	expectedAddress := common.HexToAddress(order.UserAddress)

	// 比较恢复的地址与订单中的用户地址
	return recoveredAddress == expectedAddress, nil
}

// SignOrder 签名订单（仅用于测试）
// 使用私钥对订单进行签名
// @param order 待签名订单
// @param privateKey ECDSA私钥
// @param signer 订单签名器实例
// @return 签名错误
func SignOrder(order *types.SignedOrder, privateKey *ecdsa.PrivateKey, signer *OrderSigner) error {
	// 计算订单哈希
	orderHash, err := signer.HashOrder(order)
	if err != nil {
		return fmt.Errorf("failed to hash order: %w", err)
	}

	// 使用私钥签名
	signature, err := crypto.Sign(orderHash.Bytes(), privateKey)
	if err != nil {
		return fmt.Errorf("failed to sign order: %w", err)
	}

	// 调整recovery ID（v值）
	// 将标准的0/1转换为以太坊格式的27/28
	if signature[64] < 27 {
		signature[64] += 27
	}

	// 将签名编码为十六进制字符串
	order.Signature = hexutil.Encode(signature)
	return nil
}

// GenerateOrderHash 生成订单唯一哈希（用于数据库索引）
// 此哈希不同于EIP-712哈希，仅用于数据库查询和去重
// @param order 订单对象
// @return 订单的唯一标识哈希字符串
func GenerateOrderHash(order *types.SignedOrder) string {
	// 拼接订单关键字段
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
	
	// 使用Keccak256生成哈希
	hash := sha3.NewLegacyKeccak256()
	hash.Write([]byte(data))
	return hex.EncodeToString(hash.Sum(nil))
}