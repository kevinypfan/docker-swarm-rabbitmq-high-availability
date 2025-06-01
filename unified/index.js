const amqp = require("amqplib");
const express = require("express");
require("dotenv").config();

// 簡化的日誌設定
const isDev = process.env.NODE_ENV !== "production";
const createSimpleLogger = (component) => {
  const formatData = (data) => {
    if (!data || Object.keys(data).length === 0) return "";
    return ` | ${JSON.stringify(data)}`;
  };

  return {
    info: (msg, data = {}) =>
      console.log(`[INFO] ${component} - ${msg}${formatData(data)}`),
    error: (msg, data = {}) =>
      console.error(`[ERROR] ${component} - ${msg}${formatData(data)}`),
    warn: (msg, data = {}) =>
      console.warn(`[WARN] ${component} - ${msg}${formatData(data)}`),
    debug: (msg, data = {}) =>
      isDev && console.log(`[DEBUG] ${component} - ${msg}${formatData(data)}`),
  };
};

class RabbitMQClient {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;

    // 設定參數
    this.mode = process.env.MODE || "consumer"; // consumer, producer, both
    this.queueName = process.env.QUEUE_NAME || "test-queue";
    this.exchangeName = process.env.EXCHANGE_NAME || "test-exchange";
    this.routingKey = process.env.ROUTING_KEY || "test.message";
    this.clientId =
      process.env.HOSTNAME ||
      `client-${Math.random().toString(36).substr(2, 9)}`;

    // RabbitMQ 連接設定
    this.rabbitmqUrl =
      process.env.RABBITMQ_URL ||
      process.env.RABBITMQ_HOSTS ||
      "amqp://admin:test1234@localhost:5672";
    this.rabbitmqHosts = Array.isArray(this.rabbitmqUrl)
      ? this.rabbitmqUrl
      : this.rabbitmqUrl.split(",");

    this.logger = createSimpleLogger(`${this.mode.toUpperCase()}`);

    this.logger.info("RabbitMQ Client initialized", {
      mode: this.mode,
      clientId: this.clientId,
      queue: this.queueName,
      exchange: this.exchangeName,
      routingKey: this.routingKey,
      hosts: this.rabbitmqHosts,
    });
  }

  async connect() {
    try {
      this.logger.info("Attempting to connect to RabbitMQ");

      let connection = null;
      let lastError = null;

      for (const host of this.rabbitmqHosts) {
        try {
          this.logger.debug("Trying to connect", { host });
          connection = await amqp.connect(host.trim(), {
            heartbeat: 60,
            timeout: 10000,
          });
          this.logger.info("Connected to RabbitMQ", { host });
          break;
        } catch (error) {
          this.logger.warn("Connection failed", { host, error: error.message });
          lastError = error;
          continue;
        }
      }

      if (!connection) {
        throw lastError || new Error("所有 RabbitMQ 主機連接失敗");
      }

      this.connection = connection;

      this.connection.on("error", (err) => {
        this.logger.error("RabbitMQ connection error", { error: err.message });
        this.channel = null;
        this.connection = null;
        this.reconnect();
      });

      this.connection.on("close", () => {
        this.logger.warn("RabbitMQ connection closed");
        this.channel = null;
        this.connection = null;
        this.reconnect();
      });

      this.channel = await this.connection.createChannel();
      this.logger.info("Channel created successfully");

      // 設定 QoS（只在 consumer 模式需要）
      if (this.mode === "consumer" || this.mode === "both") {
        await this.channel.prefetch(1);
      }

      // 重置重連計數器
      this.reconnectAttempts = 0;
      return true;
    } catch (error) {
      this.logger.error("Failed to connect to RabbitMQ", {
        error: error.message,
      });
      this.reconnect();
      return false;
    }
  }

  async setupInfrastructure() {
    try {
      // 宣告 Exchange
      await this.channel.assertExchange(this.exchangeName, "topic", {
        durable: true,
      });

      // 宣告 Queue
      const queueOptions = {
        durable: true,
        arguments: {
          "x-queue-type": "quorum",
        },
      };
      const queue = await this.channel.assertQueue(
        this.queueName,
        queueOptions
      );

      // 綁定 Queue 到 Exchange
      await this.channel.bindQueue(
        queue.queue,
        this.exchangeName,
        this.routingKey
      );

      this.logger.info("Infrastructure setup completed", {
        exchange: this.exchangeName,
        queue: queue.queue,
        routingKey: this.routingKey,
      });

      return queue.queue;
    } catch (error) {
      this.logger.error("Failed to setup infrastructure", {
        error: error.message,
      });
      throw error;
    }
  }

  // Consumer 相關方法
  async startConsuming() {
    if (this.mode !== "consumer" && this.mode !== "both") {
      return;
    }

    try {
      const queueName = await this.setupInfrastructure();

      this.logger.info("Starting message consumption", {
        queue: queueName,
        clientId: this.clientId,
      });

      await this.channel.consume(
        queueName,
        async (message) => {
          if (message) {
            try {
              let content;
              try {
                content = JSON.parse(message.content.toString());
              } catch {
                content = message.content.toString();
              }

              this.logger.info("Message received", {
                routingKey: message.fields.routingKey,
                content:
                  typeof content === "string"
                    ? content.substring(0, 100)
                    : content,
              });

              await this.processMessage(content);
              this.channel.ack(message);
              this.logger.debug("Message processed successfully");
            } catch (error) {
              this.logger.error("Failed to process message", {
                error: error.message,
              });
              this.channel.nack(message, false, true);
            }
          }
        },
        {
          noAck: false,
          consumerTag: `${this.clientId}-consumer`,
        }
      );
    } catch (error) {
      this.logger.error("Failed to start consuming", { error: error.message });
      throw error;
    }
  }

  async processMessage(content) {
    const processingTime = Math.random() * 2000 + 500; // 0.5-2.5秒
    this.logger.debug("Processing message", {
      processingTime: Math.round(processingTime),
      content: typeof content === "string" ? content.substring(0, 50) : content,
    });

    await new Promise((resolve) => setTimeout(resolve, processingTime));
    this.logger.debug("Message processing completed");
  }

  // Producer 相關方法
  async publishMessage(message, routingKey = null) {
    if (!this.channel) {
      throw new Error("Channel 尚未建立");
    }

    const messageBuffer = Buffer.from(
      JSON.stringify({
        ...message,
        clientId: this.clientId,
        timestamp: new Date().toISOString(),
        messageId: Math.random().toString(36).substr(2, 9),
      })
    );

    const publishRoutingKey = routingKey || this.routingKey;

    const published = this.channel.publish(
      this.exchangeName,
      publishRoutingKey,
      messageBuffer,
      {
        persistent: true,
        messageId: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        appId: this.clientId,
      }
    );

    if (published) {
      this.logger.info("Message published successfully", {
        exchange: this.exchangeName,
        routingKey: publishRoutingKey,
        messageSize: messageBuffer.length,
      });
      return true;
    } else {
      this.logger.warn("Message publish failed - buffer full");
      return false;
    }
  }

  async reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error("Max reconnect attempts exceeded", {
        attempts: this.maxReconnectAttempts,
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
    this.logger.info("Attempting to reconnect", {
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
    });

    setTimeout(async () => {
      const connected = await this.connect();
      if (connected && this.connection && this.channel) {
        await this.start();
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
      this.logger.info("Connection closed gracefully");
    } catch (error) {
      this.logger.error("Error closing connection", { error: error.message });
    }
  }

  async start() {
    // 設定基礎設施
    await this.setupInfrastructure();

    // 根據模式啟動相應功能
    if (this.mode === "consumer" || this.mode === "both") {
      await this.startConsuming();
    }

    if (this.mode === "producer" || this.mode === "both") {
      this.startProducerAPI();
      this.startAutoSender();
    }
  }

  // Producer API 伺服器
  startProducerAPI() {
    const app = express();
    app.use(express.json());

    // 健康檢查端點
    app.get("/health", (req, res) => {
      res.json({
        status: "ok",
        mode: this.mode,
        clientId: this.clientId,
        connected: !!this.connection,
        timestamp: new Date().toISOString(),
      });
    });

    // 發送訊息端點
    app.post("/send", async (req, res) => {
      try {
        const { message, routingKey } = req.body;

        if (!message) {
          return res.status(400).json({ error: "訊息內容不能為空" });
        }

        await this.publishMessage(message, routingKey);

        res.json({
          success: true,
          message: "訊息發送成功",
          clientId: this.clientId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        this.logger.error("API send message failed", { error: error.message });
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });

    // 批量發送訊息端點
    app.post("/send-batch", async (req, res) => {
      try {
        const { messages, routingKey, count = 10 } = req.body;

        const results = [];
        const messagesToSend =
          messages ||
          Array.from({ length: count }, (_, i) => ({
            id: i + 1,
            content: `批量測試訊息 #${i + 1}`,
            batch: true,
          }));

        for (const message of messagesToSend) {
          try {
            await this.publishMessage(message, routingKey);
            results.push({ success: true, message });
          } catch (error) {
            results.push({ success: false, message, error: error.message });
          }
        }

        res.json({
          success: true,
          total: messagesToSend.length,
          successful: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
          clientId: this.clientId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        this.logger.error("API batch send failed", { error: error.message });
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });

    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      this.logger.info("Producer API server started", { port });
      this.logger.info("API endpoints available", {
        health: `GET /health`,
        send: `POST /send`,
        batch: `POST /send-batch`,
      });
    });
  }

  // 自動發送訊息
  startAutoSender() {
    const interval = parseInt(process.env.AUTO_SEND_INTERVAL) || 10000;
    const autoSend = process.env.AUTO_SEND === "true";

    if (!autoSend) {
      this.logger.info("Auto send disabled");
      return;
    }

    this.logger.info("Auto send enabled", { interval });

    setInterval(async () => {
      try {
        const message = {
          type: "auto",
          content: `自動生成訊息 - ${new Date().toISOString()}`,
          data: {
            randomValue: Math.random(),
            counter: Date.now(),
          },
        };

        await this.publishMessage(message);
      } catch (error) {
        this.logger.error("Auto send failed", { error: error.message });
      }
    }, interval);
  }
}

// 主要執行邏輯
async function main() {
  const client = new RabbitMQClient();

  // 優雅關閉處理
  process.on("SIGINT", async () => {
    console.log("\n🛑 收到關閉信號，正在優雅關閉...");
    await client.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\n🛑 收到終止信號，正在優雅關閉...");
    await client.close();
    process.exit(0);
  });

  // 連接並啟動
  const connected = await client.connect();
  if (connected) {
    await client.start();
    console.log(`🚀 RabbitMQ Client started in ${client.mode} mode`);
  }
}

// 啟動應用程式
main().catch((error) => {
  console.error("❌ Application startup failed:", error);
  process.exit(1);
});
