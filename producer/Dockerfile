FROM node:18-alpine

WORKDIR /app

# 複製 package.json 和 package-lock.json
COPY package*.json ./

# 安裝依賴
RUN npm install --only=production

# 複製應用程式碼
COPY . .

# 建立非 root 使用者
RUN addgroup -g 1001 -S nodejs
RUN adduser -S producer -u 1001

# 更改檔案擁有者
RUN chown -R producer:nodejs /app
USER producer

# 暴露埠
EXPOSE 3000

# 健康檢查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# 啟動應用
CMD ["npm", "start"]
