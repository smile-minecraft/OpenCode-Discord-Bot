/**
 * Select Menu Handler
 * @description 處理各種 Select Menu 交互事件
 */

import { type AnySelectMenuInteraction, ComponentType } from 'discord.js';

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
interface StoredHandler<T = SelectMenuHandlerConfig> {
  /** 處理器配置 */
  config: T;
  /** 是否啟用 */
  enabled: boolean;
}

/**
 * Select Menu 處理器類別
 * @description 管理各種 Select Menu 的註冊和分發
 */
export class SelectMenuHandler {
  /** String Select Menu 處理器儲存 */
  private stringSelectHandlers: Map<string, StoredHandler<SelectMenuHandlerConfig>> = new Map();

  /** Channel Select Menu 處理器儲存 */
  private channelSelectHandlers: Map<string, StoredHandler<ChannelSelectMenuHandlerConfig>> = new Map();

  /** Role Select Menu 處理器儲存 */
  private roleSelectHandlers: Map<string, StoredHandler<RoleSelectMenuHandlerConfig>> = new Map();

  /** User Select Menu 處理器儲存 */
  private userSelectHandlers: Map<string, StoredHandler<UserSelectMenuHandlerConfig>> = new Map();

  /** Mentionable Select Menu 處理器儲存 */
  private mentionableSelectHandlers: Map<string, StoredHandler<MentionableSelectMenuHandlerConfig>> = new Map();

  /** Any Select Menu 處理器儲存（通用） */
  private anySelectHandlers: Map<string, StoredHandler<AnySelectMenuHandlerConfig>> = new Map();

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
      config,
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
      config,
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
      config,
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
      config,
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
      config,
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
      config,
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
    const customId = interaction.customId;
    const componentType = ComponentType[interaction.componentType] as unknown as string;

    if (this.options.logCalls) {
      console.log(`[SelectMenuHandler] Handling ${componentType}: ${customId}`);
    }

    try {
      // 根據組件類型分發到對應的處理器
      const handler = this.findHandler(customId, componentType);

      if (!handler) {
        if (this.options.logCalls) {
          console.warn(`[SelectMenuHandler] No handler found for: ${customId} (${componentType})`);
        }
        return;
      }

      // 執行處理器
      await handler.config.callback(interaction);
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
    const componentTypeName = ComponentType[interaction.componentType] as unknown as string;
    const componentTypeMap: Record<string, SelectMenuType> = {
      StringSelect: 'stringSelect',
      ChannelSelect: 'channelSelect',
      RoleSelect: 'roleSelect',
      UserSelect: 'userSelect',
      MentionableSelect: 'mentionableSelect',
    };

    return {
      customId: interaction.customId,
      values: interaction.values,
      type: componentTypeMap[componentTypeName] || 'stringSelect',
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
          ephemeral: true,
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
