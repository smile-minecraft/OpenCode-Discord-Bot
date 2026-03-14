# OpenCode Discord Bot

一個基於 [Kimaki](https://github.com/remorses/kimaki) 增強的 Discord Bot，透過 Discord.js 互動元件提升 OpenCode 使用體驗。

## 功能列表

### Session 管理
- `/session start` - 開始新的 OpenCode Session
- `/session list` - 列出所有 Sessions
- `/session resume` - 恢復既有的 Session
- `/session abort` - 終止運行中的 Session

### 任務隊列
- `/queue list` - 顯示隊列中的任務
- `/queue clear` - 清空隊列
- `/queue pause` - 暫停隊列
- `/queue resume` - 恢復隊列
- `/queue settings` - 設定隊列選項

### Agent 與模型管理
- `/agent list` - 列出所有可用的 Agents
- `/agent set` - 設定當前使用的 Agent
- `/agent info` - 顯示 Agent 詳細資訊
- `/model list` - 列出所有可用的 AI 模型
- `/model set` - 設定當前使用的模型
- `/model info` - 顯示模型詳細資訊

### Git Worktree
- `/worktree create` - 建立 Git Worktree
- `/worktree list` - 列出所有 Worktrees
- `/worktree delete` - 刪除 Worktree

### 專案管理
- `/project create` - 建立新專案
- `/project list` - 列出所有專案
- `/project info` - 顯示專案詳細資訊

### 權限管理
- `/permission` - 設定指令權限

## 安裝說明

### 前置需求
- Node.js 18+
- npm 或 yarn
- Discord 帳號（用於建立 Bot）

### 1. 建立 Discord Bot

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)
2. 點擊「New Application」建立新應用
3. 前往「Bot」頁面，點擊「Add Bot」
4. 複製 Bot Token
5. 前往「OAuth2」>「URL Generator」：
   - Scopes: `bot`, `application.commands`
   - Bot Permissions: `Send Messages`, `Use Slash Commands`, `Manage Messages`, `Embed Links`

### 2. 安裝依賴

```bash
npm install
```

### 3. 設定環境變數

複製 `.env.example` 為 `.env` 並填入必要資訊：

```bash
cp .env.example .env
```

### 4. 編譯與啟動

```bash
# 編譯 TypeScript
npm run build

# 啟動 Bot
npm start
```

或使用開發模式：

```bash
npm run dev
```

## 使用指南

### 開始使用

1. 邀請 Bot 到你的伺服器
2. 使用 `/session start` 開始新的 OpenCode Session
3. 透過 Discord 互動按鈕管理 Session

### 互動元件

Bot 支援以下 Discord 互動元件：
- **按鈕 (Buttons)** - Session 中斷、確認操作
- **下拉選單 (Select Menus)** - Agent/模型選擇
- **Modal** - 輸入表單（進階功能）

## 環境變數說明

| 變數名稱 | 說明 | 必要 |
|---------|------|------|
| `DISCORD_TOKEN` | Discord Bot Token | 是 |
| `CLIENT_ID` | Discord Application Client ID | 否 |
| `GUILD_ID` | 測試伺服器 ID（開發用） | 否 |
| `DATABASE_URL` | 資料庫連線 URL（可選） | 否 |
| `NODE_ENV` | 環境模式：`development`, `production`, `test` | 否 |
| `LOG_LEVEL` | 日誌級別：`debug`, `info`, `warn`, `error` | 否 |

## 技術栈

- **語言**: TypeScript
- **框架**: Discord.js v14
- **資料庫**: SQLite + JSON（雙模式支持）
- **AI Integration**: OpenCode API
- **測試**: Vitest

## 專案結構

```
src/
├── bot/              # Bot 入口與客戶端
├── builders/         # Discord Embed 與元件構建器
├── commands/         # Slash Commands
├── config/           # 設定檔
├── database/         # 資料庫模型與連線
├── handlers/         # 互動元件處理器
├── models/           # 資料模型
├── services/         # 商業邏輯服務
├── types/            # TypeScript 類型定義
└── utils/            # 工具函數

tests/                # 測試檔案
docs/                 # 專案文檔
```

## 參考專案

- [Kimaki](https://github.com/remorses/kimaki) - 原始專案
- [remote-opencode](https://github.com/RoundTable02/remote-opencode) - 參考專案

## License

MIT
