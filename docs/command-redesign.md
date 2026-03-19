# Discord Bot 指令系统重新设计方案

## 概述

本文档描述了基于 OpenCode SDK 架构重新设计的 Discord Bot 指令系统。新设计简化了指令集，专注于核心的 Session 管理功能，并移除不再适用的旧指令。

---

## 一、新指令清单

### 1.1 核心指令列表

| 指令名称 | 子命令 | 描述 | 参数 | 权限 |
|---------|-------|------|------|------|
| `/session` | start | 开始新会话 | `prompt` (可选), `model` (可选) | 管理频道 |
| `/session` | list | 列出当前频道的会话 | `status` (可选) | 管理频道 |
| `/session` | resume | 恢复指定会话 | `session_id` (必填) | 管理频道 |
| `/session` | abort | 终止会话 | `session_id` (可选) | 管理频道 |
| `/prompt` | - | 向当前活跃会话发送消息 | `message` (必填) | 无限制 |
| `/setup` | bind | 绑定频道与项目路径 | `project_path` (必填) | 管理员 |
| `/setup` | show | 显示当前频道的配置 | - | 无限制 |
| `/setup` | unbind | 解除频道绑定 | - | 管理员 |

### 1.2 指令详细定义

#### 1.2.1 `/session start` - 开始新会话

```
名称: session start
描述: 开始一个新的 OpenCode 会话

参数:
  - prompt (字符串, 可选): Session 的初始提示词
    - 描述: 描述你想要 AI 帮你完成的任务
    - 示例: "帮我重构 src/services 目录下的代码"

  - model (字符串, 可选): 使用的 AI 模型
    - 描述: 从 OpenCode 配置的模型中选择
    - 自动完成: 启用，显示可用模型列表

权限要求: 管理频道 (ManageChannels)

返回:
  - Session 卡片 Embed 显示:
    - Session ID
    - 状态 (启动中/运行中)
    - 使用的模型
    - 项目路径
    - 持续时间
  - 操作按钮: 恢复、终止

SDK 映射:
  - Session.create() - 创建新会话
  - Session.prompt() - 发送初始提示
```

#### 1.2.2 `/session list` - 列出所有会话

```
名称: session list
描述: 列出当前频道的所有会话记录

参数:
  - status (字符串, 可选): 过滤会话状态
    - 选项: 全部(all), 运行中(running), 已完成(completed), 已中止(aborted)
    - 默认: 全部

权限要求: 管理频道 (ManageChannels)

返回:
  - Session 列表 Embed，最多显示 10 个
  - 每个条目显示:
    - Session ID
    - 状态 (带颜色标识)
    - 初始提示词 (截断)
    - 模型
    - 开始时间
    - 持续时间

SDK 映射:
  - 通过 SessionManager 内存 + SQLite 数据库查询
```

#### 1.2.3 `/session resume` - 恢复会话

```
名称: session resume
描述: 恢复一个已存在的会话

参数:
  - session_id (字符串, 必填): 要恢复的 Session ID
    - 描述: 从 /session list 获取的 Session ID

权限要求: 管理频道 (ManageChannels)

返回:
  - Session 状态卡片
  - 操作按钮

SDK 映射:
  - 通过 SessionManager 恢复内存中的 Session 状态
```

#### 1.2.4 `/session abort` - 终止会话

```
名称: session abort
描述: 终止当前运行中的会话

参数:
  - session_id (字符串, 可选): 要终止的 Session ID
    - 不提供时: 终止当前频道的活跃会话

权限要求: 管理频道 (ManageChannels)

返回:
  - 中止确认 Embed
  - 显示会话持续时间

SDK 映射:
  - SessionManager.abortSession() - 终止会话
```

#### 1.2.5 `/prompt` - 发送消息到会话

```
名称: prompt
描述: 向当前活跃的会话发送消息

参数:
  - message (字符串, 必填): 要发送的消息内容
    - 描述: 对话内容或任务描述
    - 最大长度: 4000 字符

权限要求: 无限制 (任何频道成员)

返回:
  - 初始响应: "⏳ 正在处理..."
  - 流式更新: 实时显示 AI 响应 (打字机效果)
  - 完成状态: 显示完整响应

SDK 映射:
  - Session.prompt() - 发送消息到会话
  - Event.subscribe() - 订阅 SSE 事件流
```

#### 1.2.6 `/setup bind` - 绑定项目路径

```
名称: setup bind
描述: 将当前频道绑定到指定的项目路径

参数:
  - project_path (字符串, 必填): 项目目录路径
    - 描述: OpenCode 项目所在目录
    - 示例: /Users/smile/projects/my-app
    - 支持: 绝对路径

权限要求: 管理员 (Administrator)

返回:
  - 成功: 显示绑定信息
  - 失败: 显示错误原因

配置存储:
  - SQLite 数据库: channel_project_bindings 表
  - 缓存: ChannelProjectBinder 服务
```

#### 1.2.7 `/setup show` - 显示配置

```
名称: setup show
描述: 显示当前频道的项目绑定配置

参数: 无

权限要求: 无限制

返回:
  - 频道绑定信息
  - 当前活跃的 Session (如有)
```

#### 1.2.8 `/setup unbind` - 解除绑定

```
名称: setup unbind
描述: 解除当前频道的项目路径绑定

参数: 无

权限要求: 管理员 (Administrator)

返回:
  - 确认解除绑定
  - 警告: 不会影响正在运行的 Session
```

---

## 二、移除的指令

| 指令 | 原因 |
|------|------|
| `/model` 相关 | 模型配置已移至 OpenCode 全局配置 |
| `/agent` 相关 | Agent 配置已移至 OpenCode 全局配置 |
| `/queue` | 简化设计，移除队列管理功能 |
| `/worktree` | 非核心功能，复杂度高 |
| `/project` | 功能合并到 `/setup` |

---

## 三、指令与 SDK 映射关系

### 3.1 SDK 核心概念映射

| Discord 概念 | OpenCode SDK | 说明 |
|-------------|--------------|------|
| Session 管理 | `client.session` | 创建、获取、发送消息 |
| 消息发送 | `client.session.prompt()` | 发送 prompt 到会话 |
| 事件流 | `client.event.subscribe()` | SSE 实时更新 |
| 项目路径 | `client.session.create({ directory })` | 创建时指定项目 |

### 3.2 指令到 SDK 方法的映射

```
/session start
  ├─ SDK: client.session.create({ directory, title })
  ├─ SDK: client.session.prompt({ id, parts: [{ type: 'text', text }] })
  └─ SDK: client.event.subscribe() → StreamingMessageManager

/session list
  └─ Local: SessionManager.listSessions(channelId, status)
     └─ Storage: SQLiteDatabase.loadSessions(channelId)

/session resume
  └─ Local: SessionManager.resumeSession(sessionId)

/session abort
  └─ SDK: (无直接 SDK 方法，通过终止服务器进程)

/prompt
  ├─ SDK: client.session.prompt({ id, parts: [{ type: 'text', text }] })
  └─ SDK: client.event.subscribe() → StreamingMessageManager

/setup bind
  └─ Local: SQLiteDatabase.saveChannelBinding(channelId, projectPath)
```

### 3.3 SDK 错误处理映射

| SDK 错误码 | Discord 响应 |
|-----------|-------------|
| `NOT_INITIALIZED` | "OpenCode 服务未启动，请稍后重试" |
| `NOT_FOUND` | "找不到指定的 Session" |
| `UNAUTHORIZED` | "认证失败，请检查 OpenCode 配置" |
| `RATE_LIMIT` | "请求过于频繁，请稍后重试" |
| `TIMEOUT` | "请求超时，请检查网络连接" |
| `CONNECTION_ERROR` | "无法连接到 OpenCode 服务" |

---

## 四、状态管理方案

### 4.1 状态类型定义

```typescript
// 内存中的 Session 状态
interface SessionState {
  sessionId: string;           // Discord Session ID
  opencodeSessionId: string;   // OpenCode SDK Session ID
  channelId: string;           // Discord 频道 ID
  userId: string;              // 创建者 ID
  status: SessionStatus;
  prompt: string;
  model: string;
  projectPath: string;
  startedAt: Date;
  lastActiveAt: Date;
  endedAt: Date | null;
}

// 频道绑定状态
interface ChannelBinding {
  channelId: string;
  projectPath: string;
  boundAt: Date;
  boundBy: string;
}
```

### 4.2 状态存储结构

```
┌─────────────────────────────────────────────────────────┐
│                    In-Memory (Map)                       │
├─────────────────────────────────────────────────────────┤
│  activeSessions: Map<sessionId, Session>               │
│  channelSessions: Map<channelId, Set<sessionId>>       │
│  activeStreams: Map<streamKey, StreamingSession>      │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    SQLite Database                       │
├─────────────────────────────────────────────────────────┤
│  sessions: Session[]          (持久化)                   │
│  channel_bindings             (频道-项目绑定)           │
│  settings                     (全局设置)                │
└─────────────────────────────────────────────────────────┘
```

### 4.3 活跃会话跟踪

```typescript
class SessionManager {
  // 活跃 Session 映射
  private activeSessions: Map<string, Session> = new Map();
  
  // 频道到 Session ID 集合的映射
  private channelSessions: Map<string, Set<string>> = new Map();
  
  // 获取频道的活跃 Session
  getActiveSessionByChannel(channelId: string): Session | undefined {
    for (const [id, session] of this.activeSessions) {
      if (session.channelId === channelId && session.isRunning()) {
        return session;
      }
    }
  }
  
  // 检查频道是否有活跃 Session
  hasActiveSession(channelId: string): boolean {
    return this.getActiveSessionByChannel(channelId) !== undefined;
  }
}
```

### 4.4 状态转换图

```
                                    ┌──────────────┐
                                    │   pending    │
                                    └──────┬───────┘
                                           │
                                           ▼
┌──────────┐    start()     ┌──────────────┐    markRunning()
│ aborted  │ ◄───────────── │  starting   │ ───────────────► ┌────────────┐
└──────────┘                └──────────────┘                  │  running   │
                                  │                           └─────┬──────┘
                                  │                                 │
                                  ▼                                 ▼
                         ┌──────────────┐                ┌────────────────┐
                         │    failed    │                │    waiting     │
                         └──────────────┘                └────────────────┘
                                  │                                 │
                                  ▼                                 ▼
                         ┌──────────────────────────────────────────────┐
                         │   completed / aborted / failed (ended)       │
                         └──────────────────────────────────────────────┘
```

---

## 五、事件流处理方案

### 5.1 SSE 事件类型

| SDK 事件 | 内部事件 | 处理方式 |
|---------|---------|---------|
| `message.created` | `message` | 追加到内容，触发更新 |
| `message.updated` | `message` | 替换内容，触发更新 |
| `tool_call` | `tool_request` | 显示工具审批 UI |
| `tool_call_start` | `tool_request` | 显示工具执行中 |
| `tool_call_end` | `tool_request` | 隐藏工具 UI |
| `session.started` | `connected` | 连接成功 |
| `session.ended` | `session_complete` | 完成处理 |
| `session.error` | `error` | 显示错误 |

### 5.2 流式更新架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OpenCode SDK                                  │
│  client.event.subscribe() → AsyncIterable<SDKEvent>                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SSEEventEmitterAdapter                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  1. 将 AsyncIterator 转换为 EventEmitter                   │   │
│  │  2. 映射 SDK 事件类型到内部事件                              │   │
│  │  3. 发射内部事件                                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                          ┌─────────┴─────────┐
                          ▼                   ▼
            ┌─────────────────────┐   ┌─────────────────────┐
            │ StreamingMessageMgr │   │   ToolApprovalMgr   │
            │ - message 事件      │   │ - tool_request 事件 │
            │ - 累积内容          │   │ - 审批按钮          │
            │ - 更新 Discord 消息 │   │ - 处理响应          │
            └─────────────────────┘   └─────────────────────┘
```

### 5.3 消息更新策略

```typescript
class StreamingMessageManager {
  // 更新间隔 (毫秒)
  private readonly UPDATE_INTERVAL = 500;
  
  // 累积内容，最大长度
  private readonly MAX_CONTENT_LENGTH = 4000;
  
  // 处理流程:
  // 1. 接收 SSE message 事件
  // 2. 累积内容到 StreamingSession.content
  // 3. 设置 updateQueued = true
  // 4. 定期更新循环检查 updateQueued
  // 5. 使用 Rate Limiter 发送 Discord API 请求
  // 6. 更新 Embed 内容
}
```

### 5.4 Rate Limiting 策略

```typescript
class DiscordRateLimiter {
  // 最小请求间隔 (毫秒)
  private readonly minInterval = 250; // 4 requests/second
  
  // 队列机制:
  // 1. 所有请求进入队列
  // 2. 串行处理队列
  // 3. 每请求间隔至少 250ms
  // 4. 检测 429 错误并自动重试
}
```

### 5.5 工具审批流程

```
┌──────────────┐     tool_call      ┌─────────────────┐
│ OpenCode SDK │ ─────────────────► │ ToolRequestMgr  │
└──────────────┘                    └────────┬────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │ Discord 消息更新 │
                                    │ - 工具名称      │
                                    │ - 工具参数      │
                                    │ - 批准/拒绝按钮 │
                                    └────────┬────────┘
                                             │
                        ┌────────────────────┴────────────────────┐
                        ▼                                         ▼
              ┌──────────────────┐                     ┌──────────────────┐
              │ 用户点击批准     │                     │ 用户点击拒绝     │
              └────────┬─────────┘                     └────────┬─────────┘
                       │                                        │
                       ▼                                        ▼
              ┌──────────────────┐                     ┌──────────────────┐
              │ SDK: approve()   │                     │ SDK: reject()    │
              └──────────────────┘                     └──────────────────┘
```

---

## 六、数据库 Schema

### 6.1 Sessions 表

```sql
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  opencode_session_id TEXT,
  status TEXT NOT NULL,
  prompt TEXT,
  model TEXT,
  agent TEXT,
  project_path TEXT,
  started_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  ended_at TEXT,
  tokens_used INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  tool_call_count INTEGER DEFAULT 0,
  error_message TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_channel ON sessions(channel_id);
CREATE INDEX idx_sessions_status ON sessions(status);
```

### 6.2 Channel Bindings 表

```sql
CREATE TABLE channel_bindings (
  channel_id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  bound_at TEXT NOT NULL,
  bound_by TEXT NOT NULL
);
```

---

## 七、错误处理

### 7.1 错误类型映射

| 错误类型 | 用户消息 | 日志级别 |
|---------|---------|---------|
| SDK 未初始化 | "OpenCode 服务未就绪，请稍后再试" | Error |
| Session 不存在 | "找不到指定的 Session" | Warn |
| 无活跃 Session | "当前频道没有运行中的 Session" | Info |
| 权限不足 | "您需要『管理频道』权限" | Warn |
| 网络超时 | "请求超时，请检查网络连接" | Error |
| 速率限制 | "请求过于频繁，请稍后重试" | Warn |

### 7.2 错误响应模板

```typescript
// Embed 错误响应
const errorEmbed = new EmbedBuilder()
  .setTitle('❌ 操作失败')
  .setDescription(errorMessage)
  .setColor(Colors.ERROR)
  .setTimestamp();
```

---

## 八、测试用例

### 8.1 Session 管理测试

| 测试场景 | 预期结果 |
|---------|---------|
| `/session start` 在 DM 中 | 返回错误: 仅限服务器使用 |
| `/session start` 无权限 | 返回错误: 需要管理频道权限 |
| `/session start` 成功 | 创建 Session，返回卡片 |
| `/session list` 存在会话 | 显示会话列表 |
| `/session list` 无会话 | 显示"暂无会话" |
| `/session abort` 无参数 | 终止当前活跃 Session |
| `/session abort` 指定 ID | 终止指定 Session |

### 8.2 Prompt 测试

| 测试场景 | 预期结果 |
|---------|---------|
| `/prompt` 无活跃 Session | 返回错误提示 |
| `/prompt` 发送空消息 | 返回错误: 消息不能为空 |
| `/prompt` 发送消息 | 开始流式响应 |
| 响应过程中 Session 完成 | 显示完成状态 |

### 8.3 Setup 测试

| 测试场景 | 预期结果 |
|---------|---------|
| `/setup bind` 无权限 | 返回错误: 需要管理员权限 |
| `/setup bind` 成功 | 绑定频道到项目路径 |
| `/setup show` | 显示当前绑定配置 |
| `/setup unbind` 成功 | 解除绑定 |

---

## 九、迁移指南

### 9.1 从旧指令迁移

| 旧指令 | 新指令 | 备注 |
|-------|-------|------|
| `/session start --model xxx` | `/session start --model xxx` | 参数相同 |
| `/session start --prompt xxx` | `/session start --prompt xxx` | 参数相同 |
| `/model list` | 移除 | 由 OpenCode 管理 |
| `/model set` | 移除 | 由 OpenCode 管理 |
| `/agent list` | 移除 | 由 OpenCode 管理 |
| `/agent set` | 移除 | 由 OpenCode 管理 |
| `/queue status` | 移除 | 简化设计 |
| `/project add` | `/setup bind` | 功能合并 |
| `/project list` | `/setup show` | 功能合并 |

### 9.2 配置迁移

- 所有模型和 Agent 配置保留在 OpenCode 全局配置中
- 频道项目绑定需要通过 `/setup bind` 重新配置
- Session 历史记录保留在 SQLite 数据库中

---

## 十、附录

### A. 指令权限速查表

| 指令 | 权限要求 |
|-----|---------|
| `/session start` | ManageChannels |
| `/session list` | ManageChannels |
| `/session resume` | ManageChannels |
| `/session abort` | ManageChannels |
| `/prompt` | 无 |
| `/setup bind` | Administrator |
| `/setup show` | 无 |
| `/setup unbind` | Administrator |

### B. 状态颜色编码

| 状态 | Embed 颜色 |
|------|-----------|
| pending | 0xFFFF00 (黄色) |
| starting | 0xFFA500 (橙色) |
| running | 0x00FF00 (绿色) |
| waiting | 0x00FFFF (青色) |
| paused | 0x808080 (灰色) |
| completed | 0x00FF00 (绿色) |
| failed | 0xFF0000 (红色) |
| aborted | 0xFF0000 (红色) |

### C. Emoji 状态指示

| 状态 | Emoji |
|------|-------|
| pending | ⏳ |
| starting | 🔄 |
| running | 🟢 |
| waiting | ⏸️ |
| paused | ⏸️ |
| completed | ✅ |
| failed | ❌ |
| aborted | ⏹️ |
