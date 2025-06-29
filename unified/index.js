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
    this.mode = process.env.MODE || "consumer"; // consumer, producer, both, stats
    this.queueName = process.env.QUEUE_NAME || "test-queue";
    this.exchangeName = process.env.EXCHANGE_NAME || "test-exchange";
    this.routingKey = process.env.ROUTING_KEY || "test.message";
    this.clientId =
      process.env.HOSTNAME ||
      `client-${Math.random().toString(36).substr(2, 9)}`;

    // 可靠性監控相關
    this.sequenceNumber = 0;
    this.statsQueueName = process.env.STATS_QUEUE || "reliability-stats";
    this.statsExchangeName = process.env.STATS_EXCHANGE || "stats-exchange";
    this.receivedSequences = new Set();
    this.lastReceivedSequence = 0;
    this.statsBuffer = [];

    // 訊息遺失檢測相關
    this.producerSequences = new Map(); // 追蹤每個 producer 的序號
    this.producerHeartbeats = new Map(); // 追蹤每個 producer 的心跳
    this.heartbeatInterval = parseInt(process.env.HEARTBEAT_INTERVAL) || 10000; // 10秒

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
      // 宣告主要 Exchange
      await this.channel.assertExchange(this.exchangeName, "topic", {
        durable: true,
      });

      // 宣告統計 Exchange
      await this.channel.assertExchange(this.statsExchangeName, "topic", {
        durable: true,
      });

      // 宣告主要 Queue
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

      // 宣告統計 Queue
      const statsQueue = await this.channel.assertQueue(
        this.statsQueueName,
        queueOptions
      );

      // 綁定主要 Queue 到 Exchange
      await this.channel.bindQueue(
        queue.queue,
        this.exchangeName,
        this.routingKey
      );

      // 綁定統計 Queue 到統計 Exchange
      await this.channel.bindQueue(
        statsQueue.queue,
        this.statsExchangeName,
        "stats.*"
      );

      this.logger.info("Infrastructure setup completed", {
        exchange: this.exchangeName,
        queue: queue.queue,
        routingKey: this.routingKey,
        statsExchange: this.statsExchangeName,
        statsQueue: statsQueue.queue,
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
    const processingTime = Math.random() * 1000;
    const receivedTimestamp = new Date().toISOString();
    
    this.logger.debug("Processing message", {
      processingTime: Math.round(processingTime),
      content: typeof content === "string" ? content.substring(0, 50) : content,
    });

    // 可靠性監控：分析訊息
    let reliabilityStats = null;
    if (content && typeof content === 'object' && content.sequenceNumber) {
      reliabilityStats = this.analyzeMessageReliability(content, receivedTimestamp);
    }

    await new Promise((resolve) => setTimeout(resolve, processingTime));
    
    // 發送統計資料到統計 queue
    if (reliabilityStats) {
      await this.sendReliabilityStats(reliabilityStats);
    }
    
    this.logger.debug("Message processing completed");
  }

  analyzeMessageReliability(message, receivedTimestamp) {
    const { sequenceNumber, clientId, messageId, timestamp: sentTimestamp } = message;
    
    // 檢測重複訊息
    const isDuplicate = this.receivedSequences.has(messageId);
    if (!isDuplicate) {
      this.receivedSequences.add(messageId);
    }

    // 檢測亂序訊息
    const isOutOfOrder = sequenceNumber <= this.lastReceivedSequence;
    if (sequenceNumber > this.lastReceivedSequence) {
      this.lastReceivedSequence = sequenceNumber;
    }

    // 計算傳輸延遲
    const sentTime = new Date(sentTimestamp);
    const receivedTime = new Date(receivedTimestamp);
    const latency = receivedTime - sentTime;

    return {
      messageId,
      sequenceNumber,
      producerClientId: clientId,
      consumerClientId: this.clientId,
      sentTimestamp,
      receivedTimestamp,
      latency,
      isDuplicate,
      isOutOfOrder,
      consumerMode: this.mode,
      originalMessage: {
        type: message.type || 'unknown',
        content: typeof message.content === 'string' ? message.content.substring(0, 100) : message.content
      }
    };
  }

  async sendReliabilityStats(stats) {
    try {
      if (!this.channel) {
        this.logger.warn("Cannot send stats - channel not available");
        return;
      }

      const statsMessage = {
        type: 'message_received',
        stats,
        timestamp: new Date().toISOString(),
        reporterId: this.clientId
      };

      const messageBuffer = Buffer.from(JSON.stringify(statsMessage));
      
      const published = this.channel.publish(
        this.statsExchangeName,
        'stats.message_received',
        messageBuffer,
        {
          persistent: true,
          timestamp: Date.now(),
          appId: this.clientId,
        }
      );

      if (published) {
        this.logger.debug("Reliability stats sent", {
          messageId: stats.messageId,
          sequenceNumber: stats.sequenceNumber,
          isDuplicate: stats.isDuplicate,
          isOutOfOrder: stats.isOutOfOrder,
          latency: stats.latency
        });
      }
    } catch (error) {
      this.logger.error("Failed to send reliability stats", { error: error.message });
    }
  }

  // Producer 相關方法
  async publishMessage(message, routingKey = null) {
    if (!this.channel) {
      throw new Error("Channel 尚未建立");
    }

    // 增加序列號
    this.sequenceNumber++;
    const messageId = `${this.clientId}-${this.sequenceNumber}`;

    const enhancedMessage = {
      ...message,
      clientId: this.clientId,
      timestamp: new Date().toISOString(),
      messageId: messageId,
      sequenceNumber: this.sequenceNumber,
      producerInfo: {
        mode: this.mode,
        hostname: process.env.HOSTNAME || 'unknown'
      }
    };

    const messageBuffer = Buffer.from(JSON.stringify(enhancedMessage));
    const publishRoutingKey = routingKey || this.routingKey;

    const published = this.channel.publish(
      this.exchangeName,
      publishRoutingKey,
      messageBuffer,
      {
        persistent: true,
        messageId: messageId,
        timestamp: Date.now(),
        appId: this.clientId,
      }
    );

    if (published) {
      this.logger.info("Message published successfully", {
        exchange: this.exchangeName,
        routingKey: publishRoutingKey,
        messageId: messageId,
        sequenceNumber: this.sequenceNumber,
        messageSize: messageBuffer.length,
      });
      return { success: true, sequenceNumber: this.sequenceNumber, messageId };
    } else {
      this.logger.warn("Message publish failed - buffer full");
      return { success: false, sequenceNumber: this.sequenceNumber, messageId };
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
      this.startHeartbeat();
    }

    if (this.mode === "stats") {
      await this.startStatsCollection();
      this.startStatsAPI();
    }
  }

  // 統計收集相關方法
  async startStatsCollection() {
    try {
      const queueName = this.statsQueueName;
      
      this.logger.info("Starting statistics collection", {
        queue: queueName,
        clientId: this.clientId,
      });

      await this.channel.consume(
        queueName,
        async (message) => {
          if (message) {
            try {
              const statsData = JSON.parse(message.content.toString());
              await this.processStatsMessage(statsData);
              this.channel.ack(message);
            } catch (error) {
              this.logger.error("Failed to process stats message", {
                error: error.message,
              });
              this.channel.nack(message, false, false); // 丟棄錯誤訊息
            }
          }
        },
        {
          noAck: false,
          consumerTag: `${this.clientId}-stats-consumer`,
        }
      );

      // 定期產生統計報告
      this.startPeriodicReporting();
      
    } catch (error) {
      this.logger.error("Failed to start stats collection", { error: error.message });
      throw error;
    }
  }

  async processStatsMessage(statsData) {
    if (statsData.type === 'message_received' && statsData.stats) {
      const stats = statsData.stats;
      
      this.logger.info("Reliability event recorded", {
        messageId: stats.messageId,
        sequenceNumber: stats.sequenceNumber,
        producer: stats.producerClientId,
        consumer: stats.consumerClientId,
        latency: `${stats.latency}ms`,
        isDuplicate: stats.isDuplicate,
        isOutOfOrder: stats.isOutOfOrder,
      });

      // 儲存到統計緩衝區進行分析
      this.statsBuffer.push({
        ...stats,
        processedAt: new Date().toISOString()
      });

      // 更新 producer 序號追蹤
      this.updateProducerSequences(stats.producerClientId, stats.sequenceNumber);

      // 如果緩衝區太大，移除舊的資料
      if (this.statsBuffer.length > 10000) {
        this.statsBuffer = this.statsBuffer.slice(-5000);
      }
    }
    
    // 處理 producer 心跳
    if (statsData.type === 'heartbeat') {
      this.processProducerHeartbeat(statsData);
    }
  }

  updateProducerSequences(producerId, sequenceNumber) {
    if (!this.producerSequences.has(producerId)) {
      this.producerSequences.set(producerId, new Set());
    }
    
    const sequences = this.producerSequences.get(producerId);
    sequences.add(sequenceNumber);
    
    // 限制儲存的序號數量，避免記憶體過度使用
    if (sequences.size > 50000) {
      const sortedSequences = Array.from(sequences).sort((a, b) => a - b);
      const keepSequences = sortedSequences.slice(-25000);
      this.producerSequences.set(producerId, new Set(keepSequences));
    }
  }

  processProducerHeartbeat(heartbeatData) {
    const { producerId, currentSequence, totalSent, timestamp } = heartbeatData;
    
    this.producerHeartbeats.set(producerId, {
      currentSequence,
      totalSent,
      timestamp,
      lastSeen: new Date().toISOString()
    });

    this.logger.debug("Producer heartbeat received", {
      producerId,
      currentSequence,
      totalSent,
      timestamp
    });
  }

  startPeriodicReporting() {
    const reportInterval = parseInt(process.env.STATS_REPORT_INTERVAL) || 30000; // 30秒
    
    this.logger.info("Starting periodic reliability reporting", { 
      interval: `${reportInterval}ms` 
    });

    setInterval(() => {
      this.generateReliabilityReport();
    }, reportInterval);
  }

  generateReliabilityReport() {
    if (this.statsBuffer.length === 0) {
      this.logger.debug("No statistics data available for reporting");
      return;
    }

    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    
    // 過濾最近5分鐘的資料
    const recentStats = this.statsBuffer.filter(stat => 
      new Date(stat.receivedTimestamp) > fiveMinutesAgo
    );

    if (recentStats.length === 0) {
      this.logger.debug("No recent statistics data for reporting");
      return;
    }

    // 計算統計指標
    const totalMessages = recentStats.length;
    const duplicateMessages = recentStats.filter(s => s.isDuplicate).length;
    const outOfOrderMessages = recentStats.filter(s => s.isOutOfOrder).length;
    const latencies = recentStats.map(s => s.latency).filter(l => l >= 0);
    
    const avgLatency = latencies.length > 0 ? 
      latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;
    const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;

    // 按 producer 分組統計
    const producerStats = {};
    recentStats.forEach(stat => {
      const producer = stat.producerClientId;
      if (!producerStats[producer]) {
        producerStats[producer] = { count: 0, sequences: [] };
      }
      producerStats[producer].count++;
      producerStats[producer].sequences.push(stat.sequenceNumber);
    });

    this.logger.info("=== Reliability Report (Last 5 minutes) ===", {
      period: "5 minutes",
      totalMessages,
      duplicateMessages,
      duplicateRate: `${(duplicateMessages/totalMessages*100).toFixed(2)}%`,
      outOfOrderMessages,
      outOfOrderRate: `${(outOfOrderMessages/totalMessages*100).toFixed(2)}%`,
      latencyStats: {
        avg: `${avgLatency.toFixed(0)}ms`,
        min: `${minLatency}ms`,
        max: `${maxLatency}ms`
      },
      producers: Object.keys(producerStats).length,
      producerBreakdown: Object.entries(producerStats).map(([producer, stats]) => ({
        producer,
        messageCount: stats.count,
        sequenceRange: `${Math.min(...stats.sequences)}-${Math.max(...stats.sequences)}`
      }))
    });
  }

  // Stats API 伺服器
  startStatsAPI() {
    const app = express();
    app.use(express.json());

    // 允許 CORS
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    });

    // 健康檢查端點
    app.get("/health", (req, res) => {
      res.json({
        status: "ok",
        mode: this.mode,
        clientId: this.clientId,
        connected: !!this.connection,
        timestamp: new Date().toISOString(),
        statsBufferSize: this.statsBuffer.length
      });
    });

    // 統計摘要端點
    app.get("/stats", (req, res) => {
      try {
        const stats = this.getCurrentStats();
        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          ...stats
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 詳細統計端點
    app.get("/stats/detailed", (req, res) => {
      try {
        const detailed = this.getDetailedStats();
        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          ...detailed
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Producer 統計端點
    app.get("/stats/producers", (req, res) => {
      try {
        const producers = this.getProducerStats();
        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          producers
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // 即時統計流端點 (Server-Sent Events)
    app.get("/stats/live", (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      const sendStats = () => {
        try {
          const stats = this.getCurrentStats();
          res.write(`data: ${JSON.stringify(stats)}\n\n`);
        } catch (error) {
          res.write(`data: ${JSON.stringify({error: error.message})}\n\n`);
        }
      };

      // 立即發送一次
      sendStats();

      // 每5秒發送一次
      const interval = setInterval(sendStats, 5000);

      req.on('close', () => {
        clearInterval(interval);
      });
    });

    // 簡單的 HTML 儀表板
    app.get("/", (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>RabbitMQ Reliability Statistics</title>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
            .container { max-width: 1200px; margin: 0 auto; }
            .card { background: white; padding: 20px; margin: 10px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .metric { display: inline-block; margin: 10px 20px 10px 0; }
            .metric-value { font-size: 24px; font-weight: bold; color: #2196F3; }
            .metric-label { font-size: 14px; color: #666; }
            .error { color: #f44336; }
            .success { color: #4CAF50; }
            .warning { color: #FF9800; }
            .refresh-btn { background: #2196F3; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
            .refresh-btn:hover { background: #1976D2; }
            pre { background: #f0f0f0; padding: 10px; border-radius: 4px; overflow-x: auto; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🐰 RabbitMQ Reliability Statistics</h1>
            
            <div class="card">
              <h2>📊 Current Metrics</h2>
              <button class="refresh-btn" onclick="loadStats()">🔄 Refresh</button>
              <div id="metrics"></div>
            </div>

            <div class="card">
              <h2>📈 Live Stream</h2>
              <div id="live-status">Connecting...</div>
              <div id="live-data"></div>
            </div>

            <div class="card">
              <h2>🔍 Detailed Statistics</h2>
              <pre id="detailed-stats">Loading...</pre>
            </div>

            <div class="card">
              <h2>🏭 Producer Statistics</h2>
              <pre id="producer-stats">Loading...</pre>
            </div>
          </div>

          <script>
            function loadStats() {
              fetch('/stats')
                .then(r => r.json())
                .then(data => {
                  if (data.success) {
                    document.getElementById('metrics').innerHTML = \`
                      <div class="metric">
                        <div class="metric-value">\${data.totalMessages || 0}</div>
                        <div class="metric-label">Total Messages</div>
                      </div>
                      <div class="metric">
                        <div class="metric-value \${(data.duplicateRate && parseFloat(data.duplicateRate) > 5) ? 'error' : 'success'}">\${data.duplicateRate || '0%'}</div>
                        <div class="metric-label">Duplicate Rate</div>
                      </div>
                      <div class="metric">
                        <div class="metric-value \${(data.outOfOrderRate && parseFloat(data.outOfOrderRate) > 5) ? 'error' : 'success'}">\${data.outOfOrderRate || '0%'}</div>
                        <div class="metric-label">Out of Order Rate</div>
                      </div>
                      <div class="metric">
                        <div class="metric-value">\${data.avgLatency || '0ms'}</div>
                        <div class="metric-label">Avg Latency</div>
                      </div>
                      <div class="metric">
                        <div class="metric-value \${(data.lossRate && parseFloat(data.lossRate) > 0.1) ? 'error' : 'success'}">\${data.lossRate || '0%'}</div>
                        <div class="metric-label">Message Loss Rate</div>
                      </div>
                      <div class="metric">
                        <div class="metric-value \${(data.missingMessages && data.missingMessages > 0) ? 'warning' : 'success'}">\${data.missingMessages || 0}</div>
                        <div class="metric-label">Missing Messages</div>
                      </div>
                    \`;
                  }
                })
                .catch(err => {
                  document.getElementById('metrics').innerHTML = '<div class="error">Error loading stats: ' + err.message + '</div>';
                });
            }

            function loadDetailed() {
              fetch('/stats/detailed')
                .then(r => r.json())
                .then(data => {
                  document.getElementById('detailed-stats').textContent = JSON.stringify(data, null, 2);
                })
                .catch(err => {
                  document.getElementById('detailed-stats').textContent = 'Error: ' + err.message;
                });
            }

            function loadProducers() {
              fetch('/stats/producers')
                .then(r => r.json())
                .then(data => {
                  document.getElementById('producer-stats').textContent = JSON.stringify(data, null, 2);
                })
                .catch(err => {
                  document.getElementById('producer-stats').textContent = 'Error: ' + err.message;
                });
            }

            function setupLiveStream() {
              const eventSource = new EventSource('/stats/live');
              
              eventSource.onopen = function(event) {
                document.getElementById('live-status').innerHTML = '<span class="success">✅ Connected to live stream</span>';
              };
              
              eventSource.onmessage = function(event) {
                const data = JSON.parse(event.data);
                if (data.error) {
                  document.getElementById('live-data').innerHTML = '<div class="error">Error: ' + data.error + '</div>';
                } else {
                  document.getElementById('live-data').innerHTML = \`
                    <div style="font-size: 12px; color: #666;">Last update: \${new Date().toLocaleTimeString()}</div>
                    <div>Messages: \${data.totalMessages || 0} | Duplicates: \${data.duplicateRate || '0%'} | Out of Order: \${data.outOfOrderRate || '0%'} | Loss Rate: \${data.lossRate || '0%'} | Latency: \${data.avgLatency || '0ms'}</div>
                  \`;
                }
              };
              
              eventSource.onerror = function(event) {
                document.getElementById('live-status').innerHTML = '<span class="error">❌ Connection error</span>';
              };
            }

            // 初始載入
            loadStats();
            loadDetailed();
            loadProducers();
            setupLiveStream();

            // 定期刷新
            setInterval(loadStats, 10000);
            setInterval(loadDetailed, 30000);
            setInterval(loadProducers, 30000);
          </script>
        </body>
        </html>
      `);
    });

    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      this.logger.info("Stats API server started", { port });
      this.logger.info("Stats API endpoints available", {
        dashboard: `http://localhost:${port}/`,
        health: `GET /health`,
        stats: `GET /stats`,
        detailed: `GET /stats/detailed`,
        producers: `GET /stats/producers`,
        live: `GET /stats/live`
      });
    });
  }

  getCurrentStats() {
    if (this.statsBuffer.length === 0) {
      return {
        totalMessages: 0,
        duplicateMessages: 0,
        duplicateRate: "0%",
        outOfOrderMessages: 0, 
        outOfOrderRate: "0%",
        avgLatency: "0ms",
        maxLatency: "0ms",
        minLatency: "0ms",
        lossRate: "0%",
        missingMessages: 0,
        totalExpected: 0
      };
    }

    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const recentStats = this.statsBuffer.filter(stat => 
      new Date(stat.receivedTimestamp) > fiveMinutesAgo
    );

    if (recentStats.length === 0) {
      return {
        totalMessages: 0,
        duplicateMessages: 0,
        duplicateRate: "0%",
        outOfOrderMessages: 0,
        outOfOrderRate: "0%", 
        avgLatency: "0ms",
        maxLatency: "0ms",
        minLatency: "0ms",
        lossRate: "0%",
        missingMessages: 0,
        totalExpected: 0
      };
    }

    const totalMessages = recentStats.length;
    const duplicateMessages = recentStats.filter(s => s.isDuplicate).length;
    const outOfOrderMessages = recentStats.filter(s => s.isOutOfOrder).length;
    const latencies = recentStats.map(s => s.latency).filter(l => l >= 0);
    
    const avgLatency = latencies.length > 0 ? 
      latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;
    const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;

    // 計算訊息遺失率
    const lossStats = this.calculateMessageLoss();

    return {
      totalMessages,
      duplicateMessages,
      duplicateRate: `${(duplicateMessages/totalMessages*100).toFixed(2)}%`,
      outOfOrderMessages,
      outOfOrderRate: `${(outOfOrderMessages/totalMessages*100).toFixed(2)}%`,
      avgLatency: `${avgLatency.toFixed(0)}ms`,
      maxLatency: `${maxLatency}ms`,
      minLatency: `${minLatency}ms`,
      lossRate: lossStats.lossRate,
      missingMessages: lossStats.missingMessages,
      totalExpected: lossStats.totalExpected
    };
  }

  calculateMessageLoss() {
    let totalExpected = 0;
    let totalReceived = 0;
    let missingMessages = 0;

    // 檢查每個 producer 的訊息遺失情況
    for (const [producerId, heartbeat] of this.producerHeartbeats.entries()) {
      const expectedSequences = heartbeat.totalSent;
      const receivedSequences = this.producerSequences.get(producerId);
      
      if (receivedSequences) {
        const receivedCount = receivedSequences.size;
        totalExpected += expectedSequences;
        totalReceived += receivedCount;
        
        // 計算遺失的序號
        const missing = expectedSequences - receivedCount;
        if (missing > 0) {
          missingMessages += missing;
        }
      } else {
        // 如果沒有收到任何訊息，全部算遺失
        totalExpected += expectedSequences;
        missingMessages += expectedSequences;
      }
    }

    const lossRate = totalExpected > 0 ? 
      `${(missingMessages/totalExpected*100).toFixed(2)}%` : "0%";

    return {
      totalExpected,
      totalReceived,
      missingMessages,
      lossRate
    };
  }

  getDetailedStats() {
    const current = this.getCurrentStats();
    const bufferSize = this.statsBuffer.length;
    const oldestEntry = this.statsBuffer.length > 0 ? this.statsBuffer[0].receivedTimestamp : null;
    const newestEntry = this.statsBuffer.length > 0 ? this.statsBuffer[this.statsBuffer.length - 1].receivedTimestamp : null;

    return {
      ...current,
      bufferInfo: {
        totalEntries: bufferSize,
        oldestEntry,
        newestEntry
      },
      period: "Last 5 minutes"
    };
  }

  getProducerStats() {
    if (this.statsBuffer.length === 0) {
      return [];
    }

    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const recentStats = this.statsBuffer.filter(stat => 
      new Date(stat.receivedTimestamp) > fiveMinutesAgo
    );

    const producerStats = {};
    recentStats.forEach(stat => {
      const producer = stat.producerClientId;
      if (!producerStats[producer]) {
        producerStats[producer] = { 
          count: 0, 
          sequences: [], 
          duplicates: 0, 
          outOfOrder: 0,
          latencies: []
        };
      }
      producerStats[producer].count++;
      producerStats[producer].sequences.push(stat.sequenceNumber);
      if (stat.isDuplicate) producerStats[producer].duplicates++;
      if (stat.isOutOfOrder) producerStats[producer].outOfOrder++;
      if (stat.latency >= 0) producerStats[producer].latencies.push(stat.latency);
    });

    return Object.entries(producerStats).map(([producer, stats]) => {
      const avgLatency = stats.latencies.length > 0 ? 
        stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length : 0;
      
      // 獲取 producer 的心跳資訊和遺失統計
      const heartbeat = this.producerHeartbeats.get(producer);
      const receivedSequences = this.producerSequences.get(producer);
      
      let lossInfo = {
        expectedMessages: 0,
        receivedMessages: stats.count,
        missingMessages: 0,
        lossRate: "0%"
      };

      if (heartbeat && receivedSequences) {
        const expected = heartbeat.totalSent;
        const received = receivedSequences.size;
        const missing = Math.max(0, expected - received);
        
        lossInfo = {
          expectedMessages: expected,
          receivedMessages: received,
          missingMessages: missing,
          lossRate: expected > 0 ? `${(missing/expected*100).toFixed(2)}%` : "0%"
        };
      }
      
      return {
        producer,
        messageCount: stats.count,
        sequenceRange: stats.sequences.length > 0 ? 
          `${Math.min(...stats.sequences)}-${Math.max(...stats.sequences)}` : 'N/A',
        duplicateCount: stats.duplicates,
        duplicateRate: `${(stats.duplicates/stats.count*100).toFixed(2)}%`,
        outOfOrderCount: stats.outOfOrder,
        outOfOrderRate: `${(stats.outOfOrder/stats.count*100).toFixed(2)}%`,
        avgLatency: `${avgLatency.toFixed(0)}ms`,
        ...lossInfo,
        lastHeartbeat: heartbeat ? heartbeat.lastSeen : null
      };
    });
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

  // Producer 心跳機制
  startHeartbeat() {
    if (this.mode !== "producer" && this.mode !== "both") {
      return;
    }

    this.logger.info("Starting producer heartbeat", { 
      interval: `${this.heartbeatInterval}ms` 
    });

    setInterval(async () => {
      try {
        const heartbeatMessage = {
          type: "heartbeat",
          producerId: this.clientId,
          currentSequence: this.sequenceNumber,
          totalSent: this.sequenceNumber,
          timestamp: new Date().toISOString()
        };

        // 發送心跳到統計 exchange
        const messageBuffer = Buffer.from(JSON.stringify(heartbeatMessage));
        
        const published = this.channel.publish(
          this.statsExchangeName,
          'stats.heartbeat',
          messageBuffer,
          {
            persistent: false, // 心跳訊息不需要持久化
            timestamp: Date.now(),
            appId: this.clientId,
          }
        );

        if (published) {
          this.logger.debug("Heartbeat sent", {
            currentSequence: this.sequenceNumber,
            totalSent: this.sequenceNumber
          });
        }
      } catch (error) {
        this.logger.error("Failed to send heartbeat", { error: error.message });
      }
    }, this.heartbeatInterval);
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
