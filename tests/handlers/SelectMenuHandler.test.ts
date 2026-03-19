/**
 * SelectMenuHandler Tests - 選單處理器單元測試
 * @description 測試 Select Menu 註冊、分發和錯誤處理功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SelectMenuHandler } from '../../src/handlers/SelectMenuHandler';

// ============== Mock 創建輔助函數 ==============

function createMockStringSelectInteraction(customId: string, values: string[] = []) {
  const replyFn = vi.fn().mockResolvedValue(undefined);
  const editReplyFn = vi.fn().mockResolvedValue(undefined);

  return {
    customId,
    values,
    componentType: 3, // StringSelect
    user: { id: 'user123' },
    channelId: 'channel123',
    guildId: 'guild123',
    message: { id: 'message123' },
    reply: replyFn,
    editReply: editReplyFn,
    deferReply: vi.fn().mockResolvedValue(undefined),
    isRepliable: () => true,
  };
}

function createMockUserSelectInteraction(customId: string, values: string[] = []) {
  return {
    customId,
    values,
    componentType: 4, // UserSelect
    user: { id: 'user123' },
    channelId: 'channel123',
    guildId: 'guild123',
    message: { id: 'message123' },
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    isRepliable: () => true,
  };
}

function createMockRoleSelectInteraction(customId: string, values: string[] = []) {
  return {
    customId,
    values,
    componentType: 5, // RoleSelect
    user: { id: 'user123' },
    channelId: 'channel123',
    guildId: 'guild123',
    message: { id: 'message123' },
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    isRepliable: () => true,
  };
}

function createMockChannelSelectInteraction(customId: string, values: string[] = []) {
  return {
    customId,
    values,
    componentType: 7, // ChannelSelect
    user: { id: 'user123' },
    channelId: 'channel123',
    guildId: 'guild123',
    message: { id: 'message123' },
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    isRepliable: () => true,
  };
}

// ============== 測試 suite ==============

describe('SelectMenuHandler', () => {
  let handler: SelectMenuHandler;

  beforeEach(() => {
    handler = new SelectMenuHandler({ logCalls: false });
  });

  describe('Constructor', () => {
    it('應該正確創建無選項的實例', () => {
      const h = new SelectMenuHandler();
      expect(h).toBeDefined();
    });

    it('應該正確創建帶有自定義選項的實例', () => {
      const h = new SelectMenuHandler({ logCalls: false, defaultEnabled: false });
      expect(h).toBeDefined();
    });

    it('預設應該啟用日誌記錄', () => {
      const h = new SelectMenuHandler();
      expect(h).toBeDefined();
    });
  });

  describe('registerStringSelect() - String Select 註冊', () => {
    it('應該正確註冊 String Select 處理器', () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerStringSelect({
        customId: 'model:select',
        callback,
        description: '模型選擇',
      });

      const handlers = handler.getRegisteredHandlers();
      expect(handlers).toHaveLength(1);
      expect(handlers[0]).toMatchObject({
        type: 'StringSelect',
        customId: 'model:select',
        description: '模型選擇',
        enabled: true,
      });
    });

    it('應該正確註冊多個 String Select 處理器', () => {
      handler.registerStringSelect({
        customId: 'model:select',
        callback: vi.fn(),
      });
      handler.registerStringSelect({
        customId: 'agent:select',
        callback: vi.fn(),
      });

      const handlers = handler.getRegisteredHandlers();
      expect(handlers).toHaveLength(2);
    });

    it('應該正確處理前綴匹配（以 ":" 結尾）', () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerStringSelect({
        customId: 'menu:',
        callback,
        description: '菜單前綴',
      });

      const handlers = handler.getRegisteredHandlers();
      expect(handlers[0].customId).toBe('menu:');
    });
  });

  describe('registerChannelSelect() - Channel Select 註冊', () => {
    it('應該正確註冊 Channel Select 處理器', () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerChannelSelect({
        customId: 'channel:select',
        callback,
        description: '頻道選擇',
      });

      const handlers = handler.getRegisteredHandlers();
      expect(handlers).toHaveLength(1);
      expect(handlers[0]).toMatchObject({
        type: 'ChannelSelect',
        customId: 'channel:select',
        description: '頻道選擇',
        enabled: true,
      });
    });
  });

  describe('registerRoleSelect() - Role Select 註冊', () => {
    it('應該正確註冊 Role Select 處理器', () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerRoleSelect({
        customId: 'role:select',
        callback,
        description: '角色選擇',
      });

      const handlers = handler.getRegisteredHandlers();
      expect(handlers).toHaveLength(1);
      expect(handlers[0]).toMatchObject({
        type: 'RoleSelect',
        customId: 'role:select',
        description: '角色選擇',
        enabled: true,
      });
    });
  });

  describe('registerUserSelect() - User Select 註冊', () => {
    it('應該正確註冊 User Select 處理器', () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerUserSelect({
        customId: 'user:select',
        callback,
        description: '用戶選擇',
      });

      const handlers = handler.getRegisteredHandlers();
      expect(handlers).toHaveLength(1);
      expect(handlers[0]).toMatchObject({
        type: 'UserSelect',
        customId: 'user:select',
        description: '用戶選擇',
        enabled: true,
      });
    });
  });

  describe('registerMentionableSelect() - Mentionable Select 註冊', () => {
    it('應該正確註冊 Mentionable Select 處理器', () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerMentionableSelect({
        customId: 'mentionable:select',
        callback,
        description: '提及選擇',
      });

      const handlers = handler.getRegisteredHandlers();
      expect(handlers).toHaveLength(1);
      expect(handlers[0]).toMatchObject({
        type: 'MentionableSelect',
        customId: 'mentionable:select',
        description: '提及選擇',
        enabled: true,
      });
    });
  });

  describe('registerAnySelect() - 任意類型 Select 註冊', () => {
    it('應該正確註冊 Any Select 處理器', () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerAnySelect({
        customId: 'any:select',
        callback,
        description: '任意選擇',
      });

      const handlers = handler.getRegisteredHandlers();
      expect(handlers).toHaveLength(1);
      expect(handlers[0]).toMatchObject({
        type: 'AnySelect',
        customId: 'any:select',
        description: '任意選擇',
        enabled: true,
      });
    });
  });

  describe('handle() - 選單分發', () => {
    it('應該正確調用匹配的 String Select 處理器', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerStringSelect({
        customId: 'model:select',
        callback,
      });

      const interaction = createMockStringSelectInteraction('model:select', ['claude-3-opus']);
      await handler.handle(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(interaction);
    });

    it('應該正確處理前綴匹配的 String Select', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerStringSelect({
        customId: 'menu:',
        callback,
      });

      const interaction = createMockStringSelectInteraction('menu:123', ['option1']);
      await handler.handle(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('應該正確調用 User Select 處理器', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerUserSelect({
        customId: 'user:select',
        callback,
      });

      const interaction = createMockUserSelectInteraction('user:select', ['user123']);
      await handler.handle(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('應該正確調用 Role Select 處理器', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerRoleSelect({
        customId: 'role:select',
        callback,
      });

      const interaction = createMockRoleSelectInteraction('role:select', ['role123']);
      await handler.handle(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('應該正確調用 Channel Select 處理器', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerChannelSelect({
        customId: 'channel:select',
        callback,
      });

      const interaction = createMockChannelSelectInteraction('channel:select', ['channel123']);
      await handler.handle(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('當沒有匹配的處理器時不應該拋出錯誤', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerStringSelect({
        customId: 'model:select',
        callback,
      });

      const interaction = createMockStringSelectInteraction('unknown:select', ['value']);
      
      // 不應該拋出錯誤
      await expect(handler.handle(interaction as any)).resolves.not.toThrow();
    });

    it('應該正確處理同步回調', async () => {
      let executed = false;
      const syncCallback = () => {
        executed = true;
      };

      handler.registerStringSelect({
        customId: 'sync:select',
        callback: syncCallback as any,
      });

      const interaction = createMockStringSelectInteraction('sync:select');
      await handler.handle(interaction as any);

      expect(executed).toBe(true);
    });

    it('應該正確處理異步回調', async () => {
      const asyncCallback = vi.fn().mockResolvedValue(undefined);

      handler.registerStringSelect({
        customId: 'async:select',
        callback: asyncCallback,
      });

      const interaction = createMockStringSelectInteraction('async:select');
      await handler.handle(interaction as any);

      expect(asyncCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling - 錯誤處理', () => {
    it('應該正確處理回調中的錯誤', async () => {
      const errorCallback = vi.fn().mockRejectedValue(new Error('Callback error'));

      handler.registerStringSelect({
        customId: 'error:select',
        callback: errorCallback,
      });

      const interaction = createMockStringSelectInteraction('error:select', ['value']);
      await handler.handle(interaction as any);

      // 應該調用 reply 顯示錯誤給用戶
      expect(interaction.reply).toHaveBeenCalled();
    });

    it('當回調錯誤時應該發送正確的錯誤訊息', async () => {
      const errorCallback = vi.fn().mockRejectedValue(new Error('Test error'));

      handler.registerStringSelect({
        customId: 'error:select',
        callback: errorCallback,
      });

      const interaction = createMockStringSelectInteraction('error:select', ['value']);
      await handler.handle(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.any(String),
          flags: expect.anything(),
        })
      );
    });

    it('當回調錯誤時應該記錄日誌', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const errorCallback = vi.fn().mockRejectedValue(new Error('Test error'));

      handler.registerStringSelect({
        customId: 'error:select',
        callback: errorCallback,
      });

      const interaction = createMockStringSelectInteraction('error:select', ['value']);
      await handler.handle(interaction as any);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('setEnabled() - 啟用/停用處理器', () => {
    it('應該正確啟用/停用指定的處理器', () => {
      handler.registerStringSelect({
        customId: 'test:select',
        callback: vi.fn(),
      });

      expect(handler.setEnabled('test:select', false)).toBe(true);

      const handlers = handler.getRegisteredHandlers();
      expect(handlers[0].enabled).toBe(false);
    });

    it('應該正確重新啟用已停用的處理器', () => {
      handler.registerStringSelect({
        customId: 'test:select',
        callback: vi.fn(),
      });

      handler.setEnabled('test:select', false);
      handler.setEnabled('test:select', true);

      const handlers = handler.getRegisteredHandlers();
      expect(handlers[0].enabled).toBe(true);
    });

    it('應該返回 false 當嘗試設置不存在的處理器', () => {
      const result = handler.setEnabled('nonexistent', false);
      expect(result).toBe(false);
    });

    it('停用的處理器仍然應該被註冊', () => {
      handler.registerStringSelect({
        customId: 'test:select',
        callback: vi.fn(),
      });

      handler.setEnabled('test:select', false);

      const handlers = handler.getRegisteredHandlers();
      expect(handlers).toHaveLength(1);
    });
  });

  describe('getRegisteredHandlers() - 獲取已註冊處理器', () => {
    it('應該返回空陣列當沒有註冊處理器時', () => {
      const handlers = handler.getRegisteredHandlers();
      expect(handlers).toEqual([]);
    });

    it('應該正確返回所有已註冊的處理器資訊', () => {
      handler.registerStringSelect({
        customId: 'model:select',
        callback: vi.fn(),
        description: '模型選擇',
      });
      handler.registerUserSelect({
        customId: 'user:select',
        callback: vi.fn(),
        description: '用戶選擇',
      });
      handler.registerRoleSelect({
        customId: 'role:select',
        callback: vi.fn(),
        description: '角色選擇',
      });

      const handlers = handler.getRegisteredHandlers();

      expect(handlers).toHaveLength(3);
      expect(handlers).toContainEqual(
        expect.objectContaining({
          type: 'StringSelect',
          customId: 'model:select',
          description: '模型選擇',
        })
      );
      expect(handlers).toContainEqual(
        expect.objectContaining({
          type: 'UserSelect',
          customId: 'user:select',
          description: '用戶選擇',
        })
      );
      expect(handlers).toContainEqual(
        expect.objectContaining({
          type: 'RoleSelect',
          customId: 'role:select',
          description: '角色選擇',
        })
      );
    });
  });

  describe('getStats() - 獲取統計資訊', () => {
    it('應該返回正確的統計數據', () => {
      handler.registerStringSelect({
        customId: 'model:select',
        callback: vi.fn(),
      });
      handler.registerStringSelect({
        customId: 'agent:select',
        callback: vi.fn(),
      });
      handler.registerUserSelect({
        customId: 'user:select',
        callback: vi.fn(),
      });

      const stats = handler.getStats();

      expect(stats.stringSelect).toBe(2);
      expect(stats.userSelect).toBe(1);
      expect(stats.total).toBe(3);
    });

    it('應該正確計算總數', () => {
      handler.registerStringSelect({ customId: 's1', callback: vi.fn() });
      handler.registerChannelSelect({ customId: 'c1', callback: vi.fn() });
      handler.registerRoleSelect({ customId: 'r1', callback: vi.fn() });
      handler.registerUserSelect({ customId: 'u1', callback: vi.fn() });
      handler.registerMentionableSelect({ customId: 'm1', callback: vi.fn() });
      handler.registerAnySelect({ customId: 'a1', callback: vi.fn() });

      const stats = handler.getStats();

      expect(stats.total).toBe(6);
      expect(stats.stringSelect).toBe(1);
      expect(stats.channelSelect).toBe(1);
      expect(stats.roleSelect).toBe(1);
      expect(stats.userSelect).toBe(1);
      expect(stats.mentionableSelect).toBe(1);
      expect(stats.anySelect).toBe(1);
    });
  });

  describe('extractValues() - 提取選單值', () => {
    it('應該正確提取 String Select 的值', () => {
      const interaction = createMockStringSelectInteraction('model:select', ['claude-3-opus', 'gpt-4']);

      const result = SelectMenuHandler.extractValues(interaction as any);

      expect(result.customId).toBe('model:select');
      expect(result.values).toEqual(['claude-3-opus', 'gpt-4']);
      expect(result.type).toBe('stringSelect');
      expect(result.userId).toBe('user123');
    });

    it('應該正確提取 User Select 的值', () => {
      const interaction = createMockUserSelectInteraction('user:select', ['user123', 'user456']);

      const result = SelectMenuHandler.extractValues(interaction as any);

      expect(result.type).toBe('userSelect');
      expect(result.values).toEqual(['user123', 'user456']);
    });

    it('應該正確提取 Role Select 的值', () => {
      const interaction = createMockRoleSelectInteraction('role:select', ['role123']);

      const result = SelectMenuHandler.extractValues(interaction as any);

      expect(result.type).toBe('roleSelect');
      expect(result.values).toEqual(['role123']);
    });

    it('應該正確提取 Channel Select 的值', () => {
      const interaction = createMockChannelSelectInteraction('channel:select', ['channel123']);

      const result = SelectMenuHandler.extractValues(interaction as any);

      expect(result.type).toBe('channelSelect');
      expect(result.values).toEqual(['channel123']);
    });

    it('應該包含正確的元數據', () => {
      const interaction = createMockStringSelectInteraction('test:select', ['value1']);

      const result = SelectMenuHandler.extractValues(interaction as any);

      expect(result.channelId).toBe('channel123');
      expect(result.guildId).toBe('guild123');
      expect(result.messageId).toBe('message123');
    });
  });

  describe('多種處理器類型共存', () => {
    it('應該正確處理多種類型的處理器', async () => {
      const stringCallback = vi.fn().mockResolvedValue(undefined);
      const userCallback = vi.fn().mockResolvedValue(undefined);
      const roleCallback = vi.fn().mockResolvedValue(undefined);

      handler.registerStringSelect({
        customId: 'string:select',
        callback: stringCallback,
      });
      handler.registerUserSelect({
        customId: 'user:select',
        callback: userCallback,
      });
      handler.registerRoleSelect({
        customId: 'role:select',
        callback: roleCallback,
      });

      // 測試 String Select
      await handler.handle(createMockStringSelectInteraction('string:select', ['value']) as any);
      expect(stringCallback).toHaveBeenCalledTimes(1);

      // 測試 User Select
      await handler.handle(createMockUserSelectInteraction('user:select', ['user1']) as any);
      expect(userCallback).toHaveBeenCalledTimes(1);

      // 測試 Role Select
      await handler.handle(createMockRoleSelectInteraction('role:select', ['role1']) as any);
      expect(roleCallback).toHaveBeenCalledTimes(1);
    });

    it('不同類型的處理器應該有獨立的名稱空間', () => {
      // 相同 customId 不同類型
      handler.registerStringSelect({
        customId: 'same:id',
        callback: vi.fn(),
        description: 'String',
      });
      handler.registerUserSelect({
        customId: 'same:id',
        callback: vi.fn(),
        description: 'User',
      });

      const handlers = handler.getRegisteredHandlers();
      expect(handlers).toHaveLength(2);
    });
  });

  describe('前綴匹配行為', () => {
    it('應該正確處理帶冒號的前綴', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerStringSelect({
        customId: 'menu:',
        callback,
      });

      const interaction = createMockStringSelectInteraction('menu:action:1', ['value']);
      await handler.handle(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('前綴應該區分大小寫', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerStringSelect({
        customId: 'MENU:',
        callback,
      });

      const interaction = createMockStringSelectInteraction('menu:action', ['value']);
      await handler.handle(interaction as any);

      // 不應該匹配（小寫 vs 大寫）
      expect(callback).not.toHaveBeenCalled();
    });

    it('前綴匹配應該有正確的優先級（精確匹配優先）', async () => {
      const exactCallback = vi.fn().mockResolvedValue(undefined);
      const prefixCallback = vi.fn().mockResolvedValue(undefined);

      // 先註冊前綴
      handler.registerStringSelect({
        customId: 'test:',
        callback: prefixCallback,
      });
      // 後註冊精確匹配
      handler.registerStringSelect({
        customId: 'test:exact',
        callback: exactCallback,
      });

      const interaction = createMockStringSelectInteraction('test:exact', ['value']);
      await handler.handle(interaction as any);

      // 精確匹配應該被調用
      expect(exactCallback).toHaveBeenCalledTimes(1);
      expect(prefixCallback).not.toHaveBeenCalled();
    });
  });

  describe('邊界情況', () => {
    it('應該處理沒有選擇任何選項的情況', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerStringSelect({
        customId: 'select:empty',
        callback,
      });

      const interaction = createMockStringSelectInteraction('select:empty', []);
      await handler.handle(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(interaction);
    });

    it('應該處理 customId 包含特殊字符的情況', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      handler.registerStringSelect({
        customId: 'test_special-chars_123',
        callback,
      });

      const interaction = createMockStringSelectInteraction('test_special-chars_123', ['value']);
      await handler.handle(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('應該處理很長的 customId', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      const longId = 'a'.repeat(100);

      handler.registerStringSelect({
        customId: longId,
        callback,
      });

      const interaction = createMockStringSelectInteraction(longId, ['value']);
      await handler.handle(interaction as any);

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });
});

describe('SelectMenuHandler 工廠函數', () => {
  it('應該可以從默認導入創建實例', async () => {
    const SelectMenuHandlerModule = await import('../../src/handlers/SelectMenuHandler.js');
    const handler = new SelectMenuHandlerModule.default();
    expect(handler).toBeDefined();
  });
});
