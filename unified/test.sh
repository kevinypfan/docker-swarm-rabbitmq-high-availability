#!/bin/bash

# RabbitMQ HA Client 測試腳本

set -e

IMAGE_NAME="kevinypfan/rabbitmq-tester:latest"
NETWORK_NAME="rabbitmq-test-network"

echo "🧪 RabbitMQ Tester 測試"
echo "=========================="

# 創建測試網路
echo "📡 創建測試網路..."
docker network create ${NETWORK_NAME} || echo "網路已存在"

# 清理舊的容器
echo "🧹 清理舊的測試容器..."
docker rm -f test-consumer test-producer test-both 2>/dev/null || true

echo ""
echo "🚀 啟動測試容器..."

# 啟動 Consumer
echo "▶️  啟動 Consumer 模式..."
docker run -d \
  --name test-consumer \
  --network ${NETWORK_NAME} \
  -e MODE=consumer \
  -e NODE_ENV=development \
  -e RABBITMQ_URL=amqp://guest:guest@host.docker.internal:5672 \
  -e QUEUE_NAME=test-queue \
  -e EXCHANGE_NAME=test-exchange \
  -e ROUTING_KEY=test.message \
  ${IMAGE_NAME}

# 啟動 Producer
echo "▶️  啟動 Producer 模式..."
docker run -d \
  --name test-producer \
  --network ${NETWORK_NAME} \
  -p 3000:3000 \
  -e MODE=producer \
  -e NODE_ENV=development \
  -e RABBITMQ_URL=amqp://guest:guest@host.docker.internal:5672 \
  -e QUEUE_NAME=test-queue \
  -e EXCHANGE_NAME=test-exchange \
  -e ROUTING_KEY=test.message \
  -e AUTO_SEND=true \
  -e AUTO_SEND_INTERVAL=5000 \
  ${IMAGE_NAME}

echo ""
echo "⏳ 等待容器啟動..."
sleep 5

echo ""
echo "📊 容器狀態:"
docker ps --filter "name=test-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "🔍 測試 Producer API..."
curl -s http://localhost:3000/health | jq .

echo ""
echo "📝 發送測試訊息..."
curl -s -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{"message": {"content": "Hello from test script!", "test": true}}' | jq .

echo ""
echo "📋 查看 Consumer 日誌 (最後 10 行):"
docker logs --tail 10 test-consumer

echo ""
echo "📋 查看 Producer 日誌 (最後 10 行):"
docker logs --tail 10 test-producer

echo ""
echo "🧹 清理測試環境..."
echo "   運行以下指令來清理:"
echo "   docker rm -f test-consumer test-producer"
echo "   docker network rm ${NETWORK_NAME}"
