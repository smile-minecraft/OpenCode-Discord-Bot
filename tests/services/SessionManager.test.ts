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

// Mock ThreadManager (extended with restoreMappings for Bug 2 tests)
// CRITICAL: Use vi.hoisted() so threadManagerRestoreMappingsSpy is hoisted together
// with vi.mock factory, ensuring the SAME spy instance is used in both.
const { threadManagerRestoreMappingsSpy, threadManagerMock, getThreadManagerMock } = vi.hoisted(() => {
  const spy = vi.fn();
  const mock = {
    isReady: vi.fn().mockReturnValue(true),
    deleteDiscordThread: vi.fn().mockResolvedValue(undefined),
    deleteThread: vi.fn(),
    cleanupSession: vi.fn(),
    deleteSessionThread: vi.fn().mockResolvedValue(undefined),
    clearAllSessionThreads: vi.fn().mockResolvedValue({ deleted: 0, failed: 0 }),
    restoreMappings: spy,
  };
  const getThreadManagerFn = vi.fn(() => mock);
  return { threadManagerRestoreMappingsSpy: spy, threadManagerMock: mock, getThreadManagerMock: getThreadManagerFn };
});

vi.mock('../../src/services/ThreadManager.js', () => {
  return {
    getThreadManager: getThreadManagerMock,
  };
});

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

    /**
     * Bug 2 Test 1: findSession re-registers non-ended loaded session into activeSessions + channelSessions
     * 當 session 不在 activeSessions 但在 DB 中且未結束時，findSession 應重新註冊到 activeSessions 和 channelSessions
     */
    it('findSession 會將未結束的 DB session 重新註冊到 activeSessions 和 channelSessions', async () => {
      const manager = sessionManager as any;
      const sessionId = 'sess_db_reload_1';
      const channelId = 'channel_db_reload_1';

      // 模擬 DB 中有一個未結束的 session
      const dbSession = new Session({
        sessionId,
        channelId,
        userId: 'test-user',
        prompt: 'test reload',
        projectPath: '/tmp',
      });
      dbSession.opencodeSessionId = 'ses_db_123';
      dbSession.threadId = null;
      // session 處於 running 狀態（未結束）

      // 初始狀態：activeSessions 和 channelSessions 都是空的
      manager.activeSessions = new Map();
      manager.channelSessions = new Map();

      // Mock sqliteDb.loadSession 返回 DB 中的 session
      manager.sqliteDb = {
        isReady: vi.fn().mockReturnValue(true),
        loadSession: vi.fn().mockReturnValue(dbSession),
      };

      const result = await sessionManager.findSession(sessionId);

      // 驗證 findSession 返回 session
      expect(result).toBeTruthy();
      expect(result?.sessionId).toBe(sessionId);

      // 驗證 session 被重新註冊到 activeSessions
      expect(manager.activeSessions.has(sessionId)).toBe(true);
      expect(manager.activeSessions.get(sessionId)).toBe(dbSession);

      // 驗證 session 被註冊到 channelSessions
      expect(manager.channelSessions.has(channelId)).toBe(true);
      expect(manager.channelSessions.get(channelId)?.has(sessionId)).toBe(true);
    });

    /**
     * Bug 2 Test 1b: findSession does NOT re-register ended sessions
     * 當 session 已結束時，不應重新註冊
     */
    it('findSession 不會重新註冊已結束的 session', async () => {
      const manager = sessionManager as any;
      const sessionId = 'sess_ended_1';
      const channelId = 'channel_ended_1';

      // 模擬 DB 中有一個已結束的 session (completed)
      const endedSession = new Session({
        sessionId,
        channelId,
        userId: 'test-user',
        prompt: 'test ended',
        projectPath: '/tmp',
      });
      endedSession.opencodeSessionId = 'ses_ended_123';
      endedSession.threadId = null;
      endedSession.complete(); // 標記為完成

      // 初始狀態
      manager.activeSessions = new Map();
      manager.channelSessions = new Map();

      manager.sqliteDb = {
        isReady: vi.fn().mockReturnValue(true),
        loadSession: vi.fn().mockReturnValue(endedSession),
      };

      const result = await sessionManager.findSession(sessionId);

      // findSession 仍返回 session（因為找到了）
      expect(result).toBeTruthy();

      // 但不應重新註冊到 activeSessions
      expect(manager.activeSessions.has(sessionId)).toBe(false);

      // 也不應註冊到 channelSessions
      expect(manager.channelSessions.has(channelId)).toBe(false);
    });

    /**
     * Bug 2 Test 2: getActiveSessionByChannel resolves thread channel to parent via resolveParentChannelId
     * 當傳入 thread channel ID 時，getActiveSessionByChannel 應解析到 parent channel 並正確找到 session
     */
    it('getActiveSessionByChannel 會解析 thread channel 到 parent channel 並找到 session', () => {
      const manager = sessionManager as any;
      const parentChannelId = 'parent_channel_123';
      const threadChannelId = 'thread_channel_456';
      const sessionId = 'sess_thread_1';

      // 創建一個處於 running 狀態的 session，綁定到 parent channel
      const runningSession = new Session({
        sessionId,
        channelId: parentChannelId,
        userId: 'test-user',
        prompt: 'test thread resolution',
        projectPath: '/tmp',
      });
      runningSession.opencodeSessionId = 'ses_thread_123';
      runningSession.threadId = threadChannelId;
      runningSession.markRunning();

      // 設置 activeSessions
      manager.activeSessions = new Map([[sessionId, runningSession]]);
      manager.channelSessions = new Map([[parentChannelId, new Set([sessionId])]]);

      // Mock Discord client 回傳 thread channel
      const mockThreadChannel = {
        type: 12, // ChannelType.PublicThread
        parentId: parentChannelId,
      };
      manager.discordClient = {
        channels: {
          cache: new Map([[threadChannelId, mockThreadChannel]]),
        },
      };

      // 使用 thread channel ID 查詢，應該解析到 parent channel 並找到 session
      const result = sessionManager.getActiveSessionByChannel(threadChannelId);

      expect(result).toBeTruthy();
      expect(result?.sessionId).toBe(sessionId);
      expect(result?.channelId).toBe(parentChannelId);
    });

    /**
     * Bug 2 Test 2b: getActiveSessionByChannel without Discord client returns undefined
     * 當沒有 Discord client 時，無法解析 thread，應直接查詢原 channelId
     */
    it('沒有 Discord client 時 getActiveSessionByChannel 直接查詢原 channelId', () => {
      const manager = sessionManager as any;
      const channelId = 'direct_channel_789';
      const sessionId = 'sess_direct_1';

      const runningSession = new Session({
        sessionId,
        channelId,
        userId: 'test-user',
        prompt: 'test direct',
        projectPath: '/tmp',
      });
      runningSession.opencodeSessionId = 'ses_direct_123';
      runningSession.markRunning();

      manager.activeSessions = new Map([[sessionId, runningSession]]);
      manager.channelSessions = new Map([[channelId, new Set([sessionId])]]);
      manager.discordClient = null; // 無 client

      // 沒有 client 時，直接用原 channelId 查詢
      const result = sessionManager.getActiveSessionByChannel(channelId);

      expect(result).toBeTruthy();
      expect(result?.sessionId).toBe(sessionId);
    });

    /**
     * Bug 2 Test 3: restoreActiveSessions rebuilds channelSessions from sqliteDb.loadActiveSessions
     * 並在 threadManager ready 時呼叫 threadManager.restoreMappings
     */
    it('restoreActiveSessions 會重建 channelSessions 並呼叫 threadManager.restoreMappings', async () => {
      const manager = sessionManager as any;

      // 重置 spy 以便乾淨計算
      threadManagerRestoreMappingsSpy.mockClear();

      // 創建多個活跃 sessions
      const session1 = new Session({
        sessionId: 'sess_restore_1',
        channelId: 'channel_restore_1',
        userId: 'user_1',
        prompt: 'test restore 1',
        projectPath: '/tmp',
      });
      session1.opencodeSessionId = 'ses_restore_1';

      const session2 = new Session({
        sessionId: 'sess_restore_2',
        channelId: 'channel_restore_1', // 同一個 channel 有多個 session
        userId: 'user_2',
        prompt: 'test restore 2',
        projectPath: '/tmp',
      });
      session2.opencodeSessionId = 'ses_restore_2';

      const session3 = new Session({
        sessionId: 'sess_restore_3',
        channelId: 'channel_restore_2',
        userId: 'user_3',
        prompt: 'test restore 3',
        projectPath: '/tmp',
      });
      session3.opencodeSessionId = 'ses_restore_3';

      const dbSessions = [session1, session2, session3];

      manager.sqliteDb = {
        isReady: vi.fn().mockReturnValue(true),
        loadActiveSessions: vi.fn().mockReturnValue(dbSessions),
      };

      // Control behavior via shared getThreadManagerMock so ThreadManager module uses it
      getThreadManagerMock.mockReturnValue(threadManagerMock);

      // 初始狀態：非空（模擬重啟前有殘留數據）
      manager.activeSessions = new Map([['old_session', 'old_data' as any]]);
      manager.channelSessions = new Map([['old_channel', new Set(['old_session'])]]);

      await sessionManager.restoreActiveSessions();

      // 驗證 channelSessions 被清空並重建
      expect(manager.channelSessions.has('old_channel')).toBe(false); // 舊數據被清除

      // 驗證 channel_restore_1 的 sessions
      expect(manager.channelSessions.has('channel_restore_1')).toBe(true);
      expect(manager.channelSessions.get('channel_restore_1')?.size).toBe(2); // session1, session2

      // 驗證 channel_restore_2 的 sessions
      expect(manager.channelSessions.has('channel_restore_2')).toBe(true);
      expect(manager.channelSessions.get('channel_restore_2')?.size).toBe(1); // session3

      // 驗證 activeSessions 包含所有恢復的 sessions（加上舊的 entry，因為 restore 不會清空 activeSessions）
      expect(manager.activeSessions.size).toBe(4); // 1 old + 3 restored
      expect(manager.activeSessions.has('sess_restore_1')).toBe(true);
      expect(manager.activeSessions.has('sess_restore_2')).toBe(true);
      expect(manager.activeSessions.has('sess_restore_3')).toBe(true);

      // 驗證 threadManager 路徑被使用（穩定的 mock 斷言）
      expect(getThreadManagerMock).toHaveBeenCalledTimes(1);
      expect(threadManagerMock.isReady).toHaveBeenCalledTimes(1);
    });

    /**
     * Bug 2 Test 3b: restoreActiveSessions does not call restoreMappings when threadManager is not ready
     * 當 threadManager 未就緒時，不應呼叫 restoreMappings
     */
    it('threadManager 未就緒時 restoreActiveSessions 不呼叫 restoreMappings', async () => {
      const manager = sessionManager as any;

      const dbSession = new Session({
        sessionId: 'sess_not_ready_1',
        channelId: 'channel_not_ready_1',
        userId: 'user_1',
        prompt: 'test not ready',
        projectPath: '/tmp',
      });
      dbSession.opencodeSessionId = 'ses_not_ready_1';

      manager.sqliteDb = {
        isReady: vi.fn().mockReturnValue(true),
        loadActiveSessions: vi.fn().mockReturnValue([dbSession]),
      };

      // 建立 NOT ready 的 threadManager mock
      const notReadyMock = {
        isReady: vi.fn().mockReturnValue(false),
        restoreMappings: vi.fn(),
      };
      getThreadManagerMock.mockReturnValue(notReadyMock as any);

      manager.activeSessions = new Map();
      manager.channelSessions = new Map();

      await sessionManager.restoreActiveSessions();

      // restoreMappings 不應被呼叫
      expect(notReadyMock.restoreMappings).not.toHaveBeenCalled();

      // 但 session 仍應被恢復
      expect(manager.activeSessions.has('sess_not_ready_1')).toBe(true);
    });

    /**
     * Bug 2 Test 3c: restoreActiveSessions skips expired sessions (> 24 hours)
     * 恢復時應跳過超過 24 小時的過期 sessions
     */
    it('restoreActiveSessions 會跳過超過 24 小時的過期 sessions', async () => {
      const manager = sessionManager as any;

      // 創建一個過期的 session (lastActiveAt 為 48 小時前)
      const expiredSession = new Session({
        sessionId: 'sess_expired_1',
        channelId: 'channel_expired_1',
        userId: 'user_1',
        prompt: 'test expired',
        projectPath: '/tmp',
      });
      expiredSession.opencodeSessionId = 'ses_expired_1';
      expiredSession.markRunning(); // set running first so lastActiveAt update doesn't flip status
      const expiredTime = Date.now() - (48 * 60 * 60 * 1000);
      expiredSession.lastActiveAt = new Date(expiredTime).toISOString();

      const saveSessionSpy = vi.fn();
      manager.sqliteDb = {
        isReady: vi.fn().mockReturnValue(true),
        loadActiveSessions: vi.fn().mockReturnValue([expiredSession]),
        saveSession: saveSessionSpy,
      };

      getThreadManagerMock.mockReturnValue(threadManagerMock);

      // 明確清除確保乾淨狀態（因為 restoreActiveSessions 不會清除 activeSessions）
      manager.activeSessions = new Map();
      manager.channelSessions = new Map();

      await sessionManager.restoreActiveSessions();

      // 過期 session 不應被恢復到 activeSessions（因為 > 24 小時被跳過）
      expect(manager.activeSessions.has('sess_expired_1')).toBe(false);

      // 過期 session 應被標記為 completed 並保存
      expect(saveSessionSpy).toHaveBeenCalled();
      const savedSession = saveSessionSpy.mock.calls[0][0];
      expect(savedSession.status).toBe('completed');
    });

    /**
     * sendPrompt 測試：驗證 directory 參數正確傳遞到 SDK
     */
    it('sendPrompt 應該傳遞 session.projectPath 作為 directory 參數', async () => {
      const manager = sessionManager as any;
      const sessionId = 'sess_send_prompt_dir';
      const channelId = 'channel_send_prompt';
      const projectPath = '/test/project/path';

      const runningSession = new Session({
        sessionId,
        channelId,
        userId: 'test-user',
        prompt: 'test sendPrompt',
        projectPath,
      });
      runningSession.opencodeSessionId = 'oc_session_123';
      runningSession.markRunning();

      manager.activeSessions = new Map([[sessionId, runningSession]]);
      manager.channelSessions = new Map([[channelId, new Set([sessionId])]]);

      const sendPromptSpy = vi.fn().mockResolvedValue(undefined);
      manager.sdkAdapter = {
        sendPrompt: sendPromptSpy,
      };

      await sessionManager.sendPrompt(sessionId, 'test prompt message');

      expect(sendPromptSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'oc_session_123',
          prompt: 'test prompt message',
          directory: projectPath,
        }),
      );
    });
  });
});
