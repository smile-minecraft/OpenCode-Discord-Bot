/**
 * ButtonHandler Tests - 按鈕處理器單元測試
 * @description 測試按鈕註冊、分發和錯誤處理功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import { ButtonHandler, createButtonHandler, ButtonHandlerError } from '../../src/handlers/ButtonHandler';
import type { ButtonHandlerConfig, ButtonHandlerCallback } from '../../src/types/handlers';

// ============== Mock 創建輔助函數 ==============

function createMockInteraction(customId: string) {
  const replyFn = vi.fn().mockResolvedValue(undefined);
  const followUpFn = vi.fn().mockResolvedValue(undefined);
  
  return {
    customId,
    reply: replyFn,
    followUp: followUpFn,
    deferReply: vi.fn().mockResolvedValue(undefined),
    deferred: false,
    isReplied: false,
  };
}

// ============== 測試 suite ==============

describe('ButtonHandler', () => {
  let handler: ButtonHandler;

  beforeEach(() => {
    handler = new ButtonHandler();
  });

  describe('Constructor', () => {
    it('應該正確創建無選項的實例', () => {
      const h = new ButtonHandler();
      expect(h).toBeDefined();
    });

    it('應該正確創建帶有 defaultHandler 的實例', () => {
      const defaultHandler: ButtonHandlerCallback = vi.fn();
      const h = new ButtonHandler({ defaultHandler });
      expect(h).toBeDefined();
    });

    it('應該正確創建帶有 errorHandler 的實例', () => {
      const errorHandler = vi.fn();
      const h = new ButtonHandler({ errorHandler });
      expect(h).toBeDefined();
    });
  });

  describe('register() - 按鈕註冊', () => {
    it('應該正確註冊單一按鈕處理器', () => {
      const callback: ButtonHandlerCallback = vi.fn();
      const config: ButtonHandlerConfig = {
        customId: 'test:button',
        callback,
        description: '測試按鈕',
      };

      const result = handler.register(config);

      expect(result).toBe(config);
      expect(handler.hasHandler('test:button')).toBe(true);
    });

    it('應該正確註冊多個按鈕處理器', () => {
      const callback1: ButtonHandlerCallback = vi.fn();
      const callback2: ButtonHandlerCallback = vi.fn();

      handler.register({
        customId: 'button1',
        callback: callback1,
      });
      handler.register({
        customId: 'button2',
        callback: callback2,
      });

      expect(handler.hasHandler('button1')).toBe(true);
      expect(handler.hasHandler('button2')).toBe(true);
    });

    it('應該正確處理前綴匹配（以 ":" 結尾）', () => {
      const callback: ButtonHandlerCallback = vi.fn();
      
      handler.register({
        customId: 'session:',
        callback,
        description: 'Session 前綴',
      });

      // 前綴匹配應該也能匹配具體的按鈕 ID
      expect(handler.hasHandler('session:123')).toBe(true);
    });

    it('應該正確處理前綴匹配（以 "_" 結尾）', () => {
      const callback: ButtonHandlerCallback = vi.fn();
      
      handler.register({
        customId: 'action_',
        callback,
      });

      expect(handler.hasHandler('action_edit')).toBe(true);
      expect(handler.hasHandler('action_delete')).toBe(true);
    });

    it('registerMany() 應該批量註冊處理器', () => {
      const configs: ButtonHandlerConfig[] = [
        { customId: 'btn1', callback: vi.fn() },
        { customId: 'btn2', callback: vi.fn() },
        { customId: 'btn3', callback: vi.fn() },
      ];

      handler.registerMany(configs);

      expect(handler.hasHandler('btn1')).toBe(true);
      expect(handler.hasHandler('btn2')).toBe(true);
      expect(handler.hasHandler('btn3')).toBe(true);
    });
  });

  describe('handle() - 按鈕分發', () => {
    it('應該正確調用匹配的處理器', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      
      handler.register({
        customId: 'test:button',
        callback,
      });

      const interaction = createMockInteraction('test:button');
      await handler.handle(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(interaction);
    });

    it('應該正確處理前綴匹配的處理器', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      
      handler.register({
        customId: 'session:',
        callback,
      });

      const interaction = createMockInteraction('session:123');
      await handler.handle(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('應該正確調用 defaultHandler 當沒有匹配時', async () => {
      const defaultHandler = vi.fn().mockResolvedValue(undefined);
      const handlerWithDefault = new ButtonHandler({ defaultHandler });

      const interaction = createMockInteraction('unknown:button');
      await handlerWithDefault.handle(interaction as any);

      expect(defaultHandler).toHaveBeenCalledTimes(1);
    });

    it('當沒有處理器且無 defaultHandler 時應該發送錯誤回覆', async () => {
      const interaction = createMockInteraction('nonexistent');
      await handler.handle(interaction as any);

      expect(interaction.reply).toHaveBeenCalledTimes(1);
    });

    it('應該正確處理同步回調', async () => {
      let executed = false;
      const syncCallback = () => {
        executed = true;
      };

      handler.register({
        customId: 'sync:btn',
        callback: syncCallback as any,
      });

      const interaction = createMockInteraction('sync:btn');
      await handler.handle(interaction as any);

      expect(executed).toBe(true);
    });

    it('應該正確處理異步回調', async () => {
      const asyncCallback = vi.fn().mockResolvedValue(undefined);

      handler.register({
        customId: 'async:btn',
        callback: asyncCallback,
      });

      const interaction = createMockInteraction('async:btn');
      await handler.handle(interaction as any);

      expect(asyncCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling - 錯誤處理', () => {
    it('應該正確處理回調中的錯誤', async () => {
      const errorCallback = vi.fn().mockRejectedValue(new Error('Callback error'));
      
      handler.register({
        customId: 'error:btn',
        callback: errorCallback,
      });

      const interaction = createMockInteraction('error:btn');
      await handler.handle(interaction as any);

      // 應該調用 reply 顯示錯誤給用戶
      expect(interaction.reply).toHaveBeenCalled();
    });

    it('應該正確調用自定義錯誤處理器', async () => {
      const customErrorHandler = vi.fn().mockResolvedValue(undefined);
      const handlerWithErrorHandler = new ButtonHandler({
        errorHandler: customErrorHandler,
      });

      const errorCallback = vi.fn().mockRejectedValue(new Error('Test error'));
      
      handlerWithErrorHandler.register({
        customId: 'error:test',
        callback: errorCallback,
      });

      const interaction = createMockInteraction('error:test');
      await handlerWithErrorHandler.handle(interaction as any);

      expect(customErrorHandler).toHaveBeenCalledTimes(1);
    });

    it('應該正確處理 unknown button ID 的情況', async () => {
      const interaction = createMockInteraction('unknown:button');
      await handler.handle(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.any(String),
          flags: [MessageFlags.Ephemeral],
        })
      );
    });

    it('ButtonHandlerError 應該正確設置屬性', () => {
      const interaction = createMockInteraction('test');
      
      const error = new ButtonHandlerError(
        'Test error message',
        interaction as any,
        { showToUser: true, logLevel: 'error', customMessage: 'Custom message' }
      );

      expect(error.name).toBe('ButtonHandlerError');
      expect(error.message).toBe('Test error message');
      expect(error.interaction).toBe(interaction);
      expect(error.options.showToUser).toBe(true);
      expect(error.options.logLevel).toBe('error');
      expect(error.options.customMessage).toBe('Custom message');
    });
  });

  describe('parseButtonId() - 按鈕 ID 解析', () => {
    it('應該正確解析帶前綴的按鈕 ID', () => {
      const result = handler.parseButtonId('session:123:abc');

      expect(result.fullId).toBe('session:123:abc');
      expect(result.prefix).toBe('session');
      expect(result.params).toEqual(['123', 'abc']);
    });

    it('應該正確解析無前綴的按鈕 ID', () => {
      const result = handler.parseButtonId('simpleButton');

      expect(result.fullId).toBe('simpleButton');
      expect(result.prefix).toBeUndefined();
      expect(result.params).toEqual([]);
    });

    it('應該正確解析單一參數的按鈕 ID', () => {
      const result = handler.parseButtonId('action:edit');

      expect(result.prefix).toBe('action');
      expect(result.params).toEqual(['edit']);
    });
  });

  describe('getRegisteredHandlers() - 獲取已註冊處理器', () => {
    it('應該返回空陣列當沒有註冊處理器時', () => {
      const handlers = handler.getRegisteredHandlers();
      expect(handlers).toEqual([]);
    });

    it('應該正確返回所有已註冊的處理器資訊', () => {
      handler.register({
        customId: 'btn1',
        callback: vi.fn(),
        description: '按鈕 1',
      });
      handler.register({
        customId: 'prefix:',
        callback: vi.fn(),
        description: '前綴匹配',
      });

      const handlers = handler.getRegisteredHandlers();

      expect(handlers).toHaveLength(2);
      expect(handlers[0]).toMatchObject({
        type: 'button',
        pattern: 'btn1',
        description: '按鈕 1',
      });
      expect(handlers[1]).toMatchObject({
        type: 'button',
        pattern: 'prefix:*',
        description: '前綴匹配',
      });
    });
  });

  describe('removeHandler() - 移除處理器', () => {
    it('應該正確移除已註冊的處理器', () => {
      handler.register({
        customId: 'remove:me',
        callback: vi.fn(),
      });

      expect(handler.hasHandler('remove:me')).toBe(true);

      const removed = handler.removeHandler('remove:me');
      
      expect(removed).toBe(true);
      expect(handler.hasHandler('remove:me')).toBe(false);
    });

    it('應該返回 false 當嘗試移除不存在的處理器時', () => {
      const removed = handler.removeHandler('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('clear() - 清除所有處理器', () => {
    it('應該清除所有已註冊的處理器', () => {
      handler.register({ customId: 'btn1', callback: vi.fn() });
      handler.register({ customId: 'btn2', callback: vi.fn() });
      handler.register({ customId: 'btn3', callback: vi.fn() });

      expect(handler.getRegisteredHandlers()).toHaveLength(3);

      handler.clear();

      expect(handler.getRegisteredHandlers()).toHaveLength(0);
    });
  });
});

describe('createButtonHandler() - 工廠函數', () => {
  it('應該創建 ButtonHandler 實例', () => {
    const handler = createButtonHandler();
    expect(handler).toBeInstanceOf(ButtonHandler);
  });

  it('應該正確傳遞選項', () => {
    const defaultHandler = vi.fn();
    const handler = createButtonHandler({ defaultHandler });
    
    handler.register({
      customId: 'test',
      callback: vi.fn(),
    });

    // 使用工廠函數創建的實例應該可以正常工作
    expect(handler.hasHandler('test')).toBe(true);
  });
});
