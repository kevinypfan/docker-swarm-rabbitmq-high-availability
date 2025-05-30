const amqp = require('amqplib');
const express = require('express');
require('dotenv').config();

// 簡化的日誌設定
const isDev = process.env.NODE_ENV !== 'production';
const createSimpleLogger = (component) => {
  return {
    info: (msg, data = {}) => console.log(`[INFO] ${component} - ${msg}`, data),
    error: (msg, data = {}) => console.error(`[ERROR] ${component} - ${msg}`, data),
    warn: (msg, data = {}) => console.warn(`[WARN] ${component} - ${msg}`, data),
    debug: (msg, data = {}) => isDev && console.log(`[DEBUG] ${component} - ${msg}`, data)
  };
};

const logger = createSimpleLogger('PRODUCER');

class RabbitMQProducer {
    constructor() {
        this.connection = null;
        this.channel = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 5000;
        
        // 設定參數
        this.exchangeName = process.env.EXCHANGE_NAME || 'test-exchange';
        this.routingKey = process.env.ROUTING_KEY || 'test.message';
        this.producerId = process.env.HOSTNAME || `producer-${Math.random().toString(36).substr(2, 9)}`;
        
        // RabbitMQ 連接設定（支援多個節點的 HA）
        this.rabbitmqUrl = process.env.RABBITMQ_URL || process.env.RABBITMQ_HOSTS || "amqp://admin:test1234@localhost:5672";
        this.rabbitmqHosts = Array.isArray(this.rabbitmqUrl) ? this.rabbitmqUrl : this.rabbitmqUrl.split(",");
            
        logger.info('Producer initialized', {
            producerId: this.producerId,
            exchange: this.exchangeName,
            routingKey: this.routingKey,
            hosts: this.rabbitmqHosts
        });
    }

    async connect() {
        try {
            logger.info('Attempting to connect to RabbitMQ');
            
            // 簡化連接邏輯 - 先嘗試第一個 host，如果失敗再嘗試其他的
            let connection = null;
            let lastError = null;

            for (const host of this.rabbitmqHosts) {
                try {
                    logger.debug('Trying to connect', { host });
                    connection = await amqp.connect(host.trim(), {
                        heartbeat: 60,
                        timeout: 10000
                    });
                    logger.info('Connected to RabbitMQ', { host });
                    break;
                } catch (error) {
                    logger.warn('Connection failed', { host, error: error.message });
                    lastError = error;
                    continue;
                }
            }

            if (!connection) {
                throw lastError || new Error("所有 RabbitMQ 主機連接失敗");
            }

            this.connection = connection;
            
            this.connection.on('error', (err) => {
                logger.error('RabbitMQ connection error', { error: err.message });
                this.channel = null;
                this.connection = null;
                this.reconnect();
            });
            
            this.connection.on('close', () => {
                logger.warn('RabbitMQ connection closed');
                this.channel = null;
                this.connection = null;
                this.reconnect();
            });
            
            this.channel = await this.connection.createChannel();
            logger.info('Channel created successfully');
            
            // 暫時註解掉 confirmSelect，先測試基本功能
            // await this.channel.confirmSelect();
            
            // 重置重連計數器
            this.reconnectAttempts = 0;
            
            return true;
        } catch (error) {
            logger.error('Failed to connect to RabbitMQ', { error: error.message });
            this.reconnect();
            return false;
        }
    }

    async setupExchange() {
        try {
            // 宣告 Exchange（持久化）
            await this.channel.assertExchange(this.exchangeName, 'topic', {
                durable: true
            });
            
            logger.info('Exchange setup completed', { exchange: this.exchangeName });
        } catch (error) {
            logger.error('Failed to setup exchange', { 
                exchange: this.exchangeName, 
                error: error.message 
            });
            throw error;
        }
    }

    async publishMessage(message, routingKey = null) {
        try {
            if (!this.channel) {
                throw new Error('Channel 尚未建立');
            }

            const messageBuffer = Buffer.from(JSON.stringify({
                ...message,
                producerId: this.producerId,
                timestamp: new Date().toISOString(),
                messageId: Math.random().toString(36).substr(2, 9)
            }));

            const publishRoutingKey = routingKey || this.routingKey;

            // 發布訊息（持久化）
            const published = this.channel.publish(
                this.exchangeName,
                publishRoutingKey,
                messageBuffer,
                {
                    persistent: true,
                    messageId: Math.random().toString(36).substr(2, 9),
                    timestamp: Date.now(),
                    appId: this.producerId
                }
            );

            if (published) {
                logger.info('Message published successfully', {
                    exchange: this.exchangeName,
                    routingKey: publishRoutingKey,
                    messageId: messageBuffer.toString().substring(0, 100)
                });
                return true;
            } else {
                logger.warn('Message publish failed - buffer full');
                return false;
            }
        } catch (error) {
            logger.error('Failed to publish message', { error: error.message });
            throw error;
        }
    }

    async publishMessageWithConfirm(message, routingKey = null) {
        try {
            // 暫時使用一般的 publish 方法，不使用確認模式
            const result = await this.publishMessage(message, routingKey);
            if (result) {
                logger.info('Message published with confirmation');
                return true;
            } else {
                throw new Error('訊息發布失敗');
            }
        } catch (error) {
            logger.error('Failed to publish message with confirmation', { 
                error: error.message 
            });
            throw error;
        }
    }

    async reconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error('Max reconnect attempts exceeded', { 
                attempts: this.maxReconnectAttempts 
            });
            process.exit(1);
        }
        
        // 清理舊的連線
        try {
            if (this.channel) {
                await this.channel.close().catch(() => {});
                this.channel = null;
            }
            if (this.connection) {
                await this.connection.close().catch(() => {});
                this.connection = null;
            }
        } catch (error) {
            // 忽略清理時的錯誤
        }
        
        this.reconnectAttempts++;
        logger.info('Attempting to reconnect', {
            attempt: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts
        });
        
        setTimeout(async () => {
            const connected = await this.connect();
            if (connected && this.connection && this.channel) {
                await this.setupExchange();
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
            console.log('🔌 Producer 連接已關閉');
        } catch (error) {
            console.error('❌ 關閉連接時發生錯誤:', error.message);
        }
    }
}

// Express 伺服器設定
function createExpressApp(producer) {
    const app = express();
    app.use(express.json());

    // 健康檢查端點
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            producerId: producer.producerId,
            connected: !!producer.connection,
            timestamp: new Date().toISOString()
        });
    });

    // 發送訊息端點
    app.post('/send', async (req, res) => {
        try {
            const { message, routingKey } = req.body;
            
            if (!message) {
                return res.status(400).json({ error: '訊息內容不能為空' });
            }

            await producer.publishMessageWithConfirm(message, routingKey);
            
            res.json({
                success: true,
                message: '訊息發送成功',
                producerId: producer.producerId,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ API 發送訊息失敗:', error.message);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 批量發送訊息端點
    app.post('/send-batch', async (req, res) => {
        try {
            const { messages, routingKey, count = 10 } = req.body;
            
            const results = [];
            const messagesToSend = messages || Array.from({ length: count }, (_, i) => ({
                id: i + 1,
                content: `批量測試訊息 #${i + 1}`,
                batch: true
            }));

            for (const message of messagesToSend) {
                try {
                    await producer.publishMessageWithConfirm(message, routingKey);
                    results.push({ success: true, message });
                } catch (error) {
                    results.push({ success: false, message, error: error.message });
                }
            }

            res.json({
                success: true,
                total: messagesToSend.length,
                successful: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length,
                results,
                producerId: producer.producerId,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ API 批量發送失敗:', error.message);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    return app;
}

// 自動發送訊息功能
function startAutoSender(producer) {
    const interval = parseInt(process.env.AUTO_SEND_INTERVAL) || 10000; // 10秒
    const autoSend = process.env.AUTO_SEND === 'true';
    
    if (!autoSend) {
        console.log('🔇 自動發送已停用');
        return;
    }
    
    console.log(`🔄 自動發送啟用，間隔: ${interval}ms`);
    
    setInterval(async () => {
        try {
            const message = {
                type: 'auto',
                content: `自動生成訊息 - ${new Date().toISOString()}`,
                data: {
                    randomValue: Math.random(),
                    counter: Date.now()
                }
            };
            
            await producer.publishMessage(message);
        } catch (error) {
            console.error('❌ 自動發送失敗:', error.message);
        }
    }, interval);
}

// 主要執行邏輯
async function main() {
    const producer = new RabbitMQProducer();
    
    // 優雅關閉處理
    process.on('SIGINT', async () => {
        console.log('\n🛑 收到關閉信號，正在優雅關閉...');
        await producer.close();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('\n🛑 收到終止信號，正在優雅關閉...');
        await producer.close();
        process.exit(0);
    });
    
    // 連接並設定 RabbitMQ
    const connected = await producer.connect();
    if (connected) {
        await producer.setupExchange();
        
        // 啟動 Express 伺服器
        const app = createExpressApp(producer);
        const port = process.env.PORT || 3000;
        
        app.listen(port, () => {
            console.log(`🌐 Producer API 服務器已啟動，端口: ${port}`);
            console.log(`📡 API 端點:`);
            console.log(`   - GET  /health - 健康檢查`);
            console.log(`   - POST /send - 發送訊息`);
            console.log(`   - POST /send-batch - 批量發送`);
        });
        
        // 啟動自動發送（如果啟用）
        startAutoSender(producer);
    }
}

// 啟動 Producer
main().catch(error => {
    console.error('❌ Producer 啟動失敗:', error);
    process.exit(1);
});
