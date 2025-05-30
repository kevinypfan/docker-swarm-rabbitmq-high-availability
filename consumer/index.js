const amqp = require("amqplib");
require("dotenv").config();

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

const logger = createSimpleLogger('CONSUMER');

class RabbitMQConsumer {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;

    // 設定參數
    this.queueName = process.env.QUEUE_NAME || "test-queue";
    this.exchangeName = process.env.EXCHANGE_NAME || "test-exchange";
    this.routingKey = process.env.ROUTING_KEY || "test.message";
    this.consumerId =
      process.env.HOSTNAME ||
      `consumer-${Math.random().toString(36).substr(2, 9)}`;

    // RabbitMQ 連接設定（支援多個節點的 HA）
    this.rabbitmqUrl = process.env.RABBITMQ_URL || process.env.RABBITMQ_HOSTS || "amqp://admin:test1234@localhost:5672";
    this.rabbitmqHosts = Array.isArray(this.rabbitmqUrl) ? this.rabbitmqUrl : this.rabbitmqUrl.split(",");

    logger.info('Consumer initialized', {
      consumerId: this.consumerId,
      queue: this.queueName,
      exchange: this.exchangeName,
      routingKey: this.routingKey,
      hosts: this.rabbitmqHosts
    });
  }

  async connect() {
    try {
      console.log("🔌 嘗試連接到 RabbitMQ...");
      console.log(`連接 URL: ${this.rabbitmqHosts[0]}`);

      // 簡化連接邏輯 - 先嘗試第一個 host，如果失敗再嘗試其他的
      let connection = null;
      let lastError = null;

      for (const host of this.rabbitmqHosts) {
        try {
          console.log(`嘗試連接到: ${host}`);
          connection = await amqp.connect(host.trim(), {
            heartbeat: 60,
            timeout: 10000,
          });
          console.log(`✅ 成功連接到: ${host}`);
          break;
        } catch (error) {
          console.log(`❌ 連接失敗: ${host} - ${error.message}`);
          lastError = error;
          continue;
        }
      }

      if (!connection) {
        throw lastError || new Error("所有 RabbitMQ 主機連接失敗");
      }

      this.connection = connection;

      this.connection.on("error", (err) => {
        logger.error('RabbitMQ connection error', { error: err.message });
        this.channel = null;
        this.connection = null;
        this.reconnect();
      });

      this.connection.on("close", () => {
        logger.warn('RabbitMQ connection closed');
        this.channel = null;
        this.connection = null;
        this.reconnect();
      });

      this.channel = await this.connection.createChannel();
      logger.info('Channel created successfully');

      // 設定 QoS - 每次只處理一個訊息
      await this.channel.prefetch(1);

      // 重置重連計數器
      this.reconnectAttempts = 0;

      return true;
    } catch (error) {
      logger.error('Failed to connect to RabbitMQ', { error: error.message });
      this.reconnect();
      return false;
    }
  }

  async setupQueue() {
    try {
      // 簡化 queue 設定 - 先用基本設定測試
      const queueOptions = {
        durable: true,
        // 暫時移除 quorum 設定，使用傳統 queue
        // arguments: { "x-queue-type": "quorum" },
      };

      // 宣告 Queue（持久化）
      const queue = await this.channel.assertQueue(this.queueName, queueOptions);

      logger.info('Queue setup completed', { queue: queue.queue });

      // 如果有設定 exchange，才進行綁定
      if (this.exchangeName && this.exchangeName !== this.queueName) {
        // 宣告 Exchange（持久化）
        await this.channel.assertExchange(this.exchangeName, "topic", {
          durable: true,
        });

        // 綁定 Queue 到 Exchange
        await this.channel.bindQueue(
          queue.queue,
          this.exchangeName,
          this.routingKey
        );

        logger.info('Queue bound to exchange', {
          queue: queue.queue,
          exchange: this.exchangeName,
          routingKey: this.routingKey
        });
      }

      return queue.queue;
    } catch (error) {
      logger.error('Failed to setup queue', { error: error.message });
      throw error;
    }
  }

  async startConsuming() {
    try {
      const queueName = await this.setupQueue();

      logger.info('Starting message consumption', { 
        queue: queueName,
        consumerId: this.consumerId 
      });

      await this.channel.consume(
        queueName,
        async (message) => {
          if (message) {
            try {
              let content;
              try {
                // 嘗試解析 JSON，如果失敗就使用原始字串
                content = JSON.parse(message.content.toString());
              } catch {
                content = message.content.toString();
              }

              logger.info('Message received', {
                routingKey: message.fields.routingKey,
                content: typeof content === 'string' ? content.substring(0, 100) : content
              });

              // 模擬處理時間
              await this.processMessage(content);

              // 確認訊息已處理
              this.channel.ack(message);
              logger.debug('Message processed successfully');
            } catch (error) {
              logger.error('Failed to process message', { error: error.message });
              // 拒絕訊息並重新排隊
              this.channel.nack(message, false, true);
            }
          }
        },
        {
          noAck: false, // 需要手動確認
          consumerTag: this.consumerId,
        }
      );
    } catch (error) {
      logger.error('Failed to start consuming', { error: error.message });
      throw error;
    }
  }

  async processMessage(content) {
    // 模擬處理邏輯
    const processingTime = Math.random() * 2000 + 500; // 0.5-2.5秒
    logger.debug('Processing message', { 
      processingTime: Math.round(processingTime),
      content: typeof content === 'string' ? content.substring(0, 50) : content
    });

    await new Promise((resolve) => setTimeout(resolve, processingTime));

    // 在這裡加入你的實際業務邏輯
    logger.debug('Message processing completed');
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
      logger.info('Consumer connection closed gracefully');
    } catch (error) {
      logger.error('Error closing connection', { error: error.message });
    }
  }
}

// 主要執行邏輯
async function main() {
  const consumer = new RabbitMQConsumer();

  // 優雅關閉處理
  process.on("SIGINT", async () => {
    logger.info('Received shutdown signal, closing gracefully...');
    await consumer.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info('Received termination signal, closing gracefully...');
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
main().catch((error) => {
  logger.error('Consumer startup failed', { error: error.message });
  process.exit(1);
});
