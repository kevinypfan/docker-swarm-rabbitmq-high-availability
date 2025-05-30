const amqp = require('amqplib');
require('dotenv').config();

class RabbitMQConsumer {
    constructor() {
        this.connection = null;
        this.channel = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 5000;
        
        // 設定參數
        this.queueName = process.env.QUEUE_NAME || 'test-queue';
        this.exchangeName = process.env.EXCHANGE_NAME || 'test-exchange';
        this.routingKey = process.env.ROUTING_KEY || 'test.message';
        this.consumerId = process.env.HOSTNAME || `consumer-${Math.random().toString(36).substr(2, 9)}`;
        
        // RabbitMQ 連接設定（支援多個節點的 HA）
        this.rabbitmqHosts = process.env.RABBITMQ_HOSTS ? 
            process.env.RABBITMQ_HOSTS.split(',') : 
            ['amqp://admin:test1234@rabbitmq:5672'];
            
        console.log(`🚀 Consumer ID: ${this.consumerId}`);
        console.log(`📨 Queue: ${this.queueName}`);
        console.log(`🔄 Exchange: ${this.exchangeName}`);
        console.log(`🎯 Routing Key: ${this.routingKey}`);
        console.log(`🌐 RabbitMQ Hosts: ${this.rabbitmqHosts.join(', ')}`);
    }

    async connect() {
        try {
            console.log('🔌 嘗試連接到 RabbitMQ...');
            
            // 嘗試連接到 RabbitMQ 叢集中的任一節點
            this.connection = await amqp.connect(this.rabbitmqHosts, {
                heartbeat: 60,
                timeout: 10000
            });
            
            console.log('✅ 成功連接到 RabbitMQ');
            
            this.connection.on('error', (err) => {
                console.error('❌ RabbitMQ 連接錯誤:', err.message);
                this.reconnect();
            });
            
            this.connection.on('close', () => {
                console.log('🔌 RabbitMQ 連接關閉');
                this.reconnect();
            });
            
            this.channel = await this.connection.createChannel();
            console.log('📡 成功建立 Channel');
            
            // 設定 QoS - 每次只處理一個訊息
            await this.channel.prefetch(1);
            
            // 重置重連計數器
            this.reconnectAttempts = 0;
            
            return true;
        } catch (error) {
            console.error('❌ 連接 RabbitMQ 失敗:', error.message);
            this.reconnect();
            return false;
        }
    }

    async setupQueue() {
        try {
            // 宣告 Exchange（持久化）
            await this.channel.assertExchange(this.exchangeName, 'topic', {
                durable: true
            });
            
            // 宣告 Queue（持久化）
            const queue = await this.channel.assertQueue(this.queueName, {
                durable: true,
                arguments: {
                    'x-ha-policy': 'all' // 確保 Queue 在所有節點都有副本
                }
            });
            
            // 綁定 Queue 到 Exchange
            await this.channel.bindQueue(queue.queue, this.exchangeName, this.routingKey);
            
            console.log(`✅ Queue 設定完成: ${queue.queue}`);
            console.log(`🔗 綁定到 Exchange: ${this.exchangeName} (${this.routingKey})`);
            
            return queue.queue;
        } catch (error) {
            console.error('❌ 設定 Queue 失敗:', error.message);
            throw error;
        }
    }

    async startConsuming() {
        try {
            const queueName = await this.setupQueue();
            
            console.log(`🎧 開始監聽訊息 (Consumer: ${this.consumerId})...`);
            
            await this.channel.consume(queueName, async (message) => {
                if (message) {
                    try {
                        const content = JSON.parse(message.content.toString());
                        console.log(`📨 收到訊息 [${this.consumerId}]:`, {
                            timestamp: new Date().toISOString(),
                            routingKey: message.fields.routingKey,
                            content: content
                        });
                        
                        // 模擬處理時間
                        await this.processMessage(content);
                        
                        // 確認訊息已處理
                        this.channel.ack(message);
                        console.log(`✅ 訊息處理完成 [${this.consumerId}]`);
                        
                    } catch (error) {
                        console.error(`❌ 處理訊息失敗 [${this.consumerId}]:`, error.message);
                        // 拒絕訊息並重新排隊
                        this.channel.nack(message, false, true);
                    }
                }
            }, {
                noAck: false, // 需要手動確認
                consumerTag: this.consumerId
            });
            
        } catch (error) {
            console.error('❌ 開始消費失敗:', error.message);
            throw error;
        }
    }

    async processMessage(content) {
        // 模擬處理邏輯
        const processingTime = Math.random() * 2000 + 500; // 0.5-2.5秒
        console.log(`⏳ 處理訊息中... (預計 ${Math.round(processingTime)}ms)`);
        
        await new Promise(resolve => setTimeout(resolve, processingTime));
        
        // 在這裡加入你的實際業務邏輯
        console.log(`🎯 處理內容: ${JSON.stringify(content)}`);
    }

    async reconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error(`❌ 超過最大重連次數 (${this.maxReconnectAttempts})`);
            process.exit(1);
        }
        
        this.reconnectAttempts++;
        console.log(`🔄 嘗試重連... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        setTimeout(async () => {
            await this.connect();
            if (this.connection && this.channel) {
                await this.startConsuming();
            }
        }, this.reconnectDelay);
    }

    async close() {
        try {
            if (this.channel) {
                await this.channel.close();
            }
            if (this.connection) {
                await this.connection.close();
            }
            console.log('🔌 Consumer 連接已關閉');
        } catch (error) {
            console.error('❌ 關閉連接時發生錯誤:', error.message);
        }
    }
}

// 主要執行邏輯
async function main() {
    const consumer = new RabbitMQConsumer();
    
    // 優雅關閉處理
    process.on('SIGINT', async () => {
        console.log('\n🛑 收到關閉信號，正在優雅關閉...');
        await consumer.close();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('\n🛑 收到終止信號，正在優雅關閉...');
        await consumer.close();
        process.exit(0);
    });
    
    // 連接並開始消費
    const connected = await consumer.connect();
    if (connected) {
        await consumer.startConsuming();
    }
}

// 啟動 Consumer
main().catch(error => {
    console.error('❌ Consumer 啟動失敗:', error);
    process.exit(1);
});
