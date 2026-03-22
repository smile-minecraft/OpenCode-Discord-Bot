/**
 * OpenCodeSDKAdapter Tests - SDK 客戶端適配器單元測試
 * @description 測試 OpenCodeSDKAdapter 的初始化、健康檢查、錯誤映射和單例模式
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Use vi.hoisted to define mocks before they are used
const { mockFetchFn, mockCreateOpencodeClientFn, mockGetProcessManagerFn } = vi.hoisted(() => {
  return {
    mockFetchFn: vi.fn(),
    mockCreateOpencodeClientFn: vi.fn(),
    mockGetProcessManagerFn: vi.fn().mockReturnValue({
      startServer: () => Promise.resolve(3000),
      stopServer: () => Promise.resolve(),
      isServerRunning: () => Promise.resolve(true),
      getBaseUrl: () => 'http://127.0.0.1:3000',
      allocatePort: () => 3000,
    }),
  };
});

// Mock fetch
global.fetch = mockFetchFn;

// Mock @opencode-ai/sdk
vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: mockCreateOpencodeClientFn,
}));

// Mock ProcessManager - create mock functions using vi.hoisted
const { mockStartServer, mockStopServer, mockIsServerRunning, mockGetBaseUrl, mockAllocatePort } = vi.hoisted(() => {
  return {
    mockStartServer: vi.fn().mockResolvedValue(3000),
    mockStopServer: vi.fn().mockResolvedValue(undefined),
    mockIsServerRunning: vi.fn().mockResolvedValue(true),
    mockGetBaseUrl: vi.fn().mockReturnValue('http://127.0.0.1:3000'),
    mockAllocatePort: vi.fn().mockReturnValue(3000),
  };
});

vi.mock('../../src/services/ProcessManager.js', () => ({
  getProcessManager: mockGetProcessManagerFn,
  ProcessManager: vi.fn(),
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
  TIMEOUTS: {
    HEALTH_CHECK: 50,
  },
}));

// Import after mocking
import {
  OpenCodeSDKAdapter,
  SDKAdapterError,
  getOpenCodeSDKAdapter,
  initializeOpenCodeSDKAdapter,
} from '../../src/services/OpenCodeSDKAdapter';

describe('OpenCodeSDKAdapter', () => {
  let adapter: OpenCodeSDKAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset getProcessManager mock to return the mock functions
    mockGetProcessManagerFn.mockReturnValue({
      startServer: mockStartServer,
      stopServer: mockStopServer,
      isServerRunning: mockIsServerRunning,
      getBaseUrl: mockGetBaseUrl,
      allocatePort: mockAllocatePort,
    });
    
    // Reset all mock implementations
    // Simulate real startServer behavior: calls allocatePort when port is undefined
    mockStartServer.mockImplementation((projectPath: string, port?: number) => {
      return Promise.resolve(port ?? mockAllocatePort());
    });
    mockStopServer.mockResolvedValue(undefined);
    mockIsServerRunning.mockResolvedValue(true);
    mockGetBaseUrl.mockReturnValue('http://127.0.0.1:3000');
    mockAllocatePort.mockReturnValue(3000);
    mockCreateOpencodeClientFn.mockReturnValue({
      global: {
        event: vi.fn(),
      },
      event: { subscribe: vi.fn() },
      session: { create: vi.fn() },
      _client: { request: vi.fn().mockResolvedValue(undefined) },
    });
    
    // Clear environment variable BEFORE creating adapter
    delete process.env.OPENCODE_API_URL;
    
    adapter = new OpenCodeSDKAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor() - 構造函數', () => {
    it('應該創建實例並初始化 ProcessManager', () => {
      expect(adapter).toBeDefined();
      expect(mockGetProcessManagerFn).toHaveBeenCalled();
    });
  });

  describe('initialize() - 初始化', () => {
    it('本地模式：應該啟動服務器並初始化 SDK 客戶端', async () => {
      const mockClient = { 
        event: { subscribe: vi.fn() },
        session: { create: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      const port = await adapter.initialize({
        projectPath: '/test/project',
        port: 3000,
      });

      expect(port).toBe(3000);
      expect(mockStartServer).toHaveBeenCalledWith('/test/project', 3000);
      expect(mockCreateOpencodeClientFn).toHaveBeenCalledWith({
        baseUrl: 'http://127.0.0.1:3000',
      });
    });

    it('使用固定端口 4096', async () => {
      const mockClient = { 
        event: { subscribe: vi.fn() },
        session: { create: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);
      mockAllocatePort.mockReturnValue(4096);

      const port = await adapter.initialize({
        projectPath: '/test/project',
      });

      expect(port).toBe(4096);
      // 未指定端口时，内部使用固定端口 4096
      expect(mockStartServer).toHaveBeenCalled();
    });

    it('外部服務模式：應該使用外部 URL', async () => {
      // Set external URL BEFORE creating adapter (constructor captures externalUrl)
      process.env.OPENCODE_API_URL = 'https://api.opencode.example.com';
      
      // Create a new adapter after setting env var
      const extAdapter = new OpenCodeSDKAdapter();
      
      const mockClient = { 
        event: { subscribe: vi.fn() },
        session: { create: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      const port = await extAdapter.initialize({
        projectPath: '/test/project',
        port: 3000,
      });

      expect(port).toBe(3000);
      expect(mockStartServer).not.toHaveBeenCalled();
      expect(mockCreateOpencodeClientFn).toHaveBeenCalledWith({
        baseUrl: 'https://api.opencode.example.com',
      });
    });

    it('外部服務模式：服務不可用時應該拋出錯誤', async () => {
      // Set external URL BEFORE creating adapter
      process.env.OPENCODE_API_URL = 'https://api.opencode.example.com';
      
      // Create a new adapter after setting env var
      const extAdapter = new OpenCodeSDKAdapter();
      
      mockIsServerRunning.mockResolvedValue(false);

      await expect(extAdapter.initialize({
        projectPath: '/test/project',
      })).rejects.toThrow(SDKAdapterError);
      
      await expect(extAdapter.initialize({
        projectPath: '/test/project',
      })).rejects.toMatchObject({
        code: 'SERVER_NOT_RUNNING',
      });
    });
  });

  describe('getClient() - 獲取 SDK 客戶端', () => {
    it('已初始化時應該返回客戶端', async () => {
      const mockClient = { 
        event: { subscribe: vi.fn() },
        session: { create: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project' });

      const client = adapter.getClient();
      expect(client).toBe(mockClient);
    });

    it('未初始化時應該拋出 NOT_INITIALIZED 錯誤', () => {
      // Create a new adapter to ensure it's not initialized
      const freshAdapter = new OpenCodeSDKAdapter();
      
      try {
        freshAdapter.getClient();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(SDKAdapterError);
        expect((error as SDKAdapterError).code).toBe('NOT_INITIALIZED');
      }
    });
  });

  describe('checkHealth() - 健康檢查', () => {
    it('應該調用 ProcessManager 的 isServerRunning', async () => {
      mockIsServerRunning.mockResolvedValue(true);

      const result = await adapter.checkHealth(3000);

      expect(result).toBe(true);
      expect(mockIsServerRunning).toHaveBeenCalledWith(3000);
    });

    it('未指定端口且未初始化時應該返回 false', async () => {
      const result = await adapter.checkHealth();
      expect(result).toBe(false);
    });

    it('使用當前端口時應該正確調用', async () => {
      const mockClient = { 
        event: { subscribe: vi.fn() },
        session: { create: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);
      mockIsServerRunning.mockResolvedValue(true);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });
      await adapter.checkHealth();

      expect(mockIsServerRunning).toHaveBeenCalledWith(3000);
    });
  });

  describe('waitForReady() - 等待就緒', () => {
    it('服務器就緒時應該立即返回', async () => {
      mockIsServerRunning.mockResolvedValue(true);

      await adapter.waitForReady(3000);
      
      // Should pass without error
      expect(true).toBe(true);
    });

    it('服務器未就緒時應該重試', async () => {
      mockIsServerRunning
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await adapter.waitForReady(3000);
      
      expect(mockIsServerRunning).toHaveBeenCalledTimes(3);
    });

    it('超時時應該拋出 TIMEOUT 錯誤', async () => {
      mockIsServerRunning.mockResolvedValue(false);

      await expect(adapter.waitForReady(3000)).rejects.toThrow(SDKAdapterError);
      await expect(adapter.waitForReady(3000)).rejects.toMatchObject({
        code: 'TIMEOUT',
      });
    });

    it('未指定端口時應該拋出錯誤', async () => {
      await expect(adapter.waitForReady()).rejects.toThrow(SDKAdapterError);
      await expect(adapter.waitForReady()).rejects.toMatchObject({
        code: 'SERVER_NOT_RUNNING',
      });
    });
  });

  describe('getPort() - 獲取端口', () => {
    it('初始化後應該返回端口號', async () => {
      const mockClient = { 
        event: { subscribe: vi.fn() },
        session: { create: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      expect(adapter.getPort()).toBe(3000);
    });

    it('未初始化時應該返回 null', () => {
      expect(adapter.getPort()).toBeNull();
    });
  });

  describe('getBaseUrl() - 獲取基礎 URL', () => {
    it('初始化後應該返回基礎 URL', async () => {
      const mockClient = { 
        event: { subscribe: vi.fn() },
        session: { create: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      expect(adapter.getBaseUrl()).toBe('http://127.0.0.1:3000');
    });

    it('未初始化時應該返回 null', () => {
      expect(adapter.getBaseUrl()).toBeNull();
    });
  });

  describe('isExternal() - 是否外部服務', () => {
    it('使用外部服務時應該返回 true', () => {
      process.env.OPENCODE_API_URL = 'https://api.opencode.example.com';
      
      const extAdapter = new OpenCodeSDKAdapter();
      expect(extAdapter.isExternal()).toBe(true);
    });

    it('本地模式時應該返回 false', () => {
      const localAdapter = new OpenCodeSDKAdapter();
      expect(localAdapter.isExternal()).toBe(false);
    });
  });

  describe('subscribeToEvents() - 事件訂閱', () => {
    it('成功訂閱時應該返回 SSEEventEmitterAdapter', async () => {
      const mockEventStream = {
        stream: {
          [Symbol.asyncIterator]: vi.fn().mockReturnValue({
            next: vi.fn().mockResolvedValue({ done: true, value: undefined }),
          }),
        },
      };
      const mockClient = { 
        global: {
          event: vi.fn(),
        },
        event: { 
          subscribe: vi.fn().mockResolvedValue(mockEventStream),
        },
        session: { create: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });
      const result = await adapter.subscribeToEvents('session-123');

      expect(result).toBeDefined();
      expect(result.getSessionId()).toBe('session-123');
    });

    it('SDK 調用失敗時應該拋出 SDKAdapterError', async () => {
      const mockClient = { 
        event: { subscribe: vi.fn().mockRejectedValue(new Error('SDK error')) },
        session: { create: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await expect(adapter.subscribeToEvents('session-123')).rejects.toThrow(SDKAdapterError);
      await expect(adapter.subscribeToEvents('session-123')).rejects.toMatchObject({
        code: 'SDK_ERROR',
      });
    });

    it('未初始化時應該拋出 NOT_INITIALIZED 錯誤', async () => {
      await expect(adapter.subscribeToEvents('session-123')).rejects.toThrow(SDKAdapterError);
      await expect(adapter.subscribeToEvents('session-123')).rejects.toMatchObject({
        code: 'NOT_INITIALIZED',
      });
    });
  });

  describe('getProviders() - 解析 Provider 列表', () => {
    it('應該正確解析物件格式 providers', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { create: vi.fn() },
        config: {
          providers: vi.fn().mockResolvedValue({
            data: {
              providers: {
                openai: {
                  models: {
                    'gpt-4o': { cost: { input: 5, output: 15 } },
                  },
                },
              },
            },
          }),
        },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);
      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      const providers = await adapter.getProviders();

      expect(providers).toHaveLength(1);
      expect(providers[0].id).toBe('openai');
      expect(providers[0].models[0]).toEqual({
        id: 'gpt-4o',
        cost: { input: 5, output: 15 },
      });
    });

    it('應該正確解析陣列格式 providers（避免使用索引當 provider id）', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { create: vi.fn() },
        config: {
          providers: vi.fn().mockResolvedValue({
            data: {
              providers: [
                {
                  id: 'openai',
                  models: [
                    { id: 'gpt-4o-mini', cost: { input: 0.15, output: 0.6 } },
                  ],
                },
              ],
            },
          }),
        },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);
      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      const providers = await adapter.getProviders();

      expect(providers).toHaveLength(1);
      expect(providers[0].id).toBe('openai');
      expect(providers[0].models[0].id).toBe('gpt-4o-mini');
    });
  });

  describe('getAgents() - 解析 Agent 列表', () => {
    beforeEach(() => {
      mockCreateOpencodeClientFn.mockReturnValue({
        event: { subscribe: vi.fn() },
        session: { create: vi.fn() },
        app: {
          agents: vi.fn(),
        },
      });
    });

    it('response.data 直接是 Agent 陣列時應該正確解析', async () => {
      const mockAgents = [
        {
          name: 'developer',
          description: 'A coding agent',
          mode: 'agent',
          builtIn: true,
          model: { providerID: 'openai', modelID: 'gpt-4o' },
        },
        {
          name: 'planner',
          description: 'Planning agent',
          mode: 'planning',
          builtIn: false,
        },
      ];
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { create: vi.fn() },
        app: {
          agents: vi.fn().mockResolvedValue({ data: mockAgents }),
        },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });
      const result = await adapter.getAgents();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'developer',
        name: 'developer',
        description: 'A coding agent',
        mode: 'agent',
        builtIn: true,
        defaultModel: 'openai/gpt-4o',
      });
      expect(result[1]).toMatchObject({
        id: 'planner',
        name: 'planner',
        description: 'Planning agent',
        mode: 'planning',
        builtIn: false,
        defaultModel: undefined,
      });
    });

    it('response.data.agents 是嵌套陣列時應該正確解析', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { create: vi.fn() },
        app: {
          agents: vi.fn().mockResolvedValue({
            data: {
              agents: [
                {
                  name: 'code-reviewer',
                  description: 'Reviews code',
                  model: { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' },
                },
              ],
            },
          }),
        },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });
      const result = await adapter.getAgents();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'code-reviewer',
        name: 'code-reviewer',
        description: 'Reviews code',
        defaultModel: 'anthropic/claude-3-5-sonnet',
      });
    });

    it('response.data 非陣列且無 agents 欄位時應該回傳空陣列', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { create: vi.fn() },
        app: {
          agents: vi.fn().mockResolvedValue({
            data: {
              status: 'ok',
              count: 0,
            },
          }),
        },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });
      const result = await adapter.getAgents();

      expect(result).toEqual([]);
    });

    it('agent 缺少 name 時應該被過濾掉', async () => {
      const mockAgents = [
        { name: 'valid-agent', description: 'Valid' },
        { description: 'Missing name' },
        { name: 'another-valid', mode: 'test' },
        { name: '' },
        { name: '  ' },
      ];
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { create: vi.fn() },
        app: {
          agents: vi.fn().mockResolvedValue({ data: mockAgents }),
        },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });
      const result = await adapter.getAgents();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('valid-agent');
      expect(result[1].name).toBe('another-valid');
    });

    it('agent 有 mode 和 builtIn 時應該正確保留', async () => {
      const mockAgents = [
        {
          name: 'arch-agent',
          description: 'Architecture agent',
          mode: 'architect',
          builtIn: true,
          model: { providerID: 'google', modelID: 'gemini-pro' },
        },
        {
          name: 'custom-agent',
          description: 'Custom agent',
          mode: 'custom',
          builtIn: false,
        },
      ];
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { create: vi.fn() },
        app: {
          agents: vi.fn().mockResolvedValue({ data: mockAgents }),
        },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });
      const result = await adapter.getAgents();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'arch-agent',
        name: 'arch-agent',
        description: 'Architecture agent',
        mode: 'architect',
        builtIn: true,
        defaultModel: 'google/gemini-pro',
      });
      expect(result[1]).toMatchObject({
        id: 'custom-agent',
        name: 'custom-agent',
        description: 'Custom agent',
        mode: 'custom',
        builtIn: false,
        defaultModel: undefined,
      });
    });

    it('未初始化時應該拋出 NOT_INITIALIZED 錯誤', async () => {
      const freshAdapter = new OpenCodeSDKAdapter();
      await expect(freshAdapter.getAgents()).rejects.toMatchObject({
        code: 'NOT_INITIALIZED',
      });
    });

    it('應該支援 directory 參數', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { create: vi.fn() },
        app: {
          agents: vi.fn().mockResolvedValue({ data: [] }),
        },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });
      await adapter.getAgents('/custom/directory');

      expect(mockClient.app.agents).toHaveBeenCalledWith({
        query: { directory: '/custom/directory' },
      });
    });
  });

  describe('cleanup() - 清理資源', () => {
    it('本地模式時應該停止服務器', async () => {
      const mockClient = { 
        event: { subscribe: vi.fn() },
        session: { create: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });
      await adapter.cleanup();

      expect(mockStopServer).toHaveBeenCalledWith(3000);
      expect(adapter.getPort()).toBeNull();
    });

  });

  describe('SDKAdapterError - 錯誤類別', () => {
    it('應該正確設置錯誤屬性', () => {
      const error = new SDKAdapterError('Test error', 'NOT_INITIALIZED');

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('NOT_INITIALIZED');
      expect(error.name).toBe('SDKAdapterError');
    });

    it('應該支持所有錯誤碼', () => {
      const errorCodes: SDKAdapterError['code'][] = [
        'NOT_INITIALIZED',
        'SERVER_NOT_RUNNING',
        'SDK_ERROR',
        'TIMEOUT',
      ];

      for (const code of errorCodes) {
        const error = new SDKAdapterError('Test', code);
        expect(error.code).toBe(code);
      }
    });
  });

  describe('getOpenCodeSDKAdapter() - 單例模式', () => {
    it('應該返回同一個實例', () => {
      // Clear any existing instance
      const instance1 = getOpenCodeSDKAdapter();
      const instance2 = getOpenCodeSDKAdapter();

      expect(instance1).toBe(instance2);
    });
  });

  describe('initializeOpenCodeSDKAdapter() - 初始化單例', () => {
    it('應該返回新的實例', () => {
      const instance1 = initializeOpenCodeSDKAdapter();
      const instance2 = getOpenCodeSDKAdapter();

      expect(instance1).toBe(instance2);
    });

    it('應該允許重新初始化', () => {
      const instance1 = getOpenCodeSDKAdapter();
      const instance2 = initializeOpenCodeSDKAdapter();

      expect(instance1).not.toBe(instance2);
    });
  });

  // ============== 新增的 HTTP 方法測試 ==============

  describe('createSession() - 創建 Session', () => {
    beforeEach(() => {
      // Re-setup mock for session methods
      mockCreateOpencodeClientFn.mockReturnValue({
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn(),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
      });
    });

    it('應該使用正確參數創建 Session', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn().mockResolvedValue({
            data: { id: 'session-123', title: 'Test Session' },
          }),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      const result = await adapter.createSession({
        directory: '/test/project',
        parentID: 'parent-456',
        title: 'New Session',
      });

      expect(mockClient.session.create).toHaveBeenCalledWith({
        body: {
          parentID: 'parent-456',
          title: 'New Session',
        },
        query: {
          directory: '/test/project',
        },
      });
      expect(result).toEqual({ id: 'session-123', title: 'Test Session' });
    });

    it('應該返回 Session 資料', async () => {
      const mockSessionData = { id: 'session-789', title: 'My Session' };
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn().mockResolvedValue({ data: mockSessionData }),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      const result = await adapter.createSession({ title: 'Test' });

      expect(result).toBe(mockSessionData);
    });

    it('應該處理 SDK 錯誤', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn().mockRejectedValue(new Error('404: Not Found')),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await expect(adapter.createSession({ title: 'Test' })).rejects.toThrow(SDKAdapterError);
      await expect(adapter.createSession({ title: 'Test' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('未初始化時應該拋出 NOT_INITIALIZED 錯誤', async () => {
      await expect(adapter.createSession({ title: 'Test' })).rejects.toThrow(SDKAdapterError);
      await expect(adapter.createSession({ title: 'Test' })).rejects.toMatchObject({
        code: 'NOT_INITIALIZED',
      });
    });
  });

  describe('sendPrompt() - 發送提示', () => {
    beforeEach(() => {
      mockCreateOpencodeClientFn.mockReturnValue({
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn(),
          prompt: vi.fn().mockResolvedValue(undefined),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
      });
    });

    it('應該使用正確參數發送提示', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn(),
          prompt: vi.fn().mockResolvedValue(undefined),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await adapter.sendPrompt({
        sessionId: 'session-123',
        prompt: 'Hello, world!',
      });

      expect(mockClient.session.prompt).toHaveBeenCalledWith({
        path: { id: 'session-123' },
        body: {
          parts: [{ type: 'text', text: 'Hello, world!' }],
          model: undefined,
          agent: undefined,
          system: undefined,
          tools: undefined,
        },
        query: undefined,
      });
    });

    it('應該處理可選參數 (model, agent, system, tools)', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn(),
          prompt: vi.fn().mockResolvedValue(undefined),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await adapter.sendPrompt({
        sessionId: 'session-123',
        prompt: 'Test prompt',
        model: { providerID: 'openai', modelID: 'gpt-4' },
        agent: 'developer',
        system: 'You are a helpful assistant',
        tools: { 'filesystem.read': true, 'bash.execute': false },
      });

      expect(mockClient.session.prompt).toHaveBeenCalledWith({
        path: { id: 'session-123' },
        body: {
          parts: [{ type: 'text', text: 'Test prompt' }],
          model: { providerID: 'openai', modelID: 'gpt-4' },
          agent: 'developer',
          system: 'You are a helpful assistant',
          tools: { 'filesystem.read': true, 'bash.execute': false },
        },
        query: undefined,
      });
    });

    it('應該處理 SDK 錯誤', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn(),
          prompt: vi.fn().mockRejectedValue(new Error('401: Unauthorized')),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await expect(adapter.sendPrompt({ sessionId: 'session-123', prompt: 'test' })).rejects.toThrow(SDKAdapterError);
      await expect(adapter.sendPrompt({ sessionId: 'session-123', prompt: 'test' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('未初始化時應該拋出 NOT_INITIALIZED 錯誤', async () => {
      await expect(adapter.sendPrompt({ sessionId: 'session-123', prompt: 'test' })).rejects.toThrow(SDKAdapterError);
      await expect(adapter.sendPrompt({ sessionId: 'session-123', prompt: 'test' })).rejects.toMatchObject({
        code: 'NOT_INITIALIZED',
      });
    });

    it('應該傳遞 directory 參數到 SDK', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: {
          create: vi.fn(),
          prompt: vi.fn().mockResolvedValue(undefined),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await adapter.sendPrompt({
        sessionId: 'session-123',
        prompt: 'Hello with directory',
        directory: '/custom/directory',
      });

      expect(mockClient.session.prompt).toHaveBeenCalledWith({
        path: { id: 'session-123' },
        body: {
          parts: [{ type: 'text', text: 'Hello with directory' }],
          model: undefined,
          agent: undefined,
          system: undefined,
          tools: undefined,
        },
        query: { directory: '/custom/directory' },
      });
    });
  });

  describe('sendToolApproval() - 發送工具審批', () => {
    beforeEach(() => {
      mockCreateOpencodeClientFn.mockReturnValue({
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn(),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn().mockResolvedValue(undefined),
        auth: { set: vi.fn() },
      });
    });

    it('應該發送一次批準 (once)', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn(),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn().mockResolvedValue(undefined),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await adapter.sendToolApproval({
        sessionId: 'session-123',
        requestId: 'req-456',
        approved: true,
        always: false,
      });

      expect(mockClient.postSessionIdPermissionsPermissionId).toHaveBeenCalledWith({
        path: { id: 'session-123', permissionID: 'req-456' },
        body: { response: 'once' },
      });
    });

    it('應該發送永久批準 (always)', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn(),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn().mockResolvedValue(undefined),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await adapter.sendToolApproval({
        sessionId: 'session-123',
        requestId: 'req-456',
        approved: true,
        always: true,
      });

      expect(mockClient.postSessionIdPermissionsPermissionId).toHaveBeenCalledWith({
        path: { id: 'session-123', permissionID: 'req-456' },
        body: { response: 'always' },
      });
    });

    it('應該發送拒絕 (reject)', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn(),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn().mockResolvedValue(undefined),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await adapter.sendToolApproval({
        sessionId: 'session-123',
        requestId: 'req-456',
        approved: false,
      });

      expect(mockClient.postSessionIdPermissionsPermissionId).toHaveBeenCalledWith({
        path: { id: 'session-123', permissionID: 'req-456' },
        body: { response: 'reject' },
      });
    });

    it('應該處理 SDK 錯誤', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn(),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn().mockRejectedValue(new Error('429: Rate Limit')),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await expect(adapter.sendToolApproval({ 
        sessionId: 'session-123', 
        requestId: 'req-456', 
        approved: true 
      })).rejects.toThrow(SDKAdapterError);
      await expect(adapter.sendToolApproval({ 
        sessionId: 'session-123', 
        requestId: 'req-456', 
        approved: true 
      })).rejects.toMatchObject({
        code: 'RATE_LIMIT',
      });
    });

    it('未初始化時應該拋出 NOT_INITIALIZED 錯誤', async () => {
      await expect(adapter.sendToolApproval({ 
        sessionId: 'session-123', 
        requestId: 'req-456', 
        approved: true 
      })).rejects.toThrow(SDKAdapterError);
      await expect(adapter.sendToolApproval({ 
        sessionId: 'session-123', 
        requestId: 'req-456', 
        approved: true 
      })).rejects.toMatchObject({
        code: 'NOT_INITIALIZED',
      });
    });
  });

  describe('sendQuestionAnswer() - 發送問題答案', () => {
    it('應該使用 SDK 內部傳輸發送巢狀答案並避免全域 fetch', async () => {
      const mockRequest = vi.fn().mockResolvedValue({ data: {} });
      const mockClient = {
        global: { event: vi.fn() },
        event: { subscribe: vi.fn() },
        session: {
          create: vi.fn(),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
        _client: { request: mockRequest },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await adapter.sendQuestionAnswer({
        sessionId: 'session-123',
        questionId: 'question-abc',
        answers: ['  first  ', 'second'],
      });

      expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({
        method: 'POST',
        url: '/question/question-abc/reply',
        headers: { 'Content-Type': 'application/json' },
        body: {
          answers: [['first', 'second']],
        },
      }));
      expect(mockFetchFn).not.toHaveBeenCalled();
    });

    it('SDK 錯誤應映射為 SDKAdapterError', async () => {
      const mockRequest = vi.fn().mockRejectedValue(new Error('429 Rate Limit'));
      const mockClient = {
        global: { event: vi.fn() },
        event: { subscribe: vi.fn() },
        session: { create: vi.fn(), prompt: vi.fn() },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
        _client: { request: mockRequest },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await expect(adapter.sendQuestionAnswer({
        sessionId: 'session-123',
        questionId: 'question-abc',
        answers: ['choice'],
      })).rejects.toMatchObject({
        code: 'RATE_LIMIT',
      });
      expect(mockFetchFn).not.toHaveBeenCalled();
    });

    it('空答案應立即拒絕且不呼叫 SDK 傳輸', async () => {
      const mockRequest = vi.fn();
      const mockClient = {
        global: { event: vi.fn() },
        event: { subscribe: vi.fn() },
        session: { create: vi.fn(), prompt: vi.fn() },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
        _client: { request: mockRequest },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await expect(adapter.sendQuestionAnswer({
        sessionId: 'session-123',
        questionId: 'question-abc',
        answers: ['   ', ''],
      })).rejects.toMatchObject({
        code: 'SDK_ERROR',
      });
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('未初始化時應拋出 NOT_INITIALIZED', async () => {
      const freshAdapter = new OpenCodeSDKAdapter();
      await expect(freshAdapter.sendQuestionAnswer({
        sessionId: 'session-123',
        questionId: 'question-abc',
        answers: ['choice'],
      })).rejects.toMatchObject({
        code: 'NOT_INITIALIZED',
      });
    });
  });

  describe('setProviderAuth() - 設置 Provider 認證', () => {
    beforeEach(() => {
      mockCreateOpencodeClientFn.mockReturnValue({
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn(),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn().mockResolvedValue(undefined) },
      });
    });

    it('應該使用 apiKey 設置認證', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn(),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn().mockResolvedValue(undefined) },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await adapter.setProviderAuth({
        providerId: 'openai',
        apiKey: 'sk-test-key',
      });

      expect(mockClient.auth.set).toHaveBeenCalledWith({
        path: { id: 'openai' },
        body: { type: 'api', key: 'sk-test-key' },
      });
    });

    it('應該處理 SDK 錯誤', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn(),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn().mockRejectedValue(new Error('Connection error')) },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await expect(adapter.setProviderAuth({ 
        providerId: 'openai', 
        apiKey: 'sk-test' 
      })).rejects.toThrow(SDKAdapterError);
      await expect(adapter.setProviderAuth({ 
        providerId: 'openai', 
        apiKey: 'sk-test' 
      })).rejects.toMatchObject({
        code: 'CONNECTION_ERROR',
      });
    });

    it('未初始化時應該拋出 NOT_INITIALIZED 錯誤', async () => {
      await expect(adapter.setProviderAuth({ 
        providerId: 'openai', 
        apiKey: 'sk-test' 
      })).rejects.toThrow(SDKAdapterError);
      await expect(adapter.setProviderAuth({ 
        providerId: 'openai', 
        apiKey: 'sk-test' 
      })).rejects.toMatchObject({
        code: 'NOT_INITIALIZED',
      });
    });
  });

  describe('mapSDKError() - 錯誤映射 (通過各方法間接測試)', () => {
    beforeEach(() => {
      mockCreateOpencodeClientFn.mockReturnValue({
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn(),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
      });
    });

    it('應該映射 NOT_FOUND (404) 錯誤', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn().mockRejectedValue(new Error('404 Not Found')),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await expect(adapter.createSession({ title: 'test' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('應該映射 UNAUTHORIZED (401) 錯誤', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn().mockRejectedValue(new Error('401 Unauthorized')),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await expect(adapter.createSession({ title: 'test' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('應該映射 RATE_LIMIT (429) 錯誤', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn().mockRejectedValue(new Error('429 Rate Limit Exceeded')),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await expect(adapter.createSession({ title: 'test' })).rejects.toMatchObject({
        code: 'RATE_LIMIT',
      });
    });

    it('應該映射 TIMEOUT 錯誤', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn().mockRejectedValue(new Error('ETIMEDOUT connection timeout')),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await expect(adapter.createSession({ title: 'test' })).rejects.toMatchObject({
        code: 'TIMEOUT',
      });
    });

    it('應該映射 CONNECTION_ERROR 錯誤 (econnrefused)', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn().mockRejectedValue(new Error('ECONNREFUSED connection refused')),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await expect(adapter.createSession({ title: 'test' })).rejects.toMatchObject({
        code: 'CONNECTION_ERROR',
      });
    });

    it('應該映射 CONNECTION_ERROR 錯誤 (enotfound)', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn().mockRejectedValue(new Error('ENOTFOUND getaddrinfo')),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await expect(adapter.createSession({ title: 'test' })).rejects.toMatchObject({
        code: 'CONNECTION_ERROR',
      });
    });

    it('應該映射 SDK_ERROR (generic) 錯誤', async () => {
      const mockClient = {
        event: { subscribe: vi.fn() },
        session: { 
          create: vi.fn().mockRejectedValue(new Error('Some generic SDK error')),
          prompt: vi.fn(),
        },
        postSessionIdPermissionsPermissionId: vi.fn(),
        auth: { set: vi.fn() },
      };
      mockCreateOpencodeClientFn.mockReturnValue(mockClient);

      await adapter.initialize({ projectPath: '/test/project', port: 3000 });

      await expect(adapter.createSession({ title: 'test' })).rejects.toMatchObject({
        code: 'SDK_ERROR',
      });
    });

    it('應該映射 NOT_INITIALIZED 錯誤', async () => {
      const freshAdapter = new OpenCodeSDKAdapter();
      
      await expect(freshAdapter.createSession({ title: 'test' })).rejects.toMatchObject({
        code: 'NOT_INITIALIZED',
      });
    });

    it('應該映射 SERVER_NOT_RUNNING 錯誤 (未指定端口)', async () => {
      await expect(adapter.waitForReady()).rejects.toMatchObject({
        code: 'SERVER_NOT_RUNNING',
      });
    });
  });
});
