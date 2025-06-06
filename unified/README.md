# RabbitMQ Tester

一個統一的 RabbitMQ 測試工具，可以透過環境變數控制為 Producer、Consumer 或混合模式運行，專為高可用性測試設計。

## 🚀 特色功能

- **統一應用程式**: 單一 Docker 映像，支援 Producer、Consumer、Stats 或混合模式
- **高可用性**: 支援多個 RabbitMQ 節點的自動故障轉移
- **訊息可靠性監控**: 內建序號追蹤、遺失檢測和統計分析
- **即時統計儀表板**: Web 介面展示訊息遺失率、延遲等指標
- **自動重連**: 內建重連機制，確保連接穩定性
- **REST API**: Producer 和 Stats 模式提供 HTTP API 介面
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
| `MODE` | `consumer` | 運行模式: `consumer`, `producer`, `both`, `stats` |
| `NODE_ENV` | `production` | Node.js 環境 |
| `RABBITMQ_URL` | `amqp://admin:test1234@localhost:5672` | RabbitMQ 連接字串（支援多個主機，用逗號分隔） |
| `QUEUE_NAME` | `test-queue` | Queue 名稱 |
| `EXCHANGE_NAME` | `test-exchange` | Exchange 名稱 |
| `ROUTING_KEY` | `test.message` | Routing Key |
| `PORT` | `3000` | Producer API 端口 |
| `AUTO_SEND` | `false` | 是否啟用自動發送訊息 |
| `AUTO_SEND_INTERVAL` | `10000` | 自動發送間隔（毫秒） |
| `STATS_QUEUE` | `reliability-stats` | 統計 Queue 名稱 |
| `STATS_EXCHANGE` | `stats-exchange` | 統計 Exchange 名稱 |
| `HEARTBEAT_INTERVAL` | `10000` | Producer 心跳間隔（毫秒） |
| `STATS_REPORT_INTERVAL` | `30000` | 統計報告間隔（毫秒） |

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

### 統計收集模式

```bash
docker run -d \
  -e MODE=stats \
  -e RABBITMQ_URL=amqp://admin:test1234@rabbitmq-1:5672,amqp://admin:test1234@rabbitmq-2:5672 \
  -p 3001:3000 \
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

## 📊 統計監控 API (Stats 模式)

### 統計儀表板
```bash
GET /                    # Web 儀表板
```

### 統計 API 端點
```bash
GET /health              # 健康檢查
GET /stats               # 當前統計摘要
GET /stats/detailed      # 詳細統計報告
GET /stats/producers     # Producer 統計
GET /stats/live          # 即時統計流 (Server-Sent Events)
```

### 統計資料範例
```json
{
  "totalMessages": 2134,
  "duplicateRate": "0.00%",
  "outOfOrderRate": "13.36%", 
  "lossRate": "0.24%",
  "missingMessages": 3,
  "avgLatency": "25ms"
}
```

## 🔍 訊息可靠性監控

本系統提供完整的訊息可靠性監控機制，能夠檢測訊息遺失、重複、亂序等問題。

### 架構圖

```mermaid
graph TB
    subgraph Producer["Producer Instances"]
        P1[Producer 1]
        P2[Producer 2]  
        P3[Producer N]
    end
    
    subgraph RabbitMQ["RabbitMQ Cluster"]
        RMQ[主要訊息佇列]
        STATS_Q[統計佇列]
    end
    
    subgraph Consumer["Consumer Instances"]
        C1[Consumer 1]
        C2[Consumer 2]
        C3[Consumer N]
    end
    
    subgraph Stats["Statistics Collector"]
        SC[Stats Service]
        WEB[Web Dashboard]
        API[REST API]
    end
    
    %% Producer 流程
    P1 -->|帶序號訊息| RMQ
    P2 -->|帶序號訊息| RMQ  
    P3 -->|帶序號訊息| RMQ
    
    P1 -.->|心跳包| STATS_Q
    P2 -.->|心跳包| STATS_Q
    P3 -.->|心跳包| STATS_Q
    
    %% Consumer 流程  
    RMQ -->|訊息| C1
    RMQ -->|訊息| C2
    RMQ -->|訊息| C3
    
    C1 -->|統計資料| STATS_Q
    C2 -->|統計資料| STATS_Q
    C3 -->|統計資料| STATS_Q
    
    %% Stats 流程
    STATS_Q --> SC
    SC --> WEB
    SC --> API
    
    %% 樣式
    classDef producer fill:#e1f5fe,stroke:#01579b
    classDef consumer fill:#f3e5f5,stroke:#4a148c  
    classDef rmq fill:#fff3e0,stroke:#e65100
    classDef stats fill:#e8f5e8,stroke:#1b5e20
    
    class P1,P2,P3 producer
    class C1,C2,C3 consumer
    class RMQ,STATS_Q rmq
    class SC,WEB,API stats
```

### 運作流程

1. **Producer 端**:
   - 每個訊息包含遞增序號 (sequenceNumber)
   - 定期發送心跳包含當前序號和總發送數
   - 心跳間隔可調整 (預設 10 秒)

2. **Consumer 端**:
   - 接收訊息並記錄統計資料
   - 檢測重複訊息、亂序訊息
   - 計算傳輸延遲
   - 發送統計到專用佇列

3. **統計收集器**:
   - 比對心跳資訊與實際收到的序號
   - 計算訊息遺失率和遺失數量
   - 提供 Web 儀表板和 REST API
   - 即時監控和警告

### 監控指標

| 指標 | 說明 | 警告閾值 |
|------|------|----------|
| **遺失率** | 遺失訊息 / 預期訊息 | > 0.1% |
| **重複率** | 重複訊息 / 總訊息 | > 5% |
| **亂序率** | 亂序訊息 / 總訊息 | > 5% |
| **平均延遲** | 訊息傳輸延遲 | > 1000ms |
| **遺失訊息數** | 實際遺失的訊息數量 | > 0 |

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
npm run start:stats

# 測試可靠性監控
./test-reliability.sh       # 基本可靠性測試
./test-stats-api.sh         # 統計 API 測試
./test-message-loss.sh      # 訊息遺失檢測測試
```

## 📁 專案結構

```
unified/
├── index.js                    # 主要應用程式
├── package.json               # 依賴配置
├── Dockerfile                 # Docker 配置
├── docker-compose.yml         # Docker Compose 配置
├── build.sh                  # 建置腳本
├── test.sh                   # 測試腳本
├── test-reliability.sh       # 可靠性測試腳本
├── test-stats-api.sh         # 統計 API 測試腳本
├── test-message-loss.sh      # 訊息遺失檢測測試腳本
└── README.md                 # 說明文件
```

## 🐳 Docker Swarm 部署

可以直接部署到 Docker Swarm 集群：

```bash
docker stack deploy -c docker-compose.yml rabbitmq-ha
```

部署後可透過以下網址訪問：
- **統計儀表板**: http://localhost/stats  
- **Producer API**: http://localhost/producer
- **RabbitMQ Management**: http://localhost/rabbitmq
- **Grafana**: http://localhost/grafana
- **Prometheus**: http://localhost/prometheus

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
