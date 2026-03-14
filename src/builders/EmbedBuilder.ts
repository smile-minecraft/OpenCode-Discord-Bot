/**
 * Embed Builder - 統一訊息卡片建構工具
 * @description 提供各類型的 Discord Embed 卡片，支持鏈式調用
 */

import { EmbedBuilder, APIEmbedField, ColorResolvable, GuildMember, User } from 'discord.js';

// ============== 顏色常量 ==============

/** 成功顏色 - 綠色 */
export const Colors = {
  SUCCESS: '#4ADE80' as ColorResolvable,
  ERROR: '#F87171' as ColorResolvable,
  WARNING: '#FBBF24' as ColorResolvable,
  INFO: '#60A5FA' as ColorResolvable,
  PRIMARY: '#8B5CF6' as ColorResolvable,
  SECONDARY: '#6B7280' as ColorResolvable,
} as const;

// ============== 基礎 Embed 構建器 ==============

/**
 * 自定義 Embed 構建器
 * @extends EmbedBuilder
 * @description 提供鏈式調用介面，簡化 Embed 創建流程
 */
export class CustomEmbedBuilder extends EmbedBuilder {
  constructor() {
    super();
  }

  /**
   * 設置標題
   */
  setTitle(title: string): this {
    return super.setTitle(title);
  }

  /**
   * 設置描述
   */
  setDescription(description: string): this {
    return super.setDescription(description);
  }

  /**
   * 設置顏色
   */
  setColor(color: ColorResolvable): this {
    return super.setColor(color);
  }

  /**
   * 添加字段
   */
  addFields(...fields: APIEmbedField[]): this {
    return super.addFields(...fields);
  }

  /**
   * 設置作者
   */
  setAuthor(options: { name: string; iconURL?: string; url?: string }): this {
    return super.setAuthor(options);
  }

  /**
   * 設置頁腳
   */
  setFooter(options: { text: string; iconURL?: string }): this {
    return super.setFooter(options);
  }

  /**
   * 設置縮圖
   */
  setThumbnail(url: string): this {
    return super.setThumbnail(url);
  }

  /**
   * 設置圖片
   */
  setImage(url: string): this {
    return super.setImage(url);
  }

  /**
   * 設置時間戳
   */
  setTimestamp(date?: Date): this {
    return super.setTimestamp(date);
  }

  /**
   * 添加帶有名稱和值的字段
   */
  addField(name: string, value: string, inline?: boolean): this {
    return super.addFields({ name, value, inline });
  }
}

// ============== 專用 Embed 構建器 ==============

/**
 * Session 狀態卡片
 * @description 顯示當前 AI 對話 Session 的狀態
 */
export class SessionEmbedBuilder extends CustomEmbedBuilder {
  /**
   * 創建 Session 狀態卡片
   */
  static createSessionCard(options: {
    /** 用戶名稱 */
    username: string;
    /** 用戶頭像 URL */
    avatarURL?: string;
    /** Session ID */
    sessionId: string;
    /** 當前模型 */
    model: string;
    /** 狀態文字 */
    status: 'active' | 'waiting' | 'paused' | 'completed';
    /** 剩餘次數（可選） */
    remainingUses?: number;
    /** 總使用次數（可選） */
    totalUses?: number;
  }): EmbedBuilder {
    const { username, avatarURL, sessionId, model, status, remainingUses, totalUses } = options;

    // 狀態顏色映射
    const statusColors: Record<string, ColorResolvable> = {
      active: Colors.INFO,
      waiting: Colors.WARNING,
      paused: Colors.SECONDARY,
      completed: Colors.SUCCESS,
    };

    // 狀態文字映射
    const statusTexts: Record<string, string> = {
      active: '⚡ 進行中',
      waiting: '⏳ 等待中',
      paused: '⏸️ 已暫停',
      completed: '✅ 已完成',
    };

    const embed = new EmbedBuilder()
      .setAuthor({
        name: `${username} 的對話`,
        iconURL: avatarURL,
      })
      .setColor(statusColors[status] || Colors.INFO)
      .setTimestamp()
      .addFields(
        { name: '🆔 Session ID', value: `\`${sessionId}\``, inline: true },
        { name: '🤖 模型', value: model, inline: true },
        { name: '📊 狀態', value: statusTexts[status], inline: true }
      );

    // 添加使用次數信息
    if (remainingUses !== undefined && totalUses !== undefined) {
      const usageText = `${remainingUses} / ${totalUses}`;
      const usageBar = '█'.repeat(Math.floor((remainingUses / totalUses) * 10)) + '░'.repeat(10 - Math.floor((remainingUses / totalUses) * 10));
      embed.addFields({
        name: '📈 使用情況',
        value: `${usageBar} \`${usageText}\``,
        inline: false,
      });
    }

    return embed;
  }
}

/**
 * 模型選擇卡片
 * @description 讓用戶選擇 AI 模型
 */
export class ModelSelectEmbedBuilder extends CustomEmbedBuilder {
  /**
   * 創建模型選擇卡片
   */
  static createModelSelectCard(options: {
    /** 用戶名稱 */
    username: string;
    /** 用戶頭像 URL */
    avatarURL?: string;
    /** 可用模型列表 */
    models: Array<{
      id: string;
      name: string;
      description: string;
    }>;
    /** 當前選擇的模型（可選） */
    currentModel?: string;
  }): EmbedBuilder {
    const { username, avatarURL, models, currentModel } = options;

    const modelFields = models.map((model) => ({
      name: `${model.id === currentModel ? '✅ ' : '🤖 '} ${model.name}`,
      value: model.description,
      inline: false,
    }));

    return new EmbedBuilder()
      .setAuthor({
        name: `${username} 請選擇模型`,
        iconURL: avatarURL,
      })
      .setColor(Colors.PRIMARY)
      .setTitle('🤖 AI 模型選擇')
      .setDescription('請從下方的選單中選擇你想要使用的 AI 模型')
      .addFields(...modelFields)
      .setFooter({ text: '選擇模型後將自動開始對話' })
      .setTimestamp();
  }

  /**
   * 創建模型資訊卡片（顯示單一模型詳情）
   */
  static createModelInfoCard(options: {
    /** 模型 ID */
    modelId: string;
    /** 模型名稱 */
    modelName: string;
    /** 模型描述 */
    description: string;
    /** 模型能力 */
    capabilities?: string[];
  }): EmbedBuilder {
    const { modelId, modelName, description, capabilities } = options;

    const embed = new EmbedBuilder()
      .setColor(Colors.INFO)
      .setTitle(`🤖 ${modelName}`)
      .setDescription(description)
      .addFields({ name: '🆔 模型 ID', value: `\`${modelId}\``, inline: true });

    if (capabilities && capabilities.length > 0) {
      embed.addFields({
        name: '✨ 能力',
        value: capabilities.map((c) => `• ${c}`).join('\n'),
        inline: false,
      });
    }

    return embed;
  }
}

/**
 * 錯誤訊息卡片
 * @description 顯示錯誤訊息給用戶
 */
export class ErrorEmbedBuilder extends CustomEmbedBuilder {
  /**
   * 創建錯誤訊息卡片
   */
  static createErrorCard(options: {
    /** 錯誤標題 */
    title?: string;
    /** 錯誤描述 */
    description: string;
    /** 錯誤代碼（可選） */
    errorCode?: string;
    /** 建議操作（可選） */
    suggestion?: string;
  }): EmbedBuilder {
    const { title, description, errorCode, suggestion } = options;

    const embed = new EmbedBuilder()
      .setColor(Colors.ERROR)
      .setTitle(title || '❌ 發生錯誤')
      .setDescription(description)
      .setTimestamp();

    if (errorCode) {
      embed.addFields({
        name: '🔢 錯誤代碼',
        value: `\`${errorCode}\``,
        inline: true,
      });
    }

    if (suggestion) {
      embed.addFields({
        name: '💡 建議',
        value: suggestion,
        inline: false,
      });
    }

    return embed;
  }

  /**
   * 創建權限不足卡片
   */
  static createPermissionDeniedCard(options: {
    /** 需要權限 */
    requiredPermission: string;
    /** 用戶 */
    user?: User | GuildMember;
  }): EmbedBuilder {
    const { requiredPermission, user } = options;

    return new EmbedBuilder()
      .setColor(Colors.ERROR)
      .setTitle('🔒 權限不足')
      .setDescription(`你需要 \`${requiredPermission}\` 權限才能執行此操作`)
      .setFooter({
        text: user ? `由 ${user.displayName} 嘗試執行` : '權限驗證失敗',
      })
      .setTimestamp();
  }

  /**
   * 創建 Session 過期卡片
   */
  static createSessionExpiredCard(options: {
    /** Session ID */
    sessionId: string;
    /** 剩餘時間（可選） */
    remainingTime?: number;
  }): EmbedBuilder {
    const { sessionId, remainingTime } = options;

    const description = remainingTime
      ? `此對話已過期，請重新開始新對話`
      : `Session \`${sessionId}\` 已過期`;

    return new EmbedBuilder()
      .setColor(Colors.WARNING)
      .setTitle('⏰ Session 過期')
      .setDescription(description)
      .addFields({
        name: '💡 重新開始',
        value: '使用 `/start` 或 `/new` 指令開始新的對話',
        inline: false,
      })
      .setTimestamp();
  }
}

/**
 * 成功訊息卡片
 * @description 顯示成功訊息給用戶
 */
export class SuccessEmbedBuilder extends CustomEmbedBuilder {
  /**
   * 創建成功訊息卡片
   */
  static createSuccessCard(options: {
    /** 成功標題 */
    title?: string;
    /** 成功描述 */
    description: string;
    /** 額外信息（可選） */
    extra?: {
      label: string;
      value: string;
    }[];
  }): EmbedBuilder {
    const { title, description, extra } = options;

    const embed = new EmbedBuilder()
      .setColor(Colors.SUCCESS)
      .setTitle(title || '✅ 操作成功')
      .setDescription(description)
      .setTimestamp();

    if (extra) {
      extra.forEach((item) => {
        embed.addFields({ name: item.label, value: item.value, inline: true });
      });
    }

    return embed;
  }

  /**
   * 創建 Session 開始成功卡片
   */
  static createSessionStartedCard(options: {
    /** 用戶名稱 */
    username: string;
    /** Session ID */
    sessionId: string;
    /** 模型 */
    model: string;
    /** 可用次數 */
    availableUses: number;
  }): EmbedBuilder {
    const { username, sessionId, model, availableUses } = options;

    return new EmbedBuilder()
      .setColor(Colors.SUCCESS)
      .setAuthor({
        name: `${username} 歡迎使用！`,
        iconURL: 'https://i.imgur.com/AfFp7pu.png',
      })
      .setTitle('🎉 對話已開始')
      .setDescription('請在下方輸入你的問題或指令，AI 將為你解答')
      .addFields(
        { name: '🆔 Session ID', value: `\`${sessionId}\``, inline: true },
        { name: '🤖 模型', value: model, inline: true },
        { name: '📊 剩餘次數', value: `${availableUses} 次`, inline: true }
      )
      .setFooter({ text: '輸入你的第一個問題開始對話吧！' })
      .setTimestamp();
  }

  /**
   * 創建操作確認卡片
   */
  static createConfirmationCard(options: {
    /** 操作類型 */
    action: 'cancel' | 'stop' | 'delete' | 'reset';
    /** 目標描述 */
    target: string;
    /** 結果 */
    result?: string;
  }): EmbedBuilder {
    const { action, target, result } = options;

    const actionConfig: Record<string, { emoji: string; title: string; description: string }> = {
      cancel: {
        emoji: '⛔',
        title: '操作已取消',
        description: `已取消對 \`${target}\` 的操作`,
      },
      stop: {
        emoji: '🛑',
        title: '已停止',
        description: `已停止 \`${target}\``,
      },
      delete: {
        emoji: '🗑️',
        title: '已刪除',
        description: `已刪除 \`${target}\``,
      },
      reset: {
        emoji: '🔄',
        title: '已重置',
        description: `已重置 \`${target}\``,
      },
    };

    const config = actionConfig[action];

    const embed = new EmbedBuilder()
      .setColor(Colors.SUCCESS)
      .setTitle(`${config.emoji} ${config.title}`)
      .setDescription(config.description)
      .setTimestamp();

    if (result) {
      embed.addFields({ name: '📋 詳細結果', value: result, inline: false });
    }

    return embed;
  }
}

/**
 * 警告訊息卡片
 * @description 顯示警告訊息給用戶
 */
export class WarningEmbedBuilder extends CustomEmbedBuilder {
  /**
   * 創建警告訊息卡片
   */
  static createWarningCard(options: {
    /** 警告標題 */
    title?: string;
    /** 警告描述 */
    description: string;
    /** 剩餘次數（可選） */
    remainingUses?: number;
  }): EmbedBuilder {
    const { title, description, remainingUses } = options;

    const embed = new EmbedBuilder()
      .setColor(Colors.WARNING)
      .setTitle(title || '⚠️ 警告')
      .setDescription(description)
      .setTimestamp();

    if (remainingUses !== undefined) {
      embed.addFields({
        name: '📊 剩餘次數',
        value: `${remainingUses} 次`,
        inline: true,
      });
    }

    return embed;
  }

  /**
   * 創建次數即將用盡卡片
   */
  static createUsageLowCard(options: {
    /** 剩餘次數 */
    remainingUses: number;
    /** 總次數 */
    totalUses: number;
  }): EmbedBuilder {
    const { remainingUses, totalUses } = options;
    const percentage = Math.round((remainingUses / totalUses) * 100);

    return new EmbedBuilder()
      .setColor(Colors.WARNING)
      .setTitle('📉 剩餘次數不足')
      .setDescription(`你的剩餘次數為 **${remainingUses}** 次（${percentage}%）`)
      .addFields({
        name: '💡 建議',
        value: '請考慮購買更多次數或等待重置',
        inline: false,
      })
      .setTimestamp();
  }
}

/**
 * 資訊訊息卡片
 * @description 顯示一般資訊給用戶
 */
export class InfoEmbedBuilder extends CustomEmbedBuilder {
  /**
   * 創建資訊訊息卡片
   */
  static createInfoCard(options: {
    /** 標題 */
    title?: string;
    /** 描述 */
    description: string;
    /** 字段（可選） */
    fields?: Array<{
      name: string;
      value: string;
      inline?: boolean;
    }>;
    /** 圖片 URL（可選） */
    imageUrl?: string;
  }): EmbedBuilder {
    const { title, description, fields, imageUrl } = options;

    const embed = new EmbedBuilder()
      .setColor(Colors.INFO)
      .setTitle(title || 'ℹ️ 資訊')
      .setDescription(description)
      .setTimestamp();

    if (fields) {
      embed.addFields(...fields);
    }

    if (imageUrl) {
      embed.setImage(imageUrl);
    }

    return embed;
  }

  /**
   * 創建使用說明卡片
   */
  static createHelpCard(options: {
    /** 指令列表 */
    commands: Array<{
      command: string;
      description: string;
      usage?: string;
    }>;
  }): EmbedBuilder {
    const { commands } = options;

    const commandFields = commands.map((cmd) => ({
      name: `\`${cmd.command}\``,
      value: `${cmd.description}${cmd.usage ? `\n用法: \`${cmd.usage}\`` : ''}`,
      inline: false,
    }));

    return new EmbedBuilder()
      .setColor(Colors.INFO)
      .setTitle('📖 使用說明')
      .setDescription('以下是可用的指令列表')
      .addFields(...commandFields)
      .setFooter({ text: '如需更多幫助，請使用 /help 指令' })
      .setTimestamp();
  }
}

// ============== 預設導出 ==============

export default {
  Colors,
  CustomEmbedBuilder,
  SessionEmbedBuilder,
  ModelSelectEmbedBuilder,
  ErrorEmbedBuilder,
  SuccessEmbedBuilder,
  WarningEmbedBuilder,
  InfoEmbedBuilder,
};
