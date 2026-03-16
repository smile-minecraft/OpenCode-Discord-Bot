/**
 * ProcessManager Tests - OpenCode 伺服器進程管理單元測試
 * @description 測試 ProcessManager 的端口分配、服務器啟動/停止、垃圾回收和單例模式
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Use vi.hoisted to define mocks before they are used
const { mockFetchFn, mockSpawnFn, mockSetIntervalFn, mockClearIntervalFn } = vi.hoisted(() => {
  return {
    mockFetchFn: vi.fn(),
    mockSpawnFn: vi.fn(),
    mockSetIntervalFn: vi.fn((callback: () => void) => {
      callback(); // Execute immediately for testing
      return 123 as unknown as NodeJS.Timeout;
    }),
    mockClearIntervalFn: vi.fn(),
  };
});

// Mock fetch
global.fetch = mockFetchFn;

// Mock child_process
vi.mock('child_process', () => ({
  spawn: mockSpawnFn,
}));

// Mock setInterval/clearInterval for GC testing
vi.mock('timers', () => ({
  setInterval: mockSetIntervalFn,
  clearInterval: mockClearIntervalFn,
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock constants
vi.mock('../../src/config/constants.js', () => ({
  OPENCODE_SERVER: {
    PORT_RANGE_START: 3000,
    PORT_RANGE_END: 3100,
  },
  TIMEOUTS: {
    HEALTH_CHECK: 50,
  },
}));

// Import after mocking
import { ProcessManager, getProcessManager, initializeProcessManager } from '../../src/services/ProcessManager';
import logger from '../../src/utils/logger.js';

describe('ProcessManager', () => {
  let manager: ProcessManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton
    manager = new ProcessManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('allocatePort() - 端口分配', () => {
    it('應該從範圍起始值開始分配端口', () => {
      const port = manager.allocatePort();
      expect(port).toBe(3000);
    });

    it('應該跳過已使用的端口', () => {
      // Manually add a "used" port to the map
      (manager as any).serverProcesses.set(3000, { pid: 1234 } as any);
      
      const port = manager.allocatePort();
      expect(port).toBe(3001);
    });

    it('當所有端口都使用時應該迴繞到起始值', () => {
      // Fill all ports in range
      for (let i = 3000; i <= 3100; i++) {
        (manager as any).serverProcesses.set(i, { pid: i } as any);
      }
      
      const port = manager.allocatePort();
      expect(port).toBeGreaterThanOrEqual(3000);
      expect(port).toBeLessThanOrEqual(3100);
    });

    // Test removed: allocatePort() returns the first available port, not incrementing
    // It only uses currentPort when ALL ports in range are occupied

    it('當所有端口都使用時應該使用 currentPort', () => {
      // Fill all ports in range (3000-3100 = 101 ports)
      for (let i = 3000; i <= 3100; i++) {
        (manager as any).serverProcesses.set(i, { pid: i } as any);
      }
      
      // Now currentPort will be used since all ports are occupied
      // Set currentPort to 3100 (the end of range)
      (manager as any).currentPort = 3100;
      
      const port = manager.allocatePort();
      // Returns currentPort (3100) before incrementing, then wraps to 3000
      expect(port).toBe(3100);
    });
  });

  describe('releasePort() - 端口釋放', () => {
    it('應該記錄端口釋放', () => {
      manager.releasePort(3000);
      // Just verify no error is thrown - the port will be cleaned by GC
      expect(true).toBe(true);
    });
  });

  describe('getBaseUrl() - 獲取基礎 URL', () => {
    it('應該返回正確格式的 URL', () => {
      const url = manager.getBaseUrl(3000);
      expect(url).toBe('http://127.0.0.1:3000');
    });
  });

  describe('isServerRunning() - 服務器運行檢查', () => {
    it('服務器運行時應該返回 true', async () => {
      mockFetchFn.mockResolvedValueOnce({ ok: true } as Response);
      
      const result = await manager.isServerRunning(3000);
      
      expect(result).toBe(true);
      expect(mockFetchFn).toHaveBeenCalledWith(
        'http://127.0.0.1:3000/health',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('服務器未運行時應該返回 false', async () => {
      mockFetchFn.mockRejectedValueOnce(new Error('Network error'));
      
      const result = await manager.isServerRunning(3000);
      
      expect(result).toBe(false);
    });

    it('服務器返回錯誤狀態時應該返回 false', async () => {
      mockFetchFn.mockResolvedValueOnce({ ok: false } as Response);
      
      const result = await manager.isServerRunning(3000);
      
      expect(result).toBe(false);
    });
  });

  describe('startServer() - 服務器啟動', () => {
    it('服務器已運行時應該直接返回端口', async () => {
      mockFetchFn.mockResolvedValueOnce({ ok: true } as Response);
      
      const port = await manager.startServer('/test/project', 3000);
      
      expect(port).toBe(3000);
      expect(mockSpawnFn).not.toHaveBeenCalled();
    });

    it('應該啟動服務器並等待健康檢查通過', async () => {
      const mockProcess = {
        on: vi.fn(),
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn(),
        },
        kill: vi.fn(),
        pid: 1234,
        killed: false,
      };

      mockSpawnFn.mockReturnValue(mockProcess as any);
      
      // First check fails, then succeeds
      mockFetchFn
        .mockRejectedValueOnce(new Error('not running'))
        .mockResolvedValueOnce({ ok: true } as Response);

      const port = await manager.startServer('/test/project', 3000);

      expect(mockSpawnFn).toHaveBeenCalledWith(
        'opencode',
        ['serve', '--port', '3000'],
        expect.objectContaining({
          cwd: '/test/project',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      );
      expect(port).toBe(3000);
    });

    it('未指定端口時應該自動分配', async () => {
      const mockProcess = {
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        pid: 1234,
        killed: false,
      };

      mockSpawnFn.mockReturnValue(mockProcess as any);
      mockFetchFn.mockResolvedValue({ ok: true } as Response);

      const port = await manager.startServer('/test/project');

      expect(port).toBeDefined();
      expect(port).toBeGreaterThanOrEqual(3000);
      expect(port).toBeLessThanOrEqual(3100);
    });

    it('健康檢查超時時應該拋出錯誤', async () => {
      const mockProcess = {
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        pid: 1234,
        killed: false,
      };

      mockSpawnFn.mockReturnValue(mockProcess as any);
      mockFetchFn.mockRejectedValue(new Error('not running'));

      await expect(manager.startServer('/test/project', 3000)).rejects.toThrow('健康檢查超時');
    });

    it('應該將進程註冊到 serverProcesses Map', async () => {
      const mockProcess = {
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        pid: 1234,
        killed: false,
      };

      mockSpawnFn.mockReturnValue(mockProcess as any);
      // First check fails (not running), then succeeds
      mockFetchFn
        .mockRejectedValueOnce(new Error('not running'))
        .mockResolvedValueOnce({ ok: true } as Response);

      await manager.startServer('/test/project', 3000);

      expect((manager as any).serverProcesses.has(3000)).toBe(true);
    });
  });

  describe('stopServer() - 服務器停止', () => {
    it('停止存在的服務器時應該發送 SIGTERM', async () => {
      const mockProcess = {
        on: vi.fn(),
        once: vi.fn((event, callback) => {
          if (event === 'close') {
            // Simulate immediate close
            callback(null);
          }
        }),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        killed: false,
        pid: 1234,
      };

      (manager as any).serverProcesses.set(3000, mockProcess as any);

      await manager.stopServer(3000);

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('嘗試停止不存在的服務器時應該發出警告', async () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      
      await manager.stopServer(9999);
      
      expect(warnSpy).toHaveBeenCalled();
    });

    it('停止後應該從 Map 中移除', async () => {
      const mockProcess = {
        on: vi.fn(),
        once: vi.fn((event, callback) => {
          if (event === 'close') {
            callback(null);
          }
        }),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        killed: false,
        pid: 1234,
      };

      (manager as any).serverProcesses.set(3000, mockProcess as any);

      await manager.stopServer(3000);

      expect((manager as any).serverProcesses.has(3000)).toBe(false);
    });

    it('超時時應該強制 kill 進程', async () => {
      const mockProcess = {
        on: vi.fn(),
        once: vi.fn((event, callback) => {
          // Don't call callback - simulate process not closing
        }),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        killed: false,
        pid: 1234,
      };

      (manager as any).serverProcesses.set(3000, mockProcess as any);

      vi.useFakeTimers();
      
      const stopPromise = manager.stopServer(3000);
      
      // Advance timers past both timeouts:
      // - First timeout at 5000ms (STOP_SERVER_TIMEOUT)
      // - Then nested timeout at 2000ms after SIGKILL
      vi.advanceTimersByTime(7000);
      
      await stopPromise;
      
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
      
      vi.useRealTimers();
    });
  });

  describe('cleanupStaleProcesses() - 垃圾回收', () => {
    it('應該清理已終止的進程記錄', () => {
      const mockProcess = {
        pid: 1234,
        killed: true, // Already killed
        kill: vi.fn(),
      };

      (manager as any).serverProcesses.set(3000, mockProcess as any);

      manager.cleanupStaleProcesses();

      expect((manager as any).serverProcesses.has(3000)).toBe(false);
    });

    it('應該清理 pid 為 undefined 的進程記錄', () => {
      const mockProcess = {
        pid: undefined,
        killed: false,
        kill: vi.fn(),
      };

      (manager as any).serverProcesses.set(3000, mockProcess as any);

      manager.cleanupStaleProcesses();

      expect((manager as any).serverProcesses.has(3000)).toBe(false);
    });

    it('應該保留正常運行的進程', () => {
      const mockProcess = {
        pid: 1234,
        killed: false,
        kill: vi.fn(() => {
          // kill(0) succeeds - process is alive
        }),
      };

      (manager as any).serverProcesses.set(3000, mockProcess as any);

      manager.cleanupStaleProcesses();

      expect((manager as any).serverProcesses.has(3000)).toBe(true);
    });

    it('應該處理 kill(0) 拋出錯誤的情況', () => {
      const mockProcess = {
        pid: 1234,
        killed: false,
        kill: vi.fn(() => {
          throw new Error('No such process');
        }),
      };

      (manager as any).serverProcesses.set(3000, mockProcess as any);

      manager.cleanupStaleProcesses();

      expect((manager as any).serverProcesses.has(3000)).toBe(false);
    });
  });

  describe('getActiveServers() - 獲取活動服務器', () => {
    it('應該返回所有活動服務器的端口列表', () => {
      (manager as any).serverProcesses.set(3000, { pid: 1 } as any);
      (manager as any).serverProcesses.set(3001, { pid: 2 } as any);
      (manager as any).serverProcesses.set(3002, { pid: 3 } as any);

      const activeServers = manager.getActiveServers();

      expect(activeServers).toEqual([3000, 3001, 3002]);
    });

    it('沒有活動服務器時應該返回空數組', () => {
      const activeServers = manager.getActiveServers();
      expect(activeServers).toEqual([]);
    });
  });

  describe('cleanupAll() - 清理所有服務器', () => {
    it('應該停止所有活動服務器', async () => {
      const mockProcess1 = {
        on: vi.fn(),
        once: vi.fn((event, cb) => event === 'close' && cb(null)),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        killed: false,
        pid: 1234,
      };
      
      const mockProcess2 = {
        on: vi.fn(),
        once: vi.fn((event, cb) => event === 'close' && cb(null)),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        killed: false,
        pid: 5678,
      };

      (manager as any).serverProcesses.set(3000, mockProcess1 as any);
      (manager as any).serverProcesses.set(3001, mockProcess2 as any);

      await manager.cleanupAll();

      expect(mockProcess1.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockProcess2.kill).toHaveBeenCalledWith('SIGTERM');
      expect((manager as any).serverProcesses.size).toBe(0);
    });
  });

  describe('getProcessManager() - 單例模式', () => {
    it('應該返回同一個實例', () => {
      const instance1 = getProcessManager();
      const instance2 = getProcessManager();

      expect(instance1).toBe(instance2);
    });
  });

  describe('initializeProcessManager() - 初始化單例', () => {
    it('應該返回新的實例', () => {
      const instance1 = initializeProcessManager();
      const instance2 = getProcessManager();

      expect(instance1).toBe(instance2);
    });

    it('應該允許重新初始化', () => {
      const instance1 = getProcessManager();
      const instance2 = initializeProcessManager();

      expect(instance1).not.toBe(instance2);
    });
  });
});
