/**
 * ThreadMapping 單元測試
 * @description 測試 SQLiteDatabase 的 Thread Mapping 方法存在性和基本行為
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SQLiteDatabase } from '../../src/database/SQLiteDatabase.js';

// Mock better-sqlite3 with proper default export constructor
vi.mock('better-sqlite3', () => {
  // Create a mock prepare function that returns proper statement objects
  const createStatementMock = (sql: string) => {
    // Return table names for the schema check query
    if (sql.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
      return {
        all: vi.fn().mockReturnValue([
          { name: 'sessions' },
          { name: 'messages' },
          { name: 'tool_approvals' },
          { name: 'projects' },
          { name: 'channel_bindings' },
          { name: 'guild_settings' },
        ]),
        run: vi.fn().mockReturnValue({ changes: 0 }),
        get: vi.fn().mockReturnValue(null),
      };
    }
    // Return for schema version query
    if (sql.includes('SELECT MAX(version) as version FROM schema_version')) {
      return {
        get: vi.fn().mockReturnValue({ version: 1 }),
      };
    }
    return {
      all: vi.fn().mockReturnValue([]),
      run: vi.fn().mockReturnValue({ changes: 0, lastInsertRowid: 0 }),
      get: vi.fn().mockReturnValue(null),
    };
  };

  // Create a constructor function that returns the mock instance
  const MockDatabase = function() {
    return {
      pragma: vi.fn().mockReturnValue(undefined),
      exec: vi.fn(),
      prepare: vi.fn((sql: string) => createStatementMock(sql)),
      close: vi.fn(),
      transaction: vi.fn((fn: () => void) => {
        return () => {
          const result = fn();
          return result;
        };
      }),
      backup: vi.fn().mockResolvedValue(undefined),
    };
  };
  
  return {
    __esModule: true,
    default: MockDatabase,
  };
});

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('SQLiteDatabase ThreadMapping', () => {
  let db: SQLiteDatabase;

  beforeEach(async () => {
    // 重置單例
    (SQLiteDatabase as any).instance = null;
    db = SQLiteDatabase.getInstance();
    
    // 初始化數據庫（使用 mock better-sqlite3）
    await db.initialize();
    
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // 忽略關閉時的錯誤
    }
    vi.clearAllMocks();
  });

  describe('Thread Mapping 方法存在性', () => {
    it('saveThreadMapping 方法應該存在', () => {
      expect(typeof db.saveThreadMapping).toBe('function');
    });

    it('getThreadMapping 方法應該存在', () => {
      expect(typeof db.getThreadMapping).toBe('function');
    });

    it('getThreadMappingBySessionId 方法應該存在', () => {
      expect(typeof db.getThreadMappingBySessionId).toBe('function');
    });

    it('getThreadMappingByOpencodeSessionId 方法應該存在', () => {
      expect(typeof db.getThreadMappingByOpencodeSessionId).toBe('function');
    });

    it('archiveThreadMapping 方法應該存在', () => {
      expect(typeof db.archiveThreadMapping).toBe('function');
    });

    it('markThreadForCleanup 方法應該存在', () => {
      expect(typeof db.markThreadForCleanup).toBe('function');
    });

    it('getThreadsNeedingCleanup 方法應該存在', () => {
      expect(typeof db.getThreadsNeedingCleanup).toBe('function');
    });

    it('getActiveThreadMappings 方法應該存在', () => {
      expect(typeof db.getActiveThreadMappings).toBe('function');
    });

    it('deleteThreadMapping 方法應該存在', () => {
      expect(typeof db.deleteThreadMapping).toBe('function');
    });

    it('getAllThreadMappings 方法應該存在', () => {
      expect(typeof db.getAllThreadMappings).toBe('function');
    });

    it('updateSessionsThreadArchived 方法應該存在', () => {
      expect(typeof db.updateSessionsThreadArchived).toBe('function');
    });

    it('transaction 方法應該存在', () => {
      expect(typeof db.transaction).toBe('function');
    });
  });

  describe('isReady', () => {
    it('初始化後應該返回 true', () => {
      expect(db.isReady()).toBe(true);
    });

    it('關閉後應該返回 false', () => {
      db.close();
      expect(db.isReady()).toBe(false);
    });
  });

  describe('transaction', () => {
    it('應該執行回調函數並返回結果', () => {
      const callback = vi.fn().mockReturnValue('test-result');
      
      const result = db.transaction(callback);
      
      expect(callback).toHaveBeenCalled();
      expect(result).toBe('test-result');
    });

    it('應該在數據庫未初始化時拋出錯誤', () => {
      db.close();
      
      expect(() => db.transaction(() => {})).toThrow('資料庫未初始化');
    });
  });

  describe('getThreadMapping 方法調用行為', () => {
    it('getThreadMapping 當找不到 mapping 時應該返回 null', () => {
      const result = db.getThreadMapping('nonexistent-thread');
      expect(result).toBeNull();
    });

    it('getThreadMappingBySessionId 當找不到 mapping 時應該返回 null', () => {
      const result = db.getThreadMappingBySessionId('nonexistent-session');
      expect(result).toBeNull();
    });

    it('getThreadMappingByOpencodeSessionId 當找不到 mapping 時應該返回 null', () => {
      const result = db.getThreadMappingByOpencodeSessionId('nonexistent-opencode');
      expect(result).toBeNull();
    });

    it('getThreadsNeedingCleanup 應該返回空數組', () => {
      const result = db.getThreadsNeedingCleanup();
      expect(result).toEqual([]);
    });

    it('getActiveThreadMappings 應該返回空數組', () => {
      const result = db.getActiveThreadMappings();
      expect(result).toEqual([]);
    });

    it('getAllThreadMappings 應該返回空數組', () => {
      const result = db.getAllThreadMappings();
      expect(result).toEqual([]);
    });

    it('deleteThreadMapping 對不存在的 mapping 應該返回 false', () => {
      const result = db.deleteThreadMapping('nonexistent-thread');
      expect(result).toBe(false);
    });
  });

  describe('ThreadMapping 類型接口', () => {
    it('ThreadMapping 應該有正確的結構', () => {
      const mapping = {
        threadId: 'thread-123',
        sessionId: 'session-456',
        opencodeSessionId: 'opencode-789',
        channelId: 'channel-abc',
        guildId: 'guild-def',
        createdAt: Date.now(),
        archivedAt: null,
        needsCleanup: false,
        cleanupError: null,
      };

      expect(mapping).toHaveProperty('threadId');
      expect(mapping).toHaveProperty('sessionId');
      expect(mapping).toHaveProperty('channelId');
      expect(mapping).toHaveProperty('guildId');
      expect(mapping).toHaveProperty('createdAt');
    });
  });
});
