# 設定指南

本指南將幫助你完成 OpenCode Discord Bot 的完整設定。

## 目錄
1. [環境準備](#環境準備)
2. [Discord Bot 設定](#discord-bot-設定)
3. [環境變數設定](#環境變數設定)
4. [資料庫設定](#資料庫設定)
5. [部署上線](#部署上線)

---

## 環境準備

### 必要軟體

| 軟體 | 版本需求 | 說明 |
|-----|---------|------|
| Node.js | 18+ | 建議使用 LTS 版本 |
| npm | 9+ | 或使用 yarn/pnpm |
| Git | 2.x | 用於版本控制 |

### 安裝 Node.js

**macOS (使用 Homebrew)**:
```bash
brew install nodejs
```

**Ubuntu/Debian**:
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Windows**:
從 [Node.js 官網](https://nodejs.org/) 下載安裝程式

### 驗證安裝

```bash
node --version  # 應該顯示 v18.x.x 或更高
npm --version   # 應該顯示 9.x.x 或更高
```

---

## Discord Bot 設定

### 步驟 1: 建立應用程式

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)
2. 點擊右上角的「New Application」
3. 輸入應用程式名稱，點擊「Create」

### 步驟 2: 建立 Bot

1. 點擊左側選單的「Bot」
2. 點擊「Add Bot」
3. 在「Public Bot」保持預設設定
4. 啟用以下權限：
   - `Message Content Intent` (訊息內容意圖)

### 步驟 3: 取得 Token

1. 在 Bot 頁面，點擊「Reset Token」然後確認
2. 複製顯示的 Token（只會顯示一次！）
3. 將 Token 貼到 `.env` 文件的 `DISCORD_TOKEN`

### 步驟 4: 設定 OAuth2 URL

1. 點擊左側選單的「OAuth2」>「URL Generator」
2. 在「Scopes」勾選：
   - `bot`
   - `application.commands`
3. 在「Bot Permissions」勾選：
   - `Send Messages`
   - `Use Slash Commands`
   - `Manage Messages`
   - `Embed Links`
4. 複製「Generated URL」並在瀏覽器中打開
5. 選擇要邀請 Bot 的伺服器

---

## 環境變數設定

### 複製範本文件

```bash
cp .env.example .env
```

### 填寫環境變數

#### 必要變數

```env
# Discord Bot Configuration
DISCORD_TOKEN=your_bot_token_here
```

#### 可選變數

```env
# Application ID (從 Developer Portal 取得)
CLIENT_ID=your_client_id_here

# 開發用伺服器 ID (可加速指令註冊)
GUILD_ID=your_guild_id_here

# 資料庫連線 (可選)
DATABASE_URL=postgresql://user:password@localhost:5432/discord_bot

# 環境模式
NODE_ENV=development

# 日誌級別
LOG_LEVEL=info
```

### 取得 CLIENT_ID

1. 前往 Developer Portal 的「General Information」
2. 複製「Application ID」

### 取得 GUILD_ID

1. 在 Discord 開啟「開發者模式」：
   - Discord 設定 > 進階 > 開發者模式
2. 在伺服器名稱上按右鍵
3. 選擇「複製 ID」

---

## 資料庫設定

### 選項 1: 使用 SQLite (預設，開發用)

預設情況下，Bot 會使用 SQLite 資料庫，無需額外設定。

### 選項 2: 使用 PostgreSQL (正式環境)

1. 安裝 PostgreSQL 或使用雲端服務（如 Supabase、Railway）

2. 建立資料庫：
   ```sql
   CREATE DATABASE discord_bot;
   ```

3. 在 `.env` 中設定連線字串：
   ```env
   DATABASE_URL=postgresql://username:password@host:5432/discord_bot
   ```

### 選項 3: 使用 JSON 文件 (簡單部署)

如果不想使用資料庫，可以在 `src/database/Database.ts` 中啟用 JSON 模式。

---

## 部署上線

### 開發環境測試

```bash
# 安裝依賴
npm install

# 啟動開發伺服器 (熱重載)
npm run dev
```

### 生產環境部署

```bash
# 1. 編譯 TypeScript
npm run build

# 2. 啟動 Bot
npm start
```

### 使用 PM2 保持運行

```bash
# 安裝 PM2
npm install -g pm2

# 啟動 Bot
pm2 start dist/bot/index.js --name discord-bot

# 設定開機自動啟動
pm2 save
pm2 startup
```

### Docker 部署

建立 `Dockerfile`：

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

CMD ["node", "dist/bot/index.js"]
```

建立 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  bot:
    build: .
    env_file:
      - .env
    restart: unless-stopped
```

---

## 故障排除

### 常見問題

**Bot 上線但沒有回應指令**
- 確認已邀請 Bot 到伺服器
- 確認 Bot 有「Send Messages」權限
- 檢查 Log 是否有錯誤

**環境變數讀取失敗**
- 確認 `.env` 文件存在且格式正確
- 確認 `.env` 在專案根目錄
- 重新啟動 Bot

**資料庫連線失敗**
- 確認 DATABASE_URL 正確
- 確認資料庫伺服器運行中
- 檢查防火牆設定

---

## 相關連結

- [Discord Developer Portal](https://discord.com/developers/applications)
- [Discord.js 官方文檔](https://discord.js.org/)
- [OpenCode GitHub](https://github.com/remorses/kimaki)
