/**
 * SQLite 資料庫服務
 * @description 基於 better-sqlite3 的 SQLite 資料庫實現
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Session, type SessionData, type SessionStatus } from './models/Session.js';
import { Project, type ProjectData } from './models/Project.js';
import { Guild, type GuildData } from './models/Guild.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * SQLite 資料庫配置選項
 */
export interface SQLiteDatabaseOptions {
  /** 資料庫檔案路徑 */
  dbPath?: string;
  /** 是否啟用 WAL 模式 */
  walMode?: boolean;
  /** 是否啟用外鍵約束 */
  foreignKeys?: boolean;
}

/**
 * 工具審批記錄
 */
interface ToolApprovalRecord {
  id: number;
  session_id: string;
  message_id: string;
  tool_name: string;
  tool_args: string;
  status: string;
  response_message: string | null;
  requested_at: number;
  responded_at: number | null;
  expires_at: number | null;
  remember: number;
}

/**
 * 頻道綁定記錄
 */
interface ChannelBindingRecord {
  channel_id: string;
  project_id: number;
  project_path?: string;
  current_session_id: string | null;
  settings: string;
  bound_at?: number;
  created_at?: number;
  updated_at: number;
  bound_by: string;
}

/**
 * Session 資料庫記錄
 */
interface SessionRow {
  id: string;
  channel_id: string;
  thread_id: string | null;
  user_id: string;
  project_path: string;
  model: string;
  agent: string;
  status: string;
  port: number | null;
  prompt: string;
  opencode_session_id: string | null;
  started_at: number | null;
  last_active_at: number | null;
  ended_at: number | null;
  tokens_used: number;
  message_count: number;
  tool_call_count: number;
  error_message: string | null;
  metadata: string;
  created_at: number;
  updated_at: number;
}

/**
 * Message 資料庫記錄
 */
interface MessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  tool_results: string | null;
  timestamp: number;
}

/**
 * SQLite 資料庫類別
 */
export class SQLiteDatabase {
  private db: Database.Database | null = null;
  private dbPath: string;
  private isInitialized = false;
  private options: Required<SQLiteDatabaseOptions>;
  private backupInterval: NodeJS.Timeout | null = null;

  private static instance: SQLiteDatabase | null = null;

  /**
   * 建構函數
   */
  constructor(options: SQLiteDatabaseOptions = {}) {
    this.options = {
      dbPath: options.dbPath || './data/opencode-discord.db',
      walMode: options.walMode ?? true,
      foreignKeys: options.foreignKeys ?? true,
    };
    this.dbPath = this.options.dbPath;
  }

  /**
   * 取得單例實例
   */
  public static getInstance(options?: SQLiteDatabaseOptions): SQLiteDatabase {
    if (!SQLiteDatabase.instance) {
      SQLiteDatabase.instance = new SQLiteDatabase(options);
    }
    return SQLiteDatabase.instance;
  }

  /**
   * 重置單例實例（用於測試）
   */
  public static resetInstance(): void {
    if (SQLiteDatabase.instance) {
      SQLiteDatabase.instance.close();
      SQLiteDatabase.instance = null;
    }
  }

  /**
   * 初始化資料庫連線並執行 migrations
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // 確保目錄存在
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 開啟資料庫
      this.db = new Database(this.dbPath);
      
      // 啟用 WAL 模式（提升並發讀寫效能）
      if (this.options.walMode) {
        this.db.pragma('journal_mode = WAL');
        // WAL 模式下建議使用 NORMAL 同步模式
        this.db.pragma('synchronous = NORMAL');
        // 設置 WAL  checkpoint 自動執行
        this.db.pragma('wal_autocheckpoint = 1000');
        // 設置 busy timeout（等待鎖釋放的時間）
        this.db.pragma('busy_timeout = 5000');
      }
      
      // 啟用外鍵約束
      if (this.options.foreignKeys) {
        this.db.pragma('foreign_keys = ON');
      }

      // 設定快取大小（64MB）
      this.db.pragma('cache_size = -64000');
      
      // 啟用記憶體映射 I/O（提升大資料庫效能）
      this.db.pragma('mmap_size = 268435456'); // 256MB
      
      // 執行 schema - 支援 dev 和 production 模式
      let schemaPath = path.join(__dirname, 'schema.sql');
      
      // 如果在 dev 模式 (__dirname 指向 dist)，嘗試 src 目錄
      if (!fs.existsSync(schemaPath)) {
        schemaPath = path.join(__dirname, '..', '..', 'src', 'database', 'schema.sql');
      }
      
      // 如果還是找不到，拋出明確錯誤
      if (!fs.existsSync(schemaPath)) {
        throw new Error(`Schema file not found. Looked in: ${schemaPath}`);
      }
      
      // 讀取 schema 文件
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      
      // 過濾掉 JavaScript 風格的多行註釋 /** */
      // SQLite 的 db.exec() 可以正確處理多行 SQL 語句（包括 CREATE TRIGGER）
      const filteredSchema = schema.replace(/\/\*[\s\S]*?\*\//g, '');
      
      try {
        // 直接執行整個 schema（SQLite 會正確處理多行語句和 CREATE TRIGGER）
        this.db!.exec(filteredSchema);
        logger.info('[SQLiteDatabase] Schema 執行成功');
      } catch (error) {
        // 如果執行失敗，嘗試按語句分割執行（作為後備方案）
        logger.warn('[SQLiteDatabase] Schema 整體執行失敗，嘗試分割執行:', error instanceof Error ? error.message : String(error));
        
        // 分割並執行每條語句
        const statements = filteredSchema
          .split(';')
          .map(s => s.trim())
          .filter(s => s && !s.startsWith('--'));
        
        for (const statement of statements) {
          try {
            this.db!.exec(statement);
          } catch (stmtError) {
            // 忽略 PRAGMA 和警告級別的錯誤
            if (!statement.toUpperCase().startsWith('PRAGMA')) {
              logger.warn('[SQLiteDatabase] 語句執行失敗:', statement.substring(0, 50));
            }
          }
        }
      }
      
      // 執行 migrations
      await this.runMigrations();
      
      // 確保必要的索引存在
      this.createIndexes();
      
      this.isInitialized = true;
      logger.info(`[SQLiteDatabase] 資料庫已初始化: ${this.dbPath}`);
    } catch (error) {
      logger.error('[SQLiteDatabase] 初始化失敗:', error);
      throw error;
    }
  }

  /**
   * 關閉資料庫連線
   */
  close(): void {
    // 禁用自動備份
    this.disableAutoBackup();
    
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
      logger.info('[SQLiteDatabase] 資料庫已關閉');
    }
  }

  // ==================== 自動備份 ====================

  /**
   * 啟用自動備份
   * @param intervalHours 備份間隔（小時），預設 24 小時
   */
  enableAutoBackup(intervalHours = 24): void {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
    }

    this.backupInterval = setInterval(() => {
      try {
        this.performBackup();
      } catch (error) {
        logger.error('[SQLiteDatabase] Auto backup failed:', error);
      }
    }, intervalHours * 60 * 60 * 1000);

    logger.info(`[SQLiteDatabase] Auto backup enabled (${intervalHours}h interval)`);
  }

  /**
   * 執行資料庫備份
   * @returns 備份檔案路徑
   */
  async performBackup(): Promise<string> {
    if (!this.db) {
      throw new Error('資料庫未初始化');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.dbPath}.backup.${timestamp}`;

    // 使用 SQLite 備份 API (better-sqlite3 的 backup 方法返回 Promise)
    await this.db.backup(backupPath);
    logger.info(`[SQLiteDatabase] Backup completed: ${backupPath}`);

    // 清理舊備份
    this.cleanupOldBackups(5);

    return backupPath;
  }

  /**
   * 清理舊備份文件
   * @param keepCount 保留的備份數量
   */
  private cleanupOldBackups(keepCount: number): void {
    const backupDir = path.dirname(this.dbPath);
    const dbName = path.basename(this.dbPath, '.db');

    try {
      const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith(`${dbName}.backup.`))
        .map(f => ({
          path: path.join(backupDir, f),
          time: fs.statSync(path.join(backupDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);

      backups.slice(keepCount).forEach(f => {
        fs.unlinkSync(f.path);
        logger.info(`[SQLiteDatabase] Removed old backup: ${f.path}`);
      });
    } catch (error) {
      logger.error('[SQLiteDatabase] Failed to cleanup old backups:', error);
    }
  }

  /**
   * 禁用自動備份
   */
  disableAutoBackup(): void {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
      logger.info('[SQLiteDatabase] Auto backup disabled');
    }
  }

  /**
   * 檢查是否已初始化
   */
  isReady(): boolean {
    return this.isInitialized && this.db !== null;
  }

  // ==================== Migration 系統 ====================

  /**
   * 當前資料庫版本
   */
  private static readonly CURRENT_SCHEMA_VERSION = 1;

  /**
   * 執行資料庫遷移
   * P2-7: 增強的版本管理/遷移機制
   */
  private async runMigrations(): Promise<void> {
    if (!this.db) throw new Error('資料庫未初始化');

    // 建立版本表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        description TEXT,
        applied_at INTEGER NOT NULL
      )
    `);

    // 檢查當前版本
    const result = this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null };
    const currentVersion = result?.version || 0;

    logger.info(`[SQLiteDatabase] 當前資料庫版本: ${currentVersion}, 目標版本: ${SQLiteDatabase.CURRENT_SCHEMA_VERSION}`);

    // 如果沒有版本記錄，初始化為 v1（假設 schema.sql 是 v1）
    if (currentVersion === 0) {
      this.db.prepare(`
        INSERT INTO schema_version (version, description, applied_at) VALUES (?, ?, ?)
      `).run(1, 'Initial schema', Date.now());
      logger.info('[SQLiteDatabase] Migration v1 已執行（初始 schema）');
    }

    // 這裡可以添加未來的遷移邏輯
    // 例如：
    // if (currentVersion < 2) {
    //   await this.migrateToVersion(2);
    // }
  }

  /**
   * 遷移到指定版本（預留給未來使用）
   */
  // @ts-ignore - 預留給未來使用
  private async migrateToVersion(version: number): Promise<void> {
    if (!this.db) throw new Error('資料庫未初始化');

    logger.info(`[SQLiteDatabase] 執行遷移至 v${version}...`);

    // 根據版本執行對應的遷移
    switch (version) {
      case 2:
        // await this.migrateToV2();
        break;
      // 未來添加更多遷移...
      default:
        logger.warn(`[SQLiteDatabase] 未知的遷移版本: ${version}`);
    }

    // 記錄遷移完成
    this.db.prepare(`
      INSERT INTO schema_version (version, description, applied_at) VALUES (?, ?, ?)
    `).run(version, `Migration to v${version}`, Date.now());

    logger.info(`[SQLiteDatabase] Migration v${version} 已完成`);
  }

  // ==================== 索引創建 ====================

  /**
   * 創建效能優化索引
   * P2-6: 為經常查詢的欄位創建索引，提升查詢效能
   */
  private createIndexes(): void {
    if (!this.db) throw new Error('資料庫未初始化');

    // sessions 表的索引 - P2-6: 確保頻道和狀態欄位有索引
    const sessionsIndexes = [
      // channel_id 索引 - 用於查詢頻道的所有 sessions
      `CREATE INDEX IF NOT EXISTS idx_sessions_channel_id ON sessions(channel_id)`,
      // status 索引 - 用於查詢特定狀態的 sessions
      `CREATE INDEX IF NOT EXISTS idx_sessions_status_query ON sessions(status)`,
      // last_active_at 索引 - 用於查詢最近活躍的 sessions
      `CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active_at DESC)`,
      // channel_id + status 複合索引 - 用於查詢頻道的活躍 sessions
      `CREATE INDEX IF NOT EXISTS idx_sessions_channel_active ON sessions(channel_id, status) WHERE status IN ('running', 'starting', 'waiting')`,
      // user_id 索引 - 用於查詢用戶的所有 sessions
      `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
      // project_path 索引 - 用於查詢專案的所有 sessions
      `CREATE INDEX IF NOT EXISTS idx_sessions_project_path ON sessions(project_path)`,
    ];

    // messages 表的索引
    const messagesIndexes = [
      // role 索引 - 用於查詢特定角色的訊息
      `CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role)`,
    ];

    // tool_approvals 表的索引
    const toolApprovalsIndexes = [
      // expires_at 索引 - 用於查詢過期的審批
      `CREATE INDEX IF NOT EXISTS idx_tool_approvals_expires ON tool_approvals(expires_at) WHERE status = 'pending'`,
      // requested_at 索引 - 用於按時間排序查詢審批
      `CREATE INDEX IF NOT EXISTS idx_tool_approvals_requested ON tool_approvals(requested_at DESC)`,
    ];

    // session_files 表的索引
    const sessionFilesIndexes = [
      // change_type 索引 - 用於查詢特定類型的檔案變更
      `CREATE INDEX IF NOT EXISTS idx_session_files_type ON session_files(change_type)`,
      // timestamp 索引 - 用於按時間排序查詢檔案變更
      `CREATE INDEX IF NOT EXISTS idx_session_files_timestamp ON session_files(timestamp DESC)`,
    ];

    // 執行所有索引創建語句
    const allIndexes = [
      ...sessionsIndexes,
      ...messagesIndexes,
      ...toolApprovalsIndexes,
      ...sessionFilesIndexes,
    ];

    for (const indexSql of allIndexes) {
      try {
        this.db.exec(indexSql);
      } catch (error) {
        // 忽略索引創建失敗（可能是權限問題或索引已存在）
        logger.debug(`[SQLiteDatabase] 索引創建: ${indexSql.substring(0, 50)}...`);
      }
    }

    logger.info('[SQLiteDatabase] 資料庫索引已創建/驗證');
  }

  // ==================== Session 操作 ====================

  /**
   * 驗證 Session 資料的有效性
   * @param session 要驗證的 Session
   * @throws 如果驗證失敗則拋出錯誤
   */
  private validateSession(session: Session): void {
    if (!session.sessionId) {
      throw new Error('Session ID 不能為空');
    }
    if (!session.channelId) {
      throw new Error('Channel ID 不能為空');
    }
    if (!session.userId) {
      throw new Error('User ID 不能為空');
    }
    if (!session.projectPath) {
      throw new Error('Project Path 不能為空');
    }
    if (!session.model) {
      throw new Error('Model 不能為空');
    }
    if (!session.agent) {
      throw new Error('Agent 不能為空');
    }
  }

  /**
   * 儲存 Session
   */
  saveSession(session: Session): void {
    if (!this.db) throw new Error('資料庫未初始化');

    // P2-5: 驗證 Session 資料的有效性
    this.validateSession(session);

    // 從 metadata 中提取 userId，如果沒有則使用空字串
    const userId = (session.metadata as Record<string, unknown>)?.userId as string | undefined || '';

    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        id, channel_id, thread_id, user_id, project_path, model, agent,
        status, port, prompt, opencode_session_id, started_at, last_active_at,
        ended_at, tokens_used, message_count, tool_call_count, error_message,
        metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        port = excluded.port,
        last_active_at = excluded.last_active_at,
        ended_at = excluded.ended_at,
        tokens_used = excluded.tokens_used,
        message_count = excluded.message_count,
        tool_call_count = excluded.tool_call_count,
        error_message = excluded.error_message,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `);

    // 從 metadata 提取 port
    const port = (session.metadata as Record<string, unknown>)?.port as number | undefined;

    stmt.run(
      session.sessionId,
      session.channelId,
      session.threadId || null,
      userId,
      session.projectPath,
      session.model,
      session.agent,
      session.status,
      port || null,
      session.prompt,
      session.opencodeSessionId || null,
      session.startedAt ? new Date(session.startedAt).getTime() : null,
      session.lastActiveAt ? new Date(session.lastActiveAt).getTime() : null,
      session.endedAt ? new Date(session.endedAt).getTime() : null,
      session.tokensUsed || 0,
      session.messageCount || 0,
      session.toolCallCount || 0,
      session.errorMessage || null,
      JSON.stringify(session.metadata || {}),
      session.createdAt ? new Date(session.createdAt).getTime() : Date.now(),
      Date.now()
    );
  }

  /**
   * 載入 Session
   */
  loadSession(sessionId: string): Session | null {
    if (!this.db) throw new Error('資料庫未初始化');

    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
    if (!row) return null;

    return this.rowToSession(row);
  }

  /**
   * 載入頻道的所有 Sessions
   */
  loadChannelSessions(channelId: string, status?: string): Session[] {
    if (!this.db) throw new Error('資料庫未初始化');

    let sql = 'SELECT * FROM sessions WHERE channel_id = ?';
    const params: (string | number)[] = [channelId];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(sql).all(...params) as SessionRow[];
    return rows.map(row => this.rowToSession(row));
  }

  /**
   * 載入活躍的 Sessions
   */
  loadActiveSessions(): Session[] {
    if (!this.db) throw new Error('資料庫未初始化');

    const rows = this.db.prepare(`
      SELECT * FROM sessions 
      WHERE status IN ('running', 'starting', 'waiting')
      ORDER BY started_at DESC
    `).all() as SessionRow[];

    return rows.map(row => this.rowToSession(row));
  }

  /**
   * 刪除 Session
   */
  deleteSession(sessionId: string): boolean {
    if (!this.db) throw new Error('資料庫未初始化');

    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return result.changes > 0;
  }

  /**
   * 將資料庫記錄轉換為 Session 物件
   * P2-8: 統一 null 處理，確保與 saveSession 一致
   */
  private rowToSession(row: SessionRow): Session {
    // 解析 metadata 並提取 userId
    const metadata = JSON.parse(row.metadata || '{}');
    
    // P2-8: 統一 null 處理 - 確保空字串和 null 一致處理
    const userId = row.user_id || '';
    const threadId = row.thread_id || null;
    const opencodeSessionId = row.opencode_session_id || '';
    const errorMessage = row.error_message || null;

    const sessionData: Partial<SessionData> & { sessionId: string; channelId: string; userId?: string } = {
      sessionId: row.id,
      channelId: row.channel_id,
      userId: userId,
      prompt: row.prompt,
      model: row.model,
      agent: row.agent,
      projectPath: row.project_path,
      metadata: metadata,
    };

    const session = new Session(sessionData as SessionData);

    // P2-8: 統一 null 處理 - 與 saveSession 保持一致
    session.threadId = threadId;
    session.opencodeSessionId = opencodeSessionId;
    session.status = row.status as SessionStatus;
    session.tokensUsed = row.tokens_used;
    session.messageCount = row.message_count;
    session.toolCallCount = row.tool_call_count;
    session.errorMessage = errorMessage;
    
    // 確保 metadata 包含 userId
    if (row.user_id && metadata) {
      (session.metadata as Record<string, unknown>).userId = row.user_id;
    }
    
    if (row.started_at) session.startedAt = new Date(row.started_at).toISOString();
    if (row.last_active_at) session.lastActiveAt = new Date(row.last_active_at).toISOString();
    if (row.ended_at) session.endedAt = new Date(row.ended_at).toISOString();
    session.createdAt = new Date(row.created_at).toISOString();
    session.updatedAt = new Date(row.updated_at).toISOString();

    return session;
  }

  // ==================== Messages 操作 ====================

  /**
   * 儲存訊息
   */
  saveMessage(sessionId: string, role: string, content: string, toolCalls?: unknown[]): void {
    if (!this.db) throw new Error('資料庫未初始化');

    // P1-5: 使用 try-catch 包圍 transaction 確保錯誤處理
    try {
      // 使用事務確保消息插入和計數更新的原子性
      const transaction = this.db.transaction(() => {
        // 插入消息
        const stmt = this.db!.prepare(`
          INSERT INTO messages (session_id, role, content, tool_calls, timestamp)
          VALUES (?, ?, ?, ?, ?)
        `);

        stmt.run(
          sessionId,
          role,
          content,
          toolCalls ? JSON.stringify(toolCalls) : null,
          Date.now()
        );

        // 更新 session 的訊息計數
        this.db!.prepare(`
          UPDATE sessions SET message_count = message_count + 1, updated_at = ?
          WHERE id = ?
        `).run(Date.now(), sessionId);
      });

      transaction();
    } catch (error) {
      logger.error('[SQLiteDatabase] saveMessage 事務執行失敗:', error);
      throw error;
    }
  }

  /**
   * 載入 Session 的訊息歷史
   */
  loadMessages(sessionId: string, limit = 100): Array<{
    role: string;
    content: string;
    toolCalls?: unknown[];
    toolResults?: unknown[];
    timestamp: number;
  }> {
    if (!this.db) throw new Error('資料庫未初始化');

    const rows = this.db.prepare(`
      SELECT * FROM messages 
      WHERE session_id = ? 
      ORDER BY timestamp ASC
      LIMIT ?
    `).all(sessionId, limit) as MessageRow[];

    return rows.map(row => ({
      role: row.role,
      content: row.content,
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      toolResults: row.tool_results ? JSON.parse(row.tool_results) : undefined,
      timestamp: row.timestamp,
    }));
  }

  /**
   * 清除 Session 的訊息歷史
   */
  clearMessages(sessionId: string): void {
    if (!this.db) throw new Error('資料庫未初始化');
    
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
  }

  // ==================== 工具審批操作 ====================

  /**
   * 創建工具審批請求
   */
  createToolApproval(
    sessionId: string, 
    messageId: string,
    toolName: string, 
    args: Record<string, unknown>
  ): number {
    if (!this.db) throw new Error('資料庫未初始化');

    const stmt = this.db.prepare(`
      INSERT INTO tool_approvals 
      (session_id, message_id, tool_name, tool_args, status, requested_at, expires_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `);

    const result = stmt.run(
      sessionId,
      messageId,
      toolName,
      JSON.stringify(args),
      Date.now(),
      Date.now() + 5 * 60 * 1000 // 5 分鐘過期
    );

    return result.lastInsertRowid as number;
  }

  /**
   * 更新工具審批狀態
   */
  updateToolApproval(
    approvalId: number, 
    status: 'approved' | 'denied' | 'auto_approved' | 'expired',
    remember = false
  ): void {
    if (!this.db) throw new Error('資料庫未初始化');

    this.db.prepare(`
      UPDATE tool_approvals 
      SET status = ?, responded_at = ?, remember = ?
      WHERE id = ?
    `).run(status, Date.now(), remember ? 1 : 0, approvalId);
  }

  /**
   * 獲取工具審批記錄
   */
  getToolApproval(approvalId: number): {
    id: number;
    sessionId: string;
    messageId: string;
    toolName: string;
    args: Record<string, unknown>;
    status: string;
    requestedAt: number;
    respondedAt: number | null;
    expiresAt: number | null;
    remember: boolean;
  } | null {
    if (!this.db) throw new Error('資料庫未初始化');

    const row = this.db.prepare(`
      SELECT * FROM tool_approvals WHERE id = ?
    `).get(approvalId) as ToolApprovalRecord | undefined;

    if (!row) return null;

    return {
      id: row.id,
      sessionId: row.session_id,
      messageId: row.message_id,
      toolName: row.tool_name,
      args: JSON.parse(row.tool_args),
      status: row.status,
      requestedAt: row.requested_at,
      respondedAt: row.responded_at,
      expiresAt: row.expires_at ?? null,
      remember: row.remember === 1,
    };
  }

  /**
   * 獲取待審批的工具請求
   */
  getPendingToolApprovals(sessionId: string): Array<{
    id: number;
    messageId: string;
    toolName: string;
    args: Record<string, unknown>;
    requestedAt: number;
  }> {
    if (!this.db) throw new Error('資料庫未初始化');

    const rows = this.db.prepare(`
      SELECT * FROM tool_approvals 
      WHERE session_id = ? AND status = 'pending'
      ORDER BY requested_at ASC
    `).all(sessionId) as ToolApprovalRecord[];

    return rows.map(row => ({
      id: row.id,
      messageId: row.message_id,
      toolName: row.tool_name,
      args: JSON.parse(row.tool_args),
      requestedAt: row.requested_at,
    }));
  }

  /**
   * 獲取所有待審批的工具請求
   */
  getAllPendingToolApprovals(): Array<{
    id: number;
    sessionId: string;
    messageId: string;
    toolName: string;
    args: Record<string, unknown>;
    requestedAt: number;
    expiresAt: number;
  }> {
    if (!this.db) throw new Error('資料庫未初始化');

    const rows = this.db.prepare(`
      SELECT * FROM tool_approvals 
      WHERE status = 'pending'
      ORDER BY requested_at ASC
    `).all() as ToolApprovalRecord[];

    return rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      messageId: row.message_id,
      toolName: row.tool_name,
      args: JSON.parse(row.tool_args),
      requestedAt: row.requested_at,
      expiresAt: row.expires_at ?? 0,
    }));
  }

  // ==================== Projects 操作 ====================

  /**
   * 儲存 Project
   */
  saveProject(project: Project): void {
    if (!this.db) throw new Error('資料庫未初始化');

    const stmt = this.db.prepare(`
      INSERT INTO projects (
        project_id, alias, name, path, description,
        default_model, default_agent, auto_worktree,
        settings, stats, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        name = excluded.name,
        path = excluded.path,
        description = excluded.description,
        default_model = excluded.default_model,
        default_agent = excluded.default_agent,
        settings = excluded.settings,
        stats = excluded.stats,
        updated_at = excluded.updated_at
    `);

    // 使用專案設置中的 useGitWorktree
    const settings = project.settings as unknown as Record<string, unknown>;
    const useGitWorktree = settings?.useGitWorktree as boolean | undefined || false;

    stmt.run(
      project.projectId,
      null,  // alias - not in current model
      project.name,
      project.path,
      project.description || null,
      project.defaultModel || null,
      project.defaultAgent || null,
      useGitWorktree ? 1 : 0,
      JSON.stringify(project.settings || {}),
      JSON.stringify(project.stats || {}),
      project.createdAt ? new Date(project.createdAt).getTime() : Date.now(),
      Date.now()
    );
  }

  /**
   * 載入 Project
   */
  loadProject(projectId: string): Project | null {
    if (!this.db) throw new Error('資料庫未初始化');

    const row = this.db.prepare('SELECT * FROM projects WHERE project_id = ?').get(projectId);
    if (!row) return null;

    return this.rowToProject(row as Record<string, unknown>);
  }

  /**
   * 透過路徑載入 Project
   */
  loadProjectByPath(projectPath: string): Project | null {
    if (!this.db) throw new Error('資料庫未初始化');

    const row = this.db.prepare('SELECT * FROM projects WHERE path = ?').get(projectPath);
    if (!row) return null;

    return this.rowToProject(row as Record<string, unknown>);
  }

  /**
   * 刪除 Project
   */
  deleteProject(projectId: string): boolean {
    if (!this.db) throw new Error('資料庫未初始化');

    const result = this.db.prepare('DELETE FROM projects WHERE project_id = ?').run(projectId);
    return result.changes > 0;
  }

  /**
   * 將資料庫記錄轉換為 Project 物件
   */
  private rowToProject(row: Record<string, unknown>): Project {
    const settings = JSON.parse((row.settings as string) || '{}');
    const stats = JSON.parse((row.stats as string) || '{}');

    const projectData: Partial<ProjectData> & { projectId: string; name: string; path: string } = {
      projectId: row.project_id as string,
      name: row.name as string,
      path: row.path as string,
      description: row.description as string | undefined,
      defaultModel: row.default_model as string | undefined,
      defaultAgent: row.default_agent as string | undefined,
      gitRemoteUrl: null,
      gitBranch: 'main',
      tags: [],
      channelId: null,
      settings: settings,
      stats: stats,
      createdAt: row.created_at ? new Date(row.created_at as number).toISOString() : new Date().toISOString(),
      updatedAt: row.updated_at ? new Date(row.updated_at as number).toISOString() : new Date().toISOString(),
    };

    return new Project(projectData);
  }

  // ==================== Guild 操作 ====================

  /**
   * 儲存 Guild
   */
  saveGuild(guild: Guild): void {
    if (!this.db) throw new Error('資料庫未初始化');

    const stmt = this.db.prepare(`
      INSERT INTO guild_settings (
        guild_id, name, settings, permissions, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        name = excluded.name,
        settings = excluded.settings,
        permissions = excluded.permissions,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      guild.guildId,
      guild.name,
      JSON.stringify(guild.settings || {}),
      JSON.stringify(guild.permissions || {}),
      guild.createdAt ? new Date(guild.createdAt).getTime() : Date.now(),
      Date.now()
    );
  }

  /**
   * 載入 Guild
   */
  loadGuild(guildId: string): Guild | null {
    if (!this.db) throw new Error('資料庫未初始化');

    const row = this.db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
    if (!row) return null;

    const r = row as Record<string, unknown>;
    const guildData: GuildData = {
      guildId: r.guild_id as string,
      name: r.name as string,
      ownerId: '',  // 預設為空
      createdAt: r.created_at ? new Date(r.created_at as number).toISOString() : new Date().toISOString(),
      updatedAt: r.updated_at ? new Date(r.updated_at as number).toISOString() : new Date().toISOString(),
      channels: {},  // 需要另外從 channel_bindings 表加載
      permissions: JSON.parse((r.permissions as string) || '{}'),
      queue: [],  // 需要另外加載
      settings: JSON.parse((r.settings as string) || '{}'),
    };

    return new Guild(guildData);
  }

  /**
   * 刪除 Guild
   */
  deleteGuild(guildId: string): boolean {
    if (!this.db) throw new Error('資料庫未初始化');

    const result = this.db.prepare('DELETE FROM guild_settings WHERE guild_id = ?').run(guildId);
    return result.changes > 0;
  }

  // ==================== 審計日誌 ====================

  /**
   * 記錄審計日誌
   */
  logAudit(
    userId: string, 
    action: string, 
    targetType?: string, 
    targetId?: string, 
    details?: Record<string, unknown>,
    sessionId?: string
  ): void {
    if (!this.db) throw new Error('資料庫未初始化');

    this.db.prepare(`
      INSERT INTO audit_log (
        session_id, user_id, action, target_type, target_id, details, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId || null,
      userId,
      action,
      targetType || null,
      targetId || null,
      details ? JSON.stringify(details) : null,
      Date.now()
    );
  }

  /**
   * 查詢審計日誌
   */
  queryAuditLog(
    options: {
      sessionId?: string;
      userId?: string;
      action?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Array<{
    id: number;
    sessionId: string | null;
    userId: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    details: Record<string, unknown> | null;
    timestamp: number;
  }> {
    if (!this.db) throw new Error('資料庫未初始化');

    let sql = 'SELECT * FROM audit_log WHERE 1=1';
    const params: (string | number)[] = [];

    if (options.sessionId) {
      sql += ' AND session_id = ?';
      params.push(options.sessionId);
    }

    if (options.userId) {
      sql += ' AND user_id = ?';
      params.push(options.userId);
    }

    if (options.action) {
      sql += ' AND action = ?';
      params.push(options.action);
    }

    sql += ' ORDER BY timestamp DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options.offset) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    return rows.map(row => ({
      id: row.id as number,
      sessionId: row.session_id as string | null,
      userId: row.user_id as string,
      action: row.action as string,
      targetType: row.target_type as string | null,
      targetId: row.target_id as string | null,
      details: row.details ? JSON.parse(row.details as string) : null,
      timestamp: row.timestamp as number,
    }));
  }

  // ==================== 統計 ====================

  /**
   * 取得資料庫統計
   */
  getStats(): {
    sessionCount: number;
    activeSessionCount: number;
    messageCount: number;
    projectCount: number;
    guildCount: number;
    pendingApprovalCount: number;
  } {
    if (!this.db) throw new Error('資料庫未初始化');

    const sessionCount = (this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
    const activeSessionCount = (this.db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status IN ('running', 'starting', 'waiting')").get() as { count: number }).count;
    const messageCount = (this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }).count;
    const projectCount = (this.db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number }).count;
    const guildCount = (this.db.prepare('SELECT COUNT(*) as count FROM guild_settings').get() as { count: number }).count;
    const pendingApprovalCount = (this.db.prepare("SELECT COUNT(*) as count FROM tool_approvals WHERE status = 'pending'").get() as { count: number }).count;

    return {
      sessionCount,
      activeSessionCount,
      messageCount,
      projectCount,
      guildCount,
      pendingApprovalCount,
    };
  }

  // ==================== 工具方法 ====================

  /**
   * 準備語句（用於自訂查詢）
   * @example
   * // 安全的參數化查詢
   * const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
   * const user = stmt.get(userId);
   * 
   * // 插入數據
   * db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').run(name, email);
   */
  prepare(sql: string): Database.Statement {
    if (!this.db) throw new Error('資料庫未初始化');
    return this.db.prepare(sql);
  }

  /**
   * 執行真空（壓縮資料庫）
   */
  vacuum(): void {
    if (!this.db) throw new Error('資料庫未初始化');
    this.db.exec('VACUUM');
    logger.info('[SQLiteDatabase] 資料庫已真空壓縮');
  }

  // ==================== Channel Bindings 操作 ====================

  /**
   * 獲取或創建項目（根據路徑）
   */
  private getOrCreateProject(projectPath: string): number {
    if (!this.db) throw new Error('資料庫未初始化');

    // 嘗試通過路徑查找項目
    const existing = this.db.prepare('SELECT id FROM projects WHERE path = ?').get(projectPath) as { id: number } | undefined;

    if (existing) {
      return existing.id;
    }

    // 創建新項目
    const projectId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO projects (project_id, name, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      projectId,
      projectPath.split('/').pop() || 'Unnamed Project', // 使用路徑的最後一部分作為名稱
      projectPath,
      now,
      now
    );

    // 獲取新插入項目的 ID
    const newProject = this.db.prepare('SELECT id FROM projects WHERE path = ?').get(projectPath) as { id: number };
    return newProject.id;
  }

  /**
   * 保存頻道綁定
   */
  saveChannelBinding(channelId: string, projectPath: string, userId: string): void {
    if (!this.db) throw new Error('資料庫未初始化');

    const projectId = this.getOrCreateProject(projectPath);
    const now = Date.now();

    // 嘗試插入，如果衝突則忽略
    try {
      this.db.prepare(`
        INSERT INTO channel_bindings (channel_id, project_id, settings, created_at, updated_at)
        VALUES (?, ?, '{}', ?, ?)
      `).run(channelId, projectId, now, now);
    } catch (error) {
      // 如果已經存在，則更新
      this.db.prepare(`
        UPDATE channel_bindings 
        SET project_id = ?, updated_at = ?
        WHERE channel_id = ?
      `).run(projectId, now, channelId);
    }

    // 記錄綁定者
    this.updateChannelBindingBoundBy(channelId, userId);
  }

  /**
   * 更新綁定者信息
   */
  private updateChannelBindingBoundBy(channelId: string, userId: string): void {
    if (!this.db) throw new Error('資料庫未初始化');

    const settings = this.db.prepare('SELECT settings FROM channel_bindings WHERE channel_id = ?').get(channelId) as { settings: string } | undefined;
    if (!settings) return;

    const currentSettings = JSON.parse(settings.settings || '{}');
    currentSettings.bound_by = userId;

    this.db.prepare('UPDATE channel_bindings SET settings = ? WHERE channel_id = ?')
      .run(JSON.stringify(currentSettings), channelId);
  }

  /**
   * 獲取頻道綁定
   */
  getChannelBinding(channelId: string): ChannelBindingRecord | null {
    if (!this.db) throw new Error('資料庫未初始化');

    const row = this.db.prepare(`
      SELECT cb.channel_id, cb.project_id, cb.current_session_id, cb.settings, cb.created_at, cb.updated_at,
             p.path as project_path
      FROM channel_bindings cb
      JOIN projects p ON cb.project_id = p.id
      WHERE cb.channel_id = ?
    `).get(channelId) as (ChannelBindingRecord & { project_path: string }) | undefined;

    if (!row) return null;

    const settings = JSON.parse(row.settings || '{}');

    return {
      channel_id: row.channel_id,
      project_id: row.project_id,
      project_path: row.project_path,
      current_session_id: row.current_session_id,
      settings: row.settings,
      bound_at: row.created_at,
      updated_at: row.updated_at,
      bound_by: settings.bound_by || 'Unknown',
    };
  }

  /**
   * 更新頻道綁定
   */
  updateChannelBinding(channelId: string, projectPath: string, userId: string): void {
    if (!this.db) throw new Error('資料庫未初始化');

    const projectId = this.getOrCreateProject(projectPath);
    const now = Date.now();

    this.db.prepare(`
      UPDATE channel_bindings 
      SET project_id = ?, updated_at = ?
      WHERE channel_id = ?
    `).run(projectId, now, channelId);

    this.updateChannelBindingBoundBy(channelId, userId);
  }

  /**
   * 刪除頻道綁定
   */
  deleteChannelBinding(channelId: string): boolean {
    if (!this.db) throw new Error('資料庫未初始化');

    const result = this.db.prepare('DELETE FROM channel_bindings WHERE channel_id = ?').run(channelId);
    return result.changes > 0;
  }
}

/**
 * 建立 SQLite 資料庫實例的工廠函數
 */
export function createSQLiteDatabase(options?: SQLiteDatabaseOptions): SQLiteDatabase {
  return new SQLiteDatabase(options);
}

export default SQLiteDatabase;
