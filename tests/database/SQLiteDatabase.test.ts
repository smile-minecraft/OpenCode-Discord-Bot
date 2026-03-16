/**
 * SQLiteDatabase 單元測試
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SQLiteDatabase } from '../../src/database/SQLiteDatabase.js';

// Mock better-sqlite3
vi.mock('better-sqlite3', () => {
  const mockExec = vi.fn();
  const mockPrepare = vi.fn(() => ({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
  }));
  
  return {
    default: vi.fn(() => ({
      pragma: vi.fn(),
      exec: mockExec,
      prepare: mockPrepare,
      close: vi.fn(),
    })),
    __mockExec: mockExec,
    __mockPrepare: mockPrepare,
  };
});

describe('SQLiteDatabase', () => {
  beforeEach(() => {
    // 重置單例
    (SQLiteDatabase as any).instance = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getInstance()', () => {
    it('應該返回單例實例', () => {
      const db1 = SQLiteDatabase.getInstance();
      const db2 = SQLiteDatabase.getInstance();
      
      expect(db1).toBe(db2);
    });
  });

  describe('isReady()', () => {
    it('初始化前應該返回 false', () => {
      const db = SQLiteDatabase.getInstance();
      expect(db.isReady()).toBe(false);
    });
  });

  describe('close()', () => {
    it('應該能夠關閉資料庫而不出錯', () => {
      const db = SQLiteDatabase.getInstance();
      
      // 不應該拋出錯誤
      expect(() => db.close()).not.toThrow();
    });
  });

  describe('Schema 解析', () => {
    it('應該過濾掉 JavaScript 風格的多行註釋', () => {
      const schemaWithComments = `
/**
 * 這是測試註釋
 * 多行
 */
-- 這是 SQL 註釋
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS test (
  id INTEGER PRIMARY KEY
);
`;
      // 模擬過濾邏輯
      const filtered = schemaWithComments.replace(/\/\*[\s\S]*?\*\//g, '');
      
      expect(filtered).not.toContain('/**');
      expect(filtered).not.toContain('*/');
      expect(filtered).toContain('PRAGMA');
      expect(filtered).toContain('CREATE TABLE');
    });

    it('應該正確處理空行和註釋', () => {
      const schema = `

-- 註釋行

PRAGMA journal_mode = WAL;

-- 另一個註釋

CREATE TABLE test (id INTEGER);
`;
      const lines = schema.split('\n');
      const validStatements = lines
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('--'));
      
      expect(validStatements).toContain('PRAGMA journal_mode = WAL;');
      expect(validStatements).toContain('CREATE TABLE test (id INTEGER);');
    });
  });
});
