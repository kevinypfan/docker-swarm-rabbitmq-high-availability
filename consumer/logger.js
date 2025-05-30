const pino = require('pino');

// 根據環境變數決定日誌等級和格式
const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// 建立日誌配置
const loggerConfig = {
  level: logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    }
  },
  // 生產環境使用 JSON 格式，開發環境使用 pretty 格式
  ...(isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        messageFormat: '{component} - {msg}',
        singleLine: false
      }
    }
  })
};

// 建立 logger 實例
const createLogger = (component) => {
  const logger = pino(loggerConfig);
  
  // 為每個組件添加預設的 component 欄位
  return logger.child({ component });
};

module.exports = {
  createLogger,
  logLevel,
  isDevelopment
};
