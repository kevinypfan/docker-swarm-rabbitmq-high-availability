- `AUTO_SEND`: 是否啟用自動發送 (Producer)
- `AUTO_SEND_INTERVAL`: 自動發送間隔 (毫秒)

### Docker Compose 配置
- `replicas`: 服務副本數量
- `resources`: CPU 和記憶體限制
- `restart_policy`: 重啟策略
- `update_config`: 更新策略

## 🚨 故障排除

### 常見問題

1. **服務無法啟動**
   ```bash
   # 檢查服務日誌
   docker service logs rabbitmq-ha_rabbitmq
   docker service logs rabbitmq-ha_consumer
   docker service logs rabbitmq-ha_producer
   ```

2. **RabbitMQ 叢集未形成**
   ```bash
   # 檢查 Consul 服務發現
   curl http://localhost:3001/v1/catalog/service/rabbitmq
   
   # 進入 RabbitMQ 容器檢查叢集狀態
   docker exec -it $(docker ps -q -f name=rabbitmq-ha_rabbitmq) rabbitmqctl cluster_status
   ```

3. **Consumer 無法連接**
   ```bash
   # 檢查網路連通性
   docker exec -it $(docker ps -q -f name=rabbitmq-ha_consumer) ping rabbitmq
   
   # 檢查環境變數
   docker service inspect rabbitmq-ha_consumer
   ```

4. **Producer API 無法訪問**
   ```bash
   # 檢查 Traefik 路由
   curl http://localhost:8080/api/http/routers
   
   # 檢查服務標籤
   docker service inspect rabbitmq-ha_producer
   ```

### 重建服務
```bash
# 完全重建
docker stack rm rabbitmq-ha
docker system prune -f
docker stack deploy -c docker-compose.yml rabbitmq-ha
```

## 📚 參考資料

- [RabbitMQ 高可用性指南](https://www.rabbitmq.com/ha.html)
- [Docker Swarm 文檔](https://docs.docker.com/engine/swarm/)
- [Traefik 配置指南](https://doc.traefik.io/traefik/)
- [Prometheus 監控](https://prometheus.io/docs/)

## 🎯 測試場景

### 場景 1: 基本功能測試
1. 啟動服務
2. 發送測試訊息
3. 驗證 Consumer 接收訊息
4. 檢查監控指標

### 場景 2: 節點故障恢復
1. 停止一個 RabbitMQ 節點
2. 繼續發送訊息
3. 驗證服務可用性
4. 重啟節點並驗證自動恢復

### 場景 3: 負載測試
1. 擴展 Consumer 數量
2. 發送大量訊息
3. 監控處理效能
4. 調整資源配置

### 場景 4: 網路分區測試
1. 模擬網路分區
2. 觀察叢集行為
3. 驗證 autoheal 策略
4. 檢查資料一致性

## 🏗 專案結構

```
rabbitmq-ha/
├── README.md                 # 專案說明
├── deploy/                   # 部署配置
│   ├── docker-compose.yml    # Docker Swarm 配置
│   ├── rabbitmq.conf        # RabbitMQ 配置
│   ├── enabled_plugins      # RabbitMQ 插件
│   └── prometheus.yml       # Prometheus 配置
├── consumer/                 # 消費者服務
│   ├── index.js             # 主程式
│   ├── package.json         # 依賴管理
│   ├── Dockerfile           # 容器配置
│   └── .env                 # 環境變數
└── producer/                 # 生產者服務
    ├── index.js             # 主程式 + API
    ├── package.json         # 依賴管理
    ├── Dockerfile           # 容器配置
    └── .env                 # 環境變數
```

## 🔄 持續改進

### 未來功能
- [ ] 死信佇列處理
- [ ] 訊息優先級
- [ ] 延遲訊息
- [ ] 訊息追蹤
- [ ] 自動測試套件
- [ ] 效能基準測試
- [ ] Kubernetes 部署配置

### 貢獻指南
1. Fork 專案
2. 建立功能分支
3. 提交變更
4. 建立 Pull Request

祝你測試愉快！🎉
# RabbitMQ HA 專案架構更新

## 🎯 新增統一版本

新增了 `/unified` 目錄，包含了整合 Producer 和 Consumer 的統一應用程式。

### 📁 專案結構

```
rabbitmq-ha/
├── consumer/          # 原始 Consumer 版本
├── producer/          # 原始 Producer 版本
├── unified/           # 🆕 統一版本 (推薦使用)
│   ├── index.js
│   ├── package.json
│   ├── Dockerfile
│   ├── README.md
│   └── ...
├── .github/           # 🆕 GitHub Actions 配置
│   └── workflows/
├── deploy/            # Docker Swarm 部署配置
├── shared/            # 共享資源
└── test*/             # 測試目錄
```

### ✨ 統一版本優勢

1. **單一映像**: 只需要維護一個 Docker 映像
2. **彈性部署**: 透過環境變數控制運行模式
3. **程式碼重用**: 共享連接邏輯和重連機制
4. **簡化維護**: 減少重複配置和依賴管理
5. **自動化 CI/CD**: GitHub Actions 自動建置和發布

### 🚀 推薦使用方式

**Docker Hub 映像名稱**: `kevinypfan/rabbitmq-tester`

```bash
# 建置映像
cd unified
./build.sh

# 推送到 Docker Hub (或使用 GitHub Actions)
docker push kevinypfan/rabbitmq-tester:latest

# 使用不同模式
docker run -e MODE=consumer kevinypfan/rabbitmq-tester:latest
docker run -e MODE=producer -p 3000:3000 kevinypfan/rabbitmq-tester:latest
docker run -e MODE=both -p 3000:3000 kevinypfan/rabbitmq-tester:latest
```

### 📋 自動化部署

專案包含完整的 GitHub Actions 配置：

- **自動測試** - 每次推送和 PR 都會執行測試
- **自動建置** - 支援多平台 (amd64, arm64)
- **自動發布** - 推送到 Docker Hub
- **版本管理** - 自動標籤管理

詳見 `GITHUB_ACTIONS_SETUP.md` 了解設定方式。

### 📋 遷移指南

從原始的 consumer/producer 版本遷移到統一版本：

1. 使用 `unified/` 目錄中的新版本
2. 設定環境變數 `MODE` 來控制運行模式
3. 更新 Docker Compose 配置使用新的映像名稱
4. 設定 GitHub Actions secrets 來啟用自動發布
5. 原始的 consumer 和 producer 目錄保留作為參考

### 🔧 開發和測試

```bash
cd unified

# 本地開發
pnpm install
pnpm run start:consumer    # Consumer 模式
pnpm run start:producer    # Producer 模式
pnpm run start:both        # 混合模式

# 建置和測試
./build.sh               # 建置 Docker 映像
./test.sh                # 運行測試
```

### 🎯 特色功能

- **單行日誌格式** - 便於閱讀和分析
- **多平台支援** - 支援 amd64 和 arm64 架構
- **健康檢查** - 內建 Docker 健康檢查
- **優雅關閉** - 支援 SIGINT/SIGTERM 信號處理
- **自動重連** - 內建 RabbitMQ 重連機制

統一版本現在是專案的主要版本，建議新的部署都使用這個版本！
