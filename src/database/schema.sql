/**
 * SQLite 資料庫 Schema
 * @description 用於 Session 持久化和工具審批的完整 Schema 定義
 * 
 * 使用方式:
 * - 初始建庫: sqlite3 database.db < schema.sql
 * - 或在程式碼中使用: await db.exec(schema)
 */

-- ==================== 系統配置 ====================

-- 啟用 WAL 模式提升並發效能
PRAGMA journal_mode = WAL;

-- 啟用外鍵約束
PRAGMA foreign_keys = ON;

-- 設定同步模式為 NORMAL（在效能和安全性之間取得平衡）
PRAGMA synchronous = NORMAL;

-- 設定快取大小（負值表示 KB，正值表示頁數，這裡設定為 64MB）
PRAGMA cache_size = -64000;

-- 啟用自動 Vacuum
PRAGMA auto_vacuum = INCREMENTAL;

-- ==================== 表格定義 ====================

/**
 * sessions 表 - Session 基本資訊
 */
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                    -- Session ID (UUID)
  channel_id TEXT NOT NULL,                -- Discord 頻道 ID
  thread_id TEXT,                          -- Discord Thread ID (可選)
  user_id TEXT NOT NULL,                   -- Discord 用戶 ID
  project_path TEXT NOT NULL,              -- 專案路徑
  model TEXT NOT NULL,                     -- 使用的模型
  agent TEXT NOT NULL,                     -- 使用的 Agent
  status TEXT NOT NULL DEFAULT 'pending',  -- 狀態: pending, starting, running, waiting, paused, completed, failed, aborted
  port INTEGER,                            -- HTTP 伺服器埠號
  prompt TEXT,                             -- 初始提示詞
  opencode_session_id TEXT,                -- OpenCode 內部 Session ID
  started_at INTEGER,                      -- 開始時間 (Unix timestamp ms)
  last_active_at INTEGER,                  -- 最後活躍時間 (Unix timestamp ms)
  ended_at INTEGER,                        -- 結束時間 (Unix timestamp ms)
  tokens_used INTEGER DEFAULT 0,           -- 花費的 tokens
  message_count INTEGER DEFAULT 0,         -- 訊息數量
  tool_call_count INTEGER DEFAULT 0,       -- 工具調用次數
  error_message TEXT,                      -- 錯誤訊息
  metadata TEXT,                          -- JSON 格式的元資料
  created_at INTEGER NOT NULL,             -- 建立時間 (Unix timestamp ms)
  updated_at INTEGER NOT NULL,             -- 最後更新時間 (Unix timestamp ms)
  
  -- 索引
  CONSTRAINT idx_channel_status CHECK (channel_id IS NOT NULL AND status IS NOT NULL)
);

-- 頻道 + 狀態 複合索引：用於查詢某頻道的所有 active sessions
CREATE INDEX IF NOT EXISTS idx_sessions_channel_status 
ON sessions(channel_id, status);

-- 用戶索引：用於查詢某用戶的所有 sessions
CREATE INDEX IF NOT EXISTS idx_sessions_user 
ON sessions(user_id);

-- 專案路徑索引：用於查詢某專案的所有 sessions
CREATE INDEX IF NOT EXISTS idx_sessions_project 
ON sessions(project_path);

-- 狀態索引：用於查詢所有 running sessions
CREATE INDEX IF NOT EXISTS idx_sessions_status 
ON sessions(status) WHERE status IN ('running', 'starting', 'waiting');

-- 開始時間索引：用於按時間排序查詢 sessions
CREATE INDEX IF NOT EXISTS idx_sessions_started_at 
ON sessions(started_at DESC);

-- ====================

/**
 * messages 表 - Session 對話歷史
 */
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,    -- 自增 ID
  session_id TEXT NOT NULL,                -- 外鍵關聯 sessions
  role TEXT NOT NULL,                      -- 角色: user, assistant, system
  content TEXT NOT NULL,                   -- 訊息內容
  tool_calls TEXT,                         -- JSON array of tool calls
  tool_results TEXT,                       -- JSON array of tool results
  timestamp INTEGER NOT NULL,               -- 時間戳記 (Unix timestamp ms)
  
  -- 外鍵約束
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Session + 時間 複合索引：用於按時間順序取得訊息
CREATE INDEX IF NOT EXISTS idx_messages_session_time 
ON messages(session_id, timestamp);

-- Session 索引：用於快速查找某 session 的所有訊息
CREATE INDEX IF NOT EXISTS idx_messages_session 
ON messages(session_id);

-- ====================

/**
 * tool_approvals 表 - 工具審批記錄
 */
CREATE TABLE IF NOT EXISTS tool_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,    -- 自增 ID
  session_id TEXT NOT NULL,                -- 外鍵關聯 sessions
  message_id TEXT,                          -- Discord 訊息 ID（用於回覆）
  tool_name TEXT NOT NULL,                  -- 工具名稱
  tool_args TEXT NOT NULL,                  -- JSON 格式的工具參數
  status TEXT NOT NULL DEFAULT 'pending',   -- 狀態: pending, approved, denied, auto_approved, expired
  response_message TEXT,                    -- 回覆訊息
  requested_at INTEGER NOT NULL,            -- 請求時間 (Unix timestamp ms)
  responded_at INTEGER,                     -- 回覆時間 (Unix timestamp ms)
  expires_at INTEGER,                      -- 過期時間 (Unix timestamp ms)
  remember BOOLEAN DEFAULT 0,              -- 是否記住此選擇
  
  -- 外鍵約束
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Session + 狀態 複合索引：用於查找某 session 的待審批請求
CREATE INDEX IF NOT EXISTS idx_tool_approvals_session_pending 
ON tool_approvals(session_id, status) 
WHERE status = 'pending';

-- 狀態索引：用於批量處理待審批請求
CREATE INDEX IF NOT EXISTS idx_tool_approvals_status 
ON tool_approvals(status) WHERE status = 'pending';

-- ====================

/**
 * projects 表 - 專案管理
 */
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,    -- 自增 ID
  project_id TEXT UNIQUE NOT NULL,         -- 專案唯一 ID (UUID)
  alias TEXT UNIQUE,                       -- 專案別名
  name TEXT NOT NULL,                      -- 專案名稱
  path TEXT NOT NULL,                      -- 專案路徑
  description TEXT,                        -- 專案描述
  default_model TEXT,                      -- 預設模型
  default_agent TEXT,                      -- 預設 Agent
  auto_worktree BOOLEAN DEFAULT 0,         -- 是否自動建立 git worktree
  settings TEXT,                           -- JSON 格式的專案設定
  stats TEXT,                              -- JSON 格式的統計資料
  created_at INTEGER NOT NULL,              -- 建立時間 (Unix timestamp ms)
  updated_at INTEGER NOT NULL               -- 最後更新時間 (Unix timestamp ms)
);

-- 路徑唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path 
ON projects(path);

-- 別名索引
CREATE INDEX IF NOT EXISTS idx_projects_alias 
ON projects(alias) WHERE alias IS NOT NULL;

-- ====================

/**
 * channel_bindings 表 - 頻道與專案綁定
 */
CREATE TABLE IF NOT EXISTS channel_bindings (
  channel_id TEXT PRIMARY KEY,             -- Discord 頻道 ID (Primary Key)
  project_id INTEGER NOT NULL,              -- 外鍵關聯 projects
  current_session_id TEXT,                  -- 目前進行中的 session ID
  settings TEXT,                            -- JSON 格式的頻道設定
  created_at INTEGER NOT NULL,              -- 建立時間 (Unix timestamp ms)
  updated_at INTEGER NOT NULL,              -- 最後更新時間 (Unix timestamp ms)
  
  -- 外鍵約束
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (current_session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

-- ====================

/**
 * guild_settings 表 - Discord Guild 設定
 */
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,                -- Discord Guild ID
  name TEXT NOT NULL,                       -- Guild 名稱
  settings TEXT,                            -- JSON 格式的 Guild 設定
  permissions TEXT,                         -- JSON 格式的權限設定
  created_at INTEGER NOT NULL,              -- 建立時間 (Unix timestamp ms)
  updated_at INTEGER NOT NULL               -- 最後更新時間 (Unix timestamp ms)
);

-- ====================

/**
 * session_files 表 - Session 相關的檔案變更追蹤
 */
CREATE TABLE IF NOT EXISTS session_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  change_type TEXT NOT NULL,               -- created, modified, deleted
  lines_added INTEGER DEFAULT 0,
  lines_removed INTEGER DEFAULT 0,
  timestamp INTEGER NOT NULL,
  
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Session 索引
CREATE INDEX IF NOT EXISTS idx_session_files_session 
ON session_files(session_id);

-- ====================

/**
 * audit_log 表 - 操作審計日誌
 */
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,                     -- 操作類型
  target_type TEXT,                         -- 目標類型: session, project, channel, etc.
  target_id TEXT,                          -- 目標 ID
  details TEXT,                            -- JSON 格式的詳細資訊
  timestamp INTEGER NOT NULL               -- 時間戳記
);

-- 時間索引：用於查詢最近的日誌
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp 
ON audit_log(timestamp DESC);

-- 用戶索引：用於查詢某用戶的操作
CREATE INDEX IF NOT EXISTS idx_audit_log_user 
ON audit_log(user_id, timestamp DESC);

-- Session 索引：用於查詢某 session 的所有操作
CREATE INDEX IF NOT EXISTS idx_audit_log_session 
ON audit_log(session_id, timestamp DESC);

-- ==================== 視圖 (可選) ====================

/**
 * active_sessions 視圖 - 查詢所有進行中的 sessions
 */
CREATE VIEW IF NOT EXISTS active_sessions AS
SELECT 
  s.*,
  p.name as project_name,
  p.path as project_path
FROM sessions s
LEFT JOIN channel_bindings cb ON s.channel_id = cb.channel_id
LEFT JOIN projects p ON cb.project_id = p.id
WHERE s.status IN ('running', 'starting', 'waiting');

/**
 * pending_approvals 視圖 - 查詢所有待審批的工具請求
 */
CREATE VIEW IF NOT EXISTS pending_approvals AS
SELECT 
  ta.*,
  s.channel_id,
  s.user_id,
  s.project_path
FROM tool_approvals ta
JOIN sessions s ON ta.session_id = s.id
WHERE ta.status = 'pending';

-- ==================== 觸發器 (可選) ====================

/**
 * 自動更新 sessions 的 updated_at 欄位
 */
CREATE TRIGGER IF NOT EXISTS trigger_sessions_updated_at
AFTER UPDATE ON sessions
BEGIN
  UPDATE sessions 
  SET updated_at = CAST(strftime('%s', 'now') * 1000 AS INTEGER)
  WHERE id = NEW.id;
END;

/**
 * 自動更新 projects 的 updated_at 欄位
 */
CREATE TRIGGER IF NOT EXISTS trigger_projects_updated_at
AFTER UPDATE ON projects
BEGIN
  UPDATE projects 
  SET updated_at = CAST(strftime('%s', 'now') * 1000 AS INTEGER)
  WHERE id = NEW.id;
END;

/**
 * 自動更新 channel_bindings 的 updated_at 欄位
 */
CREATE TRIGGER IF NOT EXISTS trigger_channel_bindings_updated_at
AFTER UPDATE ON channel_bindings
BEGIN
  UPDATE channel_bindings 
  SET updated_at = CAST(strftime('%s', 'now') * 1000 AS INTEGER)
  WHERE channel_id = NEW.channel_id;
END;

/**
 * 自動更新 guild_settings 的 updated_at 欄位
 */
CREATE TRIGGER IF NOT EXISTS trigger_guild_settings_updated_at
AFTER UPDATE ON guild_settings
BEGIN
  UPDATE guild_settings 
  SET updated_at = CAST(strftime('%s', 'now') * 1000 AS INTEGER)
  WHERE guild_id = NEW.guild_id;
END;
