# Changelog

所有值得注意的專案變更都會記錄在這個文件中。

格式基於 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)。

## [Unreleased]

### 新增

- Session 管理指令 (`/session start`, `/session list`, `/session resume`, `/session abort`)
- 任務隊列管理指令 (`/queue list`, `/queue clear`, `/queue pause`, `/queue resume`, `/queue settings`)
- Agent 管理指令 (`/agent list`, `/agent set`, `/agent info`)
- 模型管理指令 (`/model list`, `/model set`, `/model info`)
- Git Worktree 管理指令 (`/worktree create`, `/worktree list`, `/worktree delete`)
- 專案管理指令 (`/project create`, `/project list`, `/project info`)
- 權限管理指令 (`/permission`)

### 架構

- 基於 Kimaki 專案的基礎架構
- Discord.js v14 互動元件支援
- 雙模式資料庫支持（SQLite + JSON）
- Zod 環境變數驗證
- Winston 日誌系統

### 文件

- 完整的專案文件結構
- 設定指南 (docs/setup.md)
- 指令參考 (docs/commands.md)
- 架構說明 (docs/architecture.md)

---

## [1.0.0] - 2026-03-15

### 首次發布

這是專案的初始版本，包含所有核心功能的基礎實現。

#### 新增功能

**Session 管理**
- `/session start` - 開始新的 OpenCode Session
- `/session list` - 列出所有 Sessions
- `/session resume` - 恢復既有 Session
- `/session abort` - 終止運行中的 Session

**任務隊列**
- `/queue list` - 顯示隊列中的任務
- `/queue clear` - 清空隊列
- `/queue pause` - 暫停隊列
- `/queue resume` - 恢復隊列
- `/queue settings` - 設定隊列選項（失敗繼續、新上下文、超時、重試）

**Agent 管理**
- 支援 5 種 Agent 類型：General、Coder、Reviewer、Architect、Debugger
- `/agent list` - 列出所有可用 Agents
- `/agent set` - 設定當前使用的 Agent
- `/agent info` - 顯示 Agent 詳細資訊

**模型管理**
- 支援多種 AI 模型：Claude、GPT-4o、Gemini 等
- `/model list` - 列出所有可用模型
- `/model set` - 設定當前使用的模型
- `/model info` - 顯示模型詳細資訊（含定價資訊）

**Git Worktree**
- `/worktree create` - 建立 Git Worktree
- `/worktree list` - 列出所有 Worktrees
- `/worktree delete` - 刪除 Worktree

**專案管理**
- `/project create` - 建立新專案
- `/project list` - 列出所有專案
- `/project info` - 顯示專案詳細資訊

**權限管理**
- `/permission` - 設定指令權限

#### 新增模組

- **Commands** - Slash Commands 實現
- **Handlers** - 互動元件處理器（按鈕、下拉選單、Modal）
- **Services** - 商業邏輯服務層
- **Builders** - Discord UI 元件構建器
- **Database** - 資料庫抽象層
- **Config** - 環境變數管理

#### 技術實現

- TypeScript 完整類型支援
- Zod schema 驗證
- Winston 日誌記錄
- Vitest 單元測試
- 錯誤處理框架

---

## 版本號說明

專案使用 [語意化版本號](https://semver.org/lang/zh-TW/) (Semantic Versioning)：

- **Major (主版本)** - 不相容的 API 變更
- **Minor (次版本)** - 向後相容的新功能
- **Patch (修訂)** - 向後相容的錯誤修復

---

## 如何更新版本

詳見 [VERSION_RELEASE](./.ai/skills/version-release/SKILL.md) 工作流程。

---

## 遷移指南

### 從舊版本升級

1. 查看 [GitHub Releases](https://github.com/your-repo/releases) 查看變更日誌
2. 備份現有資料
3. 更新依賴：`npm install`
4. 執行遷移腳本（如果有）
5. 重啟 Bot

### 常見遷移問題

詳見 [故障排除](./docs/setup.md#故障排除) 章節。
