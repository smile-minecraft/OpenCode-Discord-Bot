/**
 * sentryHelper Tests - Sentry 輔助函數單元測試
 * @description 測試 Discord Bot Sentry 錯誤追蹤功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Sentry from '@sentry/node';
import {
  shouldCaptureError,
  addDiscordContext,
  setUserContext,
  setGuildContext,
  captureInteractionError,
  captureCommandError,
  captureSessionError,
  captureExceptionWithContext,
  captureMessageError,
  setDiscordApiContext,
} from '../../src/utils/sentryHelper.js';
import {
  PermissionError,
  ValidationError,
  SessionError,
  BotError,
} from '../../src/utils/errorHandler.js';

// ============== Mock Sentry ==============

vi.mock('@sentry/node', () => ({
  setContext: vi.fn(),
  setUser: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ============== Mock Discord.js Types ==============

// Mock ChatInputCommandInteraction
const createMockInteraction = (overrides: Record<string, unknown> = {}) => ({
  user: {
    id: '123456789',
    username: 'TestUser',
    discriminator: '1234',
    toString: () => '<@123456789>',
  },
  guild: {
    id: '987654321',
    name: 'Test Guild',
    memberCount: 100,
  },
  channelId: '111222333',
  isCommand: () => true,
  isButton: () => false,
  isSelectMenu: () => false,
  isModalSubmit: () => false,
  commandName: 'test-command',
  customId: 'test-custom-id',
  ...overrides,
});

// Mock Guild
const createMockGuild = () => ({
  id: '987654321',
  name: 'Test Guild',
  memberCount: 100,
  ownerId: '111222333',
});

// Mock User
const createMockUser = () => ({
  id: '123456789',
  username: 'TestUser',
  discriminator: '1234',
});

// ============== Test Suite ==============

describe('sentryHelper', () => {
  let mockSetContext: ReturnType<typeof vi.fn>;
  let mockSetUser: ReturnType<typeof vi.fn>;
  let mockCaptureException: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Get mock functions
    mockSetContext = Sentry.setContext as ReturnType<typeof vi.fn>;
    mockSetUser = Sentry.setUser as ReturnType<typeof vi.fn>;
    mockCaptureException = Sentry.captureException as ReturnType<typeof vi.fn>;
    
    // Set default SENTRY_DSN for tests that need it
    vi.stubEnv('SENTRY_DSN', 'https://example@sentry.io/1234567');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ============== shouldCaptureError Tests ==============

  describe('shouldCaptureError', () => {
    describe('業務錯誤 - 不應該上報', () => {
      it('PermissionError 應該返回 false', () => {
        const error = new PermissionError('權限不足', 'MANAGE_MESSAGES', '123456789');
        expect(shouldCaptureError(error)).toBe(false);
      });

      it('ValidationError 應該返回 false', () => {
        const error = new ValidationError('輸入無效', 'email', 'invalid-email');
        expect(shouldCaptureError(error)).toBe(false);
      });

      it('SessionError 應該返回 false', () => {
        const error = new SessionError('Session 過期', 'session-123', 'expired');
        expect(shouldCaptureError(error)).toBe(false);
      });

      it('BotError (operational) 應該返回 false', () => {
        const error = new BotError('操作失敗', 'OP_FAILED');
        expect(shouldCaptureError(error)).toBe(false);
      });
    });

    describe('系統錯誤 - 應該上報', () => {
      it('BotError (非 operational) 應該返回 true', () => {
        // Create a non-operational BotError by manually setting isOperational
        const error = new BotError('系統錯誤', 'SYSTEM_ERROR');
        // @ts-expect-error - testing internal property
        error.isOperational = false;
        expect(shouldCaptureError(error)).toBe(true);
      });

      it('普通 Error 應該返回 true', () => {
        const error = new Error('系統錯誤');
        expect(shouldCaptureError(error)).toBe(true);
      });

      it('TypeError 應該返回 true', () => {
        const error = new TypeError('類型錯誤');
        expect(shouldCaptureError(error)).toBe(true);
      });

      it('ReferenceError 應該返回 true', () => {
        const error = new ReferenceError('引用錯誤');
        expect(shouldCaptureError(error)).toBe(true);
      });
    });

    describe('邊界情況', () => {
      it('沒有錯誤名稱的 Error 應該返回 true', () => {
        const error = new Error('普通錯誤');
        error.name = '';
        expect(shouldCaptureError(error)).toBe(true);
      });

      it('空消息的 Error 應該正常處理', () => {
        const error = new Error('');
        expect(shouldCaptureError(error)).toBe(true);
      });
    });
  });

  // ============== addDiscordContext Tests ==============

  describe('addDiscordContext', () => {
    describe('SENTRY_DSN 未設置', () => {
      beforeEach(() => {
        vi.stubEnv('SENTRY_DSN', '');
      });

      it('應該直接返回不調用 Sentry', () => {
        const interaction = createMockInteraction();
        addDiscordContext(interaction as any);
        expect(mockSetContext).not.toHaveBeenCalled();
      });
    });

    describe('SENTRY_DSN 已設置', () => {
      it('應該設置 discord 上下文', () => {
        const interaction = createMockInteraction();
        addDiscordContext(interaction as any);
        
        expect(mockSetContext).toHaveBeenCalledWith('discord', {
          userId: '123456789',
          userName: 'TestUser',
          guildId: '987654321',
          guildName: 'Test Guild',
          channelId: '111222333',
          commandName: 'test-command',
        });
      });

      it('應該正確處理按鈕交互', () => {
        const interaction = createMockInteraction({
          isButton: () => true,
          isCommand: () => false,
          customId: 'button-click',
        });
        addDiscordContext(interaction as any);
        
        expect(mockSetContext).toHaveBeenCalledWith('discord', expect.objectContaining({
          customId: 'button-click',
        }));
      });

      it('應該正確處理選擇菜單交互', () => {
        const interaction = createMockInteraction({
          isSelectMenu: () => true,
          isCommand: () => false,
          customId: 'select-menu',
        });
        addDiscordContext(interaction as any);
        
        expect(mockSetContext).toHaveBeenCalledWith('discord', expect.objectContaining({
          customId: 'select-menu',
        }));
      });

      it('應該正確處理 Modal Submit 交互', () => {
        const interaction = createMockInteraction({
          isModalSubmit: () => true,
          isCommand: () => false,
          customId: 'modal-submit',
        });
        addDiscordContext(interaction as any);
        
        expect(mockSetContext).toHaveBeenCalledWith('discord', expect.objectContaining({
          customId: 'modal-submit',
        }));
      });

      it('缺少 guild 時應該正常處理', () => {
        const interaction = createMockInteraction({
          guild: null,
        });
        addDiscordContext(interaction as any);
        
        // 當 guild 為 null 時，不會添加 guildId 和 guildName 到 context
        expect(mockSetContext).toHaveBeenCalledWith('discord', {
          userId: '123456789',
          userName: 'TestUser',
          channelId: '111222333',
          commandName: 'test-command',
        });
      });
    });
  });

  // ============== setUserContext Tests ==============

  describe('setUserContext', () => {
    describe('SENTRY_DSN 未設置', () => {
      beforeEach(() => {
        vi.stubEnv('SENTRY_DSN', '');
      });

      it('應該直接返回不調用 Sentry', () => {
        const user = createMockUser();
        const guild = createMockGuild();
        setUserContext(user as any, guild as any);
        expect(mockSetUser).not.toHaveBeenCalled();
      });
    });

    describe('SENTRY_DSN 已設置', () => {
      it('應該設置用戶上下文', () => {
        const user = createMockUser();
        setUserContext(user as any);
        
        expect(mockSetUser).toHaveBeenCalledWith({
          id: '123456789',
          username: 'TestUser',
          discriminator: '1234',
        });
      });

      it('應該設置用戶 IP 為 remote', () => {
        const user = createMockUser();
        const guild = createMockGuild();
        setUserContext(user as any, guild as any);
        
        expect(mockSetUser).toHaveBeenCalledWith(expect.objectContaining({
          ip_address: 'remote',
        }));
      });

      it('應該同時設置 guild 上下文', () => {
        const user = createMockUser();
        const guild = createMockGuild();
        setUserContext(user as any, guild as any);
        
        expect(mockSetContext).toHaveBeenCalledWith('guild', {
          id: '987654321',
          name: 'Test Guild',
          memberCount: 100,
        });
      });

      it('沒有 guild 時不應該設置 guild 上下文', () => {
        const user = createMockUser();
        setUserContext(user as any);
        
        // Should not call setContext with 'guild'
        const guildCalls = mockSetContext.mock.calls.filter(
          call => call[0] === 'guild'
        );
        expect(guildCalls).toHaveLength(0);
      });
    });
  });

  // ============== setGuildContext Tests ==============

  describe('setGuildContext', () => {
    describe('SENTRY_DSN 未設置', () => {
      beforeEach(() => {
        vi.stubEnv('SENTRY_DSN', '');
      });

      it('應該直接返回不調用 Sentry', () => {
        const guild = createMockGuild();
        setGuildContext(guild as any);
        expect(mockSetContext).not.toHaveBeenCalled();
      });
    });

    describe('SENTRY_DSN 已設置', () => {
      it('應該設置 guild 上下文', () => {
        const guild = createMockGuild();
        setGuildContext(guild as any);
        
        expect(mockSetContext).toHaveBeenCalledWith('guild', {
          id: '987654321',
          name: 'Test Guild',
          memberCount: 100,
          ownerId: '111222333',
        });
      });
    });
  });

  // ============== captureInteractionError Tests ==============

  describe('captureInteractionError', () => {
    describe('SENTRY_DSN 未設置', () => {
      beforeEach(() => {
        vi.stubEnv('SENTRY_DSN', '');
      });

      it('應該返回 false', () => {
        const error = new Error('Test error');
        const interaction = createMockInteraction();
        const result = captureInteractionError(error, interaction as any);
        expect(result).toBe(false);
      });
    });

    describe('業務錯誤', () => {
      it('PermissionError 應該返回 false', () => {
        const error = new PermissionError('權限不足', 'MANAGE_MESSAGES', '123456789');
        const interaction = createMockInteraction();
        const result = captureInteractionError(error, interaction as any);
        
        expect(result).toBe(false);
        expect(mockCaptureException).not.toHaveBeenCalled();
      });

      it('ValidationError 應該返回 false', () => {
        const error = new ValidationError('輸入無效', 'email', 'invalid');
        const interaction = createMockInteraction();
        const result = captureInteractionError(error, interaction as any);
        
        expect(result).toBe(false);
        expect(mockCaptureException).not.toHaveBeenCalled();
      });
    });

    describe('系統錯誤', () => {
      it('系統錯誤應該返回 true', () => {
        const error = new Error('系統錯誤');
        const interaction = createMockInteraction();
        const result = captureInteractionError(error, interaction as any);
        
        expect(result).toBe(true);
        expect(mockCaptureException).toHaveBeenCalledWith(error);
      });

      it('應該添加 Discord 上下文', () => {
        const error = new Error('系統錯誤');
        const interaction = createMockInteraction();
        captureInteractionError(error, interaction as any);
        
        expect(mockSetContext).toHaveBeenCalled();
      });
    });
  });

  // ============== captureCommandError Tests ==============

  describe('captureCommandError', () => {
    describe('SENTRY_DSN 未設置', () => {
      beforeEach(() => {
        vi.stubEnv('SENTRY_DSN', '');
      });

      it('應該返回 false', () => {
        const error = new Error('Test error');
        const result = captureCommandError(error, 'test-command');
        expect(result).toBe(false);
      });
    });

    describe('業務錯誤', () => {
      it('PermissionError 應該返回 false', () => {
        const error = new PermissionError('權限不足', 'ADMIN', '123456789');
        const result = captureCommandError(error, 'test-command');
        
        expect(result).toBe(false);
        expect(mockCaptureException).not.toHaveBeenCalled();
      });
    });

    describe('系統錯誤', () => {
      it('系統錯誤應該返回 true', () => {
        const error = new Error('系統錯誤');
        const result = captureCommandError(error, 'test-command');
        
        expect(result).toBe(true);
        expect(mockCaptureException).toHaveBeenCalledWith(error);
      });

      it('應該設置命令上下文', () => {
        const error = new Error('系統錯誤');
        const options = { model: 'gpt-4', stream: true };
        captureCommandError(error, 'test-command', options);
        
        expect(mockSetContext).toHaveBeenCalledWith('command', {
          name: 'test-command',
          options: { model: 'gpt-4', stream: true },
        });
      });

      it('應該清理敏感選項', () => {
        const error = new Error('系統錯誤');
        const options = { 
          model: 'gpt-4', 
          token: 'sk-12345',
          api_key: 'key-67890',
        };
        captureCommandError(error, 'test-command', options);
        
        expect(mockSetContext).toHaveBeenCalledWith('command', {
          name: 'test-command',
          options: { 
            model: 'gpt-4', 
            token: '[REDACTED]',
            api_key: '[REDACTED]',
          },
        });
      });

      it('應該添加用戶上下文', () => {
        const error = new Error('系統錯誤');
        const user = createMockUser();
        const guild = createMockGuild();
        captureCommandError(error, 'test-command', undefined, user as any, guild as any);
        
        expect(mockSetUser).toHaveBeenCalled();
        expect(mockSetContext).toHaveBeenCalledWith('guild', expect.any(Object));
      });
    });
  });

  // ============== captureSessionError Tests ==============

  describe('captureSessionError', () => {
    describe('SENTRY_DSN 未設置', () => {
      beforeEach(() => {
        vi.stubEnv('SENTRY_DSN', '');
      });

      it('應該返回 false', () => {
        const error = new Error('Test error');
        const result = captureSessionError(error, 'session-123');
        expect(result).toBe(false);
      });
    });

    describe('業務錯誤', () => {
      it('SessionError 應該返回 false', () => {
        const error = new SessionError('Session 過期', 'session-123');
        const result = captureSessionError(error, 'session-123');
        
        expect(result).toBe(false);
        expect(mockCaptureException).not.toHaveBeenCalled();
      });
    });

    describe('系統錯誤', () => {
      it('系統錯誤應該返回 true', () => {
        const error = new Error('系統錯誤');
        const result = captureSessionError(error, 'session-123');
        
        expect(result).toBe(true);
        expect(mockCaptureException).toHaveBeenCalledWith(error);
      });

      it('應該設置 session 上下文', () => {
        const error = new Error('系統錯誤');
        captureSessionError(error, 'session-123');
        
        expect(mockSetContext).toHaveBeenCalledWith('session', {
          sessionId: 'session-123',
        });
      });

      it('應該包含 guildId', () => {
        const error = new Error('系統錯誤');
        captureSessionError(error, 'session-123', 'guild-123');
        
        expect(mockSetContext).toHaveBeenCalledWith('session', {
          sessionId: 'session-123',
          guildId: 'guild-123',
        });
      });

      it('應該包含額外上下文', () => {
        const error = new Error('系統錯誤');
        const additionalContext = { userId: '123456789', action: 'start' };
        captureSessionError(error, 'session-123', undefined, additionalContext);
        
        expect(mockSetContext).toHaveBeenCalledWith('session', {
          sessionId: 'session-123',
          userId: '123456789',
          action: 'start',
        });
      });
    });
  });

  // ============== captureExceptionWithContext Tests ==============

  describe('captureExceptionWithContext', () => {
    describe('SENTRY_DSN 未設置', () => {
      beforeEach(() => {
        vi.stubEnv('SENTRY_DSN', '');
      });

      it('應該返回 false', () => {
        const error = new Error('Test error');
        const result = captureExceptionWithContext(error, 'test', { key: 'value' });
        expect(result).toBe(false);
      });
    });

    describe('業務錯誤', () => {
      it('BotError 應該返回 false', () => {
        const error = new BotError('操作失敗', 'OP_FAILED');
        const result = captureExceptionWithContext(error, 'test', { key: 'value' });
        
        expect(result).toBe(false);
        expect(mockCaptureException).not.toHaveBeenCalled();
      });
    });

    describe('系統錯誤', () => {
      it('系統錯誤應該返回 true', () => {
        const error = new Error('系統錯誤');
        const result = captureExceptionWithContext(error, 'custom-context', { key: 'value' });
        
        expect(result).toBe(true);
        expect(mockCaptureException).toHaveBeenCalledWith(error);
      });

      it('應該設置自定義上下文', () => {
        const error = new Error('系統錯誤');
        captureExceptionWithContext(error, 'api-call', { method: 'POST', url: '/api/test' });
        
        expect(mockSetContext).toHaveBeenCalledWith('api-call', {
          method: 'POST',
          url: '/api/test',
        });
      });
    });
  });

  // ============== captureMessageError Tests ==============

  describe('captureMessageError', () => {
    describe('SENTRY_DSN 未設置', () => {
      beforeEach(() => {
        vi.stubEnv('SENTRY_DSN', '');
      });

      it('應該返回 false', () => {
        const error = new Error('Test error');
        const result = captureMessageError(error, 'message-123');
        expect(result).toBe(false);
      });
    });

    describe('業務錯誤', () => {
      it('ValidationError 應該返回 false', () => {
        const error = new ValidationError('訊息格式錯誤', 'content', 'too long');
        const result = captureMessageError(error, 'message-123');
        
        expect(result).toBe(false);
        expect(mockCaptureException).not.toHaveBeenCalled();
      });
    });

    describe('系統錯誤', () => {
      it('系統錯誤應該返回 true', () => {
        const error = new Error('系統錯誤');
        const result = captureMessageError(error, 'message-123');
        
        expect(result).toBe(true);
        expect(mockCaptureException).toHaveBeenCalledWith(error);
      });

      it('應該設置 message 上下文', () => {
        const error = new Error('系統錯誤');
        captureMessageError(error, 'message-123', 'channel-123', 'user-123');
        
        expect(mockSetContext).toHaveBeenCalledWith('message', {
          messageId: 'message-123',
          channelId: 'channel-123',
          userId: 'user-123',
        });
      });

      it('可選參數應該可選', () => {
        const error = new Error('系統錯誤');
        captureMessageError(error, 'message-123');
        
        expect(mockSetContext).toHaveBeenCalledWith('message', {
          messageId: 'message-123',
          channelId: undefined,
          userId: undefined,
        });
      });
    });
  });

  // ============== setDiscordApiContext Tests ==============

  describe('setDiscordApiContext', () => {
    describe('SENTRY_DSN 未設置', () => {
      beforeEach(() => {
        vi.stubEnv('SENTRY_DSN', '');
      });

      it('應該直接返回不調用 Sentry', () => {
        setDiscordApiContext('sendMessage', { content: 'Hello' });
        expect(mockSetContext).not.toHaveBeenCalled();
      });
    });

    describe('SENTRY_DSN 已設置', () => {
      it('應該設置 discord_api 上下文', () => {
        setDiscordApiContext('sendMessage', { content: 'Hello', channelId: '123' });
        
        expect(mockSetContext).toHaveBeenCalledWith('discord_api', {
          call: 'sendMessage',
          content: 'Hello',
          channelId: '123',
        });
      });

      it('應該清理敏感資訊', () => {
        setDiscordApiContext('createMessage', { 
          content: 'Test', 
          token: 'secret-token',
          api_key: 'secret-key',
        });
        
        expect(mockSetContext).toHaveBeenCalledWith('discord_api', {
          call: 'createMessage',
          content: 'Test',
          token: '[REDACTED]',
          api_key: '[REDACTED]',
        });
      });
    });
  });

  // ============== Integration Tests ==============

  describe('Integration - 完整錯誤上報流程', () => {
    it('應該正確處理完整的命令錯誤上報流程', () => {
      // Setup
      const error = new Error('Database connection failed');
      const user = createMockUser();
      const guild = createMockGuild();
      const options = { model: 'gpt-4', token: 'sk-test' };
      
      // Execute
      const result = captureCommandError(error, 'ask', options, user as any, guild as any);
      
      // Verify
      expect(result).toBe(true);
      expect(mockSetUser).toHaveBeenCalledWith(expect.objectContaining({
        id: '123456789',
        username: 'TestUser',
      }));
      expect(mockSetContext).toHaveBeenCalledWith('guild', expect.any(Object));
      expect(mockSetContext).toHaveBeenCalledWith('command', expect.objectContaining({
        name: 'ask',
        options: expect.objectContaining({
          model: 'gpt-4',
          token: '[REDACTED]',
        }),
      }));
      expect(mockCaptureException).toHaveBeenCalledWith(error);
    });

    it('應該正確過濾業務錯誤不重複上報', () => {
      const permissionError = new PermissionError('權限不足', 'ADMIN', '123');
      const validationError = new ValidationError('驗證失敗', 'field', 'value');
      const sessionError = new SessionError('Session 過期', 'session-1');
      
      // All should return false
      expect(captureInteractionError(permissionError, createMockInteraction() as any)).toBe(false);
      expect(captureCommandError(validationError, 'test')).toBe(false);
      expect(captureSessionError(sessionError, 'session-1')).toBe(false);
      
      // No captureException calls should be made
      expect(mockCaptureException).not.toHaveBeenCalled();
    });
  });
});
