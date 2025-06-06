#!/bin/bash

# 測試訊息遺失檢測功能的腳本

echo "🧪 Testing Message Loss Detection"
echo "================================"

# 設定環境變數
export RABBITMQ_URL="amqp://admin:test1234@localhost:5672"
export NODE_ENV="development"
export STATS_REPORT_INTERVAL=5000
export HEARTBEAT_INTERVAL=3000

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
echo "  1. Start Stats collector"
echo "  2. Start Producer with heartbeat (every 3s)"
echo "  3. Start Consumer"
echo "  4. Monitor for message loss detection"
echo "  5. Test Producer failure scenario"
echo ""

# 1. 啟動統計服務
echo "🔍 Starting Stats collector with API..."
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

# 2. 啟動 Producer 
echo "📤 Starting Producer with heartbeat..."
MODE=producer AUTO_SEND=true AUTO_SEND_INTERVAL=1000 PORT=3002 node index.js &
PRODUCER_PID=$!
echo "Producer PID: $PRODUCER_PID"
sleep 3

# 3. 啟動 Consumer
echo "📥 Starting Consumer..."
MODE=consumer node index.js &
CONSUMER_PID=$!
sleep 5

echo ""
echo "✅ All services started"
echo ""

# 4. 監控統計資料
echo "📊 Monitoring statistics for message loss detection..."
echo ""

for i in {1..10}; do
    echo "=== Check #$i ==="
    
    # 獲取當前統計
    STATS_JSON=$(curl -s http://localhost:3001/stats)
    if [[ $? -eq 0 ]]; then
        echo "Current Stats:"
        echo "$STATS_JSON" | jq '{
            totalMessages,
            lossRate,
            missingMessages,
            totalExpected,
            duplicateRate,
            outOfOrderRate,
            avgLatency
        }'
        
        # 檢查遺失率
        LOSS_RATE=$(echo "$STATS_JSON" | jq -r '.lossRate // "0%"' | sed 's/%//')
        if (( $(echo "$LOSS_RATE > 0" | bc -l) )); then
            echo "⚠️  Message loss detected: ${LOSS_RATE}%"
        else
            echo "✅ No message loss detected"
        fi
    else
        echo "❌ Failed to get stats"
    fi
    
    echo ""
    sleep 5
done

echo ""
echo "🧪 Testing Producer failure scenario..."
echo "Stopping Producer to simulate failure..."

# 停止 Producer 測試遺失檢測
kill $PRODUCER_PID 2>/dev/null
echo "Producer stopped. Monitoring for a few more seconds..."

sleep 10

# 最終統計檢查
echo ""
echo "📈 Final Statistics Check:"
FINAL_STATS=$(curl -s http://localhost:3001/stats)
if [[ $? -eq 0 ]]; then
    echo "$FINAL_STATS" | jq '{
        totalMessages,
        lossRate, 
        missingMessages,
        totalExpected
    }'
    
    # 檢查 Producer 統計
    echo ""
    echo "🏭 Producer Statistics:"
    curl -s http://localhost:3001/stats/producers | jq '.producers[]'
else
    echo "❌ Failed to get final stats"
fi

echo ""
echo "🌐 Dashboard available at: http://localhost:3001/"
echo "📊 You can see the message loss metrics in the web interface"
echo ""
echo "🏁 Test completed"
echo ""
echo "Expected results:"
echo "- Message Loss Rate should start at 0%"
echo "- When Producer stops, missing messages should be detected"
echo "- Producer statistics should show individual loss rates"

cleanup