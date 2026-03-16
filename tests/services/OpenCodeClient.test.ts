/**
 * OpenCodeClient Tests - OpenCode HTTP API 客戶端單元測試
 * @description 測試 OpenCode HTTP 伺服器通訊功能
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Use vi.hoisted to define mocks before they are used
const { mockFetchFn, mockSpawnFn } = vi.hoisted(() => {
  return {
    mockFetchFn: vi.fn(),
    mockSpawnFn: vi.fn(),
  };
});

// Mock fetch
global.fetch = mockFetchFn;

// Mock child_process
vi.mock('child_process', () => ({
  spawn: mockSpawnFn,
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

// Import after mocking
import { OpenCodeClient, OpenCodeError, getOpenCodeClient } from '../../src/services/OpenCodeClient';
import type { CreateSessionOptions, SessionInfo } from '../../src/services/OpenCodeClient';

describe('OpenCodeClient', () => {
  let client: OpenCodeClient;

  beforeEach(() => {
    client = new OpenCodeClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isServerRunning() - 伺服器運行檢查', () => {
    it('伺服器運行時應該返回 true', async () => {
      mockFetchFn.mockResolvedValueOnce({ ok: true } as Response);

      const result = await client.isServerRunning(3000);

      expect(result).toBe(true);
      expect(mockFetchFn).toHaveBeenCalledWith(
        'http://127.0.0.1:3000/health',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('伺服器未運行時應該返回 false', async () => {
      mockFetchFn.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.isServerRunning(3000);

      expect(result).toBe(false);
    });

    it('伺服器返回錯誤狀態時應該返回 false', async () => {
      mockFetchFn.mockResolvedValueOnce({ ok: false } as Response);

      const result = await client.isServerRunning(3000);

      expect(result).toBe(false);
    });
  });

  describe('createSession() - Session 創建', () => {
    it('成功創建 Session 時應該返回 SessionInfo', async () => {
      const mockSessionInfo: SessionInfo = {
        id: 'session-123',
        status: 'pending',
        model: 'anthropic/claude-sonnet-4-20250514',
        agent: 'general',
      };

      mockFetchFn
        .mockResolvedValueOnce({ ok: true } as Response) // health check
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSessionInfo),
        } as Response);

      const options: CreateSessionOptions = {
        model: 'anthropic/claude-sonnet-4-20250514',
        agent: 'general',
        projectPath: '/test/project',
      };

      const result = await client.createSession(3000, options);

      expect(result).toEqual(mockSessionInfo);
      expect(result.id).toBe('session-123');
    });

    it('伺服器未運行時應該拋出 SERVER_NOT_RUNNING 錯誤', async () => {
      mockFetchFn.mockRejectedValueOnce(new Error('Network error'));

      const options: CreateSessionOptions = {
        model: 'anthropic/claude-sonnet-4-20250514',
        agent: 'general',
        projectPath: '/test/project',
      };

      await expect(client.createSession(3000, options)).rejects.toThrow(OpenCodeError);
      await expect(client.createSession(3000, options)).rejects.toMatchObject({
        code: 'SERVER_NOT_RUNNING',
      });
    });

    it('API 返回錯誤時應該拋出 API_ERROR', async () => {
      // 模擬健康檢查通過，但創建 session API 失敗
      mockFetchFn
        .mockResolvedValueOnce({ ok: true } as Response) // health check (isServerRunning)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: () => Promise.resolve('Server error'),
        } as Response); // createSession API

      const options: CreateSessionOptions = {
        model: 'anthropic/claude-sonnet-4-20250514',
        agent: 'general',
        projectPath: '/test/project',
      };

      await expect(client.createSession(3000, options)).rejects.toMatchObject({
        code: 'API_ERROR',
        statusCode: 500,
      });
    });
  });

  describe('sendPrompt() - 發送提示', () => {
    it('成功發送提示時應該不返回任何值', async () => {
      mockFetchFn
        .mockResolvedValueOnce({ ok: true } as Response) // health check
        .mockResolvedValueOnce({
          ok: true,
        } as Response);

      await client.sendPrompt(3000, 'session-123', 'Hello, world!');

      expect(mockFetchFn).toHaveBeenCalledTimes(2);
    });

    it('伺服器未運行時應該拋出 SERVER_NOT_RUNNING 錯誤', async () => {
      mockFetchFn.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.sendPrompt(3000, 'session-123', 'prompt')).rejects.toThrow(
        OpenCodeError
      );
      await expect(client.sendPrompt(3000, 'session-123', 'prompt')).rejects.toMatchObject({
        code: 'SERVER_NOT_RUNNING',
      });
    });

    it('API 返回錯誤時應該拋出 API_ERROR', async () => {
      mockFetchFn
        .mockResolvedValueOnce({ ok: true } as Response) // health check
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: () => Promise.resolve('Invalid session'),
        } as Response);

      await expect(client.sendPrompt(3000, 'invalid-session', 'prompt')).rejects.toThrow(
        OpenCodeError
      );
    });
  });

  describe('startServer() - 伺服器啟動', () => {
    it('伺服器已運行時應該直接返回', async () => {
      mockFetchFn.mockResolvedValueOnce({ ok: true } as Response);

      await client.startServer('/test/project', 3000);

      expect(mockSpawnFn).not.toHaveBeenCalled();
    });

    it('應該啟動伺服器並等待健康檢查通過', async () => {
      const mockProcess = {
        on: vi.fn(),
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn(),
        },
        kill: vi.fn(),
      };

      mockSpawnFn.mockReturnValue(mockProcess as unknown as ReturnType<typeof import('child_process').spawn>);

      // 模擬健康檢查失敗一次，然後成功
      mockFetchFn
        .mockRejectedValueOnce(new Error('not running'))
        .mockResolvedValueOnce({ ok: true } as Response);

      await client.startServer('/test/project', 3000);

      expect(mockSpawnFn).toHaveBeenCalledWith('opencode', ['serve', '--port', '3000'], expect.any(Object));
      expect(mockFetchFn).toHaveBeenCalledTimes(2);
    });

    it('健康檢查超時時應該拋出 TIMEOUT 錯誤', async () => {
      const mockProcess = {
        on: vi.fn(),
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn(),
        },
        kill: vi.fn(),
      };

      mockSpawnFn.mockReturnValue(mockProcess as unknown as ReturnType<typeof import('child_process').spawn>);
      mockFetchFn.mockRejectedValue(new Error('not running'));

      await expect(client.startServer('/test/project', 3000)).rejects.toThrow(OpenCodeError);
      await expect(client.startServer('/test/project', 3000)).rejects.toMatchObject({
        code: 'TIMEOUT',
      });
    });
  });

  describe('stopServer() - 伺服器停止', () => {
    it('停止存在的伺服器時應該發送 SIGTERM', async () => {
      const mockProcess = {
        on: vi.fn(),
        once: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn((_signal: string) => {
          // 模擬已終止
        }),
        killed: false,
      };

      // 直接設置到 serverProcesses
      (client as any).serverProcesses.set(3000, mockProcess);

      await client.stopServer(3000);

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('嘗試停止不存在的伺服器時應該發出警告', async () => {
      await client.stopServer(3000);
      // 不應該拋出錯誤
    });
  });

  describe('getActiveServers() - 獲取活動伺服器', () => {
    it('應該返回所有活動伺服器的端口列表', () => {
      const mockProcess = {
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
      };

      (client as any).serverProcesses.set(3000, mockProcess);
      (client as any).serverProcesses.set(3001, mockProcess);

      const activeServers = client.getActiveServers();

      expect(activeServers).toEqual([3000, 3001]);
    });
  });

  describe('OpenCodeError - 錯誤類別', () => {
    it('應該正確設置錯誤屬性', () => {
      const error = new OpenCodeError('Test error', 'NETWORK_ERROR', {
        port: 3000,
        statusCode: 500,
      });

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.port).toBe(3000);
      expect(error.statusCode).toBe(500);
      expect(error.name).toBe('OpenCodeError');
    });

    it('應該支持所有錯誤碼', () => {
      const errorCodes: OpenCodeError['code'][] = [
        'SERVER_NOT_RUNNING',
        'NETWORK_ERROR',
        'API_ERROR',
        'TIMEOUT',
        'SPAWN_ERROR',
      ];

      for (const code of errorCodes) {
        const error = new OpenCodeError('Test', code);
        expect(error.code).toBe(code);
      }
    });
  });

  describe('getOpenCodeClient() - 單例模式', () => {
    it('應該返回同一個實例', () => {
      const instance1 = getOpenCodeClient();
      const instance2 = getOpenCodeClient();

      expect(instance1).toBe(instance2);
    });
  });
});