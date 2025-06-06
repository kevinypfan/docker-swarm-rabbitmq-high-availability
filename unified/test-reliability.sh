#!/bin/bash

# RabbitMQ 可靠性測試腳本
# 測試訊息序號追蹤和統計功能

echo "🧪 RabbitMQ Reliability Testing Script"
echo "====================================="

# 設定環境變數
export RABBITMQ_URL="amqp://admin:test1234@localhost:5672"
export QUEUE_NAME="reliability-test-queue"
export EXCHANGE_NAME="reliability-test-exchange"
export ROUTING_KEY="reliability.test"
export STATS_QUEUE="reliability-stats"
export STATS_EXCHANGE="stats-exchange"
export NODE_ENV="development"

# 清理之前的程序
cleanup() {
    echo "🧹 清理測試程序..."
    pkill -f "MODE=producer"
    pkill -f "MODE=consumer" 
    pkill -f "MODE=stats"
    sleep 2
}

# 設定陷阱處理 Ctrl+C
trap cleanup EXIT

echo "📋 測試計劃："
echo "  1. 啟動統計收集器 (MODE=stats)"
echo "  2. 啟動 1 個 Producer (AUTO_SEND=true)"
echo "  3. 啟動 2 個 Consumer"
echo "  4. 觀察可靠性統計報告"
echo ""

# 1. 啟動統計收集器
echo "🔍 啟動統計收集器..."
MODE=stats STATS_REPORT_INTERVAL=10000 node index.js &
STATS_PID=$!
echo "Stats collector PID: $STATS_PID"
sleep 3

# 2. 啟動 Producer 
echo "📤 啟動 Producer (自動發送)..."
MODE=producer AUTO_SEND=true AUTO_SEND_INTERVAL=2000 PORT=3001 node index.js &
PRODUCER_PID=$!
echo "Producer PID: $PRODUCER_PID"
sleep 3

# 3. 啟動 Consumer 1
echo "📥 啟動 Consumer 1..."
MODE=consumer node index.js &
CONSUMER1_PID=$!
echo "Consumer 1 PID: $CONSUMER1_PID"
sleep 2

# 4. 啟動 Consumer 2
echo "📥 啟動 Consumer 2..."
MODE=consumer node index.js &
CONSUMER2_PID=$!
echo "Consumer 2 PID: $CONSUMER2_PID"
sleep 2

echo ""
echo "✅ 所有服務已啟動"
echo "📊 統計報告每 10 秒產生一次"
echo "⏰ 測試將運行 60 秒，然後自動停止"
echo ""
echo "🔬 測試中的可靠性指標："
echo "  - 訊息序號追蹤"
echo "  - 重複訊息檢測"  
echo "  - 亂序訊息檢測"
echo "  - 傳輸延遲測量"
echo "  - Producer/Consumer 統計"
echo ""
echo "按 Ctrl+C 提前停止測試"
echo ""

# 等待測試完成
sleep 60

echo ""
echo "🏁 測試完成"
echo "統計資料已收集，查看上方的可靠性報告"

cleanup