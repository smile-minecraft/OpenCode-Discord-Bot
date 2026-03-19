/**
 * ProcessManager Tests - OpenCode 伺服器進程管理單元測試
 * @description 測試 ProcessManager 的服務器啟動/停止、垃圾回收和單例模式
 * 
 * P2-13: 簡化架構：使用固定端口 3000，單一 serverProcess 變數
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

// Mock constants - simplified to fixed port 3000
vi.mock('../../src/config/constants.js', () => ({
  OPENCODE_SERVER: {
    PORT: 3000,
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

  describe('getBaseUrl() - 獲取基礎 URL', () => {
    it('應該返回正確格式的 URL (固定端口 3000)', () => {
      const url = manager.getBaseUrl(3000);
      expect(url).toBe('http://127.0.0.1:3000');
    });
  });

  describe('isServerRunning() - 服務器運行檢查', () => {
    it('服務器運行時應該返回 true', async () => {
      mockFetchFn.mockResolvedValueOnce({ ok: true } as Response);
      
      const result = await manager.isServerRunning(4096);
      
      expect(result).toBe(true);
      expect(mockFetchFn).toHaveBeenCalledWith(
        'http://127.0.0.1:4096/global/health',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('服務器未運行時應該返回 false', async () => {
      mockFetchFn.mockRejectedValueOnce(new Error('Network error'));
      
      const result = await manager.isServerRunning(4096);
      
      expect(result).toBe(false);
    });

    it('服務器返回錯誤狀態時應該返回 false', async () => {
      mockFetchFn.mockResolvedValueOnce({ ok: false } as Response);
      
      const result = await manager.isServerRunning(4096);
      
      expect(result).toBe(false);
    });
  });

  describe('startServer() - 服務器啟動', () => {
    it('服務器已運行時應該直接返回端口', async () => {
      mockFetchFn.mockResolvedValueOnce({ ok: true } as Response);
      
      const port = await manager.startServer('/test/project', 4096);
      
      expect(port).toBe(4096);
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

      const port = await manager.startServer('/test/project', 4096);

      expect(mockSpawnFn).toHaveBeenCalledWith(
        'opencode',
        ['serve', '--port', '4096'],
        expect.objectContaining({
          cwd: '/test/project',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      );
      expect(port).toBe(4096);
    });

    it('默認端口 4096 應該直接使用', async () => {
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

      // 不指定端口，應該使用默認端口 4096
      const port = await manager.startServer('/test/project');

      expect(port).toBe(4096);
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

    // P2-13: 簡化設計 - 測試 serverProcess 和 currentPort
    it('應該將進程註冊到 serverProcess', async () => {
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

      expect((manager as any).serverProcess).toBe(mockProcess);
      expect((manager as any).currentPort).toBe(3000);
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

      // P2-13: 簡化設計 - 使用 serverProcess 和 currentPort
      (manager as any).serverProcess = mockProcess;
      (manager as any).currentPort = 3000;

      await manager.stopServer(3000);

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('嘗試停止不存在的服務器時應該發出警告', async () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      
      await manager.stopServer(9999);
      
      expect(warnSpy).toHaveBeenCalled();
    });

    // P2-13: 簡化設計 - 測試 stopServer 後清理
    it('停止後應該清除 serverProcess', async () => {
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

      (manager as any).serverProcess = mockProcess;
      (manager as any).currentPort = 3000;

      await manager.stopServer(3000);

      expect((manager as any).serverProcess).toBeNull();
      expect((manager as any).currentPort).toBeNull();
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

      (manager as any).serverProcess = mockProcess;
      (manager as any).currentPort = 3000;

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
    // P2-13: 簡化設計 - 測試單一 serverProcess 清理
    it('應該清理已終止的進程記錄', () => {
      const mockProcess = {
        pid: 1234,
        killed: true, // Already killed
        kill: vi.fn(),
      };

      (manager as any).serverProcess = mockProcess;
      (manager as any).currentPort = 3000;

      manager.cleanupStaleProcesses();

      expect((manager as any).serverProcess).toBeNull();
      expect((manager as any).currentPort).toBeNull();
    });

    it('應該清理 pid 為 undefined 的進程記錄', () => {
      const mockProcess = {
        pid: undefined,
        killed: false,
        kill: vi.fn(),
      };

      (manager as any).serverProcess = mockProcess;
      (manager as any).currentPort = 3000;

      manager.cleanupStaleProcesses();

      expect((manager as any).serverProcess).toBeNull();
    });

    it('應該保留正常運行的進程', () => {
      const mockProcess = {
        pid: 1234,
        killed: false,
        kill: vi.fn(() => {
          // kill(0) succeeds - process is alive
        }),
      };

      (manager as any).serverProcess = mockProcess;
      (manager as any).currentPort = 3000;

      manager.cleanupStaleProcesses();

      expect((manager as any).serverProcess).toBe(mockProcess);
    });

    it('應該處理 kill(0) 拋出錯誤的情況', () => {
      const mockProcess = {
        pid: 1234,
        killed: false,
        kill: vi.fn(() => {
          throw new Error('No such process');
        }),
      };

      (manager as any).serverProcess = mockProcess;
      (manager as any).currentPort = 3000;

      manager.cleanupStaleProcesses();

      expect((manager as any).serverProcess).toBeNull();
    });
  });

  describe('getActiveServers() - 獲取活動服務器', () => {
    it('應該返回所有活動服務器的端口列表', () => {
      // P2-13: 簡化設計 - 設置 serverProcess 和 currentPort
      (manager as any).serverProcess = { pid: 1, killed: false };
      (manager as any).currentPort = 3000;

      const activeServers = manager.getActiveServers();

      expect(activeServers).toEqual([3000]);
    });

    it('沒有活動服務器時應該返回空數組', () => {
      const activeServers = manager.getActiveServers();
      expect(activeServers).toEqual([]);
    });
  });

  describe('cleanupAll() - 清理所有服務器', () => {
    it('應該停止所有活動伺服器', async () => {
      const mockProcess1 = {
        on: vi.fn(),
        once: vi.fn((event, cb) => event === 'close' && cb(null)),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        killed: false,
        pid: 1234,
      };

      // P2-13: 簡化設計 - 設置 serverProcess 和 currentPort
      (manager as any).serverProcess = mockProcess1;
      (manager as any).currentPort = 3000;

      await manager.cleanupAll();

      expect(mockProcess1.kill).toHaveBeenCalledWith('SIGTERM');
      expect((manager as any).serverProcess).toBeNull();
      expect((manager as any).currentPort).toBeNull();
    });

    it('沒有活動伺服器時應該正常處理', async () => {
      await manager.cleanupAll();
      // 不應該拋出錯誤
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
