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
