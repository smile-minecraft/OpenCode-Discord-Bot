/**
 * SessionManager 測試 - 簡化架構測試
 * @description 測試使用固定端口 3000 的 SessionManager
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SessionManager } from '../../src/services/SessionManager.js';
import { Session } from '../../src/database/models/Session.js';

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

// Mock ThreadManager
vi.mock('../../src/services/ThreadManager.js', () => ({
  getThreadManager: vi.fn(() => ({
    isReady: vi.fn().mockReturnValue(true),
    deleteDiscordThread: vi.fn().mockResolvedValue(undefined),
    deleteThread: vi.fn(),
    cleanupSession: vi.fn(),
    deleteSessionThread: vi.fn().mockResolvedValue(undefined),
    clearAllSessionThreads: vi.fn().mockResolvedValue({ deleted: 0, failed: 0 }),
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

    /**
     * 回歸測試：
     * 刪除流程不應在「即將刪除資料」前再保存一次 Session，
     * 以避免舊資料 userId 為空時觸發 validateSession 錯誤。
     */
    it('terminateAndDeleteSession 在 userId 為空時仍可刪除且不會呼叫 saveSession', async () => {
      const manager = sessionManager as any;
      const sessionId = 'sess_empty_user';
      const channelId = 'channel_empty_user';

      const loadedSession = new Session({
        sessionId,
        channelId,
        userId: '',
        prompt: 'test',
        projectPath: '/tmp',
      });
      loadedSession.opencodeSessionId = 'ses_test_123';
      loadedSession.threadId = null;

      const saveSpy = vi.spyOn(manager, 'saveSession');
      const deleteSessionSpy = vi.fn().mockReturnValue(true);

      manager.activeSessions = new Map();
      manager.channelSessions = new Map([[channelId, new Set([sessionId])]]);
      manager.loadSession = vi.fn().mockResolvedValue(loadedSession);
      manager.sdkAdapter = {
        abortSession: vi.fn().mockResolvedValue(undefined),
        deleteSession: vi.fn().mockResolvedValue(true),
      };
      manager.sessionEventManager = {
        unsubscribe: vi.fn(),
      };
      manager.sqliteDb = {
        isReady: vi.fn().mockReturnValue(true),
        deleteSession: deleteSessionSpy,
      };

      const result = await sessionManager.terminateAndDeleteSession(sessionId, { deleteThread: false });

      expect(result).toBeTruthy();
      expect(result?.status).toBe('aborted');
      expect(saveSpy).not.toHaveBeenCalled();
      expect(deleteSessionSpy).toHaveBeenCalledWith(sessionId);
    });

    /**
     * 測試場景：terminateAndDeleteSession 會呼叫 deleteMainStatusMessage
     * 預期結果：當 session 有 statusMessageId 時，應該嘗試刪除
     */
    it('terminateAndDeleteSession 會嘗試刪除主狀態卡（當有 statusMessageId）', async () => {
      const manager = sessionManager as any;
      const sessionId = 'sess_with_status_card';
      const channelId = 'channel_with_status';
      const statusMessageId = 'msg_status_123';
      const statusChannelId = 'status_channel_456';

      const loadedSession = new Session({
        sessionId,
        channelId,
        userId: 'test-user',
        prompt: 'test',
        projectPath: '/tmp',
      });
      loadedSession.opencodeSessionId = 'ses_test_456';
      loadedSession.threadId = null;
      // 模擬 session 有 statusMessageId
      (loadedSession.metadata as Record<string, unknown>).statusMessageId = statusMessageId;
      (loadedSession.metadata as Record<string, unknown>).statusChannelId = statusChannelId;

      // Mock Discord client
      const mockChannel = {
        messages: {
          fetch: vi.fn().mockResolvedValue({ id: statusMessageId, delete: vi.fn().mockResolvedValue(undefined) }),
        },
      };
      const mockDiscordClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue(mockChannel),
        },
      };
      manager.discordClient = mockDiscordClient;

      manager.loadSession = vi.fn().mockResolvedValue(loadedSession);
      manager.sdkAdapter = {
        abortSession: vi.fn().mockResolvedValue(undefined),
        deleteSession: vi.fn().mockResolvedValue(true),
      };
      manager.sessionEventManager = {
        unsubscribe: vi.fn(),
      };
      manager.sqliteDb = {
        isReady: vi.fn().mockReturnValue(true),
        deleteSession: vi.fn(),
      };

      await sessionManager.terminateAndDeleteSession(sessionId, { deleteThread: false });

      // 驗證 Discord client 被呼叫來刪除狀態卡
      expect(mockDiscordClient.channels.fetch).toHaveBeenCalledWith(statusChannelId);
      expect(mockChannel.messages.fetch).toHaveBeenCalledWith(statusMessageId);
    });

    /**
     * 測試場景：status message fetch/delete 失敗不阻斷刪除流程
     * 預期結果：即使刪除狀態卡失敗，session 仍被正確刪除
     */
    it('刪除狀態卡失敗時不阻斷 session 刪除流程', async () => {
      const manager = sessionManager as any;
      const sessionId = 'sess_status_delete_fail';
      const channelId = 'channel_status_fail';
      const statusMessageId = 'msg_fail_789';
      const statusChannelId = 'status_channel_fail';

      const loadedSession = new Session({
        sessionId,
        channelId,
        userId: 'test-user',
        prompt: 'test',
        projectPath: '/tmp',
      });
      loadedSession.opencodeSessionId = 'ses_test_789';
      loadedSession.threadId = null;
      (loadedSession.metadata as Record<string, unknown>).statusMessageId = statusMessageId;
      (loadedSession.metadata as Record<string, unknown>).statusChannelId = statusChannelId;

      // Mock Discord client that throws
      const mockDiscordClient = {
        channels: {
          fetch: vi.fn().mockRejectedValue(new Error('Discord API Error')),
        },
      };
      manager.discordClient = mockDiscordClient;

      const deleteSessionSpy = vi.fn().mockReturnValue(true);
      manager.loadSession = vi.fn().mockResolvedValue(loadedSession);
      manager.sdkAdapter = {
        abortSession: vi.fn().mockResolvedValue(undefined),
        deleteSession: vi.fn().mockResolvedValue(true),
      };
      manager.sessionEventManager = {
        unsubscribe: vi.fn(),
      };
      manager.sqliteDb = {
        isReady: vi.fn().mockReturnValue(true),
        deleteSession: deleteSessionSpy,
      };

      // 不應該拋出錯誤
      const result = await sessionManager.terminateAndDeleteSession(sessionId, { deleteThread: false });

      // session 仍然被刪除
      expect(result).toBeTruthy();
      expect(deleteSessionSpy).toHaveBeenCalledWith(sessionId);
    });

    /**
     * 測試場景：clearAllSessions 統計 deletedStatusMessages 且不因單一失敗中斷
     * 預期結果：回傳包含 deletedStatusMessages，即使某些 session 刪除失敗也繼續
     */
    it('clearAllSessions 統計 deletedStatusMessages 且不因單一失敗中斷', async () => {
      const manager = sessionManager as any;

      const session1 = new Session({
        sessionId: 'sess_clear_1',
        channelId: 'channel_1',
        userId: 'user_1',
        prompt: 'test1',
        projectPath: '/tmp',
      });
      session1.opencodeSessionId = 'ses_1';
      (session1.metadata as Record<string, unknown>).statusMessageId = 'msg_1';
      (session1.metadata as Record<string, unknown>).statusChannelId = 'ch_1';

      const session2 = new Session({
        sessionId: 'sess_clear_2',
        channelId: 'channel_2',
        userId: 'user_2',
        prompt: 'test2',
        projectPath: '/tmp',
      });
      session2.opencodeSessionId = 'ses_2';
      // session2 沒有 statusMessageId

      const session3 = new Session({
        sessionId: 'sess_clear_3',
        channelId: 'channel_3',
        userId: 'user_3',
        prompt: 'test3',
        projectPath: '/tmp',
      });
      session3.opencodeSessionId = 'ses_3';
      (session3.metadata as Record<string, unknown>).statusMessageId = 'msg_3';
      (session3.metadata as Record<string, unknown>).statusChannelId = 'ch_3';

      // Mock activeSessions + sqliteDb
      manager.activeSessions = new Map([
        ['sess_clear_1', session1],
        ['sess_clear_3', session3],
      ]);
      manager.channelSessions = new Map();
      manager.sqliteDb = {
        isReady: vi.fn().mockReturnValue(true),
        loadAllSessions: vi.fn().mockReturnValue([session2]),
        deleteSession: vi.fn().mockReturnValue(true),
      };
      // Mock manager.loadSession for sessions not in activeSessions
      manager.loadSession = vi.fn().mockImplementation(async (id: string) => {
        if (id === 'sess_clear_2') return session2;
        return null;
      });
      manager.sdkAdapter = {
        abortSession: vi.fn().mockResolvedValue(undefined),
        deleteSession: vi.fn().mockResolvedValue(true),
      };
      manager.sessionEventManager = {
        unsubscribe: vi.fn(),
      };
      manager.discordClient = null; // 無 client 不影響統計邏輯

      const mockThreadManager = {
        isReady: vi.fn().mockReturnValue(true),
        deleteDiscordThread: vi.fn().mockResolvedValue(undefined),
        deleteThread: vi.fn(),
        clearAllSessionThreads: vi.fn().mockResolvedValue({ deleted: 0, failed: 0 }),
      };
      manager.getThreadManager = vi.fn().mockReturnValue(mockThreadManager);

      const result = await sessionManager.clearAllSessions({ deleteThreads: true });

      expect(result.totalSessions).toBe(3);
      expect(result.deletedSessions).toBe(3);
      expect(result.deletedStatusMessages).toBe(2); // sess_clear_1 和 sess_clear_3 有 statusMessageId
      expect(result.failed).toBe(0);
    });
  });
});
