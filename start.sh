#!/bin/bash

echo "🚀 啟動 RabbitMQ HA 測試環境..."

# 檢查 Docker Swarm 是否已初始化
if ! docker info | grep -q "Swarm: active"; then
    echo "🔧 初始化 Docker Swarm..."
    docker swarm init
fi

# 進入部署目錄
cd deploy

# 檢查是否存在舊的 stack
if docker stack ls | grep -q rabbitmq-ha; then
    echo "🧹 清理舊的服務..."
    docker stack rm rabbitmq-ha
    echo "⏳ 等待服務完全停止..."
    sleep 10
fi

# 部署服務
echo "🎯 部署 RabbitMQ HA Stack..."
docker stack deploy -c docker-compose.yml rabbitmq-ha

echo "⏳ 等待服務啟動..."
sleep 15

# 檢查服務狀態
echo "📊 檢查服務狀態..."
docker service ls

echo ""
echo "🎉 RabbitMQ HA 環境啟動完成！"
echo ""
echo "📡 服務端點："
echo "   - RabbitMQ Management: http://rabbitmq.swarm-test (admin/test1234)"
echo "   - Producer API: http://producer.swarm-test"
echo "   - Traefik Dashboard: http://localhost:8080"
echo "   - Grafana: http://localhost:3000"
echo "   - Prometheus: http://localhost:3002"
echo "   - Consul: http://localhost:3001"
echo ""
echo "🧪 測試指令："
echo "   curl -X POST http://producer.swarm-test/send \\"
echo "     -H \"Content-Type: application/json\" \\"
echo "     -d '{\"message\": {\"type\": \"test\", \"content\": \"Hello RabbitMQ HA!\"}}'"
echo ""
echo "📊 監控指令："
echo "   docker service logs -f rabbitmq-ha_consumer"
echo "   docker service logs -f rabbitmq-ha_producer"
echo "   docker service logs -f rabbitmq-ha_rabbitmq"
echo ""
echo "🔧 擴展指令："
echo "   docker service scale rabbitmq-ha_consumer=5"
echo "   docker service scale rabbitmq-ha_producer=3"
