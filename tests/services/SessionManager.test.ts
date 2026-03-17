/**
 * SessionManager 測試 - 簡化架構測試
 * @description 測試使用固定端口 3000 的 SessionManager
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SessionManager } from '../../src/services/SessionManager.js';

// Mock OpenCodeServerManager
vi.mock('../../src/services/OpenCodeServerManager.js', () => ({
  getOpenCodeServerManager: vi.fn(() => ({
    getPort: vi.fn().mockReturnValue(3000),
    getIsRunning: vi.fn().mockReturnValue(false),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
  })),
}));

// Mock OpenCodeClient
vi.mock('../../src/services/deprecated/OpenCodeClient.js', () => ({
  getOpenCodeClient: vi.fn(() => ({
    startServer: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue({ id: 'test-session-id' }),
    isServerRunning: vi.fn().mockResolvedValue(false),
    stopServer: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('SessionManager', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    // 建立新的 SessionManager 實例
    sessionManager = new SessionManager();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('固定端口 3000 架構', () => {
    /**
     * 測試場景：創建 SessionManager 實例
     * 預期結果：成功創建實例
     */
    it('應該成功創建 SessionManager 實例', () => {
      expect(sessionManager).toBeDefined();
    });

    /**
     * 測試場景：SessionManager 應該有正確的方法
     * 預期結果：應該有 createSession, resumeSession, abortSession 等方法
     */
    it('應該有必要的 Session 方法', () => {
      expect(typeof sessionManager.createSession).toBe('function');
      expect(typeof sessionManager.resumeSession).toBe('function');
      expect(typeof sessionManager.abortSession).toBe('function');
      expect(typeof sessionManager.listSessions).toBe('function');
      expect(typeof sessionManager.getSession).toBe('function');
    });

    /**
     * 測試場景：獲取活躍 Session 統計
     * 預期結果：返回正確的統計對象
     */
    it('應該返回正確的統計對象', () => {
      const stats = sessionManager.getStats();
      
      expect(stats).toHaveProperty('activeCount');
      expect(stats).toHaveProperty('runningCount');
      expect(stats).toHaveProperty('waitingCount');
      expect(stats).toHaveProperty('pausedCount');
    });

    /**
     * 測試場景：通過頻道 ID 獲取 Session
     * 預期結果：返回空數組（沒有 Session）
     */
    it('沒有 Session 時應該返回空數組', () => {
      const sessions = sessionManager.getSessionsByChannel('test-channel');
      
      expect(sessions).toEqual([]);
    });

    /**
     * 測試場景：獲取不存在的 Session
     * 預期結果：返回 undefined
     */
    it('獲取不存在的 Session 應該返回 undefined', () => {
      const session = sessionManager.getSession('nonexistent-session');
      
      expect(session).toBeUndefined();
    });

    /**
     * 測試場景：檢查頻道是否有活躍 Session
     * 預期結果：返回 false
     */
    it('沒有活躍 Session 時應該返回 false', () => {
      const hasActive = sessionManager.hasActiveSession('test-channel');
      
      expect(hasActive).toBe(false);
    });
  });
});
