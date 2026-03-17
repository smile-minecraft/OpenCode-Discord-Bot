/**
 * Select Menu Handler
 * @description 處理各種 Select Menu 交互事件
 */

import { type AnySelectMenuInteraction } from 'discord.js';

import type {
  SelectMenuHandlerConfig,
  ChannelSelectMenuHandlerConfig,
  RoleSelectMenuHandlerConfig,
  UserSelectMenuHandlerConfig,
  MentionableSelectMenuHandlerConfig,
  AnySelectMenuHandlerConfig,
  SelectMenuValues,
  SelectMenuType,
  HandlerErrorOptions,
} from '../types/handlers.js';

/**
 * Select Menu 處理器選項
 */
export interface SelectMenuHandlerOptions {
  /** 是否記錄處理器調用（預設：true） */
  logCalls?: boolean;
  /** 全域預設啟用狀態（預設：true） */
  defaultEnabled?: boolean;
}

/**
 * 內部選單處理器儲存格式
 */
interface StoredHandler {
  /** 處理器配置 */
  config: {
    /** 自定義 ID */
    customId: string;
    /** 處理器回調函數 */
    callback: (interaction: AnySelectMenuInteraction) => Promise<void> | void;
    /** 處理器描述（可選） */
    description?: string;
  };
  /** 是否啟用 */
  enabled: boolean;
}

/**
 * Select Menu 處理器類別
 * @description 管理各種 Select Menu 的註冊和分發
 */
export class SelectMenuHandler {
  /** String Select Menu 處理器儲存 */
  private stringSelectHandlers = new Map<string, StoredHandler>();

  /** Channel Select Menu 處理器儲存 */
  private channelSelectHandlers = new Map<string, StoredHandler>();

  /** Role Select Menu 處理器儲存 */
  private roleSelectHandlers = new Map<string, StoredHandler>();

  /** User Select Menu 處理器儲存 */
  private userSelectHandlers = new Map<string, StoredHandler>();

  /** Mentionable Select Menu 處理器儲存 */
  private mentionableSelectHandlers = new Map<string, StoredHandler>();

  /** Any Select Menu 處理器儲存（通用） */
  private anySelectHandlers = new Map<string, StoredHandler>();

  /** 選項 */
  private readonly options: Required<SelectMenuHandlerOptions>;

  /**
   * 建立 Select Menu 處理器
   * @param options 處理器選項
   */
  constructor(options: SelectMenuHandlerOptions = {}) {
    this.options = {
      logCalls: options.logCalls ?? true,
      defaultEnabled: options.defaultEnabled ?? true,
    };
  }

  /**
   * 註冊 String Select Menu 處理器
   * @param config 處理器配置
   */
  registerStringSelect(config: SelectMenuHandlerConfig): void {
    this.stringSelectHandlers.set(config.customId, {
      config: config as StoredHandler['config'],
      enabled: this.options.defaultEnabled,
    });

    if (this.options.logCalls) {
      console.log(`[SelectMenuHandler] Registered StringSelect: ${config.customId}${config.description ? ` - ${config.description}` : ''}`);
    }
  }

  /**
   * 註冊 Channel Select Menu 處理器
   * @param config 處理器配置
   */
  registerChannelSelect(config: ChannelSelectMenuHandlerConfig): void {
    this.channelSelectHandlers.set(config.customId, {
      config: config as StoredHandler['config'],
      enabled: this.options.defaultEnabled,
    });

    if (this.options.logCalls) {
      console.log(`[SelectMenuHandler] Registered ChannelSelect: ${config.customId}${config.description ? ` - ${config.description}` : ''}`);
    }
  }

  /**
   * 註冊 Role Select Menu 處理器
   * @param config 處理器配置
   */
  registerRoleSelect(config: RoleSelectMenuHandlerConfig): void {
    this.roleSelectHandlers.set(config.customId, {
      config: config as StoredHandler['config'],
      enabled: this.options.defaultEnabled,
    });

    if (this.options.logCalls) {
      console.log(`[SelectMenuHandler] Registered RoleSelect: ${config.customId}${config.description ? ` - ${config.description}` : ''}`);
    }
  }

  /**
   * 註冊 User Select Menu 處理器
   * @param config 處理器配置
   */
  registerUserSelect(config: UserSelectMenuHandlerConfig): void {
    this.userSelectHandlers.set(config.customId, {
      config: config as StoredHandler['config'],
      enabled: this.options.defaultEnabled,
    });

    if (this.options.logCalls) {
      console.log(`[SelectMenuHandler] Registered UserSelect: ${config.customId}${config.description ? ` - ${config.description}` : ''}`);
    }
  }

  /**
   * 註冊 Mentionable Select Menu 處理器
   * @param config 處理器配置
   */
  registerMentionableSelect(config: MentionableSelectMenuHandlerConfig): void {
    this.mentionableSelectHandlers.set(config.customId, {
      config: config as StoredHandler['config'],
      enabled: this.options.defaultEnabled,
    });

    if (this.options.logCalls) {
      console.log(`[SelectMenuHandler] Registered MentionableSelect: ${config.customId}${config.description ? ` - ${config.description}` : ''}`);
    }
  }

  /**
   * 註冊任意類型的 Select Menu 處理器
   * @param config 處理器配置
   */
  registerAnySelect(config: AnySelectMenuHandlerConfig): void {
    this.anySelectHandlers.set(config.customId, {
      config: config as StoredHandler['config'],
      enabled: this.options.defaultEnabled,
    });

    if (this.options.logCalls) {
      console.log(`[SelectMenuHandler] Registered AnySelect: ${config.customId}${config.description ? ` - ${config.description}` : ''}`);
    }
  }

  /**
   * 處理 Select Menu 交互
   * @param interaction Select Menu 交互對象
   */
  async handle(interaction: AnySelectMenuInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    const customId = interaction.customId;
    
    // 修復: ComponentType[3] 返回 "SelectMenu" 而不是 "StringSelect"
    // 因為 ComponentType.StringSelect = 3 = ComponentType.SelectMenu (棄用的舊名稱)
    // 需要使用映射表來獲取正確的類型名稱
    const componentTypeMap: Record<number, string> = {
      3: 'StringSelect',      // ComponentType.StringSelect = 3
      4: 'UserSelect',       // ComponentType.UserSelect = 4
      5: 'RoleSelect',       // ComponentType.RoleSelect = 5
      6: 'MentionableSelect', // ComponentType.MentionableSelect = 6
      7: 'ChannelSelect',    // ComponentType.ChannelSelect = 7
    };
    const componentType = componentTypeMap[interaction.componentType] || 'StringSelect';

    if (this.options.logCalls) {
      console.log(`[SelectMenuHandler] Handling ${componentType}: ${customId} (raw: ${interaction.componentType})`);
    }

    try {
      // 根據組件類型分發到對應的處理器
      const handler = this.findHandler(customId, componentType);

      if (!handler) {
        if (this.options.logCalls) {
          console.warn(`[SelectMenuHandler] No handler found for: ${customId} (${componentType})`);
        }
        await interaction.editReply({ content: '無法找到對應的處理器' }).catch(() => {});
        return;
      }

      // 執行處理器
      await handler.config.callback(interaction);
      
      // 處理完成後編輯回覆
      await interaction.editReply({ content: '處理完成' }).catch(() => {});
    } catch (error) {
      await this.handleError(error, interaction, {
        showToUser: true,
        logLevel: 'error',
        customMessage: '處理選單時發生錯誤',
      });
    }
  }

  /**
   * 根據 customId 和組件類型查找處理器
   */
  private findHandler(customId: string, componentType: string) {
    // 優先查找精確匹配
    let stored = this.getHandlerByType(customId, componentType);
    if (stored) return stored;

    // 嘗試前綴匹配（支援如 "menu:" 匹配 "menu:123"）
    for (const [key, value] of this.getHandlersByComponentType(componentType)) {
      if (customId.startsWith(key + ':') || customId.startsWith(key)) {
        return value;
      }
    }

    return null;
  }

  /**
   * 根據組件類型獲取對應的處理器 Map
   */
  private getHandlersByComponentType(componentType: string): Map<string, StoredHandler> {
    switch (componentType) {
      case 'StringSelect':
        return this.stringSelectHandlers;
      case 'ChannelSelect':
        return this.channelSelectHandlers;
      case 'RoleSelect':
        return this.roleSelectHandlers;
      case 'UserSelect':
        return this.userSelectHandlers;
      case 'MentionableSelect':
        return this.mentionableSelectHandlers;
      default:
        return this.anySelectHandlers;
    }
  }

  /**
   * 根據 customId 和組件類型獲取處理器
   */
  private getHandlerByType(customId: string, componentType: string): StoredHandler | undefined {
    const handlers = this.getHandlersByComponentType(componentType);
    return handlers.get(customId);
  }

  /**
   * 從交互中提取選單值
   * @param interaction Select Menu 交互對象
   * @returns 選單值
   */
  static extractValues(interaction: AnySelectMenuInteraction): SelectMenuValues {
    // 修復: ComponentType[3] 返回 "SelectMenu" 而不是 "StringSelect"
    const componentTypeMap: Record<number, string> = {
      3: 'StringSelect',
      4: 'UserSelect',
      5: 'RoleSelect',
      6: 'MentionableSelect',
      7: 'ChannelSelect',
    };
    const componentTypeName = componentTypeMap[interaction.componentType] || 'StringSelect';
    const selectTypeMap: Record<string, SelectMenuType> = {
      StringSelect: 'stringSelect',
      ChannelSelect: 'channelSelect',
      RoleSelect: 'roleSelect',
      UserSelect: 'userSelect',
      MentionableSelect: 'mentionableSelect',
    };

    return {
      customId: interaction.customId,
      values: interaction.values,
      type: selectTypeMap[componentTypeName] || 'stringSelect',
      userId: interaction.user.id,
      channelId: interaction.channelId,
      messageId: interaction.message?.id || null,
      guildId: interaction.guildId,
    };
  }

  /**
   * 啟用或停用處理器
   * @param customId 處理器 customId
   * @param enabled 是否啟用
   * @param componentType 組件類型（可選，不指定則嘗試所有類型）
   * @returns 是否成功設置
   */
  setEnabled(customId: string, enabled: boolean, componentType?: string): boolean {
    if (componentType) {
      const handlers = this.getHandlersByComponentType(componentType);
      const stored = handlers.get(customId);
      if (stored) {
        stored.enabled = enabled;
        return true;
      }
      return false;
    }

    // 嘗試所有類型
    const allHandlers = [
      this.stringSelectHandlers,
      this.channelSelectHandlers,
      this.roleSelectHandlers,
      this.userSelectHandlers,
      this.mentionableSelectHandlers,
      this.anySelectHandlers,
    ];

    for (const handlers of allHandlers) {
      const stored = handlers.get(customId);
      if (stored) {
        stored.enabled = enabled;
        return true;
      }
    }

    return false;
  }

  /**
   * 獲取所有已註冊的處理器資訊
   */
  getRegisteredHandlers(): Array<{
    type: string;
    customId: string;
    description?: string;
    enabled: boolean;
  }> {
    const result: Array<{
      type: string;
      customId: string;
      description?: string;
      enabled: boolean;
    }> = [];

    const addFromMap = (map: Map<string, StoredHandler>, type: string) => {
      for (const [customId, stored] of map) {
        result.push({
          type,
          customId,
          description: stored.config.description,
          enabled: stored.enabled,
        });
      }
    };

    addFromMap(this.stringSelectHandlers, 'StringSelect');
    addFromMap(this.channelSelectHandlers, 'ChannelSelect');
    addFromMap(this.roleSelectHandlers, 'RoleSelect');
    addFromMap(this.userSelectHandlers, 'UserSelect');
    addFromMap(this.mentionableSelectHandlers, 'MentionableSelect');
    addFromMap(this.anySelectHandlers, 'AnySelect');

    return result;
  }

  /**
   * 獲取處理器數量統計
   */
  getStats(): Record<string, number> {
    return {
      stringSelect: this.stringSelectHandlers.size,
      channelSelect: this.channelSelectHandlers.size,
      roleSelect: this.roleSelectHandlers.size,
      userSelect: this.userSelectHandlers.size,
      mentionableSelect: this.mentionableSelectHandlers.size,
      anySelect: this.anySelectHandlers.size,
      total:
        this.stringSelectHandlers.size +
        this.channelSelectHandlers.size +
        this.roleSelectHandlers.size +
        this.userSelectHandlers.size +
        this.mentionableSelectHandlers.size +
        this.anySelectHandlers.size,
    };
  }

  /**
   * 處理錯誤
   */
  private async handleError(
    error: unknown,
    interaction: AnySelectMenuInteraction,
    options: HandlerErrorOptions
  ): Promise<void> {
    const logLevel = options.logLevel || 'error';
    const logger = console[logLevel] || console.error;

    logger(`[SelectMenuHandler Error]`, error);

    if (options.showToUser && interaction.isRepliable()) {
      try {
        await interaction.reply({
          content: options.customMessage || '處理您的請求時發生錯誤，請稍後再試。',
          flags: ['Ephemeral'],
        });
      } catch {
        // 如果無法回复，嘗試編輯回覆
        try {
          if (interaction.message) {
            await interaction.editReply({
              content: options.customMessage || '處理您的請求時發生錯誤，請稍後再試。',
            });
          }
        } catch {
          // 忽略
        }
      }
    }
  }
}

export default SelectMenuHandler;
