#!/bin/bash

echo "🛑 停止 RabbitMQ HA 測試環境..."

# 停止 stack
if docker stack ls | grep -q rabbitmq-ha; then
    echo "🔄 停止服務..."
    docker stack rm rabbitmq-ha
    
    echo "⏳ 等待所有服務完全停止..."
    sleep 15
    
    echo "✅ 服務已停止"
else
    echo "ℹ️  沒有找到運行中的 rabbitmq-ha stack"
fi

# 顯示剩餘的服務
echo "📊 當前 Docker 服務："
docker service ls

echo ""
echo "🧹 如需清理所有資源，請執行："
echo "   docker system prune -f"
echo "   docker volume prune -f"
