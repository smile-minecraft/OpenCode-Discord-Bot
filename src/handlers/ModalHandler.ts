/**
 * Modal Handler - Modal 提交處理器
 * @description 處理 ModalSubmitInteraction，支援多步驟表單流程
 */

import {
  ModalSubmitInteraction,
  TextInputComponent,
  EmbedBuilder,
  Colors
} from 'discord.js';
import type {
  ModalHandlerConfig,
  HandlerResult,
  HandlerErrorOptions,
  ModalFieldValue,
  ModalSubmitData,
  MultiStepFormState,
  ModalHandlerErrorOptions,
  RegisteredModalInfo,
  IModalHandler,
} from '../types/handlers.js';

// Re-export types for external use
export type {
  ModalHandlerConfig,
  HandlerResult,
  HandlerErrorOptions,
  ModalFieldValue,
  ModalSubmitData,
  MultiStepFormState,
  ModalHandlerErrorOptions,
  RegisteredModalInfo,
  IModalHandler,
};

/**
 * ModalHandler 預設實現
 */
export class ModalHandler implements IModalHandler {
  private handlers: Map<string, ModalHandlerConfig> = new Map();
  private prefixHandlers: Map<string, ModalHandlerConfig[]> = new Map();
  private logger?: Console;

  constructor(logger?: Console) {
    this.logger = logger;
  }

  /**
   * 註冊 Modal 處理器
   */
  register(config: ModalHandlerConfig): void {
    const { customId, description } = config;

    if (customId.includes(':')) {
      // 前綴模式（如 "form:survey" 匹配 "form:survey:123"）
      const prefix = customId.split(':')[0];
      const existing = this.prefixHandlers.get(prefix) || [];
      existing.push(config);
      this.prefixHandlers.set(prefix, existing);
      this.log(`Registered prefix modal handler: "${prefix}" - ${description || 'no description'}`);
    } else {
      // 精確匹配
      this.handlers.set(customId, config);
      this.log(`Registered exact modal handler: "${customId}" - ${description || 'no description'}`);
    }
  }

  /**
   * 處理 Modal 提交
   */
  async handle(interaction: ModalSubmitInteraction): Promise<void> {
    const modalId = interaction.customId;

    // 先嘗試精確匹配
    let handler = this.handlers.get(modalId);

    // 如果沒有精確匹配，嘗試前綴匹配
    if (!handler) {
      const prefix = modalId.split(':')[0];
      const prefixHandlers = this.prefixHandlers.get(prefix);

      if (prefixHandlers && prefixHandlers.length > 0) {
        // 找到最長匹配的前綴處理器
        handler = prefixHandlers.find(h => {
          const pattern = h.customId.replace('.', '\\.');
          const regex = new RegExp(`^${pattern}`);
          return regex.test(modalId);
        }) || prefixHandlers[0];
      }
    }

    if (!handler) {
      const errorMsg = `No handler found for modal: ${modalId}`;
      this.log(errorMsg, 'error');
      await this.sendErrorResponse(interaction, {
        showToUser: true,
        customMessage: '此表單無法識別，請重新操作。'
      });
      return;
    }

    try {
      this.log(`Handling modal: ${modalId}`);
      await handler.callback(interaction);
    } catch (error) {
      this.log(`Error handling modal ${modalId}: ${error}`, 'error');
      await this.sendErrorResponse(interaction, {
        showToUser: true,
        customMessage: '處理表單時發生錯誤，請稍後再試。'
      });
    }
  }

  /**
   * 從 Modal 提取欄位值
   */
  extractFields(interaction: ModalSubmitInteraction): ModalFieldValue[] {
    const fields: ModalFieldValue[] = [];

    // Modal 的 components 是 ActionRow[]
    for (const row of interaction.components) {
      // 檢查是否是 ActionRow
      if ('components' in row) {
        for (const component of row.components) {
          // 檢查是否是 TextInputComponent
          if (component.type === 4) {
            const textInput = component as TextInputComponent;
            fields.push({
              customId: textInput.customId,
              value: textInput.value || ''
            });
          }
        }
      }
    }

    return fields;
  }

  /**
   * 解析為結構化資料
   */
  parseModalData(interaction: ModalSubmitInteraction): ModalSubmitData {
    return {
      modalId: interaction.customId,
      userId: interaction.user.id,
      guildId: interaction.guildId ?? undefined,
      channelId: interaction.channelId ?? '',
      fields: this.extractFields(interaction)
    };
  }

  /**
   * 獲取特定欄位值
   */
  getFieldValue(interaction: ModalSubmitInteraction, customId: string): string | null {
    const fields = this.extractFields(interaction);
    const field = fields.find(f => f.customId === customId);
    return field?.value || null;
  }

  /**
   * 獲取所有已註冊的 Modal 處理器
   */
  getRegisteredModals(): RegisteredModalInfo[] {
    const modals: RegisteredModalInfo[] = [];

    // 精確匹配的處理器
    for (const [customId, config] of this.handlers) {
      modals.push({
        customId,
        description: config.description,
        registeredAt: new Date()
      });
    }

    // 前綴匹配的處理器
    for (const [prefix, configs] of this.prefixHandlers) {
      for (const config of configs) {
        modals.push({
          customId: `${prefix}:*`,
          description: config.description,
          registeredAt: new Date()
        });
      }
    }

    return modals;
  }

  /**
   * 清除處理器
   */
  clear(customId?: string): void {
    if (customId) {
      this.handlers.delete(customId);
      // 清除前綴匹配中的特定處理器
      for (const [prefix, configs] of this.prefixHandlers) {
        const filtered = configs.filter(c => c.customId !== customId);
        if (filtered.length > 0) {
          this.prefixHandlers.set(prefix, filtered);
        } else {
          this.prefixHandlers.delete(prefix);
        }
      }
    } else {
      this.handlers.clear();
      this.prefixHandlers.clear();
    }
  }

  /**
   * 發送錯誤響應
   */
  private async sendErrorResponse(
    interaction: ModalSubmitInteraction,
    options: ModalHandlerErrorOptions
  ): Promise<void> {
    if (!options.showToUser) return;
    
    try {
      const errorEmbed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle('❌ 錯誤')
        .setDescription(options.customMessage || '發生錯誤，請稍後再試。')
        .setTimestamp();
      
      if (interaction.replied) {
        await interaction.followUp({ 
          embeds: [errorEmbed], 
          ephemeral: true 
        });
      } else if (interaction.deferred) {
        await interaction.editReply({ 
          embeds: [errorEmbed] 
        });
      } else {
        await interaction.reply({ 
          embeds: [errorEmbed], 
          ephemeral: true 
        });
      }
    } catch (error) {
      this.log(`Failed to send error response: ${error}`, 'error');
    }
  }

  /**
   * 內部日誌
   */
  private log(message: string, level: 'info' | 'error' = 'info'): void {
    if (this.logger) {
      if (level === 'error') {
        this.logger.error(`[ModalHandler] ${message}`);
      } else {
        this.logger.log(`[ModalHandler] ${message}`);
      }
    }
  }
}

/**
 * 多步驟表單管理器
 * @description 支援複雜的多步驟表單流程
 */
export class MultiStepFormManager {
  private forms: Map<string, MultiStepFormState> = new Map();
  private readonly defaultTimeout = 30 * 60 * 1000; // 30 分鐘

  /**
   * 創建表單狀態
   */
  createForm(
    userId: string,
    stepId: string,
    totalSteps: number,
    timeoutMs?: number
  ): MultiStepFormState {
    const now = new Date();
    const form: MultiStepFormState = {
      stepId,
      userId,
      currentStep: 1,
      totalSteps,
      data: {},
      createdAt: now,
      expiresAt: new Date(now.getTime() + (timeoutMs || this.defaultTimeout))
    };

    const key = this.getFormKey(userId, stepId);
    this.forms.set(key, form);
    return form;
  }

  /**
   * 獲取表單狀態
   */
  getForm(userId: string, stepId: string): MultiStepFormState | null {
    const key = this.getFormKey(userId, stepId);
    const form = this.forms.get(key);

    if (!form) return null;

    // 檢查是否過期
    if (new Date() > form.expiresAt) {
      this.forms.delete(key);
      return null;
    }

    return form;
  }

  /**
   * 更新表單資料
   */
  updateFormData(userId: string, stepId: string, data: Record<string, string>): boolean {
    const form = this.getForm(userId, stepId);
    if (!form) return false;

    form.data = { ...form.data, ...data };
    return true;
  }

  /**
   * 前進一步
   */
  nextStep(userId: string, stepId: string): MultiStepFormState | null {
    const form = this.getForm(userId, stepId);
    if (!form || form.currentStep >= form.totalSteps) return null;

    form.currentStep += 1;
    return form;
  }

  /**
   * 完成表單
   */
  completeForm(userId: string, stepId: string): Record<string, string> | null {
    const form = this.getForm(userId, stepId);
    if (!form) return null;

    const data = { ...form.data };
    const key = this.getFormKey(userId, stepId);
    this.forms.delete(key);
    return data;
  }

  /**
   * 清除表單
   */
  clearForm(userId: string, stepId: string): void {
    const key = this.getFormKey(userId, stepId);
    this.forms.delete(key);
  }

  /**
   * 清除用戶所有表單
   */
  clearUserForms(userId: string): void {
    for (const [key] of this.forms) {
      if (key.startsWith(`${userId}:`)) {
        this.forms.delete(key);
      }
    }
  }

  /**
   * 生成表單 key
   */
  private getFormKey(userId: string, stepId: string): string {
    return `${userId}:${stepId}`;
  }
}

/**
 * 建立 Result 工具函數
 */
export function createModalHandlerResult(
  success: boolean,
  error?: string,
  data?: unknown
): HandlerResult {
  return {
    success,
    error,
    data
  };
}