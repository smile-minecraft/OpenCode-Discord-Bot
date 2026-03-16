/**
 * ContextMenuHandler Tests - 右鍵選單處理器單元測試
 * @description 測試 User/Message Context Menu 註冊、分發和錯誤處理功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextMenuHandler, ContextMenuHandlerError, createContextMenuHandler } from '../../src/handlers/ContextMenuHandler';

// ============== Mock 創建輔助函助函數 ==============

function createMockUserContextInteraction(commandName: string) {
  const replyFn = vi.fn().mockResolvedValue(undefined);
  const followUpFn = vi.fn().mockResolvedValue(undefined);
  const deferReplyFn = vi.fn().mockResolvedValue(undefined);
  const editReplyFn = vi.fn().mockResolvedValue(undefined);

  return {
    commandName,
    isUserContextMenuCommand: () => true,
    isMessageContextMenuCommand: () => false,
    targetId: 'targetUser123',
    user: { id: 'user123' },
    guildId: 'guild123',
    channelId: 'channel123',
    reply: replyFn,
    followUp: followUpFn,
    deferReply: deferReplyFn,
    editReply: editReplyFn,
    deferred: false,
  };
}

function createMockMessageContextInteraction(commandName: string) {
  const replyFn = vi.fn().mockResolvedValue(undefined);
  const followUpFn = vi.fn().mockResolvedValue(undefined);
  const deferReplyFn = vi.fn().mockResolvedValue(undefined);
  const editReplyFn = vi.fn().mockResolvedValue(undefined);

  return {
    commandName,
    isUserContextMenuCommand: () => false,
    isMessageContextMenuCommand: () => true,
    targetId: 'message123',
    message: { id: 'message123', content: 'Test message' },
    user: { id: 'user123' },
    guildId: 'guild123',
    channelId: 'channel123',
    reply: replyFn,
    followUp: followUpFn,
    deferReply: deferReplyFn,
    editReply: editReplyFn,
    deferred: false,
  };
}

// ============== 測試 suite ==============

describe('ContextMenuHandler', () => {
  let handler: ContextMenuHandler;

  beforeEach(() => {
    handler = new ContextMenuHandler();
  });

  describe('Constructor', () => {
    it('應該正確創建無選項的實例', () => {
      const h = new ContextMenuHandler();
      expect(h).toBeDefined();
    });

    it('應該正確創建帶有 defaultUserHandler 的實例', () => {
      const defaultHandler = vi.fn();
      const h = new ContextMenuHandler({ defaultUserHandler: defaultHandler });
      expect(h).toBeDefined();
    });

    it('應該正確創建帶有 errorHandler 的實例', () => {
      const errorHandler = vi.fn();
      const h = new ContextMenuHandler({ errorHandler });
      expect(h).toBeDefined();
    });
  });

  describe('registerUser() - User Context Menu 註冊', () => {
    it('應該正確註冊單一 User Context Menu 處理器', () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerUser({
        name: 'View Profile',
        callback,
        description: '查看用戶資料',
      });

      expect(handler.hasUserHandler('View Profile')).toBe(true);
    });

    it('應該正確註冊多個 User Context Menu 處理器', () => {
      handler.registerUser({
        name: 'View Profile',
        callback: vi.fn(),
      });
      handler.registerUser({
        name: 'Ban User',
        callback: vi.fn(),
      });

      expect(handler.hasUserHandler('View Profile')).toBe(true);
      expect(handler.hasUserHandler('Ban User')).toBe(true);
    });

    it('應該正確處理大小寫不敏感', () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerUser({
        name: 'VIEW PROFILE',
        callback,
      });

      expect(handler.hasUserHandler('view profile')).toBe(true);
    });

    it('registerUserMany() 應該批量註冊處理器', () => {
      const configs = [
        { name: 'menu1', callback: vi.fn() },
        { name: 'menu2', callback: vi.fn() },
        { name: 'menu3', callback: vi.fn() },
      ];

      handler.registerUserMany(configs);

      expect(handler.hasUserHandler('menu1')).toBe(true);
      expect(handler.hasUserHandler('menu2')).toBe(true);
      expect(handler.hasUserHandler('menu3')).toBe(true);
    });

    it('register() 應該返回配置對象', () => {
      const config = { name: 'test', callback: vi.fn() };
      const result = handler.registerUser(config);

      expect(result).toBe(config);
    });
  });

  describe('registerMessage() - Message Context Menu 註冊', () => {
    it('應該正確註冊單一 Message Context Menu 處理器', () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerMessage({
        name: 'Delete Message',
        callback,
        description: '刪除訊息',
      });

      expect(handler.hasMessageHandler('Delete Message')).toBe(true);
    });

    it('應該正確註冊多個 Message Context Menu 處理器', () => {
      handler.registerMessage({
        name: 'Delete Message',
        callback: vi.fn(),
      });
      handler.registerMessage({
        name: 'Pin Message',
        callback: vi.fn(),
      });

      expect(handler.hasMessageHandler('Delete Message')).toBe(true);
      expect(handler.hasMessageHandler('Pin Message')).toBe(true);
    });

    it('registerMessageMany() 應該批量註冊處理器', () => {
      const configs = [
        { name: 'msg1', callback: vi.fn() },
        { name: 'msg2', callback: vi.fn() },
      ];

      handler.registerMessageMany(configs);

      expect(handler.hasMessageHandler('msg1')).toBe(true);
      expect(handler.hasMessageHandler('msg2')).toBe(true);
    });
  });

  describe('handle() - Context Menu 分發', () => {
    it('應該正確調用匹配的 User Context Menu 處理器', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerUser({
        name: 'view profile',
        callback,
      });

      const interaction = createMockUserContextInteraction('view profile');
      await handler.handle(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(interaction);
    });

    it('應該正確調用匹配的 Message Context Menu 處理器', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerMessage({
        name: 'delete message',
        callback,
      });

      const interaction = createMockMessageContextInteraction('delete message');
      await handler.handle(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(interaction);
    });

    it('當沒有匹配的 User Context Menu 處理器時應該發送錯誤回覆', async () => {
      const interaction = createMockUserContextInteraction('unknown:menu');
      await handler.handle(interaction as any);

      expect(interaction.reply).toHaveBeenCalledTimes(1);
    });

    it('當沒有匹配的 Message Context Menu 處理器時應該發送錯誤回覆', async () => {
      const interaction = createMockMessageContextInteraction('unknown:menu');
      await handler.handle(interaction as any);

      expect(interaction.reply).toHaveBeenCalledTimes(1);
    });

    it('應該正確調用 defaultUserHandler 當沒有匹配時', async () => {
      const defaultHandler = vi.fn().mockResolvedValue(undefined);
      const handlerWithDefault = new ContextMenuHandler({ defaultUserHandler: defaultHandler });

      const interaction = createMockUserContextInteraction('unknown:menu');
      await handlerWithDefault.handle(interaction as any);

      expect(defaultHandler).toHaveBeenCalledTimes(1);
    });

    it('應該正確調用 defaultMessageHandler 當沒有匹配時', async () => {
      const defaultHandler = vi.fn().mockResolvedValue(undefined);
      const handlerWithDefault = new ContextMenuHandler({ defaultMessageHandler: defaultHandler });

      const interaction = createMockMessageContextInteraction('unknown:menu');
      await handlerWithDefault.handle(interaction as any);

      expect(defaultHandler).toHaveBeenCalledTimes(1);
    });

    it('應該正確處理同步回調', async () => {
      let executed = false;
      const syncCallback = () => {
        executed = true;
      };

      handler.registerUser({
        name: 'sync:menu',
        callback: syncCallback as any,
      });

      const interaction = createMockUserContextInteraction('sync:menu');
      await handler.handle(interaction as any);

      expect(executed).toBe(true);
    });

    it('應該正確處理異步回調', async () => {
      const asyncCallback = vi.fn().mockResolvedValue(undefined);

      handler.registerUser({
        name: 'async:menu',
        callback: asyncCallback,
      });

      const interaction = createMockUserContextInteraction('async:menu');
      await handler.handle(interaction as any);

      expect(asyncCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleUserContextMenu() - User Context Menu 處理', () => {
    it('應該正確調用處理器', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerUser({
        name: 'test',
        callback,
      });

      const interaction = createMockUserContextInteraction('test');
      await handler.handleUserContextMenu(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('應該正確處理大小寫', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerUser({
        name: 'TEST',
        callback,
      });

      const interaction = createMockUserContextInteraction('test');
      await handler.handleUserContextMenu(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleMessageContextMenu() - Message Context Menu 處理', () => {
    it('應該正確調用處理器', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerMessage({
        name: 'test',
        callback,
      });

      const interaction = createMockMessageContextInteraction('test');
      await handler.handleMessageContextMenu(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling - 錯誤處理', () => {
    it('應該正確處理回調中的錯誤', async () => {
      const errorCallback = vi.fn().mockRejectedValue(new Error('Callback error'));

      handler.registerUser({
        name: 'error:menu',
        callback: errorCallback,
      });

      const interaction = createMockUserContextInteraction('error:menu');
      await handler.handle(interaction as any);

      // 應該調用 reply 顯示錯誤給用戶
      expect(interaction.reply).toHaveBeenCalled();
    });

    it('應該正確調用自定義錯誤處理器', async () => {
      const customErrorHandler = vi.fn().mockResolvedValue(undefined);
      const handlerWithErrorHandler = new ContextMenuHandler({
        errorHandler: customErrorHandler,
      });

      const errorCallback = vi.fn().mockRejectedValue(new Error('Test error'));

      handlerWithErrorHandler.registerUser({
        name: 'error:test',
        callback: errorCallback,
      });

      const interaction = createMockUserContextInteraction('error:test');
      await handlerWithErrorHandler.handle(interaction as any);

      expect(customErrorHandler).toHaveBeenCalledTimes(1);
    });

    it('當回調錯誤時應該發送正確的錯誤訊息', async () => {
      const errorCallback = vi.fn().mockRejectedValue(new Error('Test error'));

      handler.registerUser({
        name: 'error:select',
        callback: errorCallback,
      });

      const interaction = createMockUserContextInteraction('error:select');
      await handler.handle(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.any(String),
          flags: expect.anything(),
        })
      );
    });

    it('應該處理未知的 Context Menu 類型', async () => {
      const interaction = {
        commandName: 'test',
        isUserContextMenuCommand: () => false,
        isMessageContextMenuCommand: () => false,
        reply: vi.fn().mockResolvedValue(undefined),
      };

      await handler.handle(interaction as any);

      expect(interaction.reply).toHaveBeenCalled();
    });
  });

  describe('getRegisteredMenus() - 獲取已註冊處理器', () => {
    it('應該返回空陣列當沒有註冊處理器時', () => {
      const menus = handler.getRegisteredMenus();
      expect(menus).toEqual([]);
    });

    it('應該正確返回所有已註冊的處理器資訊', () => {
      handler.registerUser({
        name: 'user:menu1',
        callback: vi.fn(),
        description: '用戶選單 1',
      });
      handler.registerMessage({
        name: 'msg:menu1',
        callback: vi.fn(),
        description: '訊息選單 1',
      });

      const menus = handler.getRegisteredMenus();

      expect(menus).toHaveLength(2);
      expect(menus[0]).toMatchObject({
        type: 'user',
        name: 'user:menu1',
        description: '用戶選單 1',
      });
      expect(menus[1]).toMatchObject({
        type: 'message',
        name: 'msg:menu1',
        description: '訊息選單 1',
      });
    });
  });

  describe('removeHandler() - 移除處理器', () => {
    it('應該正確移除已註冊的 User 處理器', () => {
      handler.registerUser({
        name: 'remove:me',
        callback: vi.fn(),
      });

      expect(handler.hasUserHandler('remove:me')).toBe(true);

      const removed = handler.removeUserHandler('remove:me');

      expect(removed).toBe(true);
      expect(handler.hasUserHandler('remove:me')).toBe(false);
    });

    it('應該正確移除已註冊的 Message 處理器', () => {
      handler.registerMessage({
        name: 'remove:me',
        callback: vi.fn(),
      });

      expect(handler.hasMessageHandler('remove:me')).toBe(true);

      const removed = handler.removeMessageHandler('remove:me');

      expect(removed).toBe(true);
      expect(handler.hasMessageHandler('remove:me')).toBe(false);
    });

    it('應該返回 false 當嘗試移除不存在的處理器時', () => {
      const removed = handler.removeUserHandler('nonexistent');
      expect(removed).toBe(false);
    });

    it('移除時應該將名稱轉為小寫處理', () => {
      handler.registerUser({
        name: 'TEST',
        callback: vi.fn(),
      });

      // 由於註冊時會轉為小寫，所以移除時小寫也能成功
      const removed = handler.removeUserHandler('test');

      expect(removed).toBe(true);
    });
  });

  describe('clear() - 清除處理器', () => {
    it('應該清除所有已註冊的處理器', () => {
      handler.registerUser({ name: 'user1', callback: vi.fn() });
      handler.registerUser({ name: 'user2', callback: vi.fn() });
      handler.registerMessage({ name: 'msg1', callback: vi.fn() });

      expect(handler.getRegisteredMenus()).toHaveLength(3);

      handler.clear();

      expect(handler.getRegisteredMenus()).toHaveLength(0);
    });

    it('應該只清除 User 處理器', () => {
      handler.registerUser({ name: 'user1', callback: vi.fn() });
      handler.registerMessage({ name: 'msg1', callback: vi.fn() });

      handler.clear('user');

      const menus = handler.getRegisteredMenus();
      expect(menus).toHaveLength(1);
      expect(menus[0].type).toBe('message');
    });

    it('應該只清除 Message 處理器', () => {
      handler.registerUser({ name: 'user1', callback: vi.fn() });
      handler.registerMessage({ name: 'msg1', callback: vi.fn() });

      handler.clear('message');

      const menus = handler.getRegisteredMenus();
      expect(menus).toHaveLength(1);
      expect(menus[0].type).toBe('user');
    });
  });

  describe('hasHandler() - 檢查處理器是否存在', () => {
    it('hasUserHandler 應該正確檢查', () => {
      handler.registerUser({ name: 'test', callback: vi.fn() });

      expect(handler.hasUserHandler('test')).toBe(true);
      expect(handler.hasUserHandler('nonexistent')).toBe(false);
    });

    it('hasMessageHandler 應該正確檢查', () => {
      handler.registerMessage({ name: 'test', callback: vi.fn() });

      expect(handler.hasMessageHandler('test')).toBe(true);
      expect(handler.hasMessageHandler('nonexistent')).toBe(false);
    });
  });

  describe('大小寫不敏感行為', () => {
    it('註冊時應該將名稱轉為小寫', () => {
      handler.registerUser({
        name: 'VIEW PROFILE',
        callback: vi.fn(),
      });

      expect(handler.hasUserHandler('view profile')).toBe(true);
      expect(handler.hasUserHandler('VIEW PROFILE')).toBe(true);
    });

    it('處理時應該正確匹配大小寫', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerUser({
        name: 'VIEW PROFILE',
        callback,
      });

      const interaction = createMockUserContextInteraction('view profile');
      await handler.handle(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('邊界情況', () => {
    it('應該處理很長的菜單名稱', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      const longName = 'a'.repeat(100);

      handler.registerUser({
        name: longName,
        callback,
      });

      const interaction = createMockUserContextInteraction(longName);
      await handler.handle(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('應該處理特殊字符的菜單名稱', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerUser({
        name: 'menu_with-special.chars',
        callback,
      });

      const interaction = createMockUserContextInteraction('menu_with-special.chars');
      await handler.handle(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ContextMenuHandlerError', () => {
  it('應該正確設置屬性', () => {
    const interaction = createMockUserContextInteraction('test');
    const options = { showToUser: true, logLevel: 'error' as const, customMessage: 'Custom message' };

    const error = new ContextMenuHandlerError(
      'Test error message',
      interaction as any,
      options
    );

    expect(error.name).toBe('ContextMenuHandlerError');
    expect(error.message).toBe('Test error message');
    expect(error.interaction).toBe(interaction);
    expect(error.options.showToUser).toBe(true);
    expect(error.options.logLevel).toBe('error');
    expect(error.options.customMessage).toBe('Custom message');
  });

  it('應該有預設選項', () => {
    const interaction = createMockUserContextInteraction('test');

    const error = new ContextMenuHandlerError(
      'Test error',
      interaction as any
    );

    expect(error.options).toBeDefined();
  });
});

describe('createContextMenuHandler() - 工廠函數', () => {
  it('應該創建 ContextMenuHandler 實例', () => {
    const handler = createContextMenuHandler();
    expect(handler).toBeInstanceOf(ContextMenuHandler);
  });

  it('應該正確傳遞選項', () => {
    const defaultHandler = vi.fn();
    const handler = createContextMenuHandler({ defaultUserHandler: defaultHandler });

    handler.registerUser({
      name: 'test',
      callback: vi.fn(),
    });

    // 使用工廠函數創建的實例應該可以正常工作
    expect(handler.hasUserHandler('test')).toBe(true);
  });
});
