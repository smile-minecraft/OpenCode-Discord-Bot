# 架構說明

本文檔說明 OpenCode Discord Bot 的系統架構和設計決策。

## 目錄
1. [系統概述](#系統概述)
2. [技術棧](#技術棧)
3. [目錄結構](#目錄結構)
4. [核心模組](#核心模組)
5. [資料流程](#資料流程)
6. [設計模式](#設計模式)
7. [部署架構](#部署架構)

---

## 系統概述

OpenCode Discord Bot 基於 [Kimaki](https://github.com/remorses/kimaki) 專案，目標是透過 Discord.js 互動元件提升用戶體驗。

### 設計目標

- **簡單** - 直觀的使用體驗，無需學習曲線
- **無縫** - 與現有 OpenCode 工作流程相容
- **增強** - 在不替換核心功能的情況下新增互動體驗

### 部署模式

採用「完全共用模式」：
- 面向個人用戶設計
- 多個 Discord 頻道可共享同一個 OpenCode Session
- 支援 Session 中斷、任務隊列、Passthrough 模式

---

## 技術棧

| 層面 | 技術 | 版本 |
|-----|------|------|
| 語言 | TypeScript | 5.x |
| 框架 | Discord.js | 14.x |
| 驗證 | Zod | 3.x |
| 日誌 | Winston | 3.x |
| 測試 | Vitest | 1.x |
| 資料庫 | SQLite / JSON | - |

---

## 目錄結構

```
src/
├── bot/                    # Bot 入口點
│   ├── client.ts          # Discord Client 初始化
│   └── index.ts           # 主程式入口
│
├── builders/              # Discord UI 元件構建器
│   ├── ActionRowBuilder.ts
│   ├── EmbedBuilder.ts
│   ├── ModalBuilder.ts
│   ├── SessionActionRowBuilder.ts
│   ├── SessionEmbedBuilder.ts
│   └── index.ts
│
├── commands/              # Slash Commands
│   ├── agent.ts           # Agent 管理指令
│   ├── model.ts           # 模型管理指令
│   ├── permission.ts      # 權限管理指令
│   ├── project.ts         # 專案管理指令
│   ├── queue.ts           # 隊列管理指令
│   ├── session.ts         # Session 管理指令
│   ├── worktree.ts        # Git Worktree 指令
│   └── index.ts
│
├── config/                # 設定管理
│   └── config.ts          # 環境變數載入與驗證
│
├── database/              # 資料庫層
│   ├── Database.ts        # 資料庫連線 (SQLite/JSON)
│   ├── index.ts
│   └── models/            # 資料模型
│       ├── Channel.ts
│       ├── Guild.ts
│       ├── Project.ts
│       └── Session.ts
│
├── handlers/              # 互動元件處理器
│   ├── ButtonHandler.ts   # 按鈕處理
│   ├── SelectMenuHandler.ts # 下拉選單處理
│   ├── ModalHandler.ts    # Modal 處理
│   ├── ContextMenuHandler.ts # 上下文選單處理
│   └── index.ts
│
├── models/                # 資料模型定義
│   ├── AgentData.ts       # Agent 定義
│   ├── ModelData.ts       # 模型定義
│   └── index.ts
│
├── services/              # 商業邏輯服務
│   ├── GitWorktreeService.ts
│   ├── PermissionService.ts
│   ├── ProjectManager.ts
│   ├── QueueManager.ts
│   ├── SessionManager.ts
│   ├── SessionQueueIntegration.ts
│   ├── ToolApprovalService.ts
│   └── index.ts
│
├── types/                 # TypeScript 類型定義
│   ├── handlers.ts
│   └── index.ts
│
└── utils/                 # 工具函數
    ├── errorHandler.ts
    ├── logger.ts
    └── index.ts
```

---

## 核心模組

### 1. Bot 入口 (`src/bot/`)

負責 Discord Client 的初始化和事件監聽。

**職責**:
- 建立 Discord Client
- 註冊 Slash Commands
- 註冊事件處理器
- 優雅關機處理

### 2. Commands (`src/commands/`)

實現所有 Discord Slash Commands。

**設計原則**:
- 每個指令獨立檔案
- 使用 Builder Pattern 構建指令選項
- 統一的錯誤處理

**指令類型**:
- **Session 指令** - 開始、列表、恢復、終止 Session
- **Queue 指令** - 隊列管理與設定
- **Agent/Model 指令** - AI 資源管理
- **Project 指令** - 專案管理
- **Worktree 指令** - Git Worktree 操作

### 3. Handlers (`src/handlers/`)

處理 Discord 互動元件（按鈕、下拉選單、Modal）。

**設計原則**:
- 統一的 customId 命名規範：`module:action:id`
- 非同步處理機制
- 錯誤回饋機制

### 4. Services (`src/services/`)

包含核心商業邏輯。

| 服務 | 職責 |
|-----|------|
| SessionManager | Session 生命週期管理 |
| QueueManager | 任務隊列管理 |
| ProjectManager | 專案管理 |
| PermissionService | 權限檢查 |
| GitWorktreeService | Git Worktree 操作 |

### 5. Builders (`src/builders/`)

構建 Discord UI 元件。

**元件類型**:
- Embed - 訊息卡片
- ActionRow - 互動元件容器
- Button - 操作按鈕
- SelectMenu - 下拉選單
- Modal - 輸入表單

---

## 資料流程

### 典型指令流程

```
用戶輸入指令
    ↓
Discord API 接收請求
    ↓
Command Handler 路由到對應處理函數
    ↓
Service Layer 執行商業邏輯
    ↓
Database 存取資料
    ↓
Builder 構建回覆 Embed
    ↓
Handler 發送回覆到 Discord
```

### 互動元件流程

```
用戶點擊按鈕/選擇選單
    ↓
Discord 發送 Interaction 事件
    ↓
Event Handler 解析 customId
    ↓
對應 Handler 處理互動
    ↓
Service 執行操作
    ↓
Builder 更新 UI
    ↓
回覆更新後的元件
```

---

## 設計模式

### 1. Builder Pattern

使用於構建複雜的 Discord UI 元件：

```typescript
const embed = new EmbedBuilder()
  .setTitle('標題')
  .setColor(Colors.INFO)
  .addFields({ name: '欄位', value: '值' });
```

### 2. Service Layer

業務邏輯封裝在 Service 層：

```typescript
// SessionManager.ts
export class SessionManager {
  async createSession(options: CreateSessionOptions): Promise<Session> {
    // 業務邏輯
  }
  
  async listSessions(channelId: string, filter?: StatusFilter): Promise<Session[]> {
    // 業務邏輯
  }
}
```

### 3. Singleton Pattern

服務管理器使用單例模式：

```typescript
let instance: QueueManager | null = null;

export function getQueueManager(): QueueManager {
  if (!instance) {
    instance = new QueueManager();
  }
  return instance;
}
```

### 4. Schema Validation

使用 Zod 進行環境變數驗證：

```typescript
const discordConfigSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  CLIENT_ID: z.string().optional(),
  GUILD_ID: z.string().optional(),
});
```

---

## 部署架構

### 開發環境

```
┌─────────────────┐
│  Discord App    │
└────────┬────────┘
         │
    HTTPS/WebSocket
         │
         ▼
┌─────────────────┐
│  Local Machine  │
│  npm run dev    │
└─────────────────┘
```

### 生產環境

```
┌─────────────────┐
│  Discord App    │
└────────┬────────┘
         │
    HTTPS/WebSocket
         │
         ▼
┌─────────────────┐
│   VPS/Server    │
│  ┌───────────┐  │
│  │   Bot     │  │
│  └───────────┘  │
│  ┌───────────┐  │
│  │  SQLite   │  │
│  │  or JSON  │  │
│  └───────────┘  │
└─────────────────┘
```

### 可選：使用 Docker

```
┌─────────────────┐
│   Docker Host   │
│  ┌───────────┐  │
│  │   Bot     │  │
│  └───────────┘  │
└─────────────────┘
```

---

## 安全性考量

### 權限管理

- 使用 Discord 權限系統控制指令訪問
- 敏感操作需要確認機制
- Session 資料隔離

### 環境變數

- Token 和金鑰不提交到版本控制
- 使用 `.env` 文件管理敏感資訊
- 預設驗證防止配置錯誤

---

## 擴展指南

### 新增指令

1. 在 `src/commands/` 建立新檔案
2. 實現指令的 data 和 execute 函數
3. 在 `src/commands/index.ts` 匯出
4. 在 `src/bot/index.ts` 註冊指令

### 新增互動元件

1. 在 `src/handlers/` 建立 Handler
2. 實作 customId 解析邏輯
3. 在 Bot 入口註冊處理器

### 新增資料模型

1. 在 `src/database/models/` 建立模型檔案
2. 實作 CRUD 操作
3. 在 `src/database/Database.ts` 註冊

---

## 相關資源

- [Discord.js 官方文檔](https://discord.js.org/)
- [Discord API 文件](https://discord.com/developers/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
