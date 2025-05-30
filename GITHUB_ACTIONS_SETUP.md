# GitHub Actions 設定說明

## 🔧 必要的 Secrets 設定

在 GitHub 專案中設定以下 Secrets（Settings > Secrets and variables > Actions）：

### Docker Hub 發布設定

1. **DOCKER_HUB_USERNAME**: `kevinypfan`
   - 你的 Docker Hub 用戶名

2. **DOCKER_HUB_TOKEN**: `your-docker-hub-access-token`
   - Docker Hub Access Token（推薦使用而非密碼）

> 💡 如何創建 Docker Hub Access Token：
> 1. 登入 Docker Hub
> 2. 前往 Account Settings > Security > New Access Token
> 3. 創建名為 "GitHub Actions" 的 token
> 4. 複製 token 到 GitHub Secrets

## 🚀 GitHub Actions 工作流程

### 📋 工作流程文件

1. **`.github/workflows/test.yml`** - 測試工作流程
   - 在每次 push 和 PR 時運行
   - 執行語法檢查
   - 建置 Docker 映像
   - 測試不同運行模式

2. **`.github/workflows/docker-publish.yml`** - 建置和發布工作流程
   - 建置多平台映像 (amd64, arm64)
   - 發布到 Docker Hub
   - 自動標籤管理

### 🏷️ 標籤策略

GitHub Actions 會自動創建以下標籤：

- **latest** - main/master 分支的最新版本
- **分支名稱** - 每個分支的最新版本
- **v1.0.0** - Git tag 版本
- **v1.0** - 主要.次要版本
- **v1** - 主要版本

### 📋 觸發條件

#### 測試工作流程 (test.yml)
- Push 到 main, master, develop 分支
- Pull Request 到 main, master 分支

#### 發布工作流程 (docker-publish.yml)
- Push 到 main, master, develop 分支 → 發布映像
- Push Git tags (v*) → 發布版本標籤
- Pull Request → 只建置不發布

### 🔍 工作流程範例

```bash
# 推送到 main 分支 - 觸發測試和發布 latest
git push origin main

# 創建版本標籤 - 觸發版本發布
git tag v1.0.0
git push origin v1.0.0

# 推送到功能分支 - 只測試和建置
git push origin feature/new-feature

# 創建 PR - 只測試
gh pr create --title "New feature" --body "Description"
```

## 📦 發布結果

成功的工作流程會產生：

- **Docker Hub**: `kevinypfan/rabbitmq-tester:latest`
- **版本標籤**: `kevinypfan/rabbitmq-tester:v1.0.0`
- **分支標籤**: `kevinypfan/rabbitmq-tester:main`

## 🔍 監控工作流程

1. 前往 GitHub 專案的 **Actions** 頁面
2. 查看工作流程執行狀態
3. 檢查建置日誌和測試結果

## 🐛 故障排除

### 常見問題

1. **Docker Hub 登入失敗**
   ```
   Error: Cannot perform an interactive login from a non TTY device
   ```
   - 檢查 DOCKER_HUB_USERNAME 和 DOCKER_HUB_TOKEN 是否正確設定
   - 確認 Docker Hub token 有推送權限

2. **映像建置失敗**
   ```
   ERROR: failed to solve: failed to read dockerfile
   ```
   - 檢查 Dockerfile 路徑是否正確 (./unified)
   - 確認所有檔案都已提交到 Git

3. **測試失敗**
   - 查看 Actions 日誌中的詳細錯誤訊息
   - 檢查 Node.js 語法或 Docker 容器啟動問題

### 手動觸發工作流程

1. 前往 GitHub 專案的 Actions 頁面
2. 選擇要運行的工作流程
3. 點擊 "Run workflow" 按鈕

## 📊 狀態徽章

可以在 README.md 中加入狀態徽章：

```markdown
![Test](https://github.com/kevinypfan/rabbitmq-ha/workflows/Test/badge.svg)
![Docker](https://github.com/kevinypfan/rabbitmq-ha/workflows/Build%20and%20Publish%20Docker%20Image/badge.svg)
```

## 🎯 最佳實踐

1. **保護主分支** - 設定分支保護規則要求 PR 和測試通過
2. **語義化版本** - 使用 v1.0.0 格式的 Git tags
3. **定期更新** - 保持 Actions 版本為最新
4. **監控使用量** - 注意 GitHub Actions 的使用限制

使用映像：
```bash
docker pull kevinypfan/rabbitmq-tester:latest
docker run -e MODE=consumer kevinypfan/rabbitmq-tester:latest
```
