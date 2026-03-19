-- ==============================
-- 初始遷移: 001_initial.sql
-- 建立 OpenCode Discord Bot 的核心資料庫結構
-- 
-- 執行方式:
--   sqlite3 database.db < migrations/001_initial.sql
--   或在程式碼中使用 better-sqlite3 的 migrate 功能
-- ==============================

-- 先執行 schema.sql 的內容（如果尚未執行）
-- 這裡假設 schema.sql 已經執行，我們只處理數據遷移（如果需要）

-- ==================== 系統配置 ====================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;
PRAGMA auto_vacuum = INCREMENTAL;

-- ==================== 建立表格 ====================

-- sessions 表
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  thread_id TEXT,
  user_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  model TEXT NOT NULL,
  agent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  port INTEGER,
  prompt TEXT,
  opencode_session_id TEXT,
  started_at INTEGER,
  last_active_at INTEGER,
  ended_at INTEGER,
  tokens_used INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  tool_call_count INTEGER DEFAULT 0,
  error_message TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- messages 表
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  tool_results TEXT,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- tool_approvals 表
CREATE TABLE IF NOT EXISTS tool_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  message_id TEXT,
  tool_name TEXT NOT NULL,
  tool_args TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  response_message TEXT,
  requested_at INTEGER NOT NULL,
  responded_at INTEGER,
  expires_at INTEGER,
  remember INTEGER DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- projects 表
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT UNIQUE NOT NULL,
  alias TEXT UNIQUE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  description TEXT,
  default_model TEXT,
  default_agent TEXT,
  auto_worktree INTEGER DEFAULT 0,
  settings TEXT,
  stats TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- channel_bindings 表
CREATE TABLE IF NOT EXISTS channel_bindings (
  channel_id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  current_session_id TEXT,
  settings TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (current_session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

-- guild_settings 表
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  settings TEXT,
  permissions TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- session_files 表
CREATE TABLE IF NOT EXISTS session_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  change_type TEXT NOT NULL,
  lines_added INTEGER DEFAULT 0,
  lines_removed INTEGER DEFAULT 0,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- audit_log 表
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details TEXT,
  timestamp INTEGER NOT NULL
);

-- ==================== 建立索引 ====================

-- sessions 索引
CREATE INDEX IF NOT EXISTS idx_sessions_channel_status ON sessions(channel_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status) WHERE status IN ('running', 'starting', 'waiting');

-- messages 索引
CREATE INDEX IF NOT EXISTS idx_messages_session_time ON messages(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

-- tool_approvals 索引
CREATE INDEX IF NOT EXISTS idx_tool_approvals_session_pending ON tool_approvals(session_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_tool_approvals_status ON tool_approvals(status) WHERE status = 'pending';

-- projects 索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
CREATE INDEX IF NOT EXISTS idx_projects_alias ON projects(alias) WHERE alias IS NOT NULL;

-- session_files 索引
CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files(session_id);

-- audit_log 索引
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_session ON audit_log(session_id, timestamp DESC);

-- ==================== 建立視圖 ====================

CREATE VIEW IF NOT EXISTS active_sessions AS
SELECT 
  s.*,
  p.name as project_name,
  p.path as project_path
FROM sessions s
LEFT JOIN channel_bindings cb ON s.channel_id = cb.channel_id
LEFT JOIN projects p ON cb.project_id = p.id
WHERE s.status IN ('running', 'starting', 'waiting');

CREATE VIEW IF NOT EXISTS pending_approvals AS
SELECT 
  ta.*,
  s.channel_id,
  s.user_id,
  s.project_path
FROM tool_approvals ta
JOIN sessions s ON ta.session_id = s.id
WHERE ta.status = 'pending';

-- ==================== 建立觸發器 ====================

CREATE TRIGGER IF NOT EXISTS trigger_sessions_updated_at
AFTER UPDATE ON sessions
BEGIN
  UPDATE sessions 
  SET updated_at = CAST(strftime('%s', 'now') * 1000 AS INTEGER)
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trigger_projects_updated_at
AFTER UPDATE ON projects
BEGIN
  UPDATE projects 
  SET updated_at = CAST(strftime('%s', 'now') * 1000 AS INTEGER)
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trigger_channel_bindings_updated_at
AFTER UPDATE ON channel_bindings
BEGIN
  UPDATE channel_bindings 
  SET updated_at = CAST(strftime('%s', 'now') * 1000 AS INTEGER)
  WHERE channel_id = NEW.channel_id;
END;

CREATE TRIGGER IF NOT EXISTS trigger_guild_settings_updated_at
AFTER UPDATE ON guild_settings
BEGIN
  UPDATE guild_settings 
  SET updated_at = CAST(strftime('%s', 'now') * 1000 AS INTEGER)
  WHERE guild_id = NEW.guild_id;
END;

-- ==================== 版本記錄 ====================

-- 記錄 schema 版本
CREATE TABLE IF NOT EXISTS schema_version (
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT
);

INSERT INTO schema_version (version, applied_at, description) 
VALUES ('001_initial', CAST(strftime('%s', 'now') * 1000 AS INTEGER), 'Initial schema with sessions, messages, tool_approvals, projects, channel_bindings, guild_settings, session_files, and audit_log tables');
