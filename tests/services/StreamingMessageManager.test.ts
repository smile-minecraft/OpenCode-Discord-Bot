/**
 * StreamingMessageManager Tests - 去重行為單元測試
 * @description 測試 StreamingMessageManager 的工具呼叫去重邏輯
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

// Mock ToolStateTracker
const mockTrackTool = vi.fn();
const mockStartTool = vi.fn();
const mockCompleteTool = vi.fn();
const mockErrorTool = vi.fn();
const mockGetSessionTools = vi.fn();
const mockClearSessionTools = vi.fn();
const mockGetTool = vi.fn();

vi.mock('../../src/services/ToolStateTracker.js', () => ({
  getToolStateTracker: () => ({
    trackTool: mockTrackTool,
    startTool: mockStartTool,
    completeTool: mockCompleteTool,
    errorTool: mockErrorTool,
    getSessionTools: mockGetSessionTools,
    clearSessionTools: mockClearSessionTools,
    getTool: mockGetTool,
  }),
}));

// Mock ThreadManager
vi.mock('../../src/services/ThreadManager.js', () => ({
  getThreadManager: () => ({
    getThreadIdBySessionId: vi.fn().mockReturnValue(null),
  }),
}));

// Import after mocking
import {
  StreamingMessageManager,
  ToolUpdateEventData,
} from '../../src/services/StreamingMessageManager';

describe('StreamingMessageManager - 工具呼叫去重', () => {
  let manager: StreamingMessageManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new StreamingMessageManager();

    // Mock Discord Client
    const mockClient = {
      channels: {
        fetch: vi.fn().mockResolvedValue(null),
      },
    } as any;
    manager.setDiscordClient(mockClient);

    // Reset all tool-related maps by accessing private state
    const privateState = manager as any;
    privateState.activeStreams = new Map();
    privateState.toolUpdateQueue = new Map();
    privateState.toolMessageMap = new Map();
    privateState.toolTrackingDedup = new Map();
    privateState.sessionIdToOpenCodeId = new Map();
    privateState.openCodeIdToSessionId = new Map();
  });

  afterEach(() => {
    manager.stopToolUpdateLoop();
    vi.restoreAllMocks();
  });

  describe('toolTrackingDedup 去重映射', () => {
    it('同一 sessionId+requestId 的 pending 事件不應重複追蹤', async () => {
      // 建立一個測試用的串流 session
      const streamKey = 'channel-1:session-dedup-1';
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue({
            send: vi.fn().mockResolvedValue({ id: 'msg-1' }),
            sendTyping: vi.fn().mockResolvedValue(undefined),
          }),
        },
      } as any;
      manager.setDiscordClient(mockClient);

      const privateState = manager as any;
      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-dedup-1',
        channelId: 'channel-1',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      // Mock trackTool 返回相同的 toolId（模擬重複請求）
      mockTrackTool.mockReturnValueOnce({
        id: 'tool-abc123',
        toolName: 'Read',
        status: 'pending',
      });

      // 第一個 tool_request (pending)
      const toolEvent1: ToolUpdateEventData = {
        sessionId: 'session-dedup-1',
        toolName: 'Read',
        requestId: 'call-abc123',
        status: 'pending',
        args: { path: '/test.txt' },
      };

      // 透過私有方法間接觸發（因為 handleToolRequestEvent 是 private）
      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);
      handleToolRequestEvent(toolEvent1);

      // 第一次呼叫應該成功追蹤
      expect(mockTrackTool).toHaveBeenCalledTimes(1);
      expect(mockTrackTool).toHaveBeenCalledWith('session-dedup-1', 'Read', { path: '/test.txt' });

      // 重置 mock 以驗證第二次不會呼叫
      mockTrackTool.mockClear();

      // 第二個相同的 tool_request (pending) - 不應再次追蹤
      const toolEvent2: ToolUpdateEventData = {
        sessionId: 'session-dedup-1',
        toolName: 'Read',
        requestId: 'call-abc123',
        status: 'pending',
        args: { path: '/test.txt' },
      };

      handleToolRequestEvent(toolEvent2);

      // 第二次不應呼叫 trackTool（已去重）
      expect(mockTrackTool).not.toHaveBeenCalled();
    });

    it('無 requestId 時，相同 args 在時間窗口內應去重', async () => {
      const privateState = manager as any;
      const streamKey = 'channel-2:session-dedup-2';
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-dedup-2',
        channelId: 'channel-2',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      // 第一次調用：無既有工具，建立新追蹤
      mockTrackTool.mockReturnValueOnce({
        id: 'tool-no-req-id-1',
        toolName: 'Bash',
        status: 'pending',
      });

      // 第一個無 requestId 的 tool_request
      const toolEvent1: ToolUpdateEventData = {
        sessionId: 'session-dedup-2',
        toolName: 'Bash',
        // requestId 缺失
        status: 'pending',
        args: { command: 'ls' },
      };

      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);
      handleToolRequestEvent(toolEvent1);

      expect(mockTrackTool).toHaveBeenCalledTimes(1);

      mockTrackTool.mockClear();

      // 模擬已存在的工具（在時間窗口內）
      mockGetSessionTools.mockReturnValueOnce([{
        id: 'tool-no-req-id-1',
        toolName: 'Bash',
        status: 'pending',
        args: { command: 'ls' },
        startedAt: Date.now(), // 剛剛創建，在 5 秒窗口內
      }]);

      // 第二個相同的無 requestId 的 tool_request（相同 args，在時間窗口內）
      const toolEvent2: ToolUpdateEventData = {
        sessionId: 'session-dedup-2',
        toolName: 'Bash',
        status: 'pending',
        args: { command: 'ls' },
      };

      handleToolRequestEvent(toolEvent2);

      // 相同 args 在時間窗口內，應去重
      expect(mockTrackTool).not.toHaveBeenCalled();
    });

    it('不同 requestId 應視為不同工具呼叫', async () => {
      const privateState = manager as any;
      const streamKey = 'channel-3:session-dedup-3';
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-dedup-3',
        channelId: 'channel-3',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      mockTrackTool
        .mockReturnValueOnce({ id: 'tool-req-1', toolName: 'Read', status: 'pending' })
        .mockReturnValueOnce({ id: 'tool-req-2', toolName: 'Read', status: 'pending' });

      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);

      // 兩個不同 requestId 的 tool_request
      const toolEvent1: ToolUpdateEventData = {
        sessionId: 'session-dedup-3',
        toolName: 'Read',
        requestId: 'call-001',
        status: 'pending',
        args: { path: '/a.txt' },
      };

      const toolEvent2: ToolUpdateEventData = {
        sessionId: 'session-dedup-3',
        toolName: 'Read',
        requestId: 'call-002',
        status: 'pending',
        args: { path: '/b.txt' },
      };

      handleToolRequestEvent(toolEvent1);
      handleToolRequestEvent(toolEvent2);

      // 兩個不同的 requestId 應各自追蹤
      expect(mockTrackTool).toHaveBeenCalledTimes(2);
    });
  });

  describe('cleanupStream 清理 toolTrackingDedup', () => {
    it('cleanupStream 應清理該 session 的所有去重映射', () => {
      const privateState = manager as any;

      // 手動注入去重映射
      privateState.toolTrackingDedup.set('session-cleanup:req-1', 'tool-1');
      privateState.toolTrackingDedup.set('session-cleanup:req-2', 'tool-2');
      privateState.toolTrackingDedup.set('other-session:req-3', 'tool-3');

      // Mock ToolStateTracker
      mockClearSessionTools.mockClear();

      const cleanupStream = privateState.cleanupStream.bind(manager);
      cleanupStream('session-cleanup', 'channel-cleanup');

      // session-cleanup 的去重映射應被清理
      expect(privateState.toolTrackingDedup.has('session-cleanup:req-1')).toBe(false);
      expect(privateState.toolTrackingDedup.has('session-cleanup:req-2')).toBe(false);

      // 其他 session 的去重映射應保留
      expect(privateState.toolTrackingDedup.has('other-session:req-3')).toBe(true);
    });
  });

  describe('queueToolStateUpdate', () => {
    it('應正確將 toolId 加入佇列', () => {
      const privateState = manager as any;
      privateState.toolUpdateQueue = new Map();

      const queueToolStateUpdate = privateState.queueToolStateUpdate.bind(manager);
      queueToolStateUpdate('session-q1', 'tool-q1');
      queueToolStateUpdate('session-q1', 'tool-q2');

      expect(privateState.toolUpdateQueue.has('session-q1')).toBe(true);
      const toolIds = privateState.toolUpdateQueue.get('session-q1');
      expect(toolIds?.size).toBe(2);
      expect(toolIds?.has('tool-q1')).toBe(true);
      expect(toolIds?.has('tool-q2')).toBe(true);
    });
  });

  describe('handleToolRequestEvent - 狀態更新', () => {
    it('pending 狀態應呼叫 trackTool', () => {
      const privateState = manager as any;
      const streamKey = 'channel-status:session-status-1';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-status-1',
        channelId: 'channel-status',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      mockTrackTool.mockReturnValueOnce({
        id: 'tool-pending-1',
        toolName: 'Read',
        status: 'pending',
      });

      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);
      const toolEvent: ToolUpdateEventData = {
        sessionId: 'session-status-1',
        toolName: 'Read',
        requestId: 'req-pending-1',
        status: 'pending',
        args: {},
      };

      handleToolRequestEvent(toolEvent);

      expect(mockTrackTool).toHaveBeenCalledWith('session-status-1', 'Read', {});
    });

    it('running 狀態應呼叫 startTool', () => {
      const privateState = manager as any;
      const streamKey = 'channel-status:session-status-2';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-status-2',
        channelId: 'channel-status',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      // 模擬 pending 追蹤已記錄
      privateState.toolTrackingDedup.set('session-status-2:req-running-1', 'tool-running-1');

      mockGetSessionTools.mockReturnValueOnce([
        { id: 'tool-running-1', toolName: 'Bash', status: 'pending' },
      ]);

      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);
      const toolEvent: ToolUpdateEventData = {
        sessionId: 'session-status-2',
        toolName: 'Bash',
        requestId: 'req-running-1',
        status: 'running',
      };

      handleToolRequestEvent(toolEvent);

      expect(mockStartTool).toHaveBeenCalledWith('session-status-2', 'tool-running-1');
    });

    it('completed 狀態應呼叫 completeTool', () => {
      const privateState = manager as any;
      const streamKey = 'channel-status:session-status-3';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-status-3',
        channelId: 'channel-status',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      privateState.toolTrackingDedup.set('session-status-3:req-complete-1', 'tool-complete-1');

      mockGetSessionTools.mockReturnValueOnce([
        { id: 'tool-complete-1', toolName: 'Write', status: 'running' },
      ]);

      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);
      const toolEvent: ToolUpdateEventData = {
        sessionId: 'session-status-3',
        toolName: 'Write',
        requestId: 'req-complete-1',
        status: 'completed',
        result: { success: true },
      };

      handleToolRequestEvent(toolEvent);

      expect(mockCompleteTool).toHaveBeenCalledWith('session-status-3', 'tool-complete-1', { success: true });
    });

    it('error 狀態應呼叫 errorTool', () => {
      const privateState = manager as any;
      const streamKey = 'channel-status:session-status-4';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-status-4',
        channelId: 'channel-status',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      privateState.toolTrackingDedup.set('session-status-4:req-error-1', 'tool-error-1');

      mockGetSessionTools.mockReturnValueOnce([
        { id: 'tool-error-1', toolName: 'Read', status: 'running' },
      ]);

      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);
      const toolEvent: ToolUpdateEventData = {
        sessionId: 'session-status-4',
        toolName: 'Read',
        requestId: 'req-error-1',
        status: 'error',
        error: 'File not found',
      };

      handleToolRequestEvent(toolEvent);

      expect(mockErrorTool).toHaveBeenCalledWith('session-status-4', 'tool-error-1', 'File not found');
    });
  });

  describe('handleToolRequestEvent - running/completed/error 無 pending 時的追蹤', () => {
    it('running-first 無 pending 仍應建立追蹤並呼叫 startTool', () => {
      const privateState = manager as any;
      const streamKey = 'channel-rs:session-rs-1';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-rs-1',
        channelId: 'channel-rs',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      // 沒有任何既有工具，session 工具列表為空
      mockGetSessionTools.mockReturnValueOnce([]);
      mockTrackTool.mockReturnValueOnce({
        id: 'tool-running-new',
        toolName: 'Bash',
        status: 'pending',
      });

      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);
      const toolEvent: ToolUpdateEventData = {
        sessionId: 'session-rs-1',
        toolName: 'Bash',
        requestId: 'call-running-first',
        status: 'running',
        args: { command: 'echo hello' },
      };

      handleToolRequestEvent(toolEvent);

      // 應建立新追蹤
      expect(mockTrackTool).toHaveBeenCalledWith('session-rs-1', 'Bash', { command: 'echo hello' });
      expect(mockStartTool).toHaveBeenCalledWith('session-rs-1', 'tool-running-new');
    });

    it('completed-first 無 pending 仍應建立追蹤並呼叫 completeTool', () => {
      const privateState = manager as any;
      const streamKey = 'channel-cs:session-cs-1';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-cs-1',
        channelId: 'channel-cs',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      // 沒有任何既有工具
      mockGetSessionTools.mockReturnValueOnce([]);
      mockTrackTool.mockReturnValueOnce({
        id: 'tool-completed-new',
        toolName: 'Read',
        status: 'pending',
      });

      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);
      const toolEvent: ToolUpdateEventData = {
        sessionId: 'session-cs-1',
        toolName: 'Read',
        requestId: 'call-completed-first',
        status: 'completed',
        result: { content: 'Hello World' },
      };

      handleToolRequestEvent(toolEvent);

      // 應建立新追蹤並直接標記完成
      expect(mockTrackTool).toHaveBeenCalledWith('session-cs-1', 'Read', {});
      expect(mockCompleteTool).toHaveBeenCalledWith('session-cs-1', 'tool-completed-new', { content: 'Hello World' });
    });

    it('同名工具但不同 args（無 requestId）不應被錯誤去重', () => {
      const privateState = manager as any;
      const streamKey = 'channel-dedup:session-dedup-args';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-dedup-args',
        channelId: 'channel-dedup',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      // 模擬第一次工具調用（Read file1.txt）
      mockTrackTool
        .mockReturnValueOnce({ id: 'tool-1', toolName: 'Read', status: 'pending', args: { path: '/file1.txt' }, startedAt: Date.now() });

      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);

      const firstEvent: ToolUpdateEventData = {
        sessionId: 'session-dedup-args',
        toolName: 'Read',
        // 無 requestId
        status: 'pending',
        args: { path: '/file1.txt' },
      };

      handleToolRequestEvent(firstEvent);
      expect(mockTrackTool).toHaveBeenCalledTimes(1);

      // 模擬第二次工具調用（Read file2.txt - 不同 args）
      mockTrackTool.mockClear();
      mockTrackTool
        .mockReturnValueOnce({ id: 'tool-2', toolName: 'Read', status: 'pending', args: { path: '/file2.txt' }, startedAt: Date.now() });

      const secondEvent: ToolUpdateEventData = {
        sessionId: 'session-dedup-args',
        toolName: 'Read',
        // 無 requestId
        status: 'pending',
        args: { path: '/file2.txt' },
      };

      handleToolRequestEvent(secondEvent);

      // 不同 args，應各自追蹤
      expect(mockTrackTool).toHaveBeenCalledTimes(1);
      expect(mockTrackTool).toHaveBeenCalledWith('session-dedup-args', 'Read', { path: '/file2.txt' });
    });

    it('同名工具且相同 args（無 requestId）在短時間窗口內應去重', () => {
      const privateState = manager as any;
      const streamKey = 'channel-window:session-window';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-window',
        channelId: 'channel-window',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      // 第一次調用，無既有工具，建立新追蹤
      mockTrackTool.mockReturnValueOnce({
        id: 'tool-window-1',
        toolName: 'Glob',
        status: 'pending',
        args: { pattern: '**/*.ts' },
        startedAt: Date.now(),
      });

      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);

      const firstEvent: ToolUpdateEventData = {
        sessionId: 'session-window',
        toolName: 'Glob',
        status: 'pending',
        args: { pattern: '**/*.ts' },
      };

      handleToolRequestEvent(firstEvent);
      expect(mockTrackTool).toHaveBeenCalledTimes(1);

      // 第二次相同工具、相同 args（在保守窗口 300ms 內）
      mockTrackTool.mockClear();
      
      // 模擬已存在的工具（在保守窗口內）
      mockGetSessionTools.mockReturnValueOnce([{
        id: 'tool-window-1',
        toolName: 'Glob',
        status: 'pending',
        args: { pattern: '**/*.ts' },
        startedAt: Date.now(), // 剛剛創建，在 300ms 保守窗口內
      }]);

      const secondEvent: ToolUpdateEventData = {
        sessionId: 'session-window',
        toolName: 'Glob',
        status: 'pending',
        args: { pattern: '**/*.ts' },
      };

      handleToolRequestEvent(secondEvent);

      // 相同 args 在保守窗口內，應去重
      expect(mockTrackTool).not.toHaveBeenCalled();
    });
  });

  describe('保守去重窗口邊界測試 (Momus Concern)', () => {
    it('a. 無 requestId 同名同args 在短窗內（<=300ms）應去重', () => {
      const privateState = manager as any;
      const streamKey = 'channel-boundary:session-boundary';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-boundary',
        channelId: 'channel-boundary',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      // 第一次調用
      mockTrackTool.mockReturnValueOnce({
        id: 'tool-boundary-1',
        toolName: 'Read',
        status: 'pending',
        args: { path: '/test.txt' },
        startedAt: Date.now(),
      });

      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);

      const firstEvent: ToolUpdateEventData = {
        sessionId: 'session-boundary',
        toolName: 'Read',
        status: 'pending',
        args: { path: '/test.txt' },
      };

      handleToolRequestEvent(firstEvent);
      expect(mockTrackTool).toHaveBeenCalledTimes(1);

      // 100ms 後第二次相同請求（在 300ms 窗口內）
      mockTrackTool.mockClear();
      mockGetSessionTools.mockReturnValueOnce([{
        id: 'tool-boundary-1',
        toolName: 'Read',
        status: 'pending',
        args: { path: '/test.txt' },
        startedAt: Date.now() - 100, // 100ms 前
      }]);

      handleToolRequestEvent(firstEvent);

      // 在窗口內，應去重
      expect(mockTrackTool).not.toHaveBeenCalled();
    });

    it('b. 無 requestId 同名同args 超過短窗（>300ms）應允許新調用', () => {
      const privateState = manager as any;
      const streamKey = 'channel-past:session-past';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-past',
        channelId: 'channel-past',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      // 模擬舊的工具（在 500ms 前創建，超過 300ms 窗口）
      mockGetSessionTools.mockReturnValueOnce([{
        id: 'tool-old',
        toolName: 'Read',
        status: 'pending',
        args: { path: '/old.txt' },
        startedAt: Date.now() - 500, // 500ms 前，超過保守窗口
      }]);

      mockTrackTool.mockReturnValueOnce({
        id: 'tool-new',
        toolName: 'Read',
        status: 'pending',
        args: { path: '/old.txt' },
        startedAt: Date.now(),
      });

      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);

      // 超過窗口的相同請求
      const pastEvent: ToolUpdateEventData = {
        sessionId: 'session-past',
        toolName: 'Read',
        status: 'pending',
        args: { path: '/old.txt' },
      };

      handleToolRequestEvent(pastEvent);

      // 超過保守窗口，應建立新的追蹤（合法重複呼叫）
      expect(mockTrackTool).toHaveBeenCalledTimes(1);
      expect(mockTrackTool).toHaveBeenCalledWith('session-past', 'Read', { path: '/old.txt' });
    });

    it('c. 舊新事件交錯（不同 args）不應被錯誤去重', () => {
      const privateState = manager as any;
      const streamKey = 'channel-interleave:session-interleave';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-interleave',
        channelId: 'channel-interleave',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      // 第一個工具 Read file1.txt
      mockTrackTool.mockReturnValueOnce({
        id: 'tool-interleave-1',
        toolName: 'Read',
        status: 'pending',
        args: { path: '/file1.txt' },
        startedAt: Date.now(),
      });

      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);

      const event1: ToolUpdateEventData = {
        sessionId: 'session-interleave',
        toolName: 'Read',
        status: 'pending',
        args: { path: '/file1.txt' },
      };

      handleToolRequestEvent(event1);
      expect(mockTrackTool).toHaveBeenCalledTimes(1);

      // 50ms 後，相同名稱但不同 args 的工具 Read file2.txt
      mockTrackTool.mockClear();
      mockGetSessionTools.mockReturnValueOnce([{
        id: 'tool-interleave-1',
        toolName: 'Read',
        status: 'pending',
        args: { path: '/file1.txt' },
        startedAt: Date.now() - 50,
      }]);

      mockTrackTool.mockReturnValueOnce({
        id: 'tool-interleave-2',
        toolName: 'Read',
        status: 'pending',
        args: { path: '/file2.txt' },
        startedAt: Date.now(),
      });

      const event2: ToolUpdateEventData = {
        sessionId: 'session-interleave',
        toolName: 'Read',
        status: 'pending',
        args: { path: '/file2.txt' }, // 不同 args
      };

      handleToolRequestEvent(event2);

      // 不同 args，應建立新追蹤
      expect(mockTrackTool).toHaveBeenCalledTimes(1);
      expect(mockTrackTool).toHaveBeenCalledWith('session-interleave', 'Read', { path: '/file2.txt' });
    });

    it('d. 同名併發不同 args 時 running/completed 應匹配到正確條目', () => {
      const privateState = manager as any;
      const streamKey = 'channel-concurrent:session-concurrent';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-concurrent',
        channelId: 'channel-concurrent',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      // 模擬兩個併發的工具調用（不同 args）
      const existingTools = [
        {
          id: 'tool-concurrent-1',
          toolName: 'Bash',
          status: 'pending',
          args: { command: 'echo A' },
          startedAt: Date.now(),
        },
        {
          id: 'tool-concurrent-2',
          toolName: 'Bash',
          status: 'pending',
          args: { command: 'echo B' },
          startedAt: Date.now(),
        },
      ];

      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);

      // 第一個 running 事件（command: echo A）
      mockGetSessionTools.mockReturnValueOnce(existingTools);
      mockStartTool.mockClear();

      const runningEvent1: ToolUpdateEventData = {
        sessionId: 'session-concurrent',
        toolName: 'Bash',
        status: 'running',
        args: { command: 'echo A' }, // 匹配第一個
      };

      handleToolRequestEvent(runningEvent1);

      // 應匹配到 tool-concurrent-1 並呼叫 startTool
      expect(mockStartTool).toHaveBeenCalledTimes(1);
      expect(mockStartTool).toHaveBeenCalledWith('session-concurrent', 'tool-concurrent-1');

      // 第二個 completed 事件（command: echo B）
      mockGetSessionTools.mockReturnValueOnce(existingTools);
      mockCompleteTool.mockClear();

      const completedEvent2: ToolUpdateEventData = {
        sessionId: 'session-concurrent',
        toolName: 'Bash',
        status: 'completed',
        args: { command: 'echo B' }, // 匹配第二個
        result: { output: 'B' },
      };

      handleToolRequestEvent(completedEvent2);

      // 應匹配到 tool-concurrent-2 並呼叫 completeTool
      expect(mockCompleteTool).toHaveBeenCalledTimes(1);
      expect(mockCompleteTool).toHaveBeenCalledWith('session-concurrent', 'tool-concurrent-2', { output: 'B' });
    });

    it('e. 狀態演進：pending -> running -> completed 應正確匹配到同一工具', () => {
      const privateState = manager as any;
      const streamKey = 'channel-progression:session-progression';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-progression',
        channelId: 'channel-progression',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);
      const args = { path: '/progress.txt' };

      // Step 1: pending 事件
      mockTrackTool.mockReturnValueOnce({
        id: 'tool-progress',
        toolName: 'Read',
        status: 'pending',
        args,
        startedAt: Date.now(),
      });

      const pendingEvent: ToolUpdateEventData = {
        sessionId: 'session-progression',
        toolName: 'Read',
        status: 'pending',
        args,
      };

      handleToolRequestEvent(pendingEvent);
      expect(mockTrackTool).toHaveBeenCalledTimes(1);

      // Step 2: running 事件（無 requestId，應匹配到 pending 工具）
      mockTrackTool.mockClear();
      mockStartTool.mockClear();
      mockGetSessionTools.mockReturnValueOnce([{
        id: 'tool-progress',
        toolName: 'Read',
        status: 'pending',
        args,
        startedAt: Date.now(),
      }]);

      const runningEvent: ToolUpdateEventData = {
        sessionId: 'session-progression',
        toolName: 'Read',
        status: 'running',
        args, // 相同 args
      };

      handleToolRequestEvent(runningEvent);
      expect(mockStartTool).toHaveBeenCalledTimes(1);
      expect(mockStartTool).toHaveBeenCalledWith('session-progression', 'tool-progress');
      expect(mockTrackTool).not.toHaveBeenCalled(); // 不應建立新追蹤

      // Step 3: completed 事件（應匹配到 running 工具）
      mockStartTool.mockClear();
      mockCompleteTool.mockClear();
      mockGetSessionTools.mockReturnValueOnce([{
        id: 'tool-progress',
        toolName: 'Read',
        status: 'running',
        args,
        startedAt: Date.now(),
      }]);

      const completedEvent: ToolUpdateEventData = {
        sessionId: 'session-progression',
        toolName: 'Read',
        status: 'completed',
        args,
        result: { content: 'Hello' },
      };

      handleToolRequestEvent(completedEvent);
      expect(mockCompleteTool).toHaveBeenCalledTimes(1);
      expect(mockCompleteTool).toHaveBeenCalledWith('session-progression', 'tool-progress', { content: 'Hello' });
      expect(mockTrackTool).not.toHaveBeenCalled(); // 不應建立新追蹤
    });

    it('f. 不同工具的 completed 事件不應被錯誤匹配', () => {
      const privateState = manager as any;
      const streamKey = 'channel-difftool:session-difftool';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-difftool',
        channelId: 'channel-difftool',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);

      // 模擬 Read 工具處於 pending 狀態
      mockGetSessionTools.mockReturnValueOnce([{
        id: 'tool-read-1',
        toolName: 'Read',
        status: 'pending',
        args: { path: '/file.txt' },
        startedAt: Date.now(),
      }]);

      mockTrackTool.mockReturnValueOnce({
        id: 'tool-write-new',
        toolName: 'Write',
        status: 'pending',
        args: { path: '/output.txt' },
        startedAt: Date.now(),
      });

      // Write 的 completed 事件（不應匹配到 Read）
      const writeCompleted: ToolUpdateEventData = {
        sessionId: 'session-difftool',
        toolName: 'Write', // 不同的工具名稱
        status: 'completed',
        args: { path: '/output.txt' },
        result: { success: true },
      };

      handleToolRequestEvent(writeCompleted);

      // 應建立新的 Write 追蹤，而非匹配到 Read
      expect(mockTrackTool).toHaveBeenCalledTimes(1);
      expect(mockTrackTool).toHaveBeenCalledWith('session-difftool', 'Write', { path: '/output.txt' });
      expect(mockCompleteTool).toHaveBeenCalledWith('session-difftool', 'tool-write-new', { success: true });
    });
  });
});
