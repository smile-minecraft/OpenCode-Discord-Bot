# 指令參考

本文檔列出所有可用的 Slash Commands 和使用方式。

## 目錄
1. [Session 管理](#session-管理)
2. [任務隊列](#任務隊列)
3. [Agent 管理](#agent-管理)
4. [模型管理](#模型管理)
5. [Git Worktree](#git-worktree)
6. [專案管理](#專案管理)
7. [權限管理](#權限管理)

---

## Session 管理

### /session start

開始一個新的 OpenCode Session。

**使用方法**:
```
/session start [prompt] [model]
```

**選項**:
| 選項 | 類型 | 必要 | 說明 |
|-----|------|------|------|
| prompt | 字串 | 否 | Session 的初始提示詞 |
| model | 字串 | 否 | 使用的 AI 模型 |

**範例**:
```
/session start 幫我建立一個 Hello World 程式
/session start 修復這個函數的 bug anthropic/claude-opus-4-20250514
```

**可用模型**:
- `anthropic/claude-sonnet-4-20250514` (預設)
- `anthropic/claude-opus-4-20250514`
- `openai/gpt-4o`
- `google/gemini-2.5-pro-preview-05-20`

---

### /session list

列出所有 Sessions。

**使用方法**:
```
/session list [status]
```

**選項**:
| 選項 | 類型 | 必要 | 說明 |
|-----|------|------|------|
| status | 字串 | 否 | 過濾 Session 狀態 |

**狀態選項**:
- `all` - 全部 (預設)
- `running` - 運行中
- `completed` - 已完成
- `aborted` - 已中止

**範例**:
```
/session list
/session list status:running
```

---

### /session resume

恢復既有的 Session。

**使用方法**:
```
/session resume <session_id>
```

**選項**:
| 選項 | 類型 | 必要 | 說明 |
|-----|------|------|------|
| session_id | 字串 | 是 | 要恢復的 Session ID |

**範例**:
```
/session resume abc123-def456-ghi789
```

---

### /session abort

終止運行中的 Session。

**使用方法**:
```
/session abort [session_id]
```

**選項**:
| 選項 | 類型 | 必要 | 說明 |
|-----|------|------|------|
| session_id | 字串 | 否 | 要終止的 Session ID（略過則終止當前） |

**範例**:
```
/session abort
/session abort abc123-def456-ghi789
```

---

## 任務隊列

### /queue list

顯示隊列中的任務。

**使用方法**:
```
/queue list [page]
```

**選項**:
| 選項 | 類型 | 必要 | 說明 |
|-----|------|------|------|
| page | 整數 | 否 | 頁碼 (預設: 1) |

**範例**:
```
/queue list
/queue list page:2
```

---

### /queue clear

清空隊列中的所有待處理任務。

**使用方法**:
```
/queue clear
```

**範例**:
```
/queue clear
```

---

### /queue pause

暫停隊列處理。

**使用方法**:
```
/queue pause
```

**說明**: 暫停後，新的任務將不會自動執行。

**範例**:
```
/queue pause
```

---

### /queue resume

恢復已暫停的隊列。

**使用方法**:
```
/queue resume
```

**範例**:
```
/queue resume
```

---

### /queue settings

設定隊列選項。

**使用方法**:
```
/queue settings [continue_on_failure] [fresh_context] [task_timeout] [max_retries]
```

**選項**:
| 選項 | 類型 | 必要 | 說明 |
|-----|------|------|------|
| continue_on_failure | 字串 | 否 | 失敗後是否繼續執行 (`true`/`false`) |
| fresh_context | 字串 | 否 | 是否使用新的上下文 (`true`/`false`) |
| task_timeout | 整數 | 否 | 任務超時時間（分鐘，1-60） |
| max_retries | 整數 | 否 | 最大重試次數 (0-10) |

**範例**:
```
/queue settings continue_on_failure:true max_retries:3
/queue settings task_timeout:30
```

---

## Agent 管理

### /agent list

列出所有可用的 Agents。

**使用方法**:
```
/agent list
```

**說明**: 顯示所有可用的 Agent 類型，包括：
- General - 一般用途
- Coder - 程式開發
- Reviewer - 程式碼審查
- Architect - 架構規劃
- Debugger - 錯誤偵錯

**範例**:
```
/agent list
```

---

### /agent set

設定當前使用的 Agent。

**使用方法**:
```
/agent set <agent>
```

**選項**:
| 選項 | 類型 | 必要 | 說明 |
|-----|------|------|------|
| agent | 字串 | 是 | Agent ID |

**範例**:
```
/agent set coder
/agent set architect
```

---

### /agent info

顯示 Agent 詳細資訊。

**使用方法**:
```
/agent info [agent]
```

**選項**:
| 選項 | 類型 | 必要 | 說明 |
|-----|------|------|------|
| agent | 字串 | 否 | Agent ID（略過顯示選擇選單） |

**範例**:
```
/agent info
/agent info coder
```

---

## 模型管理

### /model list

列出所有可用的 AI 模型。

**使用方法**:
```
/model list
```

**說明**: 按提供商分組顯示所有可用模型，包括定價資訊。

**範例**:
```
/model list
```

---

### /model set

設定當前使用的模型。

**使用方法**:
```
/model set <model>
```

**選項**:
| 選項 | 類型 | 必要 | 說明 |
|-----|------|------|------|
| model | 字串 | 是 | 模型 ID |

**範例**:
```
/model set anthropic/claude-sonnet-4-20250514
```

---

### /model info

顯示模型詳細資訊。

**使用方法**:
```
/model info [model]
```

**選項**:
| 選項 | 類型 | 必要 | 說明 |
|-----|------|------|------|
| model | 字串 | 否 | 模型 ID（略過顯示選擇選單） |

**範例**:
```
/model info
/model info openai/gpt-4o
```

---

## Git Worktree

### /worktree create

建立 Git Worktree。

**使用方法**:
```
/worktree create <name> [branch]
```

**選項**:
| 選項 | 類型 | 必要 | 說明 |
|-----|------|------|------|
| name | 字串 | 是 | Worktree 名稱 |
| branch | 字串 | 否 | 分支名稱（預設: main） |

**範例**:
```
/worktree create feature/new-feature
/worktree create bugfix/issue-123 main
```

---

### /worktree list

列出所有 Worktrees。

**使用方法**:
```
/worktree list
```

**範例**:
```
/worktree list
```

---

### /worktree delete

刪除 Worktree。

**使用方法**:
```
/worktree delete <name>
```

**選項**:
| 選項 | 類型 | 必要 | 說明 |
|-----|------|------|------|
| name | 字串 | 是 | Worktree 名稱 |

**範例**:
```
/worktree delete feature/new-feature
```

---

## 專案管理

### /project create

建立新專案。

**使用方法**:
```
/project create
```

**說明**: 會彈出 Modal 視窗讓你輸入專案名稱和路徑。

**範例**:
```
/project create
```

---

### /project list

列出所有專案。

**使用方法**:
```
/project list
```

**範例**:
```
/project list
```

---

### /project info

顯示專案詳細資訊。

**使用方法**:
```
/project info [name]
```

**選項**:
| 選項 | 類型 | 必要 | 說明 |
|-----|------|------|------|
| name | 字串 | 否 | 專案名稱（略過顯示選擇選單） |

**範例**:
```
/project info
/project info my-project
```

---

## 權限管理

### /permission

管理指令權限。

**使用方法**:
```
/permission
```

**說明**: 開啟權限設定選單，可設定各指令的使用權限。

**範例**:
```
/permission
```

---

## 互動元件

除了 Slash Commands，Bot 還支援以下互動元件：

### 按鈕 (Buttons)

| ID | 功能 |
|----|------|
| `session:abort` | 中止當前 Session |
| `session:refresh` | 重新整理 Session 狀態 |
| `queue:pause` | 暫停隊列 |
| `queue:resume` | 恢復隊列 |
| `queue:clear` | 清空隊列 |
| `queue:refresh` | 重新整理隊列 |

### 下拉選單 (Select Menus)

| ID | 功能 |
|----|------|
| `agent:select` | 選擇 Agent |
| `agent:info:select` | 查看 Agent 資訊 |
| `model:select` | 選擇模型 |
| `model:info:select` | 查看模型資訊 |
| `project:select` | 選擇專案 |

---

## 快捷鍵

- 所有指令都可在 Discord 中透過輸入 `/` 來存取
- 指令支援自動完成功能
- 使用方向鍵導航選項
