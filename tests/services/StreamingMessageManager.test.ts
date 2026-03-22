/**
 * StreamingMessageManager Tests - 去重行為單元測試
 * @description 測試 StreamingMessageManager 的工具呼叫去重邏輯、工具時間線編輯行為、args 格式化
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
    privateState.sessionMessageMap = new Map();
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

  describe('cleanupStream 清理 sessionMessageMap', () => {
    it('cleanupStream 應清理該 session 的 sessionMessageMap 和 toolTrackingDedup', () => {
      const privateState = manager as any;

      // 手動注入 sessionMessageMap
      privateState.sessionMessageMap.set('session-cleanup', 'msg-cleanup-1');
      privateState.sessionMessageMap.set('other-session', 'msg-other-1');

      // 手動注入去重映射
      privateState.toolTrackingDedup.set('session-cleanup:req-1', 'tool-1');
      privateState.toolTrackingDedup.set('other-session:req-2', 'tool-2');

      // Mock ToolStateTracker
      mockClearSessionTools.mockClear();

      const cleanupStream = privateState.cleanupStream.bind(manager);
      cleanupStream('session-cleanup', 'channel-cleanup');

      // session-cleanup 的 sessionMessageMap 應被清理
      expect(privateState.sessionMessageMap.has('session-cleanup')).toBe(false);
      // 其他 session 的 sessionMessageMap 應保留
      expect(privateState.sessionMessageMap.has('other-session')).toBe(true);

      // session-cleanup 的去重映射應被清理
      expect(privateState.toolTrackingDedup.has('session-cleanup:req-1')).toBe(false);
      // 其他 session 的去重映射應保留
      expect(privateState.toolTrackingDedup.has('other-session:req-2')).toBe(true);
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

    it('running 狀態帶非空 args 時應回填既有空 args', () => {
      const privateState = manager as any;
      const streamKey = 'channel-status:session-status-2b';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-status-2b',
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

      privateState.toolTrackingDedup.set('session-status-2b:req-running-2', 'tool-running-2');

      const existingTool = {
        id: 'tool-running-2',
        toolName: 'Read',
        status: 'pending',
        args: {},
        startedAt: Date.now(),
      };
      mockGetSessionTools.mockReturnValueOnce([existingTool]);

      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);
      const toolEvent: ToolUpdateEventData = {
        sessionId: 'session-status-2b',
        toolName: 'Read',
        requestId: 'req-running-2',
        status: 'running',
        args: { filePath: '/tmp/demo.txt' },
      };

      handleToolRequestEvent(toolEvent);

      expect(mockStartTool).toHaveBeenCalledWith('session-status-2b', 'tool-running-2');
      expect(existingTool.args).toEqual({ filePath: '/tmp/demo.txt' });
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

  describe('工具訊息格式 - 工具時間線（多行 inline code）', () => {
    it('工具時間線應為多行 inline code 格式，每個工具一行', async () => {
      const privateState = manager as any;
      const streamKey = 'channel-timeline:session-timeline-1';

      const mockChannel = {
        id: 'channel-timeline',
        send: vi.fn().mockResolvedValue({ id: 'msg-timeline-1', editable: true }),
        messages: { fetch: vi.fn().mockResolvedValue(null) },
        sendTyping: vi.fn().mockResolvedValue(undefined),
      };
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(mockChannel) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-timeline-1',
        channelId: 'channel-timeline',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      // 先用 handleToolRequestEvent 建立追蹤並加入佇列
      const handleToolRequestEvent = (manager as any).handleToolRequestEvent.bind(manager);
      const queueToolStateUpdate = privateState.queueToolStateUpdate.bind(manager);

      mockTrackTool.mockReturnValueOnce({ id: 'tool-1', toolName: 'Read', status: 'pending', args: { path: '/a.txt' }, startedAt: Date.now() });
      handleToolRequestEvent({ sessionId: 'session-timeline-1', toolName: 'Read', status: 'pending', args: { path: '/a.txt' } });
      queueToolStateUpdate('session-timeline-1', 'tool-1');

      mockTrackTool.mockReturnValueOnce({ id: 'tool-2', toolName: 'Bash', status: 'pending', args: { command: 'ls' }, startedAt: Date.now() });
      handleToolRequestEvent({ sessionId: 'session-timeline-1', toolName: 'Bash', status: 'running', args: { command: 'ls' } });
      queueToolStateUpdate('session-timeline-1', 'tool-2');

      mockTrackTool.mockReturnValueOnce({ id: 'tool-3', toolName: 'Write', status: 'pending', args: { path: '/b.txt' }, startedAt: Date.now() });
      handleToolRequestEvent({ sessionId: 'session-timeline-1', toolName: 'Write', status: 'completed', args: { path: '/b.txt' } });
      queueToolStateUpdate('session-timeline-1', 'tool-3');

      // Mock rateLimiter.enqueue 為同步執行
      const originalEnqueue = privateState.rateLimiter.enqueue;
      privateState.rateLimiter.enqueue = vi.fn().mockImplementation(async (fn: () => Promise<any>) => fn());

      // 直接 mock getChannel 返回 mockChannel
      const originalGetChannel = privateState.getChannel;
      privateState.getChannel = vi.fn().mockResolvedValue(mockChannel);

      // Mock getSessionTools 返回多個工具（每次 processToolUpdates 呼叫一次）
      mockGetSessionTools.mockReturnValueOnce([
        { id: 'tool-1', toolName: 'Read', status: 'pending', args: { path: '/a.txt' }, startedAt: Date.now() },
        { id: 'tool-2', toolName: 'Bash', status: 'running', args: { command: 'ls' }, startedAt: Date.now() },
        { id: 'tool-3', toolName: 'Write', status: 'completed', args: { path: '/b.txt' }, startedAt: Date.now() },
      ]);

      // 直接呼叫 processToolUpdates
      const processToolUpdates = (manager as any).processToolUpdates.bind(manager);
      await processToolUpdates();

      // 還原 mocks
      privateState.rateLimiter.enqueue = originalEnqueue;
      privateState.getChannel = originalGetChannel;

      // 驗證發送的訊息格式
      expect(mockChannel.send).toHaveBeenCalled();
      const sentContent = mockChannel.send.mock.calls[0][0].content;

      // 應該是三行，每行一個工具（帶狀態圖示）
      expect(sentContent).toContain('⏳ `Read');
      expect(sentContent).toContain('🔄 `Bash');
      expect(sentContent).toContain('✅ `Write');
      // 不應包含 fenced JSON（```）
      expect(sentContent).not.toContain('```');
    });

    it('有既有 messageId 時應編輯現有消息而非發送新消息', async () => {
      const privateState = manager as any;
      const streamKey = 'channel-edit:session-edit-1';

      const existingMessage = {
        id: 'msg-existing-1',
        editable: true,
        edit: vi.fn().mockResolvedValue({ id: 'msg-existing-1' }),
      };
      const mockChannel = {
        id: 'channel-edit',
        send: vi.fn().mockResolvedValue({ id: 'msg-new-1', editable: true }),
        messages: { fetch: vi.fn().mockResolvedValue(existingMessage) },
        sendTyping: vi.fn().mockResolvedValue(undefined),
      };
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(mockChannel) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-edit-1',
        channelId: 'channel-edit',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      // 預先設置 sessionMessageMap
      privateState.sessionMessageMap.set('session-edit-1', 'msg-existing-1');

      // 建立追蹤並加入佇列
      const queueToolStateUpdate = privateState.queueToolStateUpdate.bind(manager);
      queueToolStateUpdate('session-edit-1', 'tool-edit-1');

      // Mock rateLimiter.enqueue 為同步執行
      const originalEnqueue = privateState.rateLimiter.enqueue;
      privateState.rateLimiter.enqueue = vi.fn().mockImplementation(async (fn: () => Promise<any>) => fn());

      // 直接 mock getChannel 返回 mockChannel
      const originalGetChannel = privateState.getChannel;
      privateState.getChannel = vi.fn().mockResolvedValue(mockChannel);

      // Mock getSessionTools 返回工具
      mockGetSessionTools.mockReturnValueOnce([
        { id: 'tool-edit-1', toolName: 'Read', status: 'pending', args: { path: '/test.txt' }, startedAt: Date.now() },
      ]);

      // 直接呼叫 processToolUpdates
      const processToolUpdates = (manager as any).processToolUpdates.bind(manager);
      await processToolUpdates();

      // 還原 mocks
      privateState.rateLimiter.enqueue = originalEnqueue;
      privateState.getChannel = originalGetChannel;

      // 應該編輯現有消息
      expect(mockChannel.messages.fetch).toHaveBeenCalledWith('msg-existing-1');
      expect(existingMessage.edit).toHaveBeenCalled();
      // 不應發送新消息
      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it('無既有 messageId 時應發送新消息並存入 sessionMessageMap', async () => {
      const privateState = manager as any;
      const streamKey = 'channel-new:session-new-1';

      const mockChannel = {
        id: 'channel-new',
        send: vi.fn().mockResolvedValue({ id: 'msg-new-2', editable: true }),
        messages: { fetch: vi.fn().mockRejectedValue(new Error('Unknown message')) },
        sendTyping: vi.fn().mockResolvedValue(undefined),
      };
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(mockChannel) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-new-1',
        channelId: 'channel-new',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      // 建立追蹤並加入佇列
      const queueToolStateUpdate = privateState.queueToolStateUpdate.bind(manager);
      queueToolStateUpdate('session-new-1', 'tool-new-1');

      // Mock rateLimiter.enqueue 為同步執行
      const originalEnqueue = privateState.rateLimiter.enqueue;
      privateState.rateLimiter.enqueue = vi.fn().mockImplementation(async (fn: () => Promise<any>) => fn());

      // 直接 mock getChannel 返回 mockChannel
      const originalGetChannel = privateState.getChannel;
      privateState.getChannel = vi.fn().mockResolvedValue(mockChannel);

      // Mock getSessionTools 返回工具
      mockGetSessionTools.mockReturnValueOnce([
        { id: 'tool-new-1', toolName: 'Glob', status: 'running', args: { pattern: '**/*.ts' }, startedAt: Date.now() },
      ]);

      // 直接呼叫 processToolUpdates
      const processToolUpdates = (manager as any).processToolUpdates.bind(manager);
      await processToolUpdates();

      // 還原 mocks
      privateState.rateLimiter.enqueue = originalEnqueue;
      privateState.getChannel = originalGetChannel;

      // 應該發送新消息
      expect(mockChannel.send).toHaveBeenCalled();
      // sessionMessageMap 應更新
      expect(privateState.sessionMessageMap.get('session-new-1')).toBe('msg-new-2');
    });
  });

  describe('工具 args 格式化 - 支援多種類型', () => {
    function setupArgsTest(sessionId: string, channelId: string, toolId: string, toolName: string, args: unknown) {
      const privateState = manager as any;
      const streamKey = `${channelId}:${sessionId}`;

      const mockChannel = {
        id: channelId,
        send: vi.fn().mockResolvedValue({ id: `msg-${toolId}`, editable: true }),
        messages: { fetch: vi.fn().mockResolvedValue(null) },
        sendTyping: vi.fn().mockResolvedValue(undefined),
      };
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(mockChannel) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId,
        channelId,
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
      });

      const queueToolStateUpdate = privateState.queueToolStateUpdate.bind(manager);
      queueToolStateUpdate(sessionId, toolId);

      const originalEnqueue = privateState.rateLimiter.enqueue;
      privateState.rateLimiter.enqueue = vi.fn().mockImplementation(async (fn: () => Promise<any>) => fn());

      const originalGetChannel = privateState.getChannel;
      privateState.getChannel = vi.fn().mockResolvedValue(mockChannel);

      mockGetSessionTools.mockReturnValueOnce([
        { id: toolId, toolName, status: 'pending', args, startedAt: Date.now() },
      ]);

      return { privateState, mockChannel, originalEnqueue, originalGetChannel };
    }

    async function runProcessToolUpdates(privateState: any) {
      const processToolUpdates = (manager as any).processToolUpdates.bind(manager);
      await processToolUpdates();
    }

    function cleanup(privateState: any, originalEnqueue: any, originalGetChannel: any) {
      privateState.rateLimiter.enqueue = originalEnqueue;
      privateState.getChannel = originalGetChannel;
    }

    it('空 args 應顯示為 ()', async () => {
      const { privateState, mockChannel, originalEnqueue, originalGetChannel } = setupArgsTest(
        'session-args-empty', 'channel-args-empty', 'tool-args-empty', 'Bash', {}
      );
      await runProcessToolUpdates(privateState);
      cleanup(privateState, originalEnqueue, originalGetChannel);

      expect(mockChannel.send).toHaveBeenCalled();
      const sentContent = mockChannel.send.mock.calls[0][0].content;
      expect(sentContent).toBe('⏳ `Bash()`');
    });

    it('string args 應直接顯示為 ("value")，不轉成 {}', async () => {
      const { privateState, mockChannel, originalEnqueue, originalGetChannel } = setupArgsTest(
        'session-args-string', 'channel-args-string', 'tool-args-string', 'Read', '/path/to/file.txt'
      );
      await runProcessToolUpdates(privateState);
      cleanup(privateState, originalEnqueue, originalGetChannel);

      expect(mockChannel.send).toHaveBeenCalled();
      const sentContent = mockChannel.send.mock.calls[0][0].content;
      expect(sentContent).toBe('⏳ `Read("/path/to/file.txt")`');
      expect(sentContent).not.toContain('({})');
    });

    it('array args 應顯示為 ([N items])', async () => {
      const { privateState, mockChannel, originalEnqueue, originalGetChannel } = setupArgsTest(
        'session-args-array', 'channel-args-array', 'tool-args-array', 'Glob', ['*.ts', '*.js', '*.json']
      );
      await runProcessToolUpdates(privateState);
      cleanup(privateState, originalEnqueue, originalGetChannel);

      expect(mockChannel.send).toHaveBeenCalled();
      const sentContent = mockChannel.send.mock.calls[0][0].content;
      expect(sentContent).toBe('⏳ `Glob([3 items])`');
    });

    it('null args 應顯示為 ()', async () => {
      const { privateState, mockChannel, originalEnqueue, originalGetChannel } = setupArgsTest(
        'session-args-null', 'channel-args-null', 'tool-args-null', 'Bash', null
      );
      await runProcessToolUpdates(privateState);
      cleanup(privateState, originalEnqueue, originalGetChannel);

      expect(mockChannel.send).toHaveBeenCalled();
      const sentContent = mockChannel.send.mock.calls[0][0].content;
      expect(sentContent).toBe('⏳ `Bash()`');
    });

    it('超長 string args 應被截斷', async () => {
      const longStr = 'a'.repeat(250);
      const { privateState, mockChannel, originalEnqueue, originalGetChannel } = setupArgsTest(
        'session-args-long', 'channel-args-long', 'tool-args-long', 'Read', longStr
      );
      await runProcessToolUpdates(privateState);
      cleanup(privateState, originalEnqueue, originalGetChannel);

      expect(mockChannel.send).toHaveBeenCalled();
      const sentContent = mockChannel.send.mock.calls[0][0].content;
      // Formatter truncates long string args to 180 chars and adds "..." inside quotes
      // e.g. ⏳ `Read("aaaa...aaa...")`
      expect(sentContent).toContain('...")');
      expect(sentContent.length).toBeLessThanOrEqual(2000);
    });
  });

  describe('prompt 去重 - 完全前綴匹配', () => {
    it('AI 回覆開頭與用戶 prompt 完全相同前綴時應被移除', async () => {
      const privateState = manager as any;
      const streamKey = 'channel-prompt:session-prompt-1';
      const mockChannel = {
        send: vi.fn().mockResolvedValue({ id: 'msg-prompt-1' }),
        sendTyping: vi.fn().mockResolvedValue(undefined),
      };
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue(mockChannel),
        },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-prompt-1',
        channelId: 'channel-prompt',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
        userPrompt: 'Hello, how are you?',
      });

      // 模擬 AI 回覆開頭與 prompt 完全相同
      const handleMessageEvent = (manager as any).handleMessageEvent.bind(manager);
      handleMessageEvent({
        sessionId: 'session-prompt-1',
        content: 'Hello, how are you?\n\nI am doing well, thank you!',
        isComplete: false,
      });

      const stream = privateState.activeStreams.get(streamKey);
      // 去除重複前綴後，開頭應該是回覆內容而非重複的 prompt
      expect(stream.content).toBe('\n\nI am doing well, thank you!');
    });

    it('AI 回覆開頭與用戶 prompt 不是完全相同前綴時不應被移除', async () => {
      const privateState = manager as any;
      const streamKey = 'channel-prompt:session-prompt-2';
      const mockChannel = {
        send: vi.fn().mockResolvedValue({ id: 'msg-prompt-2' }),
        sendTyping: vi.fn().mockResolvedValue(undefined),
      };
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue(mockChannel),
        },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-prompt-2',
        channelId: 'channel-prompt',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
        userPrompt: 'Hello, how are you?',
      });

      // 模擬 AI 回覆開頭與 prompt 部分相同但非完全前綴
      const handleMessageEvent = (manager as any).handleMessageEvent.bind(manager);
      handleMessageEvent({
        sessionId: 'session-prompt-2',
        content: 'Hello, how are you doing?\n\nI am doing well!', // "doing?" vs "doing" 不同
        isComplete: false,
      });

      const stream = privateState.activeStreams.get(streamKey);
      // 非完全前綴，不應被移除
      expect(stream.content).toBe('Hello, how are you doing?\n\nI am doing well!');
    });

    it('無 userPrompt 時不應進行去重', async () => {
      const privateState = manager as any;
      const streamKey = 'channel-prompt:session-prompt-3';
      const mockChannel = {
        send: vi.fn().mockResolvedValue({ id: 'msg-prompt-3' }),
        sendTyping: vi.fn().mockResolvedValue(undefined),
      };
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue(mockChannel),
        },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-prompt-3',
        channelId: 'channel-prompt',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: mockClient,
        // 無 userPrompt
      });

      const handleMessageEvent = (manager as any).handleMessageEvent.bind(manager);
      handleMessageEvent({
        sessionId: 'session-prompt-3',
        content: 'Hello, how are you?\n\nI am doing well!',
        isComplete: false,
      });

      const stream = privateState.activeStreams.get(streamKey);
      // 無 userPrompt，不應被移除
      expect(stream.content).toBe('Hello, how are you?\n\nI am doing well!');
    });

    it('setUserPrompt 應正確設置用戶 prompt', () => {
      const setUserPrompt = (manager as any).setUserPrompt.bind(manager);
      const privateState = manager as any;

      // 先建立一個 stream
      privateState.activeStreams.set('channel-1:session-1', {
        sessionId: 'session-1',
        channelId: 'channel-1',
        content: '',
        isComplete: false,
        hasFlushed: false,
        typingTimer: null,
        stallTimer: null,
        lastEventAt: Date.now(),
        hasSentThinkingNotice: false,
        discordClient: {},
      });

      // 設置 userPrompt
      setUserPrompt('session-1', 'channel-1', 'My custom prompt');

      const stream = privateState.activeStreams.get('channel-1:session-1');
      expect(stream.userPrompt).toBe('My custom prompt');
    });
  });

  describe('completed 無 requestId + 空 args 匹配既有 running 工具 - Fallback', () => {
    it('running(args有值, 無requestId) -> completed(args空, 無requestId) 應匹配到同一工具', () => {
      const privateState = manager as any;
      const streamKey = 'channel-fallback:session-fallback';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-fallback',
        channelId: 'channel-fallback',
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

      // Step 1: running 事件，無 requestId，但 args 有值
      mockTrackTool.mockReturnValueOnce({
        id: 'tool-fallback-1',
        toolName: 'Bash',
        status: 'pending',
        args: { command: 'ls -la' },
        startedAt: Date.now(),
      });

      handleToolRequestEvent({
        sessionId: 'session-fallback',
        toolName: 'Bash',
        status: 'running',
        args: { command: 'ls -la' }, // 有 args
        // 無 requestId
      });

      expect(mockTrackTool).toHaveBeenCalledTimes(1);
      expect(mockStartTool).toHaveBeenCalledWith('session-fallback', 'tool-fallback-1');

      // Step 2: completed 事件，無 requestId，args 為空（常見於 SDK 不回傳 completed args）
      mockTrackTool.mockClear();
      mockStartTool.mockClear();
      mockCompleteTool.mockClear();

      // 模擬 running 狀態的工具存在
      mockGetSessionTools.mockReturnValueOnce([{
        id: 'tool-fallback-1',
        toolName: 'Bash',
        status: 'running',
        args: { command: 'ls -la' }, // running 有 args
        startedAt: Date.now(),
      }]);

      handleToolRequestEvent({
        sessionId: 'session-fallback',
        toolName: 'Bash',
        status: 'completed',
        args: {}, // 空 args（無 requestId）
        result: { output: 'total 0' },
      });

      // 應呼叫 completeTool 而非 trackTool
      expect(mockCompleteTool).toHaveBeenCalledTimes(1);
      expect(mockCompleteTool).toHaveBeenCalledWith('session-fallback', 'tool-fallback-1', { output: 'total 0' });
      // 不應建立新追蹤
      expect(mockTrackTool).not.toHaveBeenCalled();
    });

    it('completed 有 requestId 時不應觸發 fallback', () => {
      const privateState = manager as any;
      const streamKey = 'channel-no-fallback:session-no-fallback';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-no-fallback',
        channelId: 'channel-no-fallback',
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

      // completed 有 requestId，空 args，不應觸發 fallback
      mockGetSessionTools.mockReturnValueOnce([]);
      mockTrackTool.mockReturnValueOnce({
        id: 'tool-no-fallback-new',
        toolName: 'Read',
        status: 'pending',
        args: {},
        startedAt: Date.now(),
      });

      handleToolRequestEvent({
        sessionId: 'session-no-fallback',
        toolName: 'Read',
        requestId: 'call-with-id', // 有 requestId
        status: 'completed',
        args: {}, // 空 args
        result: { content: 'file content' },
      });

      // 有 requestId 時，應建立新追蹤而非 fallback
      expect(mockTrackTool).toHaveBeenCalledTimes(1);
    });

    it('completed 無 requestId 但有非空 args 時不應觸發 fallback', () => {
      const privateState = manager as any;
      const streamKey = 'channel-args-no-fallback:session-args-no-fallback';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-args-no-fallback',
        channelId: 'channel-args-no-fallback',
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

      // completed 無 requestId 但有非空 args，應精確匹配
      mockGetSessionTools.mockReturnValueOnce([{
        id: 'tool-args-match',
        toolName: 'Write',
        status: 'running',
        args: { path: '/file.txt' },
        startedAt: Date.now(),
      }]);

      handleToolRequestEvent({
        sessionId: 'session-args-no-fallback',
        toolName: 'Write',
        // 無 requestId
        status: 'completed',
        args: { path: '/file.txt' }, // 非空 args，應精確匹配
        result: { success: true },
      });

      // 應精確匹配而非 fallback
      expect(mockCompleteTool).toHaveBeenCalledWith('session-args-no-fallback', 'tool-args-match', { success: true });
      expect(mockTrackTool).not.toHaveBeenCalled();
    });

    it('多個同名 running 工具時，completed fallback 應匹配最新一筆', () => {
      const privateState = manager as any;
      const streamKey = 'channel-multi:session-multi';
      const mockClient = {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
      } as any;
      manager.setDiscordClient(mockClient);

      privateState.activeStreams.set(streamKey, {
        sessionId: 'session-multi',
        channelId: 'channel-multi',
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

      // 三個同名 Bash running 工具，按 startedAt 排序
      mockGetSessionTools.mockReturnValueOnce([
        {
          id: 'tool-oldest',
          toolName: 'Bash',
          status: 'running',
          args: { command: 'echo first' },
          startedAt: Date.now() - 2000, // 2秒前
        },
        {
          id: 'tool-middle',
          toolName: 'Bash',
          status: 'running',
          args: { command: 'echo second' },
          startedAt: Date.now() - 1000, // 1秒前
        },
        {
          id: 'tool-newest',
          toolName: 'Bash',
          status: 'running',
          args: { command: 'echo third' },
          startedAt: Date.now(), // 最近
        },
      ]);

      handleToolRequestEvent({
        sessionId: 'session-multi',
        toolName: 'Bash',
        status: 'completed',
        args: {}, // 空 args
        result: { output: 'third' },
      });

      // 應匹配最新一筆（tool-newest）
      expect(mockCompleteTool).toHaveBeenCalledWith('session-multi', 'tool-newest', { output: 'third' });
      expect(mockTrackTool).not.toHaveBeenCalled();
    });
  });
});
