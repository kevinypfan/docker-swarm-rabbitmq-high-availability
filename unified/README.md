# RabbitMQ Tester

一個統一的 RabbitMQ 測試工具，可以透過環境變數控制為 Producer、Consumer 或混合模式運行，專為高可用性測試設計。

## 🚀 特色功能

- **統一應用程式**: 單一 Docker 映像，支援 Producer、Consumer 或混合模式
- **高可用性**: 支援多個 RabbitMQ 節點的自動故障轉移
- **自動重連**: 內建重連機制，確保連接穩定性
- **REST API**: Producer 模式提供 HTTP API 介面
- **健康檢查**: 內建健康檢查端點
- **優雅關閉**: 支援 SIGINT/SIGTERM 信號處理

## 📦 Docker Hub

```bash
docker pull kevinypfan/rabbitmq-tester:latest
```

## 🛠️ 使用方式

### 環境變數

| 變數名稱 | 預設值 | 說明 |
|---------|--------|------|
| `MODE` | `consumer` | 運行模式: `consumer`, `producer`, `both` |
| `NODE_ENV` | `production` | Node.js 環境 |
| `RABBITMQ_URL` | `amqp://admin:test1234@localhost:5672` | RabbitMQ 連接字串（支援多個主機，用逗號分隔） |
| `QUEUE_NAME` | `test-queue` | Queue 名稱 |
| `EXCHANGE_NAME` | `test-exchange` | Exchange 名稱 |
| `ROUTING_KEY` | `test.message` | Routing Key |
| `PORT` | `3000` | Producer API 端口 |
| `AUTO_SEND` | `false` | 是否啟用自動發送訊息 |
| `AUTO_SEND_INTERVAL` | `10000` | 自動發送間隔（毫秒） |

### Consumer 模式

```bash
docker run -d \
  -e MODE=consumer \
  -e RABBITMQ_URL=amqp://admin:test1234@rabbitmq-1:5672,amqp://admin:test1234@rabbitmq-2:5672 \
  kevinypfan/rabbitmq-tester:latest
```

### Producer 模式

```bash
docker run -d \
  -e MODE=producer \
  -e RABBITMQ_URL=amqp://admin:test1234@rabbitmq-1:5672,amqp://admin:test1234@rabbitmq-2:5672 \
  -p 3000:3000 \
  kevinypfan/rabbitmq-tester:latest
```

### 混合模式（測試用）

```bash
docker run -d \
  -e MODE=both \
  -e RABBITMQ_URL=amqp://admin:test1234@rabbitmq-1:5672,amqp://admin:test1234@rabbitmq-2:5672 \
  -p 3000:3000 \
  kevinypfan/rabbitmq-tester:latest
```

## 🌐 API 端點 (Producer 模式)

### 健康檢查
```bash
GET /health
```

### 發送單一訊息
```bash
POST /send
Content-Type: application/json

{
  "message": {
    "content": "Hello World!",
    "data": "任意資料"
  },
  "routingKey": "custom.routing.key"  // 可選
}
```

### 批量發送訊息
```bash
POST /send-batch
Content-Type: application/json

{
  "count": 10,  // 或提供 messages 陣列
  "routingKey": "custom.routing.key"  // 可選
}
```

## 🏗️ 本地開發

### 建置映像

```bash
./build.sh [version]
```

### 運行測試

```bash
./test.sh
```

### 手動測試

```bash
# 安裝依賴
npm install

# 運行不同模式
npm run start:consumer
npm run start:producer
npm run start:both
```

## 📁 專案結構

```
unified/
├── index.js                    # 主要應用程式
├── package.json               # 依賴配置
├── Dockerfile                 # Docker 配置
├── .env.example              # 環境變數範例
├── docker-compose.example.yml # Docker Compose 範例
├── build.sh                  # 建置腳本
├── test.sh                   # 測試腳本
└── README.md                 # 說明文件
```

## 🐳 Docker Swarm 部署

參考 `docker-compose.example.yml` 檔案，可以部署到 Docker Swarm 集群：

```bash
docker stack deploy -c docker-compose.example.yml rabbitmq-ha
```

## 📊 監控和日誌

應用程式會輸出單行格式的結構化日誌，便於閱讀和解析：

```
[INFO] CONSUMER - RabbitMQ Client initialized | {"mode":"consumer","clientId":"client-abc123","queue":"test-queue"}
[INFO] CONSUMER - Connected to RabbitMQ | {"host":"amqp://admin:test1234@rabbitmq-1:5672"}
[INFO] CONSUMER - Message received | {"routingKey":"test.message","content":"Hello World"}
[WARN] PRODUCER - Message publish failed - buffer full
[ERROR] CONSUMER - Failed to connect to RabbitMQ | {"error":"Connection refused"}
```

日誌包含：
- 連接狀態和重連資訊
- 訊息處理情況和效能指標
- 錯誤詳情和故障排除資訊
- 結構化的 JSON 資料便於分析

## 🤝 貢獻

歡迎提交 Issue 和 Pull Request！

## 📄 授權

ISC License
