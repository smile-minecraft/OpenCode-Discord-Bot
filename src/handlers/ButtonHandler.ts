/**
 * Button Handler - 按鈕互動處理器
 * @description 負責註冊和分發按鈕交互事件
 */

import { MessageFlags } from 'discord.js';

import type {
  ButtonInteraction,
  ButtonHandlerConfig,
  ButtonHandlerCallback,
  HandlerErrorOptions,
  ButtonId解析結果,
  RegisteredHandlerInfo,
  HandlerResult,
} from '../types/handlers.js';
import logger from '../utils/logger.js';

// Re-export types for external use
export type {
  ButtonHandlerConfig,
  ButtonHandlerCallback,
  HandlerErrorOptions,
  ButtonId解析結果,
  RegisteredHandlerInfo,
  HandlerResult,
};

/**
 * 按鈕 ID 匹配結果
 */
interface MatchResult {
  config: ButtonHandlerConfig;
  matchType: 'exact' | 'prefix';
}

/**
 * 按鈕處理器錯誤類
 */
export class ButtonHandlerError extends Error {
  public readonly interaction: ButtonInteraction;
  public readonly options: HandlerErrorOptions;

  constructor(
    message: string,
    interaction: ButtonInteraction,
    options: HandlerErrorOptions = {}
  ) {
    super(message);
    this.name = 'ButtonHandlerError';
    this.interaction = interaction;
    this.options = options;
  }
}

/**
 * ButtonHandler 類
 * @description 管理按鈕處理器的註冊和分發
 */
export class ButtonHandler {
  private readonly handlers: Map<string, ButtonHandlerConfig> = new Map();
  private readonly prefixHandlers: ButtonHandlerConfig[] = [];
  private readonly defaultHandler?: ButtonHandlerCallback;
  private readonly errorHandler?: (error: ButtonHandlerError) => Promise<void>;

  /**
   * 建立 ButtonHandler 實例
   * @param options 選項配置
   */
  constructor(options: ButtonHandlerOptions = {}) {
    this.defaultHandler = options.defaultHandler;
    this.errorHandler = options.errorHandler;
  }

  /**
   * 註冊按鈕處理器
   * @param config 處理器配置
   * @returns 處理器配置（用於鏈式調用）
   */
  public register(config: ButtonHandlerConfig): ButtonHandlerConfig {
    const { customId } = config;

    // 檢查是否為前綴匹配（前綴匹配以 ":" 或 "_" 結尾）
    if (this.isPrefixPattern(customId)) {
      this.prefixHandlers.push(config);
      this.prefixHandlers.sort((a, b) => b.customId.length - a.customId.length); // 較長前綴優先
    } else {
      // 精確匹配
      this.handlers.set(customId, config);
    }

    return config;
  }

  /**
   * 批量註冊多個處理器
   * @param configs 處理器配置陣列
   */
  public registerMany(configs: ButtonHandlerConfig[]): void {
    for (const config of configs) {
      this.register(config);
    }
  }

  /**
   * 處理按鈕交互事件
   * @param interaction Discord.js ButtonInteraction
   */
  public async handle(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;

    try {
      // 嘗試找到匹配的處理器
      const matchResult = this.findHandler(customId);

      if (matchResult) {
        await this.executeHandler(matchResult.config.callback, interaction);
      } else if (this.defaultHandler) {
        // 使用預設處理器
        await this.executeHandler(this.defaultHandler, interaction);
      } else {
        // 無匹配的處理器
        await this.handleError(
          new ButtonHandlerError(
            `No handler registered for button: ${customId}`,
            interaction,
            { showToUser: true, logLevel: 'warn', customMessage: '此按鈕無法識別' }
          )
        );
      }
    } catch (error) {
      // 處理器執行時發生錯誤
      if (error instanceof ButtonHandlerError) {
        await this.handleError(error);
      } else {
        await this.handleError(
          new ButtonHandlerError(
            error instanceof Error ? error.message : 'Unknown error',
            interaction,
            { showToUser: true, logLevel: 'error' }
          )
        );
      }
    }
  }

  /**
   * 解析按鈕 ID
   * @param customId 按鈕自定義 ID
   * @returns 解析結果
   */
  public parseButtonId(customId: string): ButtonId解析結果 {
    const parts = customId.split(':');

    return {
      fullId: customId,
      prefix: parts.length > 1 ? parts[0] : undefined,
      params: parts.slice(1),
    };
  }

  /**
   * 獲取所有已註冊的處理器資訊
   * @returns 處理器資訊陣列
   */
  public getRegisteredHandlers(): RegisteredHandlerInfo[] {
    const infos: RegisteredHandlerInfo[] = [];

    // 精確匹配的處理器
    for (const [pattern, config] of this.handlers) {
      infos.push({
        type: 'button',
        pattern,
        description: config.description,
      });
    }

    // 前綴匹配的處理器
    for (const config of this.prefixHandlers) {
      infos.push({
        type: 'button',
        pattern: `${config.customId}*`,
        description: config.description,
      });
    }

    return infos;
  }

  /**
   * 檢查是否存在特定處理器
   * @param customId 按鈕自定義 ID
   * @returns 是否存在
   */
  public hasHandler(customId: string): boolean {
    return this.handlers.has(customId) || this.findHandler(customId) !== null;
  }

  /**
   * 移除特定處理器
   * @param customId 按鈕自定義 ID
   * @returns 是否成功移除
   */
  public removeHandler(customId: string): boolean {
    if (this.handlers.has(customId)) {
      this.handlers.delete(customId);
      return true;
    }

    const index = this.prefixHandlers.findIndex((h) => h.customId === customId);
    if (index !== -1) {
      this.prefixHandlers.splice(index, 1);
      return true;
    }

    return false;
  }

  /**
   * 清除所有處理器
   */
  public clear(): void {
    this.handlers.clear();
    this.prefixHandlers.length = 0;
  }

  // ==================== 私有方法 ====================

  /**
   * 檢查是否為前綴匹配模式
   * @param customId 自定義 ID
   */
  private isPrefixPattern(customId: string): boolean {
    return customId.endsWith(':') || customId.endsWith('_') || customId.endsWith('-');
  }

  /**
   * 查找匹配的處理器
   * @param customId 按鈕自定義 ID
   * @returns 匹配結果或 null
   */
  private findHandler(customId: string): MatchResult | null {
    // 首先嘗試精確匹配
    const exactMatch = this.handlers.get(customId);
    if (exactMatch) {
      return { config: exactMatch, matchType: 'exact' };
    }

    // 嘗試前綴匹配（較長前綴優先）
    for (const config of this.prefixHandlers) {
      if (customId.startsWith(config.customId)) {
        return { config, matchType: 'prefix' };
      }
    }

    return null;
  }

  /**
   * 執行處理器回調
   * @param callback 處理器回調
   * @param interaction 按鈕交互
   */
  private async executeHandler(
    callback: ButtonHandlerCallback,
    interaction: ButtonInteraction
  ): Promise<void> {
    const result = callback(interaction);

    // 處理同步或異步回調
    if (result instanceof Promise) {
      await result;
    }
  }

  /**
   * 處理錯誤
   * @param error ButtonHandlerError 實例
   */
  private async handleError(error: ButtonHandlerError): Promise<void> {
    // 記錄日誌
    if (error.options.logLevel) {
      this.log(error.options.logLevel, error.message, error.interaction.customId);
    }

    // 嘗試回應用戶
    if (error.options.showToUser) {
      try {
        await error.interaction.reply({
          content: error.options.customMessage || '處理此按鈕時發生錯誤',
          flags: [MessageFlags.Ephemeral],
        });
      } catch {
        // 如果無法回應，嘗試 followUp
        try {
          await error.interaction.followUp({
            content: error.options.customMessage || '處理此按鈕時發生錯誤',
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
   * @param customId 相關的自定義 ID
   */
  private log(level: 'error' | 'warn' | 'info', message: string, customId?: string): void {
    const idInfo = customId ? ` [${customId}]` : '';

    switch (level) {
      case 'error':
        logger.error(`ButtonHandler ERROR${idInfo}: ${message}`);
        break;
      case 'warn':
        logger.warn(`ButtonHandler WARN${idInfo}: ${message}`);
        break;
      case 'info':
        logger.info(`ButtonHandler INFO${idInfo}: ${message}`);
        break;
    }
  }
}

/**
 * ButtonHandler 選項配置
 */
export interface ButtonHandlerOptions {
  /** 預設處理器（當沒有匹配的處理器時調用） */
  defaultHandler?: ButtonHandlerCallback;
  /** 自定義錯誤處理器 */
  errorHandler?: (error: ButtonHandlerError) => Promise<void>;
}

/**
 * 建立 ButtonHandler 工廠函數
 * @param options 選項配置
 * @returns ButtonHandler 實例
 */
export function createButtonHandler(options?: ButtonHandlerOptions): ButtonHandler {
  return new ButtonHandler(options);
}