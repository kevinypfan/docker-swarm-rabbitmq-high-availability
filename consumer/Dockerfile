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
RUN adduser -S consumer -u 1001

# 更改檔案擁有者
RUN chown -R consumer:nodejs /app
USER consumer

# 暴露埠（如果需要健康檢查）
EXPOSE 3000

# 啟動應用
CMD ["npm", "start"]
