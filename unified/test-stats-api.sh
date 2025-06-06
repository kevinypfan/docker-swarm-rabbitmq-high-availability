#!/bin/bash

# 測試統計 API 功能的腳本

echo "🧪 Testing Stats API Functionality"
echo "================================="

# 設定環境變數
export RABBITMQ_URL="amqp://admin:test1234@localhost:5672"
export NODE_ENV="development"
export STATS_REPORT_INTERVAL=5000

# 清理函數
cleanup() {
    echo "🧹 Cleaning up test processes..."
    pkill -f "MODE=stats"
    pkill -f "MODE=producer"
    pkill -f "MODE=consumer"
    sleep 2
}

# 設定陷阱處理 Ctrl+C
trap cleanup EXIT

echo "📋 Test Plan:"
echo "  1. Start Stats API server"
echo "  2. Start Producer and Consumer"
echo "  3. Test API endpoints"
echo "  4. Verify dashboard"
echo ""

# 1. 啟動統計服務
echo "🔍 Starting Stats API server..."
MODE=stats PORT=3001 node index.js &
STATS_PID=$!
echo "Stats API PID: $STATS_PID"
sleep 3

# 檢查統計服務是否啟動成功
echo "🔍 Testing Stats API health endpoint..."
if curl -s http://localhost:3001/health > /dev/null; then
    echo "✅ Stats API is running"
else
    echo "❌ Stats API failed to start"
    exit 1
fi

# 2. 啟動 Producer 和 Consumer
echo "📤 Starting Producer..."
MODE=producer AUTO_SEND=true AUTO_SEND_INTERVAL=1000 PORT=3002 node index.js &
PRODUCER_PID=$!
sleep 2

echo "📥 Starting Consumer..."
MODE=consumer node index.js &
CONSUMER_PID=$!
sleep 3

echo ""
echo "✅ All services started"
echo ""

# 3. 測試 API 端點
echo "🧪 Testing API endpoints..."

echo ""
echo "🔍 Testing /health endpoint:"
curl -s http://localhost:3001/health | jq '.' || echo "Failed to get health status"

echo ""
echo "📊 Testing /stats endpoint:"
sleep 5  # 等待一些統計資料
curl -s http://localhost:3001/stats | jq '.' || echo "Failed to get stats"

echo ""
echo "📈 Testing /stats/detailed endpoint:"
curl -s http://localhost:3001/stats/detailed | jq '.' || echo "Failed to get detailed stats"

echo ""
echo "🏭 Testing /stats/producers endpoint:"
curl -s http://localhost:3001/stats/producers | jq '.' || echo "Failed to get producer stats"

echo ""
echo "🌐 Dashboard available at: http://localhost:3001/"
echo ""
echo "📊 API Endpoints:"
echo "  - Health: http://localhost:3001/health"
echo "  - Stats: http://localhost:3001/stats"
echo "  - Detailed: http://localhost:3001/stats/detailed"
echo "  - Producers: http://localhost:3001/stats/producers"
echo "  - Live Stream: http://localhost:3001/stats/live"
echo ""

echo "⏰ Test running for 30 seconds to collect data..."
echo "🖥️  Open http://localhost:3001/ in your browser to see the dashboard"
echo ""
echo "Press Ctrl+C to stop the test"

# 等待測試完成
sleep 30

echo ""
echo "🏁 Test completed"

cleanup