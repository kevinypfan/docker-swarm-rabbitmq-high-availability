# 使用官方 Node.js 18 Alpine 映像作為基底
FROM node:18-alpine

# 設定工作目錄
WORKDIR /app

# 安裝 dumb-init 以處理信號
RUN apk add --no-cache dumb-init

# 複製 package.json 和 package-lock.json（如果存在）
COPY package*.json ./

# 安裝依賴
RUN npm install --omit=dev && npm cache clean --force

# 創建非 root 用戶
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# 複製應用程式代碼
COPY index.js ./

# 設定權限
RUN chown -R nodejs:nodejs /app
USER nodejs

# 暴露端口（只在 producer 模式需要）
EXPOSE 3000

# 設定環境變數
ENV NODE_ENV=production
ENV MODE=consumer

# 健康檢查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD if [ "$MODE" = "producer" ] || [ "$MODE" = "both" ]; then \
        wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1; \
      else \
        ps aux | grep -q '[n]ode index.js' || exit 1; \
      fi

# 使用 dumb-init 啟動應用程式
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
