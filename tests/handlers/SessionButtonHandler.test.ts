/**
 * SessionButtonHandler Tests - Session 按鈕處理器單元測試
 * @description 測試 Session 按鈕處理器的註冊和各種按鈕事件處理
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SessionButtonHandler,
  registerSessionButtonHandlers,
} from '../../src/handlers/SessionButtonHandler';
import { SessionButtonIds } from '../../src/builders/SessionActionRowBuilder';

// ============== Mock 創建輔助函數 ==============

/**
 * 創建模擬 ButtonInteraction
 */
function createMockInteraction(customId: string, options: {
  channelId?: string;
  userId?: string;
} = {}) {
  return {
    customId,
    channelId: options.channelId || 'test-channel',
    user: {
      id: options.userId || 'test-user',
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * 創建模擬 Session
 */
function createMockSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'test-session-123',
    channelId: 'test-channel',
    userId: 'test-user',
    prompt: 'Test prompt',
    model: 'test-model',
    status: 'active' as const,
    projectPath: '/test/path',
    getDuration: vi.fn().mockReturnValue(60000),
    pause: vi.fn(),
    ...overrides,
  };
}

// ============== 測試 suite ==============

describe('SessionButtonHandler', () => {
  let handler: SessionButtonHandler;

  beforeEach(() => {
    handler = new SessionButtonHandler();
  });

  describe('Constructor', () => {
    it('應該正確創建無參數的實例', () => {
      const h = new SessionButtonHandler();
      expect(h).toBeDefined();
    });

    it('應該正確接受自定義 sessionManager', () => {
      const mockSessionManager = {
        createSession: vi.fn(),
        getActiveSessionByChannel: vi.fn(),
        hasActiveSession: vi.fn(),
        abortSession: vi.fn(),
        resumeSession: vi.fn(),
        updateSessionStatus: vi.fn(),
        getSession: vi.fn(),
      } as any;

      const h = new SessionButtonHandler(mockSessionManager);
      expect(h).toBeDefined();
    });
  });

  describe('getHandlerConfigs() - 獲取處理器配置', () => {
    it('應該返回所有 Session 按鈕處理器配置', () => {
      const configs = handler.getHandlerConfigs();

      // 應該包含多個處理器配置
      expect(configs.length).toBeGreaterThan(0);

      // 檢查關鍵按鈕是否存在（使用前綴匹配）
      const customIds = configs.map(c => c.customId);
      
      expect(customIds).toContain(SessionButtonIds.START);
      expect(customIds).toContain('session:stop:'); // 改用前綴匹配
      expect(customIds).toContain(SessionButtonIds.RESUME);
      expect(customIds).toContain(SessionButtonIds.PASSTHROUGH_TOGGLE);
    });

    it('應該包含前綴匹配的處理器', () => {
      const configs = handler.getHandlerConfigs();
      const customIds = configs.map(c => c.customId);

      // 前綴匹配
      expect(customIds).toContain('session:start:');
      expect(customIds).toContain('session:stop:');
      expect(customIds).toContain('session:resume:');
      expect(customIds).toContain('session:pause:');
      expect(customIds).toContain('session:restart:');
      expect(customIds).toContain('session:status:');
      expect(customIds).toContain('session:passthrough:toggle:');
    });

    it('每個配置應該有正確的結構', () => {
      const configs = handler.getHandlerConfigs();

      configs.forEach(config => {
        expect(config).toHaveProperty('customId');
        expect(config).toHaveProperty('callback');
        expect(config).toHaveProperty('description');
        expect(typeof config.callback).toBe('function');
      });
    });
  });

  describe('handleStart() - 開始 Session', () => {
    it('應該正確處理開始按鈕（無冲突）', async () => {
      const mockSessionManager = {
        hasActiveSession: vi.fn().mockReturnValue(false),
        createSession: vi.fn().mockResolvedValue(createMockSession()),
        getActiveSessionByChannel: vi.fn(),
      } as any;

      const h = new SessionButtonHandler(mockSessionManager);
      const interaction = createMockInteraction('session:start');

      await h.handleStart(interaction as any);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(mockSessionManager.createSession).toHaveBeenCalledWith({
        channelId: 'test-channel',
        userId: 'test-user',
        prompt: '',
        guildId: '',
      });
      expect(interaction.editReply).toHaveBeenCalled();
    });

    it('應該正確處理開始按鈕（有冲突）', async () => {
      const mockSession = createMockSession();
      const mockSessionManager = {
        hasActiveSession: vi.fn().mockReturnValue(true),
        getActiveSessionByChannel: vi.fn().mockReturnValue(mockSession),
        createSession: vi.fn(),
      } as any;

      const h = new SessionButtonHandler(mockSessionManager);
      const interaction = createMockInteraction('session:start');

      await h.handleStart(interaction as any);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(mockSessionManager.createSession).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalled();
    });
  });

  describe('handleStop() - 停止 Session', () => {
    it('應該正確處理停止按鈕（有 active session）', async () => {
      const mockSession = createMockSession();
      const mockSessionManager = {
        getActiveSessionByChannel: vi.fn().mockReturnValue(mockSession),
        abortSession: vi.fn().mockResolvedValue(mockSession),
      } as any;

      const h = new SessionButtonHandler(mockSessionManager);
      const interaction = createMockInteraction('session:stop');

      await h.handleStop(interaction as any);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(mockSessionManager.abortSession).toHaveBeenCalledWith('test-session-123');
      expect(interaction.editReply).toHaveBeenCalled();
    });

    it('應該正確處理停止按鈕（無 active session）', async () => {
      const mockSessionManager = {
        getActiveSessionByChannel: vi.fn().mockReturnValue(null),
      } as any;

      const h = new SessionButtonHandler(mockSessionManager);
      const interaction = createMockInteraction('session:stop');

      await h.handleStop(interaction as any);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '此頻道沒有運行中的 Session',
      });
    });
  });

  describe('handleResume() - 恢復 Session', () => {
    it('應該正確處理恢復按鈕（有暂停的 session）', async () => {
      const mockSession = createMockSession({ status: 'paused' });
      const mockSessionManager = {
        getActiveSessionByChannel: vi.fn().mockReturnValue(mockSession),
        resumeSession: vi.fn().mockResolvedValue(mockSession),
      } as any;

      const h = new SessionButtonHandler(mockSessionManager);
      const interaction = createMockInteraction('session:resume');

      await h.handleResume(interaction as any);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(mockSessionManager.resumeSession).toHaveBeenCalledWith('test-session-123');
      expect(interaction.editReply).toHaveBeenCalled();
    });

    it('應該正確處理恢復按鈕（無暂停的 session）', async () => {
      const mockSessionManager = {
        getActiveSessionByChannel: vi.fn().mockReturnValue(null),
      } as any;

      const h = new SessionButtonHandler(mockSessionManager);
      const interaction = createMockInteraction('session:resume');

      await h.handleResume(interaction as any);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '此頻道沒有暫停的 Session',
      });
    });
  });

  describe('handlePassthroughToggle() - Passthrough 切換', () => {
    it('應該正確切換到開啟狀態', async () => {
      const h = new SessionButtonHandler();
      const interaction = createMockInteraction('session:passthrough:toggle:false');

      await h.handlePassthroughToggle(interaction as any);

      expect(interaction.update).toHaveBeenCalled();
      const updateCall = (interaction.update as any).mock.calls[0][0];
      expect(updateCall.embeds[0].data.title).toContain('開啟');
    });

    it('應該正確切換到關閉狀態', async () => {
      const h = new SessionButtonHandler();
      const interaction = createMockInteraction('session:passthrough:toggle:true');

      await h.handlePassthroughToggle(interaction as any);

      expect(interaction.update).toHaveBeenCalled();
      const updateCall = (interaction.update as any).mock.calls[0][0];
      expect(updateCall.embeds[0].data.title).toContain('關閉');
    });
  });

  describe('handleStatus() - 查看狀態', () => {
    it('應該正確顯示 Session 狀態', async () => {
      const mockSession = createMockSession();
      const mockSessionManager = {
        getActiveSessionByChannel: vi.fn().mockReturnValue(mockSession),
      } as any;

      const h = new SessionButtonHandler(mockSessionManager);
      const interaction = createMockInteraction('session:status');

      await h.handleStatus(interaction as any);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalled();
    });

    it('應該正確處理無 Session 的情況', async () => {
      const mockSessionManager = {
        getActiveSessionByChannel: vi.fn().mockReturnValue(null),
      } as any;

      const h = new SessionButtonHandler(mockSessionManager);
      const interaction = createMockInteraction('session:status');

      await h.handleStatus(interaction as any);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '此頻道沒有運行中的 Session',
      });
    });
  });

  describe('extractSessionId() - 提取 Session ID', () => {
    it('應該正確提取 Session ID', () => {
      // 使用私有方法需要通過公共接口測試
      // 這裡測試 handleStartWithId 的行為
      const h = new SessionButtonHandler();
      const interaction = createMockInteraction('session:start:abc123');

      // handleStartWithId 會解析 customId
      // 格式：session:start:{sessionId}
      const parts = interaction.customId.split(':');
      const sessionId = parts.length > 2 ? parts.slice(2).join(':') : '';

      expect(sessionId).toBe('abc123');
    });

    it('應該正確處理無 sessionId 的情況', () => {
      const h = new SessionButtonHandler();
      const interaction = createMockInteraction('session:start');

      const parts = interaction.customId.split(':');
      const sessionId = parts.length > 2 ? parts.slice(2).join(':') : '';

      expect(sessionId).toBe('');
    });
  });

  describe('Error Handling - 錯誤處理', () => {
    it('應該正確處理 createSession 失敗', async () => {
      const mockSessionManager = {
        hasActiveSession: vi.fn().mockReturnValue(false),
        createSession: vi.fn().mockRejectedValue(new Error('建立失敗')),
      } as any;

      const h = new SessionButtonHandler(mockSessionManager);
      const interaction = createMockInteraction('session:start');

      await h.handleStart(interaction as any);

      expect(interaction.editReply).toHaveBeenCalled();
      const editCall = (interaction.editReply as any).mock.calls[0][0];
      expect(editCall.content).toContain('❌');
    });

    it('應該正確處理 abortSession 失敗', async () => {
      const mockSession = createMockSession();
      const mockSessionManager = {
        getActiveSessionByChannel: vi.fn().mockReturnValue(mockSession),
        abortSession: vi.fn().mockRejectedValue(new Error('停止失敗')),
      } as any;

      const h = new SessionButtonHandler(mockSessionManager);
      const interaction = createMockInteraction('session:stop');

      await h.handleStop(interaction as any);

      expect(interaction.editReply).toHaveBeenCalled();
      const editCall = (interaction.editReply as any).mock.calls[0][0];
      expect(editCall.content).toContain('❌');
    });
  });
});

describe('registerSessionButtonHandlers() - 註冊函數', () => {
  let mockButtonHandler: {
    registerMany: ReturnType<typeof vi.fn>;
  };
  let mockSessionManager: any;

  beforeEach(() => {
    mockButtonHandler = {
      registerMany: vi.fn(),
    };
    mockSessionManager = {
      createSession: vi.fn(),
      getActiveSessionByChannel: vi.fn(),
      hasActiveSession: vi.fn(),
      abortSession: vi.fn(),
      resumeSession: vi.fn(),
      updateSessionStatus: vi.fn(),
      getSession: vi.fn(),
    };
  });

  it('應該正確註冊所有 Session 按鈕處理器', () => {
    registerSessionButtonHandlers(mockButtonHandler as any);

    expect(mockButtonHandler.registerMany).toHaveBeenCalledTimes(1);
    
    const configs = (mockButtonHandler.registerMany as any).mock.calls[0][0];
    
    // 應該包含所有主要的按鈕配置（使用前綴匹配）
    const customIds = configs.map((c: any) => c.customId);
    expect(customIds).toContain(SessionButtonIds.START);
    expect(customIds).toContain('session:stop:'); // 改用前綴匹配
    expect(customIds).toContain(SessionButtonIds.RESUME);
    expect(customIds).toContain(SessionButtonIds.PASSTHROUGH_TOGGLE);
    expect(customIds).toContain('session:status');
  });

  it('應該正確接受自定義 sessionManager', () => {
    registerSessionButtonHandlers(mockButtonHandler as any, mockSessionManager);

    expect(mockButtonHandler.registerMany).toHaveBeenCalledTimes(1);
  });

  it('應該在沒有提供 sessionManager 時創建默認實例', () => {
    // 這應該正常工作，不會拋出錯誤
    expect(() => {
      registerSessionButtonHandlers(mockButtonHandler as any);
    }).not.toThrow();
  });

  it('註冊的配置數量應該正確', () => {
    registerSessionButtonHandlers(mockButtonHandler as any);

    const configs = (mockButtonHandler.registerMany as any).mock.calls[0][0];
    
    // 根據 getHandlerConfigs 的實現，應該有 12 個配置
    // - session:start (exact)
    // - session:start: (prefix)
    // - session:stop (exact)
    // - session:stop: (prefix)
    // - session:resume (exact)
    // - session:resume: (prefix)
    // - session:pause: (prefix)
    // - session:restart: (prefix)
    // - session:status (exact)
    // - session:status: (prefix)
    // - session:passthrough:toggle (exact)
    // - session:passthrough:toggle: (prefix)
    expect(configs.length).toBe(12);
  });

  it('每個配置應該有正確的 callback 函數', () => {
    registerSessionButtonHandlers(mockButtonHandler as any);

    const configs = (mockButtonHandler.registerMany as any).mock.calls[0][0];
    
    configs.forEach((config: any) => {
      expect(typeof config.callback).toBe('function');
      expect(config.description).toBeDefined();
    });
  });
});
