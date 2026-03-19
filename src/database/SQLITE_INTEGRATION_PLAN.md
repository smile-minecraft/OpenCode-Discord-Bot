# SQLite 整合計劃

## 概述

本計劃描述如何將現有的 JSON 文件儲存遷移到 SQLite 資料庫。

## 現狀分析

### 現有實現 (Database.ts)
- 基於 JSON 文件的儲存
- 每個實體（Guild, Session, Project）作為單獨的 JSON 檔案
- 記憶體緩存 + 檔案持久化
- 自動備份機制

### 目標實現 (SQLite)
- 使用 `better-sqlite3` 作為 SQLite 驅動
- 支援 WAL 模式提升並發效能
- 完整的外鍵約束和級聯刪除
- 自動時間戳更新觸發器

---

## Phase 1: 基礎設施建設

### 1.1 安裝依賴

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

### 1.2 創建 SQLiteDatabase 類

```typescript
// src/database/SQLiteDatabase.ts
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export class SQLiteDatabase {
  private db: Database.Database;
  
  constructor(dbPath: string) {
    // 確保目錄存在
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }
  
  // 執行 SQL 語句
  exec(sql: string): void {
    this.db.exec(sql);
  }
  
  // 準備語句
  prepare<T>(sql: string): Database.Statement<T> {
    return this.db.prepare<T>(sql);
  }
  
  // 關閉資料庫
  close(): void {
    this.db.close();
  }
}
```

---

## Phase 2: Repository 層實現

### 2.1 SessionRepository

```typescript
// src/database/repositories/SessionRepository.ts
import { SQLiteDatabase } from '../SQLiteDatabase';
import { Session, SessionData } from '../models/Session';

export class SessionRepository {
  constructor(private db: SQLiteDatabase) {}
  
  // 插入 Session
  insert(session: SessionData): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, channel_id, thread_id, user_id, project_path, 
        model, agent, status, port, prompt, opencode_session_id, started_at,
        last_active_at, ended_at, tokens_used, message_count, tool_call_count,
        error_message, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      session.sessionId,
      session.channelId,
      session.threadId,
      session.userId,
      session.projectPath,
      session.model,
      session.agent,
      session.status,
      session.port,
      session.prompt,
      session.opencodeSessionId,
      session.startedAt ? new Date(session.startedAt).getTime() : null,
      session.lastActiveAt ? new Date(session.lastActiveAt).getTime() : null,
      session.endedAt ? new Date(session.endedAt).getTime() : null,
      session.tokensUsed,
      session.messageCount,
      session.toolCallCount,
      session.errorMessage,
      JSON.stringify(session.metadata),
      new Date(session.createdAt).getTime(),
      new Date(session.updatedAt).getTime()
    );
  }
  
  // 查詢 Session
  findById(id: string): SessionData | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id) as any;
    
    if (!row) return null;
    return this.mapRowToSession(row);
  }
  
  // 查詢頻道的 Sessions
  findByChannel(channelId: string): SessionData[] {
    const stmt = this.db.prepare(
      'SELECT * FROM sessions WHERE channel_id = ? ORDER BY created_at DESC'
    );
    const rows = stmt.all(channelId) as any[];
    return rows.map(row => this.mapRowToSession(row));
  }
  
  // 更新 Session
  update(session: SessionData): void {
    const stmt = this.db.prepare(`
      UPDATE sessions SET 
        channel_id = ?, thread_id = ?, user_id = ?, project_path = ?,
        model = ?, agent = ?, status = ?, port = ?, prompt = ?,
        opencode_session_id = ?, started_at = ?, last_active_at = ?,
        ended_at = ?, tokens_used = ?, message_count = ?, tool_call_count = ?,
        error_message = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `);
    
    // ... 類似的參數綁定
  }
  
  // 刪除 Session
  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    stmt.run(id);
  }
  
  // 映射行數據到 SessionData
  private mapRowToSession(row: any): SessionData {
    return {
      sessionId: row.id,
      channelId: row.channel_id,
      threadId: row.thread_id,
      userId: row.user_id,
      projectPath: row.project_path,
      model: row.model,
      agent: row.agent,
      status: row.status,
      port: row.port,
      prompt: row.prompt,
      opencodeSessionId: row.opencode_session_id,
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
      lastActiveAt: row.last_active_at ? new Date(row.last_active_at).toISOString() : null,
      endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
      tokensUsed: row.tokens_used,
      messageCount: row.message_count,
      toolCallCount: row.tool_call_count,
      errorMessage: row.error_message,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
```

### 2.2 MessageRepository

```typescript
// src/database/repositories/MessageRepository.ts
export class MessageRepository {
  insert(sessionId: string, role: string, content: string, 
         toolCalls?: any[], toolResults?: any[]): number {
    const stmt = this.db.prepare(`
      INSERT INTO messages (session_id, role, content, tool_calls, tool_results, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      sessionId,
      role,
      content,
      toolCalls ? JSON.stringify(toolCalls) : null,
      toolResults ? JSON.stringify(toolResults) : null,
      Date.now()
    );
    
    return result.lastInsertRowid as number;
  }
  
  findBySession(sessionId: string): any[] {
    const stmt = this.db.prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC'
    );
    return stmt.all(sessionId);
  }
}
```

### 2.3 ToolApprovalRepository

```typescript
// src/database/repositories/ToolApprovalRepository.ts
export class ToolApprovalRepository {
  insert(sessionId: string, toolName: string, toolArgs: any): number {
    const stmt = this.db.prepare(`
      INSERT INTO tool_approvals (session_id, tool_name, tool_args, status, requested_at)
      VALUES (?, ?, ?, 'pending', ?)
    `);
    
    return stmt.run(
      sessionId,
      toolName,
      JSON.stringify(toolArgs),
      Date.now()
    ).lastInsertRowid as number;
  }
  
  updateStatus(id: number, status: string, responseMessage?: string): void {
    const stmt = this.db.prepare(`
      UPDATE tool_approvals 
      SET status = ?, response_message = ?, responded_at = ?
      WHERE id = ?
    `);
    
    stmt.run(status, responseMessage || null, Date.now(), id);
  }
  
  findPendingBySession(sessionId: string): any[] {
    const stmt = this.db.prepare(
      'SELECT * FROM tool_approvals WHERE session_id = ? AND status = ? ORDER BY requested_at ASC'
    );
    return stmt.all(sessionId, 'pending');
  }
}
```

---

## Phase 3: Database 類整合

### 3.1 策略選擇

有兩種整合策略：

#### 策略 A: 雙模式運行 (推薦)
保持現有的 JSON 儲存，新增 SQLite 作為可選的後端。

```typescript
// src/database/Database.ts
export type StorageBackend = 'json' | 'sqlite';

export interface DatabaseOptions {
  dataPath?: string;
  storageBackend?: StorageBackend;  // 新增選項
  sqlitePath?: string;               // SQLite 資料庫路徑
  // ... 其他選項
}

export class Database {
  private jsonDb: JsonDatabase;      // 現有實現
  private sqliteDb: SQLiteDatabase; // 新增 SQLite
  
  constructor(options: DatabaseOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    // 初始化 JSON 資料庫
    this.jsonDb = new JsonDatabase(this.options);
    
    // 如果指定了 SQLite，初始化 SQLite
    if (this.options.storageBackend === 'sqlite') {
      this.sqliteDb = new SQLiteDatabase(this.options.sqlitePath);
      this.initializeSchema();
    }
  }
  
  // 自動選擇儲存後端
  private get storage(): JsonDatabase | SQLiteDatabase {
    return this.options.storageBackend === 'sqlite' 
      ? this.sqliteDb 
      : this.jsonDb;
  }
  
  // 封裝 Session 操作
  async createSession(data: SessionData): Promise<Session> {
    if (this.options.storageBackend === 'sqlite') {
      const repo = new SessionRepository(this.sqliteDb);
      repo.insert(data);
      return new Session(data);
    }
    // 回退到 JSON
    return this.jsonDb.createSession(data);
  }
}
```

#### 策略 B: 完全替換
直接替換現有的實現，SQLite 作為唯一的儲存後端。

### 3.2 推薦的實現方式

建議採用策略 A，並按照以下順序實現：

1. **先實現 SQLiteDatabase 類** - 底層連接和 schema 管理
2. **實現 Repository 類** - 封裝所有 CRUD 操作
3. **擴展 Database 類** - 添加雙模式支持
4. **添加遷移工具** - 從 JSON 遷移到 SQLite

---

## Phase 4: 遷移策略

### 4.1 數據遷移腳本

```typescript
// src/database/migrations/migrate-json-to-sqlite.ts
export async function migrateFromJsonToSQLite(
  jsonDataPath: string,
  sqliteDbPath: string
): Promise<void> {
  const sqliteDb = new SQLiteDatabase(sqliteDbPath);
  
  // 讀取所有 JSON 檔案
  const sessionsDir = path.join(jsonDataPath, 'sessions');
  const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
  
  const sessionRepo = new SessionRepository(sqliteDb);
  
  for (const file of files) {
    const sessionData = JSON.parse(
      fs.readFileSync(path.join(sessionsDir, file), 'utf-8')
    );
    sessionRepo.insert(sessionData);
  }
  
  sqliteDb.close();
}
```

### 4.2 遷移選項

| 選項 | 描述 | 風險 |
|------|------|------|
| 一次性遷移 | 停止服務，一次性遷移所有數據 | 高風險，需停機維護 |
| 雙寫模式 | 寫入時同時寫入 JSON 和 SQLite | 複雜，可能影響效能 |
| 漸進式遷移 | 新數據寫入 SQLite，歷史數據保留在 JSON | 推薦，最小風險 |

---

## 文件結構

```
src/database/
├── Database.ts              # 現有實現 (保持不變)
├── SQLiteDatabase.ts       # 新增: SQLite 連接類
├── schema.sql              # 新增: 完整 Schema
├── migrations/
│   ├── 001_initial.sql    # 新增: 初始遷移
│   └── migrate-json-to-sqlite.ts  # 新增: 遷移腳本
├── repositories/
│   ├── SessionRepository.ts      # 新增
│   ├── MessageRepository.ts      # 新增
│   ├── ToolApprovalRepository.ts # 新增
│   ├── ProjectRepository.ts      # 新增
│   └── ChannelBindingRepository.ts # 新增
└── index.ts               # 更新: 匯出新類別
```

---

## 實作順序

1. **第一週**: 安裝依賴，實現 `SQLiteDatabase.ts`
2. **第二週**: 實現 `SessionRepository.ts` 和 `MessageRepository.ts`
3. **第三週**: 實現 `ToolApprovalRepository.ts` 和其他 Repository
4. **第四週**: 擴展 `Database.ts` 支持雙模式，添加遷移工具
5. **測試**: 全面測試，確保數據一致性

---

## 注意事項

### 效能優化
- 使用 WAL 模式提升並發讀寫效能
- 合理設計索引，避免過度索引
- 使用 prepared statements 避免 SQL 注入

### 錯誤處理
- 事務回滾機制
- 連接池管理
- 斷線重連

### 備份策略
- 定期執行 VACUUM
- 保留 WAL 文件的備份
- 監控資料庫大小

---

## 成本估計

- **開發時間**: 4-5 週
- **程式碼變更**: ~2000 行
- **測試覆蓋**: 需要完整的單元測試和集成測試
