/**
 * EmbedBuilder Tests - 嵌入構建器單元測試
 * @description 測試 Embed 創建和顏色常量功能
 */

import { describe, it, expect } from 'vitest';
import {
  Colors,
  CustomEmbedBuilder,
  SessionEmbedBuilder,
  ModelSelectEmbedBuilder,
  ErrorEmbedBuilder,
  SuccessEmbedBuilder,
  WarningEmbedBuilder,
  InfoEmbedBuilder,
} from '../../src/builders/EmbedBuilder';
import { EmbedBuilder } from 'discord.js';

/**
 * 輔助函數：將 hex 顏色轉換為 Discord.js 內部使用的數值
 */
function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

// ============== 測試 suite ==============

describe('EmbedBuilder - 顏色常量', () => {
  describe('Colors', () => {
    it('應該有 SUCCESS 顏色', () => {
      expect(Colors.SUCCESS).toBeDefined();
      expect(Colors.SUCCESS).toBe('#4ADE80');
    });

    it('應該有 ERROR 顏色', () => {
      expect(Colors.ERROR).toBeDefined();
      expect(Colors.ERROR).toBe('#F87171');
    });

    it('應該有 WARNING 顏色', () => {
      expect(Colors.WARNING).toBeDefined();
      expect(Colors.WARNING).toBe('#FBBF24');
    });

    it('應該有 INFO 顏色', () => {
      expect(Colors.INFO).toBeDefined();
      expect(Colors.INFO).toBe('#60A5FA');
    });

    it('應該有 PRIMARY 顏色', () => {
      expect(Colors.PRIMARY).toBeDefined();
      expect(Colors.PRIMARY).toBe('#8B5CF6');
    });

    it('應該有 SECONDARY 顏色', () => {
      expect(Colors.SECONDARY).toBeDefined();
      expect(Colors.SECONDARY).toBe('#6B7280');
    });

    it('所有顏色應該是有效的顏色值', () => {
      const colorValues = Object.values(Colors);
      colorValues.forEach(color => {
        // 檢查是否是有效的 hex 顏色格式
        expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });
  });
});

describe('CustomEmbedBuilder', () => {
  describe('基本方法', () => {
    it('應該能夠創建實例', () => {
      const builder = new CustomEmbedBuilder();
      expect(builder).toBeInstanceOf(EmbedBuilder);
    });

    it('應該能夠設置標題', () => {
      const builder = new CustomEmbedBuilder();
      const result = builder.setTitle('測試標題');
      expect(result).toBe(builder); // 鏈式調用
    });

    it('應該能夠設置描述', () => {
      const builder = new CustomEmbedBuilder();
      const result = builder.setDescription('這是描述');
      expect(result).toBe(builder);
    });

    it('應該能夠設置顏色', () => {
      const builder = new CustomEmbedBuilder();
      const result = builder.setColor(Colors.INFO);
      expect(result).toBe(builder);
    });

    it('應該能夠添加字段', () => {
      const builder = new CustomEmbedBuilder();
      const result = builder.addFields({ name: '字段1', value: '值1' });
      expect(result).toBe(builder);
    });

    it('應該能夠添加帶有名稱和值的字段', () => {
      const builder = new CustomEmbedBuilder();
      const result = builder.addField('名稱', '值', true);
      expect(result).toBe(builder);
    });

    it('應該能夠設置作者', () => {
      const builder = new CustomEmbedBuilder();
      const result = builder.setAuthor({ name: '作者名稱' });
      expect(result).toBe(builder);
    });

    it('應該能夠設置頁腳', () => {
      const builder = new CustomEmbedBuilder();
      const result = builder.setFooter({ text: '頁腳文字' });
      expect(result).toBe(builder);
    });

    it('應該能夠設置縮圖', () => {
      const builder = new CustomEmbedBuilder();
      const result = builder.setThumbnail('https://example.com/thumb.png');
      expect(result).toBe(builder);
    });

    it('應該能夠設置圖片', () => {
      const builder = new CustomEmbedBuilder();
      const result = builder.setImage('https://example.com/image.png');
      expect(result).toBe(builder);
    });

    it('應該能夠設置時間戳', () => {
      const builder = new CustomEmbedBuilder();
      const result = builder.setTimestamp();
      expect(result).toBe(builder);
    });

    it('應該能夠設置自定義時間戳', () => {
      const builder = new CustomEmbedBuilder();
      const date = new Date('2024-01-01');
      const result = builder.setTimestamp(date);
      expect(result).toBe(builder);
    });
  });
});

describe('SessionEmbedBuilder', () => {
  describe('createSessionCard()', () => {
    it('應該正確創建 active 狀態的卡片', () => {
      const embed = SessionEmbedBuilder.createSessionCard({
        username: 'TestUser',
        sessionId: 'session123',
        model: 'gpt-4',
        status: 'active',
        avatarURL: 'https://example.com/avatar.png',
      });

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.author).toEqual({
        name: 'TestUser 的對話',
        icon_url: 'https://example.com/avatar.png',
      });
      // Discord.js 會將 hex 顏色轉換為數值
      expect(embed.data.color).toBeDefined();
      expect(embed.data.fields).toHaveLength(3);
    });

    it('應該正確創建 waiting 狀態的卡片', () => {
      const embed = SessionEmbedBuilder.createSessionCard({
        username: 'TestUser',
        sessionId: 'session456',
        model: 'gpt-3.5',
        status: 'waiting',
      });

      expect(embed.data.color).toBeDefined();
    });

    it('應該正確創建 paused 狀態的卡片', () => {
      const embed = SessionEmbedBuilder.createSessionCard({
        username: 'TestUser',
        sessionId: 'session789',
        model: 'gpt-4',
        status: 'paused',
      });

      expect(embed.data.color).toBeDefined();
    });

    it('應該正確創建 completed 狀態的卡片', () => {
      const embed = SessionEmbedBuilder.createSessionCard({
        username: 'TestUser',
        sessionId: 'session000',
        model: 'gpt-4',
        status: 'completed',
      });

      expect(embed.data.color).toBeDefined();
    });

    it('應該包含使用情況當提供 remainingUses 和 totalUses 時', () => {
      const embed = SessionEmbedBuilder.createSessionCard({
        username: 'TestUser',
        sessionId: 'session123',
        model: 'gpt-4',
        status: 'active',
        remainingUses: 5,
        totalUses: 10,
      });

      expect(embed.data.fields).toHaveLength(4); // 3 基本字段 + 1 使用情況
    });

    it('應該不包含使用情況當未提供時', () => {
      const embed = SessionEmbedBuilder.createSessionCard({
        username: 'TestUser',
        sessionId: 'session123',
        model: 'gpt-4',
        status: 'active',
      });

      expect(embed.data.fields).toHaveLength(3);
    });
  });
});

describe('ModelSelectEmbedBuilder', () => {
  describe('createModelSelectCard()', () => {
    it('應該正確創建模型選擇卡片', () => {
      const embed = ModelSelectEmbedBuilder.createModelSelectCard({
        username: 'TestUser',
        models: [
          { id: 'gpt-4', name: 'GPT-4', description: '最強大的模型' },
          { id: 'gpt-3.5', name: 'GPT-3.5', description: '快速響應' },
        ],
      });

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.color).toBeDefined();
      expect(embed.data.title).toBe('🤖 AI 模型選擇');
      expect(embed.data.fields).toHaveLength(2);
    });

    it('應該正確標記當前選擇的模型', () => {
      const embed = ModelSelectEmbedBuilder.createModelSelectCard({
        username: 'TestUser',
        models: [
          { id: 'gpt-4', name: 'GPT-4', description: '最強大的模型' },
          { id: 'gpt-3.5', name: 'GPT-3.5', description: '快速響應' },
        ],
        currentModel: 'gpt-4',
      });

      // GPT-4 應該有 ✅ 標記
      expect(embed.data.fields?.[0].name).toContain('✅');
      // GPT-3.5 應該沒有 ✅ 標記
      expect(embed.data.fields?.[1].name).toContain('🤖');
    });
  });

  describe('createModelInfoCard()', () => {
    it('應該正確創建模型資訊卡片', () => {
      const embed = ModelSelectEmbedBuilder.createModelInfoCard({
        modelId: 'gpt-4',
        modelName: 'GPT-4',
        description: '最先進的大型語言模型',
      });

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.color).toBeDefined();
      expect(embed.data.title).toBe('🤖 GPT-4');
      expect(embed.data.description).toBe('最先進的大型語言模型');
    });

    it('應該正確顯示模型能力', () => {
      const embed = ModelSelectEmbedBuilder.createModelInfoCard({
        modelId: 'gpt-4',
        modelName: 'GPT-4',
        description: '描述',
        capabilities: ['視覺分析', '代碼生成', '創意寫作'],
      });

      expect(embed.data.fields).toHaveLength(2);
      expect(embed.data.fields?.[1].name).toBe('✨ 能力');
    });
  });
});

describe('ErrorEmbedBuilder', () => {
  describe('createErrorCard()', () => {
    it('應該正確創建錯誤卡片', () => {
      const embed = ErrorEmbedBuilder.createErrorCard({
        description: '發生了一個錯誤',
      });

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.color).toBeDefined();
      expect(embed.data.title).toContain('錯誤');
      expect(embed.data.description).toBe('發生了一個錯誤');
    });

    it('應該正確設置自定義標題', () => {
      const embed = ErrorEmbedBuilder.createErrorCard({
        title: '自定義錯誤',
        description: '錯誤描述',
      });

      expect(embed.data.title).toContain('自定義錯誤');
    });

    it('應該正確顯示錯誤代碼', () => {
      const embed = ErrorEmbedBuilder.createErrorCard({
        description: '錯誤描述',
        errorCode: 'ERR_001',
      });

      expect(embed.data.fields).toHaveLength(1);
      expect(embed.data.fields?.[0].name).toBe('🔢 錯誤代碼');
    });

    it('應該正確顯示建議', () => {
      const embed = ErrorEmbedBuilder.createErrorCard({
        description: '錯誤描述',
        suggestion: '請稍後再試',
      });

      expect(embed.data.fields).toHaveLength(1);
      expect(embed.data.fields?.[0].name).toBe('💡 建議');
    });
  });

  describe('createPermissionDeniedCard()', () => {
    it('應該正確創建權限不足卡片', () => {
      const embed = ErrorEmbedBuilder.createPermissionDeniedCard({
        requiredPermission: 'Administrator',
      });

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.color).toBeDefined();
      expect(embed.data.title).toBe('🔒 權限不足');
    });
  });

  describe('createSessionExpiredCard()', () => {
    it('應該正確創建 Session 過期卡片', () => {
      const embed = ErrorEmbedBuilder.createSessionExpiredCard({
        sessionId: 'session123',
      });

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.color).toBeDefined();
      expect(embed.data.title).toBe('⏰ Session 過期');
    });
  });
});

describe('SuccessEmbedBuilder', () => {
  describe('createSuccessCard()', () => {
    it('應該正確創建成功卡片', () => {
      const embed = SuccessEmbedBuilder.createSuccessCard({
        description: '操作成功完成',
      });

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.color).toBeDefined();
      expect(embed.data.title).toContain('成功');
    });

    it('應該正確設置自定義標題', () => {
      const embed = SuccessEmbedBuilder.createSuccessCard({
        title: '完成！',
        description: '描述',
      });

      expect(embed.data.title).toContain('完成');
    });

    it('應該正確顯示額外信息', () => {
      const embed = SuccessEmbedBuilder.createSuccessCard({
        description: '操作成功',
        extra: [
          { label: '用戶', value: 'TestUser' },
          { label: '時間', value: '2024-01-01' },
        ],
      });

      expect(embed.data.fields).toHaveLength(2);
    });
  });

  describe('createSessionStartedCard()', () => {
    it('應該正確創建 Session 開始卡片', () => {
      const embed = SuccessEmbedBuilder.createSessionStartedCard({
        username: 'TestUser',
        sessionId: 'session123',
        model: 'gpt-4',
        availableUses: 10,
      });

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.color).toBeDefined();
      expect(embed.data.title).toBe('🎉 對話已開始');
      expect(embed.data.fields).toHaveLength(3);
    });
  });

  describe('createConfirmationCard()', () => {
    it('應該正確創建取消確認卡片', () => {
      const embed = SuccessEmbedBuilder.createConfirmationCard({
        action: 'cancel',
        target: '操作',
      });

      expect(embed.data.title).toBe('⛔ 操作已取消');
    });

    it('應該正確創建停止確認卡片', () => {
      const embed = SuccessEmbedBuilder.createConfirmationCard({
        action: 'stop',
        target: '對話',
      });

      expect(embed.data.title).toBe('🛑 已停止');
    });

    it('應該正確創建刪除確認卡片', () => {
      const embed = SuccessEmbedBuilder.createConfirmationCard({
        action: 'delete',
        target: '項目',
      });

      expect(embed.data.title).toBe('🗑️ 已刪除');
    });

    it('應該正確創建重置確認卡片', () => {
      const embed = SuccessEmbedBuilder.createConfirmationCard({
        action: 'reset',
        target: '設置',
      });

      expect(embed.data.title).toBe('🔄 已重置');
    });
  });
});

describe('WarningEmbedBuilder', () => {
  describe('createWarningCard()', () => {
    it('應該正確創建警告卡片', () => {
      const embed = WarningEmbedBuilder.createWarningCard({
        description: '這是一個警告',
      });

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.color).toBeDefined();
      expect(embed.data.title).toBe('⚠️ 警告');
    });

    it('應該正確顯示剩餘次數', () => {
      const embed = WarningEmbedBuilder.createWarningCard({
        description: '警告描述',
        remainingUses: 5,
      });

      expect(embed.data.fields).toHaveLength(1);
      expect(embed.data.fields?.[0].name).toBe('📊 剩餘次數');
    });
  });

  describe('createUsageLowCard()', () => {
    it('應該正確創建次數不足卡片', () => {
      const embed = WarningEmbedBuilder.createUsageLowCard({
        remainingUses: 2,
        totalUses: 10,
      });

      expect(embed).toBeInstanceOf(EmbedBuilder);
      // Discord.js 將 hex 顏色轉換為數值
      expect(embed.data.color).toBe(hexToNumber(Colors.WARNING));
      expect(embed.data.title).toBe('📉 剩餘次數不足');
    });

    it('應該正確計算百分比', () => {
      const embed = WarningEmbedBuilder.createUsageLowCard({
        remainingUses: 5,
        totalUses: 10,
      });

      // 描述應該包含百分比
      expect(embed.data.description).toContain('50%');
    });
  });
});

describe('InfoEmbedBuilder', () => {
  describe('createInfoCard()', () => {
    it('應該正確創建資訊卡片', () => {
      const embed = InfoEmbedBuilder.createInfoCard({
        description: '這是一些資訊',
      });

      expect(embed).toBeInstanceOf(EmbedBuilder);
      // Discord.js 將 hex 顏色轉換為數值
      expect(embed.data.color).toBe(hexToNumber(Colors.INFO));
      expect(embed.data.title).toBe('ℹ️ 資訊');
    });

    it('應該正確添加字段', () => {
      const embed = InfoEmbedBuilder.createInfoCard({
        description: '描述',
        fields: [
          { name: '字段1', value: '值1', inline: true },
          { name: '字段2', value: '值2', inline: false },
        ],
      });

      expect(embed.data.fields).toHaveLength(2);
    });

    it('應該正確設置圖片', () => {
      const embed = InfoEmbedBuilder.createInfoCard({
        description: '描述',
        imageUrl: 'https://example.com/image.png',
      });

      expect(embed.data.image).toBeDefined();
    });
  });

  describe('createHelpCard()', () => {
    it('應該正確創建使用說明卡片', () => {
      const embed = InfoEmbedBuilder.createHelpCard({
        commands: [
          { command: '/start', description: '開始對話' },
          { command: '/help', description: '顯示幫助', usage: '/help' },
        ],
      });

      expect(embed).toBeInstanceOf(EmbedBuilder);
      // Discord.js 將 hex 顏色轉換為數值
      expect(embed.data.color).toBe(hexToNumber(Colors.INFO));
      expect(embed.data.title).toBe('📖 使用說明');
      expect(embed.data.fields).toHaveLength(2);
    });
  });
});

describe('Default Export', () => {
  it('應該正確導出所有構建器', async () => {
    // 使用 ES Module 動態匯入
    const mod = await import('../../src/builders/index.js');
    
    expect(mod.Colors).toBeDefined();
    expect(mod.CustomEmbedBuilder).toBeDefined();
    expect(mod.SessionEmbedBuilder).toBeDefined();
    expect(mod.ModelSelectEmbedBuilder).toBeDefined();
    expect(mod.ErrorEmbedBuilder).toBeDefined();
    expect(mod.SuccessEmbedBuilder).toBeDefined();
    expect(mod.WarningEmbedBuilder).toBeDefined();
    expect(mod.InfoEmbedBuilder).toBeDefined();
  });
});

