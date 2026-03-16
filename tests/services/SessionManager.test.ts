/**
 * SessionManager 測試 - Race Condition 修復驗證
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SessionManager } from '../../src/services/SessionManager.js';

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

  describe('allocatePort - Race Condition 修復', () => {
    /**
     * 測試場景：多個並發請求同時請求埠號分配
     * 預期結果：只有一個請求會實際執行分配邏輯，其他請求等待並獲得相同結果
     */
    it('應該防止 Race Condition - 並發請求獲得不同埠號', async () => {
      // 追蹤實際調用 isServerRunning 的次數
      let callCount = 0;
      const mockIsServerRunning = vi.fn().mockImplementation(() => {
        callCount++;
        // 模擬檢查時間 - 每次返回不同的結果來模擬真實場景
        return Promise.resolve(callCount % 10 !== 0);
      });

      // 重新設置 mock
      const { getOpenCodeClient } = await import('../../src/services/deprecated/OpenCodeClient.js');
      (getOpenCodeClient as ReturnType<typeof vi.fn>).mockReturnValue({
        startServer: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn().mockResolvedValue({ id: 'test-session-id' }),
        isServerRunning: mockIsServerRunning,
        stopServer: vi.fn().mockResolvedValue(undefined),
      });

      sessionManager = new SessionManager();

      const channelId1 = 'channel-1';
      const channelId2 = 'channel-2';

      // 同時發起兩個請求
      const [port1, port2] = await Promise.all([
        sessionManager.allocatePort(channelId1),
        sessionManager.allocatePort(channelId2),
      ]);

      // 兩個請求應該獲得不同的埠號
      expect(port1).not.toBe(port2);
      expect(port1).toBeGreaterThanOrEqual(3000);
      expect(port1).toBeLessThanOrEqual(3100);
      expect(port2).toBeGreaterThanOrEqual(3000);
      expect(port2).toBeLessThanOrEqual(3100);
    });

    /**
     * 測試場景：同一頻道的並發請求
     * 預期結果：所有請求都應該獲得相同的埠號
     */
    it('同一頻道的並發請求應該獲得相同埠號', async () => {
      const mockIsServerRunning = vi.fn().mockResolvedValue(false);

      const { getOpenCodeClient } = await import('../../src/services/deprecated/OpenCodeClient.js');
      (getOpenCodeClient as ReturnType<typeof vi.fn>).mockReturnValue({
        startServer: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn().mockResolvedValue({ id: 'test-session-id' }),
        isServerRunning: mockIsServerRunning,
        stopServer: vi.fn().mockResolvedValue(undefined),
      });

      sessionManager = new SessionManager();

      const channelId = 'channel-1';

      // 同時發起多個請求
      const ports = await Promise.all([
        sessionManager.allocatePort(channelId),
        sessionManager.allocatePort(channelId),
        sessionManager.allocatePort(channelId),
      ]);

      // 所有請求應該獲得相同的埠號
      expect(ports[0]).toBe(ports[1]);
      expect(ports[1]).toBe(ports[2]);
    });

    /**
     * 測試場景：連續調用 allocatePort
     * 預期結果：同一頻道獲得相同埠號，不同頻道獲得不同埠號
     */
    it('連續調用應該正確處理', async () => {
      const mockIsServerRunning = vi.fn().mockResolvedValue(false);

      const { getOpenCodeClient } = await import('../../src/services/deprecated/OpenCodeClient.js');
      (getOpenCodeClient as ReturnType<typeof vi.fn>).mockReturnValue({
        startServer: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn().mockResolvedValue({ id: 'test-session-id' }),
        isServerRunning: mockIsServerRunning,
        stopServer: vi.fn().mockResolvedValue(undefined),
      });

      sessionManager = new SessionManager();

      const channelId1 = 'channel-1';
      const channelId2 = 'channel-2';

      // 第一個頻道第一次調用
      const port1a = await sessionManager.allocatePort(channelId1);
      // 第一個頻道第二次調用（應該返回相同埠號）
      const port1b = await sessionManager.allocatePort(channelId1);
      // 第二個頻道第一次調用（應該獲得不同埠號）
      const port2a = await sessionManager.allocatePort(channelId2);

      expect(port1a).toBe(port1b);
      expect(port1a).not.toBe(port2a);
    });

    /**
     * 測試場景：大量並發請求測試
     * 預期結果：所有請求都成功獲得唯一埠號
     */
    it('大量並發請求應該正確分配唯一埠號', async () => {
      let callCount = 0;

      const mockIsServerRunning = vi.fn().mockImplementation(() => {
        callCount++;
        // 模擬：返回 false 表示埠號可用
        // 每次檢查都返回 false，讓分配邏輯決定
        return Promise.resolve(false);
      });

      const { getOpenCodeClient } = await import('../../src/services/deprecated/OpenCodeClient.js');
      (getOpenCodeClient as ReturnType<typeof vi.fn>).mockReturnValue({
        startServer: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn().mockResolvedValue({ id: 'test-session-id' }),
        isServerRunning: mockIsServerRunning,
        stopServer: vi.fn().mockResolvedValue(undefined),
      });

      sessionManager = new SessionManager();

      const channelIds = Array.from({ length: 10 }, (_, i) => `channel-${i}`);

      // 同時發起 10 個請求
      const ports = await Promise.all(
        channelIds.map(id => sessionManager.allocatePort(id))
      );

      // 所有埠號應該是唯一的
      const uniquePorts = new Set(ports);
      expect(uniquePorts.size).toBe(ports.length);

      // 驗證所有埠號都在有效範圍內
      ports.forEach(port => {
        expect(port).toBeGreaterThanOrEqual(3000);
        expect(port).toBeLessThanOrEqual(3100);
      });
    });

    /**
     * 測試場景：所有埠號都被佔用
     * 預期結果：應該拋出錯誤
     */
    it('所有埠號被佔用時應該拋出錯誤', async () => {
      // 模擬所有埠號都已被佔用
      const mockIsServerRunning = vi.fn().mockResolvedValue(true);

      const { getOpenCodeClient } = await import('../../src/services/deprecated/OpenCodeClient.js');
      (getOpenCodeClient as ReturnType<typeof vi.fn>).mockReturnValue({
        startServer: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn().mockResolvedValue({ id: 'test-session-id' }),
        isServerRunning: mockIsServerRunning,
        stopServer: vi.fn().mockResolvedValue(undefined),
      });

      sessionManager = new SessionManager();

      // 嘗試分配埠號
      await expect(sessionManager.allocatePort('channel-1')).rejects.toThrow('沒有可用的埠號');
    });
  });
});
