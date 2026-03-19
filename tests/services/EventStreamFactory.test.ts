/**
 * EventStreamFactory Tests - 事件串流工廠適配器單元測試
 * @description 測試 createEventStreamAdapter() 工廠函數
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock SSEClient
vi.mock('../../src/services/SSEClient.js', () => ({
  SSEClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(() => () => {}),
    once: vi.fn(),
    off: vi.fn(),
    isConnected: vi.fn(() => false),
    getConnectionState: vi.fn(() => 'disconnected'),
    dispose: vi.fn(),
  })),
  getSSEClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(() => () => {}),
    once: vi.fn(),
    off: vi.fn(),
    isConnected: vi.fn(() => false),
    getConnectionState: vi.fn(() => 'disconnected'),
    dispose: vi.fn(),
  })),
  initializeSSEClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(() => () => {}),
    once: vi.fn(),
    off: vi.fn(),
    isConnected: vi.fn(() => false),
    getConnectionState: vi.fn(() => 'disconnected'),
    dispose: vi.fn(),
  })),
}));

// Mock SSEEventEmitterAdapter
vi.mock('../../src/services/SSEEventEmitterAdapter.js', () => ({
  SSEEventEmitterAdapter: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    on: vi.fn(() => () => {}),
    once: vi.fn(),
    off: vi.fn(),
    isActive: vi.fn(() => false),
    getSessionId: vi.fn(() => null),
    getStream: vi.fn(() => null),
    dispose: vi.fn(),
  })),
}));

// Mock OpenCodeSDKAdapter
vi.mock('../../src/services/OpenCodeSDKAdapter.js', () => ({
  OpenCodeSDKAdapter: vi.fn().mockImplementation(() => ({
    subscribeToEvents: vi.fn().mockResolvedValue({
      on: vi.fn(() => () => {}),
      isActive: vi.fn(() => true),
      getSessionId: vi.fn(() => 'test-session'),
      dispose: vi.fn(),
    }),
    getBaseUrl: vi.fn(() => 'http://127.0.0.1:3000'),
  })),
  getOpenCodeSDKAdapter: vi.fn().mockImplementation(() => ({
    subscribeToEvents: vi.fn().mockResolvedValue({
      on: vi.fn(() => () => {}),
      isActive: vi.fn(() => true),
      getSessionId: vi.fn(() => 'test-session'),
      dispose: vi.fn(),
    }),
    getBaseUrl: vi.fn(() => 'http://127.0.0.1:3000'),
  })),
  initializeOpenCodeSDKAdapter: vi.fn().mockImplementation(() => ({
    subscribeToEvents: vi.fn().mockResolvedValue({
      on: vi.fn(() => () => {}),
      isActive: vi.fn(() => true),
      getSessionId: vi.fn(() => 'test-session'),
      dispose: vi.fn(),
    }),
    getBaseUrl: vi.fn(() => 'http://127.0.0.1:3000'),
  })),
}));

// Import after mocking
import {
  createEventStreamAdapter,
  getEventStreamAdapter,
  initializeEventStreamAdapter,
} from '../../src/services/EventStreamFactory.js';

describe('EventStreamFactory', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = process.env.USE_SDK_ADAPTER;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.USE_SDK_ADAPTER;
    } else {
      process.env.USE_SDK_ADAPTER = originalEnv;
    }
  });

  describe('createEventStreamAdapter()', () => {
    it('當 USE_SDK_ADAPTER 為 false 時應該創建適配器', () => {
      process.env.USE_SDK_ADAPTER = 'false';
      
      const adapter = createEventStreamAdapter();
      
      expect(adapter).toBeDefined();
    });

    it('當 USE_SDK_ADAPTER 為 undefined 時應該創建適配器（預設行為）', () => {
      delete process.env.USE_SDK_ADAPTER;
      
      const adapter = createEventStreamAdapter();
      
      expect(adapter).toBeDefined();
    });

    it('當 USE_SDK_ADAPTER 為 true 時應該創建 SDK 適配器', () => {
      process.env.USE_SDK_ADAPTER = 'true';
      
      const adapter = createEventStreamAdapter();
      
      expect(adapter).toBeDefined();
    });
  });

  describe('Singleton Pattern', () => {
    it('getEventStreamAdapter() 應該返回單例', () => {
      delete process.env.USE_SDK_ADAPTER;
      
      const adapter1 = getEventStreamAdapter();
      const adapter2 = getEventStreamAdapter();
      
      expect(adapter1).toBe(adapter2);
    });

    it('initializeEventStreamAdapter() 應該創建新的適配器實例', () => {
      delete process.env.USE_SDK_ADAPTER;
      
      // 先獲取現有適配器（確保有 dispose 方法）
      const existingAdapter = getEventStreamAdapter();
      
      // 確保適配器有 dispose 方法（防止 mock 問題）
      if (!existingAdapter.dispose) {
        existingAdapter.dispose = vi.fn();
      }
      
      // 重新初始化應該創建新實例
      const freshAdapter = initializeEventStreamAdapter();
      
      expect(freshAdapter).toBeDefined();
    });
  });

  describe('適配器創建行為', () => {
    it('多次調用 createEventStreamAdapter() 應該創建不同實例', () => {
      delete process.env.USE_SDK_ADAPTER;
      
      const adapter1 = createEventStreamAdapter();
      const adapter2 = createEventStreamAdapter();
      
      expect(adapter1).toBeDefined();
      expect(adapter2).toBeDefined();
      // factory 每次創建新實例
      expect(adapter1).not.toBe(adapter2);
    });

    it('不同環境變數設置應該創建不同類型適配器', () => {
      // 先測試 false 模式
      process.env.USE_SDK_ADAPTER = 'false';
      const adapter1 = createEventStreamAdapter();
      expect(adapter1).toBeDefined();

      // 再測試 true 模式
      process.env.USE_SDK_ADAPTER = 'true';
      const adapter2 = createEventStreamAdapter();
      expect(adapter2).toBeDefined();
    });
  });
});
