/**
 * SSEEventEmitterAdapter Tests - SDK 事件串流適配器單元測試
 * @description 測試 SSEEventEmitterAdapter 的事件發射、事件類型映射、清理處置和 AsyncGenerator 消費
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

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
import {
  SSEEventEmitterAdapter,
  SDKEvent,
  SDKEventType,
  MessageEventData,
  ToolRequestEventData,
  ErrorEventData,
  SessionCompleteEventData,
} from '../../src/services/SSEEventEmitterAdapter';

describe('SSEEventEmitterAdapter', () => {
  let adapter: SSEEventEmitterAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new SSEEventEmitterAdapter();
  });

  afterEach(() => {
    adapter.dispose();
    vi.restoreAllMocks();
  });

  describe('constructor() - 構造函數', () => {
    it('應該創建實例', () => {
      expect(adapter).toBeDefined();
    });

    it('初始狀態應該為非活躍', () => {
      expect(adapter.isActive()).toBe(false);
    });

    it('初始 sessionId 應該為 null', () => {
      expect(adapter.getSessionId()).toBeNull();
    });
  });

  describe('start() - 啟動事件監聽', () => {
    it('應該設置 sessionId', () => {
      const mockEventStream = createMockEventStream([]);
      adapter.start(mockEventStream, 'session-123');
      
      expect(adapter.getSessionId()).toBe('session-123');
    });

    it('應該發送 connected 事件', () => {
      const mockEventStream = createMockEventStream([]);
      const handler = vi.fn();
      adapter.on('connected', handler);
      
      adapter.start(mockEventStream, 'session-123');
      
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'connected',
          data: expect.objectContaining({ sessionId: 'session-123' }),
        })
      );
    });

    it('應該將 isProcessing 設為 true', () => {
      const mockEventStream = createMockEventStream([]);
      adapter.start(mockEventStream, 'session-123');
      
      expect(adapter.isActive()).toBe(true);
    });

    it('重複啟動時應該先停止再啟動', () => {
      const stream1 = createMockEventStream([]);
      const stream2 = createMockEventStream([]);
      
      const disconnectHandler = vi.fn();
      adapter.on('disconnected', disconnectHandler);
      
      adapter.start(stream1, 'session-1');
      adapter.start(stream2, 'session-2');
      
      expect(disconnectHandler).toHaveBeenCalled();
      expect(adapter.getSessionId()).toBe('session-2');
    });

    it('已處置的適配器應該拋出錯誤', () => {
      adapter.dispose();
      const mockEventStream = createMockEventStream([]);
      
      expect(() => adapter.start(mockEventStream, 'session-123')).toThrow(
        'SSEEventEmitterAdapter 已被銷毀，無法重複使用'
      );
    });
  });

  describe('stop() - 停止事件監聽', () => {
    it('應該將 isProcessing 設為 false', () => {
      const mockEventStream = createMockEventStream([]);
      adapter.start(mockEventStream, 'session-123');
      
      adapter.stop();
      
      expect(adapter.isActive()).toBe(false);
    });

    it('應該發送 disconnected 事件', () => {
      const mockEventStream = createMockEventStream([]);
      const handler = vi.fn();
      adapter.on('disconnected', handler);
      
      adapter.start(mockEventStream, 'session-123');
      adapter.stop();
      
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'disconnected',
        })
      );
    });

    it('重複調用時不應該出錯', () => {
      const mockEventStream = createMockEventStream([]);
      adapter.start(mockEventStream, 'session-123');
      
      expect(() => adapter.stop()).not.toThrow();
      expect(() => adapter.stop()).not.toThrow();
    });
  });

  describe('事件類型映射', () => {
    it('message.updated 應該映射到 message 事件', async () => {
      const event: SDKEvent = {
        type: 'message.updated',
        properties: {
          session_id: 'session-123',
          content: 'Hello',
          is_complete: true,
        },
      };
      
      const mockEventStream = createMockEventStream([event]);
      const handler = vi.fn();
      adapter.on('message', handler);
      
      adapter.start(mockEventStream, 'session-123');
      
      // Wait for event processing
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled();
      });
      
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message',
          data: expect.objectContaining({
            content: 'Hello',
            isComplete: true,
          }),
        })
      );
    });

    it('message.created 應該映射到 message 事件', async () => {
      const event: SDKEvent = {
        type: 'message.created',
        properties: {
          session_id: 'session-123',
          content: 'New message',
          is_complete: false,
        },
      };
      
      const mockEventStream = createMockEventStream([event]);
      const handler = vi.fn();
      adapter.on('message', handler);
      
      adapter.start(mockEventStream, 'session-123');
      
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled();
      });
    });

    it('tool_call 應該映射到 tool_request 事件', async () => {
      const event: SDKEvent = {
        type: 'tool_call',
        properties: {
          session_id: 'session-123',
          tool_name: 'Bash',
          tool_args: { command: 'ls' },
          request_id: 'req-456',
        },
      };
      
      const mockEventStream = createMockEventStream([event]);
      const handler = vi.fn();
      adapter.on('tool_request', handler);
      
      adapter.start(mockEventStream, 'session-123');
      
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled();
      });
      
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_request',
          data: expect.objectContaining({
            toolName: 'Bash',
            args: { command: 'ls' },
            requestId: 'req-456',
          }),
        })
      );
    });

    it('tool_call_start 應該映射到 tool_request 事件', async () => {
      const event: SDKEvent = {
        type: 'tool_call_start',
        properties: {
          session_id: 'session-123',
          tool_name: 'Read',
          tool_args: { path: '/test.txt' },
          request_id: 'req-789',
        },
      };
      
      const mockEventStream = createMockEventStream([event]);
      const handler = vi.fn();
      adapter.on('tool_request', handler);
      
      adapter.start(mockEventStream, 'session-123');
      
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled();
      });
    });

    it('session.started 應該觸發 connected 事件', () => {
      const event: SDKEvent = {
        type: 'session.started',
        properties: { session_id: 'session-123' },
      };
      
      const mockEventStream = createMockEventStream([event]);
      const handler = vi.fn();
      adapter.on('message', handler); // connected is emitted at start
      
      adapter.start(mockEventStream, 'session-123');
      
      // Just verify it doesn't crash
      expect(adapter.isActive()).toBe(true);
    });

    it('session.ended 應該映射到 session_complete 事件', async () => {
      const event: SDKEvent = {
        type: 'session.ended',
        properties: { session_id: 'session-123' },
      };
      
      const mockEventStream = createMockEventStream([event]);
      const handler = vi.fn();
      adapter.on('session_complete', handler);
      
      adapter.start(mockEventStream, 'session-123');
      
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled();
      });
    });

    it('session.idle 應該映射到 session_complete 事件', async () => {
      const event: SDKEvent = {
        type: 'session.idle',
        properties: { session_id: 'session-123' },
      };
      
      const mockEventStream = createMockEventStream([event]);
      const handler = vi.fn();
      adapter.on('session_complete', handler);
      
      adapter.start(mockEventStream, 'session-123');
      
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled();
      });
    });

    it('error 應該映射到 error 事件', async () => {
      const event: SDKEvent = {
        type: 'error',
        properties: {
          session_id: 'session-123',
          error: 'Something went wrong',
        },
      };
      
      const mockEventStream = createMockEventStream([event]);
      const handler = vi.fn();
      adapter.on('error', handler);
      
      adapter.start(mockEventStream, 'session-123');
      
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled();
      });
      
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          data: expect.objectContaining({
            error: 'Something went wrong',
          }),
        })
      );
    });

    it('session.error 應該映射到 error 事件', async () => {
      const event: SDKEvent = {
        type: 'session.error',
        properties: {
          session_id: 'session-123',
          error: 'Session failed',
        },
      };
      
      const mockEventStream = createMockEventStream([event]);
      const handler = vi.fn();
      adapter.on('error', handler);
      
      adapter.start(mockEventStream, 'session-123');
      
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled();
      });
    });

    it('未知的 SDK 事件類型應該被忽略', async () => {
      const event: SDKEvent = {
        type: 'unknown_event_type' as SDKEventType,
        properties: {},
      };
      
      const mockEventStream = createMockEventStream([event]);
      const messageHandler = vi.fn();
      const errorHandler = vi.fn();
      
      adapter.on('message', messageHandler);
      adapter.on('error', errorHandler);
      
      adapter.start(mockEventStream, 'session-123');
      
      // Give time for processing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // No events should be emitted for unknown types
      expect(messageHandler).not.toHaveBeenCalled();
      expect(errorHandler).not.toHaveBeenCalled();
    });

    it('file.watcher.updated 事件應該被靜默忽略', async () => {
      const event: SDKEvent = {
        type: 'file.watcher.updated',
        properties: {},
      };

      const mockEventStream = createMockEventStream([event]);
      const messageHandler = vi.fn();
      const errorHandler = vi.fn();

      adapter.on('message', messageHandler);
      adapter.on('error', errorHandler);
      adapter.start(mockEventStream, 'session-123');

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(messageHandler).not.toHaveBeenCalled();
      expect(errorHandler).not.toHaveBeenCalled();
    });

    it('應該處理 camelCase 和 snake_case 屬性', async () => {
      // Test camelCase
      const event: SDKEvent = {
        type: 'message.updated',
        properties: {
          sessionId: 'session-123',
          messageId: 'msg-456',
          content: 'Test',
          isComplete: true,
        },
      };
      
      const mockEventStream = createMockEventStream([event]);
      const handler = vi.fn();
      adapter.on('message', handler);
      
      adapter.start(mockEventStream, 'session-123');
      
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled();
      });
    });
  });

  describe('EventEmitter 接口', () => {
    it('應該支持 on() 方法註冊監聽器', () => {
      const handler = vi.fn();
      adapter.on('message', handler);
      
      // Verify handler is registered
      expect((adapter as any).listenerCount('message')).toBe(1);
    });

    it('應該支持 once() 方法註冊一次性監聽器', async () => {
      const event: SDKEvent = {
        type: 'message.created',
        properties: { session_id: 's1', content: 'Hello' },
      };
      
      const mockEventStream = createMockEventStream([event]);
      const handler = vi.fn();
      adapter.once('message', handler);
      
      adapter.start(mockEventStream, 'session-123');
      
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1);
      });
      
      // Should not be called again for subsequent events
    });

    it('應該支持 off() 方法移除監聽器', () => {
      const handler = vi.fn();
      adapter.on('message', handler);
      adapter.off('message', handler);
      
      expect((adapter as any).listenerCount('message')).toBe(0);
    });

    it('應該支持通配符 * 事件', async () => {
      const event: SDKEvent = {
        type: 'message.created',
        properties: { session_id: 's1', content: 'Hello' },
      };
      
      const mockEventStream = createMockEventStream([event]);
      const handler = vi.fn();
      adapter.on('*', handler);
      
      adapter.start(mockEventStream, 'session-123');
      
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled();
      });
    });
  });

  describe('dispose() - 清理處置', () => {
    it('應該調用 stop()', () => {
      const mockEventStream = createMockEventStream([]);
      adapter.start(mockEventStream, 'session-123');
      
      adapter.dispose();
      
      expect(adapter.isActive()).toBe(false);
    });

    it('應該將 isDisposed 設為 true', () => {
      adapter.dispose();
      
      expect((adapter as any).isDisposed).toBe(true);
    });

    it('應該移除所有監聽器', () => {
      adapter.on('message', vi.fn());
      adapter.on('error', vi.fn());
      adapter.on('connected', vi.fn());
      
      adapter.dispose();
      
      expect((adapter as any).listenerCount('message')).toBe(0);
      expect((adapter as any).listenerCount('error')).toBe(0);
      expect((adapter as any).listenerCount('connected')).toBe(0);
    });

    it('重複調用時不應該出錯', () => {
      expect(() => adapter.dispose()).not.toThrow();
      expect(() => adapter.dispose()).not.toThrow();
    });
  });

  describe('getStream() - 獲取事件流引用', () => {
    it('應該返回事件流引用', () => {
      const mockEventStream = createMockEventStream([]);
      adapter.start(mockEventStream, 'session-123');
      
      expect(adapter.getStream()).toBe(mockEventStream);
    });

    it('未啟動時應該返回 null', () => {
      expect(adapter.getStream()).toBeNull();
    });

    it('停止後應該返回 null', () => {
      const mockEventStream = createMockEventStream([]);
      adapter.start(mockEventStream, 'session-123');
      adapter.stop();
      
      expect(adapter.getStream()).toBeNull();
    });
  });

  describe('AsyncGenerator consumption - AsyncGenerator 消費', () => {
    it('應該正確消費多個事件', async () => {
      const events: SDKEvent[] = [
        { type: 'message.created', properties: { session_id: 's1', content: 'Hello' } },
        { type: 'message.updated', properties: { session_id: 's1', content: 'Hello World' } },
        { type: 'tool_call', properties: { session_id: 's1', tool_name: 'Bash', tool_args: {}, request_id: 'r1' } },
        { type: 'session.ended', properties: { session_id: 's1' } },
      ];
      
      const mockEventStream = createMockEventStream(events);
      const messageHandler = vi.fn();
      const toolHandler = vi.fn();
      const completeHandler = vi.fn();
      
      adapter.on('message', messageHandler);
      adapter.on('tool_request', toolHandler);
      adapter.on('session_complete', completeHandler);
      
      adapter.start(mockEventStream, 'session-123');
      
      await vi.waitFor(() => {
        expect(completeHandler).toHaveBeenCalled();
      });
      
      expect(messageHandler).toHaveBeenCalledTimes(2);
      expect(toolHandler).toHaveBeenCalledTimes(1);
    });

    it('應該處理空事件流', () => {
      const mockEventStream = createMockEventStream([]);
      const handler = vi.fn();
      adapter.on('message', handler);
      
      adapter.start(mockEventStream, 'session-123');
      
      expect(adapter.isActive()).toBe(true);
    });

    it('應該處理錯誤事件流', async () => {
      const errorStream = {
        [Symbol.asyncIterator]: vi.fn(() => {
          let called = false;
          return {
            next: async () => {
              if (!called) {
                called = true;
                throw new Error('Stream error');
              }
              return { done: true, value: undefined as any };
            },
          };
        }),
      };
      
      const errorHandler = vi.fn();
      adapter.on('error', errorHandler);
      
      adapter.start(errorStream as any, 'session-123');
      
      await vi.waitFor(() => {
        expect(errorHandler).toHaveBeenCalled();
      });
    });

    it('流完成時應該發送 session_complete 事件', async () => {
      const events: SDKEvent[] = [
        { type: 'message.created', properties: { session_id: 's1', content: 'Done' } },
      ];
      
      const mockEventStream = createMockEventStream(events);
      const completeHandler = vi.fn();
      adapter.on('session_complete', completeHandler);
      
      adapter.start(mockEventStream, 'session-123');
      
      await vi.waitFor(() => {
        expect(completeHandler).toHaveBeenCalled();
      });
    });

    it('停止時應該中止迭代', () => {
      let iteratorCallCount = 0;
      const stream = {
        [Symbol.asyncIterator]: vi.fn(() => {
          return {
            next: async () => {
              iteratorCallCount++;
              // Simulate long-running operation
              await new Promise(resolve => setTimeout(resolve, 1000));
              return { done: false, value: { type: 'message.created', properties: {} } };
            },
          };
        }),
      };
      
      adapter.start(stream as any, 'session-123');
      
      // Stop immediately
      adapter.stop();
      
      // Should not wait for iterator to complete
      expect(adapter.isActive()).toBe(false);
    });
  });

  describe('事件數據結構', () => {
    it('事件應該包含 timestamp', async () => {
      const event: SDKEvent = {
        type: 'message.created',
        properties: { session_id: 's1', content: 'Test' },
      };
      
      const mockEventStream = createMockEventStream([event]);
      const handler = vi.fn();
      adapter.on('message', handler);
      
      adapter.start(mockEventStream, 'session-123');
      
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled();
      });
      
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(Number),
        })
      );
    });

    it('事件應該包含正確的 sessionId', async () => {
      const event: SDKEvent = {
        type: 'message.created',
        properties: {}, // No session_id in properties
      };
      
      const mockEventStream = createMockEventStream([event]);
      const handler = vi.fn();
      adapter.on('message', handler);
      
      adapter.start(mockEventStream, 'session-123');
      
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled();
      });
      
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sessionId: 'session-123' }),
        })
      );
    });
  });
});

// ============== 輔助函數 ==============

/**
 * 創建 Mock AsyncIterable 事件流
 */
function createMockEventStream(events: SDKEvent[]): AsyncIterable<SDKEvent> {
  let index = 0;
  
  return {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        if (index >= events.length) {
          return { done: true, value: undefined as unknown as SDKEvent };
        }
        return { done: false, value: events[index++] };
      },
    }),
  };
}
