module orderbook-engine

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/gorilla/websocket v1.5.1
	github.com/redis/go-redis/v9 v9.4.0
	github.com/ethereum/go-ethereum v1.13.10
	github.com/shopspring/decimal v1.3.1
	github.com/google/uuid v1.5.0
	github.com/sirupsen/logrus v1.9.3
	github.com/spf13/viper v1.18.2
	go.uber.org/zap v1.26.0
	github.com/stretchr/testify v1.8.4
	gorm.io/gorm v1.25.5
	gorm.io/driver/postgres v1.5.4
)