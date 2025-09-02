// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract TokenRegistry is 
    Initializable, 
    AccessControlUpgradeable, 
    PausableUpgradeable 
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    
    struct TokenInfo {
        bool isActive;
        uint8 decimals;
        string symbol;
        string name;
        uint256 minOrderSize;
        uint256 maxOrderSize;
        uint256 dailyVolumeLimit;
        uint256 currentDailyVolume;
        uint256 lastVolumeResetTime;
        bool requiresKYC;
    }
    
    struct TradingPair {
        bool isActive;
        uint256 minPrice;
        uint256 maxPrice;
        uint256 tickSize;
        uint256 makerFeeOverride;
        uint256 takerFeeOverride;
        bool useFeeOverride;
    }
    
    mapping(address => TokenInfo) public tokens;
    mapping(address => mapping(address => TradingPair)) public tradingPairs;
    
    address[] public tokenList;
    mapping(address => bool) public isListed;
    
    mapping(address => bool) public kycVerified;
    
    event TokenAdded(
        address indexed token,
        string symbol,
        string name,
        uint8 decimals
    );
    
    event TokenUpdated(address indexed token, bool isActive);
    
    event TradingPairAdded(
        address indexed tokenA,
        address indexed tokenB,
        uint256 minPrice,
        uint256 maxPrice
    );
    
    event TradingPairUpdated(
        address indexed tokenA,
        address indexed tokenB,
        bool isActive
    );
    
    event KYCStatusUpdated(address indexed user, bool verified);
    
    function initialize() public initializer {
        __AccessControl_init();
        __Pausable_init();
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }
    
    function addToken(
        address token,
        uint256 minOrderSize,
        uint256 maxOrderSize,
        uint256 dailyVolumeLimit,
        bool requiresKYC
    ) external onlyRole(ADMIN_ROLE) {
        require(token != address(0), "Invalid token address");
        require(!isListed[token], "Token already listed");
        require(minOrderSize > 0, "Invalid min order size");
        require(maxOrderSize > minOrderSize, "Invalid max order size");
        
        IERC20Metadata tokenContract = IERC20Metadata(token);
        
        tokens[token] = TokenInfo({
            isActive: true,
            decimals: tokenContract.decimals(),
            symbol: tokenContract.symbol(),
            name: tokenContract.name(),
            minOrderSize: minOrderSize,
            maxOrderSize: maxOrderSize,
            dailyVolumeLimit: dailyVolumeLimit,
            currentDailyVolume: 0,
            lastVolumeResetTime: block.timestamp,
            requiresKYC: requiresKYC
        });
        
        tokenList.push(token);
        isListed[token] = true;
        
        emit TokenAdded(
            token,
            tokens[token].symbol,
            tokens[token].name,
            tokens[token].decimals
        );
    }
    
    function updateTokenStatus(
        address token,
        bool isActive
    ) external onlyRole(OPERATOR_ROLE) {
        require(isListed[token], "Token not listed");
        tokens[token].isActive = isActive;
        emit TokenUpdated(token, isActive);
    }
    
    function updateTokenLimits(
        address token,
        uint256 minOrderSize,
        uint256 maxOrderSize,
        uint256 dailyVolumeLimit
    ) external onlyRole(ADMIN_ROLE) {
        require(isListed[token], "Token not listed");
        require(minOrderSize > 0, "Invalid min order size");
        require(maxOrderSize > minOrderSize, "Invalid max order size");
        
        TokenInfo storage tokenInfo = tokens[token];
        tokenInfo.minOrderSize = minOrderSize;
        tokenInfo.maxOrderSize = maxOrderSize;
        tokenInfo.dailyVolumeLimit = dailyVolumeLimit;
    }
    
    function addTradingPair(
        address tokenA,
        address tokenB,
        uint256 minPrice,
        uint256 maxPrice,
        uint256 tickSize
    ) external onlyRole(ADMIN_ROLE) {
        require(isListed[tokenA] && isListed[tokenB], "Token not listed");
        require(tokenA != tokenB, "Same token");
        require(minPrice > 0 && maxPrice > minPrice, "Invalid price range");
        require(tickSize > 0, "Invalid tick size");
        
        tradingPairs[tokenA][tokenB] = TradingPair({
            isActive: true,
            minPrice: minPrice,
            maxPrice: maxPrice,
            tickSize: tickSize,
            makerFeeOverride: 0,
            takerFeeOverride: 0,
            useFeeOverride: false
        });
        
        tradingPairs[tokenB][tokenA] = TradingPair({
            isActive: true,
            minPrice: 1e36 / maxPrice,
            maxPrice: 1e36 / minPrice,
            tickSize: tickSize,
            makerFeeOverride: 0,
            takerFeeOverride: 0,
            useFeeOverride: false
        });
        
        emit TradingPairAdded(tokenA, tokenB, minPrice, maxPrice);
    }
    
    function updateTradingPairStatus(
        address tokenA,
        address tokenB,
        bool isActive
    ) external onlyRole(OPERATOR_ROLE) {
        tradingPairs[tokenA][tokenB].isActive = isActive;
        tradingPairs[tokenB][tokenA].isActive = isActive;
        emit TradingPairUpdated(tokenA, tokenB, isActive);
    }
    
    function setTradingPairFees(
        address tokenA,
        address tokenB,
        uint256 makerFee,
        uint256 takerFee,
        bool useFeeOverride
    ) external onlyRole(ADMIN_ROLE) {
        require(makerFee <= 500 && takerFee <= 500, "Fee too high");
        
        TradingPair storage pair = tradingPairs[tokenA][tokenB];
        pair.makerFeeOverride = makerFee;
        pair.takerFeeOverride = takerFee;
        pair.useFeeOverride = useFeeOverride;
        
        TradingPair storage reversePair = tradingPairs[tokenB][tokenA];
        reversePair.makerFeeOverride = makerFee;
        reversePair.takerFeeOverride = takerFee;
        reversePair.useFeeOverride = useFeeOverride;
    }
    
    function updateKYCStatus(
        address user,
        bool verified
    ) external onlyRole(OPERATOR_ROLE) {
        kycVerified[user] = verified;
        emit KYCStatusUpdated(user, verified);
    }
    
    function batchUpdateKYCStatus(
        address[] calldata users,
        bool[] calldata statuses
    ) external onlyRole(OPERATOR_ROLE) {
        require(users.length == statuses.length, "Length mismatch");
        require(users.length <= 100, "Batch too large");
        
        for (uint256 i = 0; i < users.length; i++) {
            kycVerified[users[i]] = statuses[i];
            emit KYCStatusUpdated(users[i], statuses[i]);
        }
    }
    
    function isValidOrder(
        address trader,
        address tokenA,
        address tokenB,
        uint256 amount,
        uint256 price
    ) external view returns (bool valid, string memory reason) {
        if (!tokens[tokenA].isActive) {
            return (false, "TokenA not active");
        }
        
        if (!tokens[tokenB].isActive) {
            return (false, "TokenB not active");
        }
        
        if (!tradingPairs[tokenA][tokenB].isActive) {
            return (false, "Trading pair not active");
        }
        
        TokenInfo memory tokenInfo = tokens[tokenA];
        
        if (tokenInfo.requiresKYC && !kycVerified[trader]) {
            return (false, "KYC required");
        }
        
        if (amount < tokenInfo.minOrderSize) {
            return (false, "Below minimum order size");
        }
        
        if (amount > tokenInfo.maxOrderSize) {
            return (false, "Above maximum order size");
        }
        
        TradingPair memory pair = tradingPairs[tokenA][tokenB];
        
        if (price < pair.minPrice) {
            return (false, "Price below minimum");
        }
        
        if (price > pair.maxPrice) {
            return (false, "Price above maximum");
        }
        
        if (price % pair.tickSize != 0) {
            return (false, "Invalid price tick");
        }
        
        return (true, "");
    }
    
    function updateDailyVolume(
        address token,
        uint256 volume
    ) external onlyRole(OPERATOR_ROLE) {
        TokenInfo storage tokenInfo = tokens[token];
        
        if (block.timestamp >= tokenInfo.lastVolumeResetTime + 1 days) {
            tokenInfo.currentDailyVolume = volume;
            tokenInfo.lastVolumeResetTime = block.timestamp;
        } else {
            tokenInfo.currentDailyVolume += volume;
        }
        
        require(
            tokenInfo.dailyVolumeLimit == 0 || 
            tokenInfo.currentDailyVolume <= tokenInfo.dailyVolumeLimit,
            "Daily volume limit exceeded"
        );
    }
    
    function getTokenList() external view returns (address[] memory) {
        return tokenList;
    }
    
    function getActiveTokens() external view returns (address[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokens[tokenList[i]].isActive) {
                activeCount++;
            }
        }
        
        address[] memory activeTokens = new address[](activeCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokens[tokenList[i]].isActive) {
                activeTokens[index] = tokenList[i];
                index++;
            }
        }
        
        return activeTokens;
    }
    
    function getTradingPairInfo(
        address tokenA,
        address tokenB
    ) external view returns (
        bool isActive,
        uint256 minPrice,
        uint256 maxPrice,
        uint256 tickSize,
        uint256 makerFee,
        uint256 takerFee
    ) {
        TradingPair memory pair = tradingPairs[tokenA][tokenB];
        return (
            pair.isActive,
            pair.minPrice,
            pair.maxPrice,
            pair.tickSize,
            pair.useFeeOverride ? pair.makerFeeOverride : 0,
            pair.useFeeOverride ? pair.takerFeeOverride : 0
        );
    }
    
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
}