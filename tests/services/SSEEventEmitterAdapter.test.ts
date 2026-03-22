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

    it('question.asked 應該支援 sessionID + questions[] payload', async () => {
      const event: SDKEvent = {
        type: 'question.asked',
        properties: {
          id: 'q-top-level',
          sessionID: 'session-xyz',
          questions: [
            {
              id: 'q-1',
              text: '請選擇下一步',
              options: [
                { label: '繼續', value: 'continue' },
                { label: '停止', value: 'stop' },
              ],
            },
          ],
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const handler = vi.fn();
      adapter.on('question', handler);

      adapter.start(mockEventStream, 'session-fallback');

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled();
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'question',
          data: expect.objectContaining({
            sessionId: 'session-xyz',
            questionId: 'q-1',
            text: '請選擇下一步',
            options: expect.arrayContaining([
              expect.objectContaining({ label: '繼續', value: 'continue' }),
            ]),
          }),
        })
      );
    });

    it('question options 應該支援 title/name/id 欄位', async () => {
      const event: SDKEvent = {
        type: 'question.asked',
        properties: {
          sessionID: 'session-abc',
          questions: [
            {
              id: 'q-2',
              title: '要執行哪個操作？',
              choices: [
                { title: '讀檔', id: 'read' },
                { name: '搜尋', value: 'glob' },
              ],
            },
          ],
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const handler = vi.fn();
      adapter.on('question', handler);

      adapter.start(mockEventStream, 'session-fallback');

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled();
      });

      const call = handler.mock.calls[0][0];
      expect(call.data.options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: '讀檔', value: 'read' }),
          expect.objectContaining({ label: '搜尋', value: 'glob' }),
        ])
      );
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

    it('session.idle 應該映射到 waiting 事件', async () => {
      // 加入第二個事件防止流立即結束觸發 session_complete
      const events: SDKEvent[] = [
        { type: 'session.idle', properties: { session_id: 'session-123' } },
        { type: 'message.created', properties: { session_id: 'session-123', content: 'dummy' } },
      ];
      
      const mockEventStream = createMockEventStream(events);
      const waitingHandler = vi.fn();
      const completeHandler = vi.fn();
      adapter.on('waiting', waitingHandler);
      adapter.on('session_complete', completeHandler);
      
      adapter.start(mockEventStream, 'session-123');
      
      await vi.waitFor(() => {
        expect(waitingHandler).toHaveBeenCalled();
      });
      
      // session.idle 映射到 waiting，不應直接映射到 session_complete
      // (session_complete 只應在流結束後觸發)
      expect(waitingHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'waiting',
          data: expect.objectContaining({ sessionId: 'session-123' }),
        })
      );
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

  describe('message.part.updated / message.part.delta tool part 轉換', () => {
    it('message.part.updated 附帶 tool part 應觸發 tool_request 事件', async () => {
      const event: SDKEvent = {
        type: 'message.part.updated',
        properties: {
          session_id: 'session-tool-1',
          part: {
            type: 'tool',
            id: 'call-abc123',
            tool: 'Read',
            state: {
              status: 'running',
              input: { path: '/test.txt' },
            },
          },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-tool-1');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      expect(toolHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_request',
          data: expect.objectContaining({
            sessionId: 'session-tool-1',
            toolName: 'Read',
            args: { path: '/test.txt' },
            requestId: 'call-abc123',
            status: 'running',
          }),
        })
      );
    });

    it('tool part 應從 props.info.part 來源提取資料', async () => {
      const event: SDKEvent = {
        type: 'message.part.delta',
        properties: {
          sessionId: 'session-tool-2',
          info: {
            part: {
              type: 'tool',
              call_id: 'call-xyz789',
              tool: 'Bash',
              state: {
                status: 'completed',
                input: { command: 'ls -la' },
                output: 'total 12\n-rw-r-- 1 user user 120 Mar 20 10:00 test.txt',
              },
            },
          },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-tool-2');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.toolName).toBe('Bash');
      expect(call.data.args).toEqual({ command: 'ls -la' });
      expect(call.data.requestId).toBe('call-xyz789');
      expect(call.data.status).toBe('completed');
      expect(call.data.result).toBe('total 12\n-rw-r-- 1 user user 120 Mar 20 10:00 test.txt');
    });

    it('tool part 應從 props.info.parts[] 來源提取資料', async () => {
      const event: SDKEvent = {
        type: 'message.part.updated',
        properties: {
          sessionId: 'session-tool-3',
          info: {
            parts: [
              { type: 'text', text: 'Some text before' },
              { type: 'tool', id: 'call-def456', tool: 'Glob', state: { status: 'pending', input: { pattern: '**/*.ts' } } },
              { type: 'text', text: 'Some text after' },
            ],
          },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      const messageHandler = vi.fn();
      adapter.on('tool_request', toolHandler);
      adapter.on('message', messageHandler);

      adapter.start(mockEventStream, 'session-tool-3');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      // tool_request 應該被觸發，且不發送 message
      expect(toolHandler).toHaveBeenCalledTimes(1);
      const toolCall = toolHandler.mock.calls[0][0];
      expect(toolCall.data.toolName).toBe('Glob');
      expect(toolCall.data.args).toEqual({ pattern: '**/*.ts' });
      expect(toolCall.data.requestId).toBe('call-def456');
      expect(toolCall.data.status).toBe('pending');
    });

    it('tool part 狀態為 error 時應包含 error 欄位', async () => {
      const event: SDKEvent = {
        type: 'message.part.updated',
        properties: {
          session_id: 'session-tool-4',
          part: {
            type: 'tool',
            id: 'call-err001',
            tool: 'Write',
            state: {
              status: 'error',
              input: { path: '/nonexistent/file.txt', content: 'data' },
              error: 'ENOENT: no such file or directory',
            },
          },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-tool-4');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.status).toBe('error');
      expect(call.data.error).toBe('ENOENT: no such file or directory');
      expect(call.data.result).toBeUndefined();
    });

    it('tool part 無 input 時 args 應為空物件', async () => {
      const event: SDKEvent = {
        type: 'message.part.updated',
        properties: {
          sessionId: 'session-tool-5',
          part: {
            type: 'tool',
            tool: 'SomeTool',
            state: {
              status: 'completed',
              output: 'done',
            },
          },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-tool-5');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      expect(toolHandler.mock.calls[0][0].data.args).toEqual({});
    });

    it('message.part.removed 應被靜默忽略，不發送 tool_request', async () => {
      const event: SDKEvent = {
        type: 'message.part.removed',
        properties: {
          session_id: 'session-tool-6',
          part: {
            type: 'tool',
            id: 'call-removed',
            tool: 'Read',
            state: { status: 'completed' },
          },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      const messageHandler = vi.fn();
      adapter.on('tool_request', toolHandler);
      adapter.on('message', messageHandler);

      adapter.start(mockEventStream, 'session-tool-6');

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(toolHandler).not.toHaveBeenCalled();
      expect(messageHandler).not.toHaveBeenCalled();
    });

    it('非 tool part 應正常發送 message 事件', async () => {
      const event: SDKEvent = {
        type: 'message.part.updated',
        properties: {
          session_id: 'session-tool-7',
          part: {
            type: 'text',
            text: 'Hello from tool context',
          },
        },
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      const messageHandler = vi.fn();
      adapter.on('tool_request', toolHandler);
      adapter.on('message', messageHandler);

      adapter.start(mockEventStream, 'session-tool-7');

      await vi.waitFor(() => {
        expect(messageHandler).toHaveBeenCalled();
      });

      expect(toolHandler).not.toHaveBeenCalled();
      expect(messageHandler.mock.calls[0][0].data.content).toBe('Hello from tool context');
    });

    it('message.part.delta 附帶 tool part（於 props.delta）應觸發 tool_request', async () => {
      const event: SDKEvent = {
        type: 'message.part.delta',
        properties: {
          session_id: 'session-delta-1',
          delta: {
            type: 'tool',
            call_id: 'call-delta001',
            tool: 'Search',
            state: {
              status: 'running',
              input: { query: 'opencode discord bot' },
            },
          },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-delta-1');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.toolName).toBe('Search');
      expect(call.data.args).toEqual({ query: 'opencode discord bot' });
      expect(call.data.requestId).toBe('call-delta001');
      expect(call.data.status).toBe('running');
    });

    it('tool part 應支援 tool_name / toolName / name 欄位 fallback', async () => {
      const testCases = [
        { field: 'tool_name', value: 'ToolViaToolName', expected: 'ToolViaToolName' },
        { field: 'toolName', value: 'ToolViaToolNameCamel', expected: 'ToolViaToolNameCamel' },
        { field: 'name', value: 'ToolViaNameField', expected: 'ToolViaNameField' },
      ];

      for (const tc of testCases) {
        vi.clearAllMocks();
        const adapterForTest = new SSEEventEmitterAdapter();

        const event: SDKEvent = {
          type: 'message.part.updated',
          properties: {
            session_id: `session-name-fallback-${tc.field}`,
            part: {
              type: 'tool',
              id: `call-${tc.field}`,
              [tc.field]: tc.value,
              state: { status: 'pending' },
            },
          } as any,
        };

        const mockEventStream = createMockEventStream([event]);
        const toolHandler = vi.fn();
        adapterForTest.on('tool_request', toolHandler);
        adapterForTest.start(mockEventStream, `session-name-fallback-${tc.field}`);

        await vi.waitFor(() => {
          expect(toolHandler).toHaveBeenCalled();
        });

        expect(toolHandler.mock.calls[0][0].data.toolName).toBe(tc.expected);
        adapterForTest.dispose();
      }
    });

    it('tool_call_end 事件應正確映射 completed 狀態', async () => {
      const event: SDKEvent = {
        type: 'tool_call_end',
        properties: {
          session_id: 'session-tool-end-1',
          tool_name: 'Read',
          request_id: 'req-end-001',
          result: { content: 'file contents here' },
        },
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-tool-end-1');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.status).toBe('completed');
      expect(call.data.result).toEqual({ content: 'file contents here' });
    });

    it('tool_call_end 事件攜帶 error 欄位時應映射為 error 狀態', async () => {
      const event: SDKEvent = {
        type: 'tool_call_end',
        properties: {
          session_id: 'session-tool-end-2',
          tool_name: 'Write',
          request_id: 'req-end-002',
          error: 'EACCES: permission denied',
        },
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-tool-end-2');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.status).toBe('error');
      expect(call.data.error).toBe('EACCES: permission denied');
    });

    it('tool_call_end 狀態應從 state.error 推斷為 error（無 props.error 時）', async () => {
      const event: SDKEvent = {
        type: 'tool_call_end',
        properties: {
          session_id: 'session-tool-end-3',
          tool_name: 'Bash',
          request_id: 'req-end-003',
          status: 'error',
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-tool-end-3');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.status).toBe('error');
    });

    it('state.tool / state.tool_name 應作為 toolName 的最後 fallback', async () => {
      const event: SDKEvent = {
        type: 'message.part.updated',
        properties: {
          session_id: 'session-state-fallback',
          part: {
            type: 'tool',
            id: 'call-state-fb',
            state: {
              tool: 'ToolFromStateTool',
              status: 'running',
            },
          },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-state-fallback');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      expect(toolHandler.mock.calls[0][0].data.toolName).toBe('ToolFromStateTool');
    });
  });

  describe('工具 args 增強提取', () => {
    it('state.args 應作為 args 的來源', async () => {
      const event: SDKEvent = {
        type: 'message.part.updated',
        properties: {
          session_id: 'session-args-1',
          part: {
            type: 'tool',
            id: 'call-args-1',
            tool: 'Read',
            state: {
              status: 'running',
              args: { path: '/test.txt', encoding: 'utf-8' },
            },
          },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-args-1');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      expect(toolHandler.mock.calls[0][0].data.args).toEqual({ path: '/test.txt', encoding: 'utf-8' });
    });

    it('state.arguments 應作為 args 的來源', async () => {
      const event: SDKEvent = {
        type: 'message.part.updated',
        properties: {
          session_id: 'session-args-2',
          part: {
            type: 'tool',
            id: 'call-args-2',
            tool: 'Write',
            state: {
              status: 'running',
              arguments: { path: '/output.txt', content: 'Hello World' },
            },
          },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-args-2');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      expect(toolHandler.mock.calls[0][0].data.args).toEqual({ path: '/output.txt', content: 'Hello World' });
    });

    it('state.parameters 應作為 args 的來源', async () => {
      const event: SDKEvent = {
        type: 'message.part.updated',
        properties: {
          session_id: 'session-args-3',
          part: {
            type: 'tool',
            id: 'call-args-3',
            tool: 'Bash',
            state: {
              status: 'running',
              parameters: { command: 'ls -la', cwd: '/home' },
            },
          },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-args-3');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      expect(toolHandler.mock.calls[0][0].data.args).toEqual({ command: 'ls -la', cwd: '/home' });
    });

    it('string JSON 格式的 args 應該被解析', async () => {
      const event: SDKEvent = {
        type: 'message.part.updated',
        properties: {
          session_id: 'session-args-4',
          part: {
            type: 'tool',
            id: 'call-args-4',
            tool: 'Glob',
            state: {
              status: 'running',
              input: '{"pattern":"**/*.ts","cwd":"/project"}',
            },
          },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-args-4');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      expect(toolHandler.mock.calls[0][0].data.args).toEqual({ pattern: '**/*.ts', cwd: '/project' });
    });

    it('part.input 應該作為 args 的 fallback', async () => {
      const event: SDKEvent = {
        type: 'message.part.updated',
        properties: {
          session_id: 'session-args-5',
          part: {
            type: 'tool',
            id: 'call-args-5',
            tool: 'Edit',
            // state 為空，但 part.input 有值
            input: { path: '/file.ts', oldText: 'foo', newText: 'bar' },
            state: {
              status: 'running',
            },
          },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-args-5');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      expect(toolHandler.mock.calls[0][0].data.args).toEqual({ path: '/file.ts', oldText: 'foo', newText: 'bar' });
    });

    it('part.args 應該作為 args 的 fallback', async () => {
      const event: SDKEvent = {
        type: 'message.part.updated',
        properties: {
          session_id: 'session-args-6',
          part: {
            type: 'tool',
            id: 'call-args-6',
            tool: 'Search',
            // state.input 為空，但 part.args 有值
            args: { query: 'opencode bot', limit: 10 },
            state: {
              status: 'running',
              input: {},
            },
          },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-args-6');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      expect(toolHandler.mock.calls[0][0].data.args).toEqual({ query: 'opencode bot', limit: 10 });
    });

    it('part 上的 string JSON 應該被解析', async () => {
      const event: SDKEvent = {
        type: 'message.part.updated',
        properties: {
          session_id: 'session-args-7',
          part: {
            type: 'tool',
            id: 'call-args-7',
            tool: 'Read',
            // 整個 args 是 JSON 字串
            args: '{"path":"/config.json","encoding":"utf-8"}',
            state: {
              status: 'running',
            },
          },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-args-7');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      expect(toolHandler.mock.calls[0][0].data.args).toEqual({ path: '/config.json', encoding: 'utf-8' });
    });

    it('state.input 應該優先於 state.args', async () => {
      const event: SDKEvent = {
        type: 'message.part.updated',
        properties: {
          session_id: 'session-args-8',
          part: {
            type: 'tool',
            id: 'call-args-8',
            tool: 'Bash',
            state: {
              status: 'running',
              input: { command: 'ls' }, // 優先
              args: { command: 'echo' }, // 忽略
            },
          },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-args-8');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      expect(toolHandler.mock.calls[0][0].data.args).toEqual({ command: 'ls' });
    });
  });

  describe('legacy tool_request 事件 args/requestId/toolName 增強提取', () => {
    it('tool_request 應從 args 欄位提取參數', async () => {
      const event: SDKEvent = {
        type: 'tool_call',
        properties: {
          session_id: 'session-legacy-1',
          args: { path: '/src', pattern: '**/*.ts' },
          request_id: 'req-legacy-1',
          tool_name: 'Glob',
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-legacy-1');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.args).toEqual({ path: '/src', pattern: '**/*.ts' });
    });

    it('tool_request 應從 input 欄位提取參數', async () => {
      const event: SDKEvent = {
        type: 'tool_call',
        properties: {
          session_id: 'session-legacy-2',
          input: { content: 'Hello World', path: '/test.txt' },
          requestId: 'req-legacy-2',
          toolName: 'Write',
        },
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-legacy-2');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.args).toEqual({ content: 'Hello World', path: '/test.txt' });
    });

    it('tool_request 應從 JSON 字串解析 args', async () => {
      const event: SDKEvent = {
        type: 'tool_call',
        properties: {
          session_id: 'session-legacy-3',
          args: '{"command":"ls -la","cwd":"/home"}',
          request_id: 'req-legacy-3',
          tool_name: 'Bash',
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-legacy-3');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.args).toEqual({ command: 'ls -la', cwd: '/home' });
    });

    it('tool_request 應從 callID 欄位提取 requestId', async () => {
      const event: SDKEvent = {
        type: 'tool_call',
        properties: {
          session_id: 'session-legacy-4',
          callID: 'call-abc123',
          tool_name: 'Read',
          tool_args: { path: '/file.txt' },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-legacy-4');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.requestId).toBe('call-abc123');
    });

    it('tool_request 應從 call_id 欄位提取 requestId', async () => {
      const event: SDKEvent = {
        type: 'tool_call',
        properties: {
          session_id: 'session-legacy-5',
          call_id: 'call-xyz789',
          tool_name: 'Edit',
          args: {},
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-legacy-5');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.requestId).toBe('call-xyz789');
    });

    it('tool_request 應從 id 欄位提取 requestId', async () => {
      const event: SDKEvent = {
        type: 'tool_call',
        properties: {
          session_id: 'session-legacy-6',
          id: 'req-id-from-id',
          tool_name: 'Search',
          toolArgs: { query: 'test' },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-legacy-6');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.requestId).toBe('req-id-from-id');
    });

    it('tool_request 應從 callId 欄位提取 requestId', async () => {
      const event: SDKEvent = {
        type: 'tool_call',
        properties: {
          session_id: 'session-legacy-callId',
          callId: 'call-camel-123',
          tool_name: 'Read',
          tool_args: { path: '/file.txt' },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-legacy-callId');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.requestId).toBe('call-camel-123');
    });

    it('tool_request 應從 tool 欄位提取 toolName', async () => {
      const event: SDKEvent = {
        type: 'tool_call',
        properties: {
          session_id: 'session-legacy-7',
          tool: 'CustomTool',
          args: { param1: 'value1' },
          request_id: 'req-legacy-7',
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-legacy-7');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.toolName).toBe('CustomTool');
    });

    it('tool_request 應從 name 欄位提取 toolName', async () => {
      const event: SDKEvent = {
        type: 'tool_call',
        properties: {
          session_id: 'session-legacy-8',
          name: 'NamedTool',
          args: {},
          requestId: 'req-legacy-8',
        },
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-legacy-8');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.toolName).toBe('NamedTool');
    });

    it('tool_request 應從 arguments 欄位提取參數', async () => {
      const event: SDKEvent = {
        type: 'tool_call',
        properties: {
          session_id: 'session-legacy-9',
          arguments: { url: 'https://example.com', method: 'GET' },
          request_id: 'req-legacy-9',
          tool_name: 'WebFetch',
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-legacy-9');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.args).toEqual({ url: 'https://example.com', method: 'GET' });
    });

    it('tool_request 應從 parameters 欄位提取參數', async () => {
      const event: SDKEvent = {
        type: 'tool_call',
        properties: {
          session_id: 'session-legacy-10',
          parameters: { timeout: 5000, retries: 3 },
          request_id: 'req-legacy-10',
          tool_name: 'HTTP',
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-legacy-10');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.args).toEqual({ timeout: 5000, retries: 3 });
    });

    it('tool_request 參數白名單應有正確優先順序', async () => {
      // toolArgs 優先於 input
      const event: SDKEvent = {
        type: 'tool_call',
        properties: {
          session_id: 'session-legacy-11',
          toolArgs: { from: 'toolArgs' },
          input: { from: 'input' },
          args: { from: 'args' },
          request_id: 'req-legacy-11',
          tool_name: 'Test',
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-legacy-11');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      // toolArgs 應被使用（白名單順序）
      expect(call.data.args).toEqual({ from: 'toolArgs' });
    });

    it('tool_request 應可從 props.info 巢狀欄位提取參數', async () => {
      const event: SDKEvent = {
        type: 'tool_call',
        properties: {
          session_id: 'session-legacy-info-1',
          request_id: 'req-legacy-info-1',
          tool_name: 'Read',
          info: {
            input: { filePath: '/tmp/a.txt' },
          },
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-legacy-info-1');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.args).toEqual({ filePath: '/tmp/a.txt' });
    });

    it('tool_request 的非物件參數應保留為 value 包裝', async () => {
      const event: SDKEvent = {
        type: 'tool_call',
        properties: {
          session_id: 'session-legacy-value-1',
          request_id: 'req-legacy-value-1',
          tool_name: 'Read',
          input: '/tmp/a.txt',
        } as any,
      };

      const mockEventStream = createMockEventStream([event]);
      const toolHandler = vi.fn();
      adapter.on('tool_request', toolHandler);

      adapter.start(mockEventStream, 'session-legacy-value-1');

      await vi.waitFor(() => {
        expect(toolHandler).toHaveBeenCalled();
      });

      const call = toolHandler.mock.calls[0][0];
      expect(call.data.args).toEqual({ value: '/tmp/a.txt' });
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
