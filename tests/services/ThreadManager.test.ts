/**
 * ThreadManager 單元測試
 * @description 測試 Thread 管理器的持久化、清理和映射功能
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ThreadManager, resetThreadManager } from '../../src/services/ThreadManager.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock Discord.js
vi.mock('discord.js', () => {
  // Create a mock ThreadChannel class that will pass instanceof checks
  // Use any to bypass TypeScript's private constructor check
  const MockThreadChannel = class MockThreadChannel {
    id: string;
    guildId: string = 'mock-guild';
    parentId: string = 'mock-channel';
    archived: boolean = false;
    constructor(id: string) {
      this.id = id;
    }
  } as any;
  
  return {
    Client: vi.fn(),
    ThreadChannel: MockThreadChannel,
    TextChannel: vi.fn(),
    NewsChannel: vi.fn(),
    Message: vi.fn(),
  };
});

describe('ThreadManager', () => {
  let threadManager: ThreadManager;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSqliteDb: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockDiscordClient: any;

  beforeEach(() => {
    resetThreadManager();
    threadManager = new ThreadManager();

    // 創建模擬 SQLite 數據庫
    const mockPrepare = vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
    }));

    mockSqliteDb = {
      isReady: vi.fn().mockReturnValue(true),
      prepare: mockPrepare,
      transaction: vi.fn((fn: () => void) => fn()),
    };

    // 創建模擬 Discord Client
    mockDiscordClient = {
      channels: {
        fetch: vi.fn(),
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('應該在第一次嘗試成功時設置 isInitialized 為 true', async () => {
      mockSqliteDb.isReady.mockReturnValue(true);

      await threadManager.initialize(mockSqliteDb);

      expect(threadManager.isReady()).toBe(true);
    });

    it('應該在數據庫未就緒時拋出錯誤', async () => {
      mockSqliteDb.isReady.mockReturnValue(false);

      await expect(threadManager.initialize(mockSqliteDb)).rejects.toThrow();
    });

    it('應該在 restoreMappings 失敗時重試並最終拋出錯誤', async () => {
      mockSqliteDb.isReady.mockReturnValue(true);
      mockSqliteDb.prepare = vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn().mockImplementation(() => {
          throw new Error('DB Error');
        }),
      }));

      await expect(threadManager.initialize(mockSqliteDb)).rejects.toThrow();
    });

    it('應該在成功後設置 isInitialized', async () => {
      mockSqliteDb.isReady.mockReturnValue(true);

      await threadManager.initialize(mockSqliteDb);

      expect(threadManager.isReady()).toBe(true);
    });

    it('應該在初始化後獲取正確的統計', async () => {
      mockSqliteDb.isReady.mockReturnValue(true);

      await threadManager.initialize(mockSqliteDb);
      const stats = threadManager.getStats();

      expect(stats).toHaveProperty('totalThreads');
      expect(stats).toHaveProperty('activeThreads');
      expect(stats).toHaveProperty('pendingCleanup');
    });
  });

  describe('restoreMappings', () => {
    it('應該從數據庫恢復映射', async () => {
      const { ThreadChannel } = await import('discord.js');
      
      const mockRows = [
        {
          thread_id: 'thread-123',
          session_id: 'session-456',
          opencode_session_id: 'opencode-789',
          channel_id: 'channel-abc',
          guild_id: 'guild-def',
          created_at: Date.now(),
          archived_at: null,
        },
      ];

      mockSqliteDb.isReady.mockReturnValue(true);
      mockSqliteDb.prepare = vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn().mockReturnValue(mockRows),
      }));

      // 設置 Discord Client 並模擬 thread 存在
      threadManager.setDiscordClient(mockDiscordClient);
      // Create a mock ThreadChannel instance using Object.setPrototypeOf
      // This ensures instanceof checks pass in the ThreadManager
      const { ThreadChannel: MockThreadClass } = await import('discord.js');
      const mockThread = Object.setPrototypeOf(
        { id: 'thread-123', guildId: 'guild-def', parentId: 'channel-abc', archived: false },
        MockThreadClass.prototype
      );
      mockDiscordClient.channels.fetch.mockResolvedValue(mockThread);

      await threadManager.initialize(mockSqliteDb);

      // 驗證映射已恢復
      expect(threadManager.isSessionThread('thread-123')).toBe(true);
    });

    it('應該跳過不存在的 thread 並從數據庫刪除', async () => {
      const mockRows = [
        {
          thread_id: 'deleted-thread',
          session_id: 'session-xyz',
          opencode_session_id: null,
          channel_id: 'channel-abc',
          guild_id: 'guild-def',
          created_at: Date.now(),
          archived_at: null,
        },
      ];

      mockSqliteDb.isReady.mockReturnValue(true);
      mockSqliteDb.prepare = vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn().mockReturnValue(mockRows),
      }));

      threadManager.setDiscordClient(mockDiscordClient);
      // 模擬 thread 不存在 (return null)
      mockDiscordClient.channels.fetch.mockResolvedValue(null);

      await threadManager.initialize(mockSqliteDb);

      // 驗證跳過了不存在的 thread
      expect(threadManager.isSessionThread('deleted-thread')).toBe(false);
    });

    it('應該在沒有 Discord Client 時跳過驗證', async () => {
      const mockRows = [
        {
          thread_id: 'thread-no-client',
          session_id: 'session-no-client',
          opencode_session_id: null,
          channel_id: 'channel-abc',
          guild_id: 'guild-def',
          created_at: Date.now(),
          archived_at: null,
        },
      ];

      mockSqliteDb.isReady.mockReturnValue(true);
      mockSqliteDb.prepare = vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn().mockReturnValue(mockRows),
      }));

      // 不設置 Discord Client
      await threadManager.initialize(mockSqliteDb);

      // 驗證映射已恢復（即使沒有驗證 thread）
      expect(threadManager.isSessionThread('thread-no-client')).toBe(true);
    });
  });

  describe('createThread', () => {
    it('應該創建 thread 並返回 threadId', async () => {
      threadManager.setDiscordClient(mockDiscordClient);

      const mockChannel = {
        threads: {
          create: vi.fn().mockResolvedValue({
            id: 'new-thread-id',
          }),
        },
        id: 'channel-123',
      };

      const threadId = await threadManager.createThread({
        channel: mockChannel as any,
        sessionId: 'session-new',
        guildId: 'guild-new',
        opencodeSessionId: 'opencode-new',
      });

      expect(threadId).toBe('new-thread-id');
    });

    it('應該創建後更新雙向映射', async () => {
      // Initialize the ThreadManager first to set isInitialized = true
      mockSqliteDb.isReady.mockReturnValue(true);
      mockSqliteDb.prepare = vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn().mockReturnValue([]),
      }));
      
      await threadManager.initialize(mockSqliteDb);
      threadManager.setDiscordClient(mockDiscordClient);

      const mockChannel = {
        threads: {
          create: vi.fn().mockResolvedValue({
            id: 'new-thread-id',
          }),
        },
        id: 'channel-123',
      };

      const threadId = await threadManager.createThread({
        channel: mockChannel as any,
        sessionId: 'session-bidir',
        guildId: 'guild-bidir',
      });

      expect(threadManager.getSessionIdByThreadId(threadId)).toBe('session-bidir');
      expect(threadManager.getThreadIdBySessionId('session-bidir')).toBe(threadId);
    });

    it('應該在創建失敗時拋出錯誤', async () => {
      threadManager.setDiscordClient(mockDiscordClient);

      const mockChannel = {
        threads: {
          create: vi.fn().mockRejectedValue(new Error('Discord API Error')),
        },
        id: 'channel-123',
      };

      await expect(
        threadManager.createThread({
          channel: mockChannel as any,
          sessionId: 'session-fail',
          guildId: 'guild-fail',
        })
      ).rejects.toThrow('Discord API Error');
    });

    it('應該使用預設名稱創建 thread', async () => {
      threadManager.setDiscordClient(mockDiscordClient);

      const mockChannel = {
        threads: {
          create: vi.fn().mockResolvedValue({
            id: 'thread-with-name',
          }),
        },
        id: 'channel-123',
      };

      const threadId = await threadManager.createThread({
        channel: mockChannel as any,
        sessionId: 'session-with-name',
        guildId: 'guild-123',
        name: 'custom-thread-name',
      });

      expect(mockChannel.threads.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'custom-thread-name',
        })
      );
    });
  });

  describe('cleanupSession', () => {
    beforeEach(async () => {
      threadManager.setDiscordClient(mockDiscordClient);

      // 創建一個 thread
      const mockChannel = {
        threads: {
          create: vi.fn().mockResolvedValue({ id: 'cleanup-thread' }),
        },
        id: 'channel-123',
      };

      await threadManager.createThread({
        channel: mockChannel as any,
        sessionId: 'cleanup-session',
        guildId: 'guild-cleanup',
      });
    });

    it('應該成功歸檔 thread 並清理內存', async () => {
      mockDiscordClient.channels.fetch.mockResolvedValue({
        id: 'cleanup-thread',
        setAutoArchiveDuration: vi.fn().mockResolvedValue(undefined),
        setArchived: vi.fn().mockResolvedValue(undefined),
      });

      await threadManager.cleanupSession('cleanup-session');

      expect(threadManager.isSessionThread('cleanup-thread')).toBe(false);
      expect(threadManager.getThreadIdBySessionId('cleanup-session')).toBeUndefined();
    });

    it('應該在 Discord API 錯誤時標記為手動清理', async () => {
      mockDiscordClient.channels.fetch.mockRejectedValue(new Error('Discord Error'));

      await expect(threadManager.cleanupSession('cleanup-session')).rejects.toThrow();

      // 驗證已標記為手動清理
      const pending = threadManager.getPendingManualCleanup();
      expect(pending.length).toBeGreaterThan(0);
    });

    it('應該在 session 不存在時不拋出錯誤', async () => {
      await expect(threadManager.cleanupSession('nonexistent-session')).resolves.not.toThrow();
    });

    it('應該清除所有相關的內存映射', async () => {
      mockDiscordClient.channels.fetch.mockResolvedValue({
        id: 'cleanup-thread',
        setAutoArchiveDuration: vi.fn().mockResolvedValue(undefined),
        setArchived: vi.fn().mockResolvedValue(undefined),
      });

      await threadManager.cleanupSession('cleanup-session');

      expect(threadManager.getThreadInfo('cleanup-thread')).toBeUndefined();
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      threadManager.setDiscordClient(mockDiscordClient);

      await threadManager.initialize(mockSqliteDb);
    });

    it('應該返回準確的線程計數', async () => {
      // 創建多個 threads
      const mockChannel1 = {
        threads: { create: vi.fn().mockResolvedValue({ id: 'thread-1' }) },
        id: 'channel-1',
      };
      const mockChannel2 = {
        threads: { create: vi.fn().mockResolvedValue({ id: 'thread-2' }) },
        id: 'channel-2',
      };

      await threadManager.createThread({
        channel: mockChannel1 as any,
        sessionId: 'session-1',
        guildId: 'guild-1',
      });
      await threadManager.createThread({
        channel: mockChannel2 as any,
        sessionId: 'session-2',
        guildId: 'guild-2',
      });

      const stats = threadManager.getStats();
      expect(stats.totalThreads).toBe(2);
      expect(stats.activeThreads).toBe(2);
    });

    it('應該在有待清理線程時正確計數', async () => {
      // 標記為手動清理
      threadManager.markForManualCleanup('thread-error', 'Test error');

      const stats = threadManager.getStats();
      expect(stats.pendingCleanup).toBe(1);
    });

    it('應該返回正確的結構', () => {
      const stats = threadManager.getStats();

      expect(typeof stats.totalThreads).toBe('number');
      expect(typeof stats.activeThreads).toBe('number');
      expect(typeof stats.pendingCleanup).toBe('number');
    });
  });

  describe('isSessionThread', () => {
    beforeEach(async () => {
      threadManager.setDiscordClient(mockDiscordClient);

      await threadManager.initialize(mockSqliteDb);
    });

    it('應該對存在的 thread 返回 true', async () => {
      const mockChannel = {
        threads: { create: vi.fn().mockResolvedValue({ id: 'valid-thread' }) },
        id: 'channel-valid',
      };

      await threadManager.createThread({
        channel: mockChannel as any,
        sessionId: 'session-valid',
        guildId: 'guild-valid',
      });

      expect(threadManager.isSessionThread('valid-thread')).toBe(true);
    });

    it('應該對不存在的 thread 返回 false', () => {
      expect(threadManager.isSessionThread('nonexistent-thread')).toBe(false);
    });

    it('應該在未初始化時返回 false', () => {
      const uninitializedManager = new ThreadManager();
      expect(uninitializedManager.isSessionThread('any-thread')).toBe(false);
    });
  });

  describe('markForManualCleanup', () => {
    it('應該正確標記 thread 為需要手動清理', () => {
      threadManager.markForManualCleanup('thread-123', 'Test error message');

      const pending = threadManager.getPendingManualCleanup();
      expect(pending).toContainEqual({
        threadId: 'thread-123',
        error: 'Test error message',
      });
    });

    it('應該允許清除標記', () => {
      threadManager.markForManualCleanup('thread-456', 'Error');
      threadManager.clearManualCleanup('thread-456');

      const pending = threadManager.getPendingManualCleanup();
      expect(pending).not.toContainEqual(expect.objectContaining({ threadId: 'thread-456' }));
    });
  });

  describe('clear', () => {
    beforeEach(async () => {
      threadManager.setDiscordClient(mockDiscordClient);

      await threadManager.initialize(mockSqliteDb);
    });

    it('應該清除所有內存映射', async () => {
      const mockChannel = {
        threads: { create: vi.fn().mockResolvedValue({ id: 'clear-thread' }) },
        id: 'channel-clear',
      };

      await threadManager.createThread({
        channel: mockChannel as any,
        sessionId: 'session-clear',
        guildId: 'guild-clear',
      });

      threadManager.clear();

      expect(threadManager.getStats().totalThreads).toBe(0);
      expect(threadManager.isSessionThread('clear-thread')).toBe(false);
    });

    it('應該清除待清理列表', () => {
      threadManager.markForManualCleanup('thread-error', 'Error');
      threadManager.clear();

      expect(threadManager.getStats().pendingCleanup).toBe(0);
    });
  });

  describe('setDiscordClient', () => {
    it('應該設置 Discord Client', () => {
      expect(() => threadManager.setDiscordClient(mockDiscordClient)).not.toThrow();
    });
  });

  describe('getThreadInfo', () => {
    beforeEach(async () => {
      threadManager.setDiscordClient(mockDiscordClient);

      await threadManager.initialize(mockSqliteDb);
    });

    it('應該返回已創建線程的信息', async () => {
      const mockChannel = {
        threads: { create: vi.fn().mockResolvedValue({ id: 'info-thread' }) },
        id: 'channel-info',
      };

      await threadManager.createThread({
        channel: mockChannel as any,
        sessionId: 'session-info',
        guildId: 'guild-info',
        opencodeSessionId: 'opencode-info',
      });

      const info = threadManager.getThreadInfo('info-thread');
      expect(info).toBeDefined();
      expect(info?.sessionId).toBe('session-info');
      expect(info?.opencodeSessionId).toBe('opencode-info');
    });

    it('對不存在的線程應該返回 undefined', () => {
      expect(threadManager.getThreadInfo('nonexistent')).toBeUndefined();
    });
  });

  describe('getPendingManualCleanup', () => {
    it('應該返回空數組當沒有待清理項目', () => {
      const pending = threadManager.getPendingManualCleanup();
      expect(pending).toEqual([]);
    });
  });

  describe('getActiveThreads', () => {
    beforeEach(async () => {
      threadManager.setDiscordClient(mockDiscordClient);

      await threadManager.initialize(mockSqliteDb);
    });

    it('應該返回活躍線程列表', async () => {
      const mockChannel = {
        threads: { create: vi.fn().mockResolvedValue({ id: 'active-thread' }) },
        id: 'channel-active',
      };

      await threadManager.createThread({
        channel: mockChannel as any,
        sessionId: 'session-active',
        guildId: 'guild-active',
      });

      const activeThreads = threadManager.getActiveThreads();
      expect(activeThreads.length).toBeGreaterThan(0);
    });
  });

  describe('getAllThreads', () => {
    beforeEach(async () => {
      threadManager.setDiscordClient(mockDiscordClient);

      await threadManager.initialize(mockSqliteDb);
    });

    it('應該返回所有線程列表', async () => {
      const mockChannel = {
        threads: { create: vi.fn().mockResolvedValue({ id: 'all-thread' }) },
        id: 'channel-all',
      };

      await threadManager.createThread({
        channel: mockChannel as any,
        sessionId: 'session-all',
        guildId: 'guild-all',
      });

      const allThreads = threadManager.getAllThreads();
      expect(allThreads.length).toBeGreaterThan(0);
    });
  });
});
