/**
 * Context Menu Handler - 右鍵選單互動處理器
 * @description 負責註冊和分發用戶/訊息右鍵選單交互事件
 */

import { MessageFlags, type UserContextMenuCommandInteraction, type MessageContextMenuCommandInteraction } from 'discord.js';
import logger from '../utils/logger.js';
import type {
  UserContextMenuHandlerConfig,
  UserContextMenuHandlerCallback,
  MessageContextMenuHandlerConfig,
  MessageContextMenuHandlerCallback,
  ContextMenuHandlerErrorOptions,
  RegisteredContextMenuInfo,
  ContextMenuType,
  ContextMenuHandlerResult,
  IContextMenuHandler,
} from '../types/handlers.js';

// Re-export types for external use
export type {
  UserContextMenuHandlerConfig,
  UserContextMenuHandlerCallback,
  MessageContextMenuHandlerConfig,
  MessageContextMenuHandlerCallback,
  ContextMenuHandlerErrorOptions,
  RegisteredContextMenuInfo,
  ContextMenuType,
  ContextMenuHandlerResult,
  IContextMenuHandler,
};

/**
 * Context Menu 處理器錯誤類
 */
export class ContextMenuHandlerError extends Error {
  public readonly interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction;
  public readonly options: ContextMenuHandlerErrorOptions;

  constructor(
    message: string,
    interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction,
    options: ContextMenuHandlerErrorOptions = {}
  ) {
    super(message);
    this.name = 'ContextMenuHandlerError';
    this.interaction = interaction;
    this.options = options;
  }
}

/**
 * ContextMenuHandler 類
 * @description 管理 Context Menu 處理器的註冊和分發
 */
export class ContextMenuHandler {
  private readonly userHandlers: Map<string, UserContextMenuHandlerConfig> = new Map();
  private readonly messageHandlers: Map<string, MessageContextMenuHandlerConfig> = new Map();
  private readonly defaultUserHandler?: UserContextMenuHandlerCallback;
  private readonly defaultMessageHandler?: MessageContextMenuHandlerCallback;
  private readonly errorHandler?: (error: ContextMenuHandlerError) => Promise<void>;

  /**
   * 建立 ContextMenuHandler 實例
   * @param options 選項配置
   */
  constructor(options: ContextMenuHandlerOptions = {}) {
    this.defaultUserHandler = options.defaultUserHandler;
    this.defaultMessageHandler = options.defaultMessageHandler;
    this.errorHandler = options.errorHandler;
  }

  /**
   * 註冊 User Context Menu 處理器
   * @param config 處理器配置
   * @returns 處理器配置（用於鏈式調用）
   */
  public registerUser(config: UserContextMenuHandlerConfig): UserContextMenuHandlerConfig {
    const { name } = config;
    this.userHandlers.set(name.toLowerCase(), config);
    return config;
  }

  /**
   * 註冊 Message Context Menu 處理器
   * @param config 處理器配置
   * @returns 處理器配置（用於鏈式調用）
   */
  public registerMessage(config: MessageContextMenuHandlerConfig): MessageContextMenuHandlerConfig {
    const { name } = config;
    this.messageHandlers.set(name.toLowerCase(), config);
    return config;
  }

  /**
   * 批量註冊 User Context Menu 處理器
   * @param configs 處理器配置陣列
   */
  public registerUserMany(configs: UserContextMenuHandlerConfig[]): void {
    for (const config of configs) {
      this.registerUser(config);
    }
  }

  /**
   * 批量註冊 Message Context Menu 處理器
   * @param configs 處理器配置陣列
   */
  public registerMessageMany(configs: MessageContextMenuHandlerConfig[]): void {
    for (const config of configs) {
      this.registerMessage(config);
    }
  }

  /**
   * 處理 Context Menu 交互事件
   * @param interaction Discord.js Context Menu Interaction
   */
  public async handle(
    interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction
  ): Promise<void> {
    try {
      // 判斷 Context Menu 類型並分發
      if (interaction.isUserContextMenuCommand()) {
        await this.handleUserContextMenu(interaction);
      } else if (interaction.isMessageContextMenuCommand()) {
        await this.handleMessageContextMenu(interaction);
      } else {
        await this.handleError(
          new ContextMenuHandlerError(
            'Unknown context menu type',
            interaction,
            { showToUser: true, logLevel: 'warn', customMessage: '未知的 Context Menu 類型' }
          )
        );
      }
    } catch (error) {
      // 處理器執行時發生錯誤
      if (error instanceof ContextMenuHandlerError) {
        await this.handleError(error);
      } else {
        await this.handleError(
          new ContextMenuHandlerError(
            error instanceof Error ? error.message : 'Unknown error',
            interaction,
            { showToUser: true, logLevel: 'error' }
          )
        );
      }
    }
  }

  /**
   * 處理 User Context Menu 交互
   * @param interaction User Context Menu Interaction
   */
  public async handleUserContextMenu(
    interaction: UserContextMenuCommandInteraction
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    try {
      const name = interaction.commandName.toLowerCase();

      // 嘗試找到匹配的處理器
      const config = this.userHandlers.get(name);

      if (config) {
        await this.executeUserHandler(config.callback, interaction);
      } else if (this.defaultUserHandler) {
        // 使用預設處理器
        await this.executeUserHandler(this.defaultUserHandler, interaction);
      } else {
        // 無匹配的處理器
        await interaction.editReply('❌ 未知的 Context Menu 命令');
      }
    } catch (error) {
      logger.error('[ContextMenuHandler] Error handling user context menu:', error);
      await interaction.editReply('❌ 處理命令時發生錯誤');
    }
  }

  /**
   * 處理 Message Context Menu 交互
   * @param interaction Message Context Menu Interaction
   */
  public async handleMessageContextMenu(
    interaction: MessageContextMenuCommandInteraction
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    try {
      const name = interaction.commandName.toLowerCase();

      // 嘗試找到匹配的處理器
      const config = this.messageHandlers.get(name);

      if (config) {
        await this.executeMessageHandler(config.callback, interaction);
      } else if (this.defaultMessageHandler) {
        // 使用預設處理器
        await this.executeMessageHandler(this.defaultMessageHandler, interaction);
      } else {
        // 無匹配的處理器
        await interaction.editReply('❌ 未知的 Context Menu 命令');
      }
    } catch (error) {
      logger.error('[ContextMenuHandler] Error handling message context menu:', error);
      await interaction.editReply('❌ 處理命令時發生錯誤');
    }
  }

  /**
   * 獲取所有已註冊的 Context Menu 處理器資訊
   * @returns 處理器資訊陣列
   */
  public getRegisteredMenus(): RegisteredContextMenuInfo[] {
    const infos: RegisteredContextMenuInfo[] = [];

    // User Context Menu 處理器
    for (const [name, config] of this.userHandlers) {
      infos.push({
        type: 'user',
        name,
        description: config.description,
        registeredAt: new Date(),
      });
    }

    // Message Context Menu 處理器
    for (const [name, config] of this.messageHandlers) {
      infos.push({
        type: 'message',
        name,
        description: config.description,
        registeredAt: new Date(),
      });
    }

    return infos;
  }

  /**
   * 檢查是否存在特定 User Context Menu 處理器
   * @param name Context Menu 名稱
   * @returns 是否存在
   */
  public hasUserHandler(name: string): boolean {
    return this.userHandlers.has(name.toLowerCase());
  }

  /**
   * 檢查是否存在特定 Message Context Menu 處理器
   * @param name Context Menu 名稱
   * @returns 是否存在
   */
  public hasMessageHandler(name: string): boolean {
    return this.messageHandlers.has(name.toLowerCase());
  }

  /**
   * 移除特定 User Context Menu 處理器
   * @param name Context Menu 名稱
   * @returns 是否成功移除
   */
  public removeUserHandler(name: string): boolean {
    return this.userHandlers.delete(name.toLowerCase());
  }

  /**
   * 移除特定 Message Context Menu 處理器
   * @param name Context Menu 名稱
   * @returns 是否成功移除
   */
  public removeMessageHandler(name: string): boolean {
    return this.messageHandlers.delete(name.toLowerCase());
  }

  /**
   * 清除所有處理器或特定類型的處理器
   * @param type 可選的 Context Menu 類型
   */
  public clear(type?: ContextMenuType): void {
    if (!type || type === 'user') {
      this.userHandlers.clear();
    }
    if (!type || type === 'message') {
      this.messageHandlers.clear();
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 執行使用者 Context Menu 處理器回調
   * @param callback 處理器回調
   * @param interaction User Context Menu 交互
   */
  private async executeUserHandler(
    callback: UserContextMenuHandlerCallback,
    interaction: UserContextMenuCommandInteraction
  ): Promise<void> {
    const result = callback(interaction);
    if (result instanceof Promise) {
      await result;
    }
  }

  /**
   * 執行訊息 Context Menu 處理器回調
   * @param callback 處理器回調
   * @param interaction Message Context Menu 交互
   */
  private async executeMessageHandler(
    callback: MessageContextMenuHandlerCallback,
    interaction: MessageContextMenuCommandInteraction
  ): Promise<void> {
    const result = callback(interaction);
    if (result instanceof Promise) {
      await result;
    }
  }

  /**
   * 處理錯誤
   * @param error ContextMenuHandlerError 實例
   */
  private async handleError(error: ContextMenuHandlerError): Promise<void> {
    // 記錄日誌
    if (error.options.logLevel) {
      const menuInfo = error.options.menuName
        ? ` [${error.options.menuType}:${error.options.menuName}]`
        : '';
      this.log(error.options.logLevel, error.message, menuInfo);
    }

    // 嘗試回應用戶
    if (error.options.showToUser) {
      try {
        await error.interaction.reply({
          content: error.options.customMessage || '處理此選單時發生錯誤',
          flags: [MessageFlags.Ephemeral],
        });
      } catch {
        // 如果無法回應，嘗試 followUp
        try {
          await error.interaction.followUp({
            content: error.options.customMessage || '處理此選單時發生錯誤',
            flags: [MessageFlags.Ephemeral],
          });
        } catch {
          // 忽略最終失敗
        }
      }
    }

    // 呼叫自定義錯誤處理器
    if (this.errorHandler) {
      await this.errorHandler(error);
    }
  }

  /**
   * 日誌輸出
   * @param level 日誌級別
   * @param message 訊息
   * @param menuInfo 相關的 Context Menu 資訊
   */
  private log(level: 'error' | 'warn' | 'info', message: string, menuInfo?: string): void {
    const timestamp = new Date().toISOString();
    const info = menuInfo || '';

    switch (level) {
      case 'error':
        console.error(`[${timestamp}] ContextMenuHandler ERROR${info}: ${message}`);
        break;
      case 'warn':
        console.warn(`[${timestamp}] ContextMenuHandler WARN${info}: ${message}`);
        break;
      case 'info':
        console.info(`[${timestamp}] ContextMenuHandler INFO${info}: ${message}`);
        break;
    }
  }
}

/**
 * ContextMenuHandler 選項配置
 */
export interface ContextMenuHandlerOptions {
  /** User Context Menu 預設處理器 */
  defaultUserHandler?: UserContextMenuHandlerCallback;
  /** Message Context Menu 預設處理器 */
  defaultMessageHandler?: MessageContextMenuHandlerCallback;
  /** 自定義錯誤處理器 */
  errorHandler?: (error: ContextMenuHandlerError) => Promise<void>;
}

/**
 * 建立 ContextMenuHandler 工廠函數
 * @param options 選項配置
 * @returns ContextMenuHandler 實例
 */
export function createContextMenuHandler(
  options?: ContextMenuHandlerOptions
): ContextMenuHandler {
  return new ContextMenuHandler(options);
}
