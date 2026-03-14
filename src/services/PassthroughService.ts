/**
 * Passthrough Service - Passthrough 模式管理服務
 * @description 管理每個 Thread/Channel 的 Passthrough 狀態，監聽訊息並轉發到 OpenCode Session
 */

import type { Message, ThreadChannel, GuildTextBasedChannel, VoiceBasedChannel } from 'discord.js';
import { getSessionManager } from './SessionManager.js';
import { log } from '../utils/logger.js';

// ============== 類型定義 ==============

/**
 * Passthrough 狀態
 */
export interface PassthroughState {
  /** 頻道 ID */
  channelId: string;
  /** 是否啟用 Passthrough */
  enabled: boolean;
  /** 啟用時間 */
  enabledAt?: Date;
  /** 是否正在處理訊息 */
  isProcessing: boolean;
  /** 自動轉錄語音訊息 */
  autoTranscribe: boolean;
}

/**
 * Passthrough 訊息轉發選項
 */
export interface ForwardMessageOptions {
  /** Discord 訊息 */
  message: Message;
  /** 顯示忙碌指示器 */
  showBusyIndicator?: boolean;
  /** 顯示 Prompt 前綴 */
  showPromptPrefix?: boolean;
}

// ============== Passthrough 服務 ==============

/**
 * Passthrough 服務類
 * @description 管理 Passthrough 模式的開關狀態，並處理訊息轉發
 */
export class PassthroughService {
  /** Passthrough 狀態映射（每個頻道獨立狀態） */
  private states: Map<string, PassthroughState> = new Map();

  /** 忙碌訊息映射（用於顯示 ⏳ 指示器） */
  private busyMessages: Map<string, string> = new Map();

  /**
   * 獲取頻道的 Passthrough 狀態
   * @param channelId 頻道 ID
   * @returns Passthrough 狀態
   */
  getState(channelId: string): PassthroughState {
    if (!this.states.has(channelId)) {
      this.states.set(channelId, {
        channelId,
        enabled: false,
        isProcessing: false,
        autoTranscribe: true, // 預設啟用語音轉錄
      });
    }
    return this.states.get(channelId)!;
  }

  /**
   * 檢查頻道是否啟用 Passthrough
   * @param channelId 頻道 ID
   * @returns 是否啟用
   */
  isEnabled(channelId: string): boolean {
    return this.getState(channelId).enabled;
  }

  /**
   * 啟用 Passthrough 模式
   * @param channelId 頻道 ID
   * @returns 新的狀態
   */
  enable(channelId: string): PassthroughState {
    const state = this.getState(channelId);
    state.enabled = true;
    state.enabledAt = new Date();
    this.states.set(channelId, state);

    log.info(`[Passthrough] Enabled for channel: ${channelId}`);
    return state;
  }

  /**
   * 停用 Passthrough 模式
   * @param channelId 頻道 ID
   * @returns 新的狀態
   */
  disable(channelId: string): PassthroughState {
    const state = this.getState(channelId);
    state.enabled = false;
    state.enabledAt = undefined;
    this.states.set(channelId, state);

    log.info(`[Passthrough] Disabled for channel: ${channelId}`);
    return state;
  }

  /**
   * 切換 Passthrough 模式
   * @param channelId 頻道 ID
   * @returns 新的狀態
   */
  toggle(channelId: string): PassthroughState {
    const state = this.getState(channelId);
    if (state.enabled) {
      return this.disable(channelId);
    } else {
      return this.enable(channelId);
    }
  }

  /**
   * 處理訊息轉發
   * @param options 轉發選項
   */
  async forwardMessage(options: ForwardMessageOptions): Promise<void> {
    const { message, showBusyIndicator = true, showPromptPrefix = true } = options;
    const channelId = message.channelId;

    // 檢查是否啟用 Passthrough
    if (!this.isEnabled(channelId)) {
      return;
    }

    // 忽略 Bot 訊息（避免無限循環）
    if (message.author.bot) {
      log.debug(`[Passthrough] Ignored bot message: ${message.id}`);
      return;
    }

    const state = this.getState(channelId);

    // 檢查是否正在處理
    if (state.isProcessing) {
      log.debug(`[Passthrough] Already processing message: ${message.id}`);
      return;
    }

    // 標記為正在處理
    state.isProcessing = true;
    this.states.set(channelId, state);

    try {
      // 顯示忙碌指示器
      let busyMessageId: string | undefined;
      if (showBusyIndicator) {
        busyMessageId = await this.showBusyIndicator(message);
      }

      // 構建 Prompt
      const prompt = await this.buildPrompt(message, showPromptPrefix);

      // 發送給 Session Manager
      const sessionManager = getSessionManager();
      await sessionManager.createSession({
        channelId,
        userId: message.author.id,
        prompt,
      });

      log.info(`[Passthrough] Forwarded message to session: ${message.id}`);
    } catch (error) {
      log.error(`[Passthrough] Error forwarding message:`, error);
      await message.reply({
        content: '❌ 轉發訊息到 OpenCode Session 時發生錯誤',
        ephemeral: true,
      });
    } finally {
      // 清除忙碌狀態
      state.isProcessing = false;
      this.states.set(channelId, state);

      // 移除忙碌指示器
      if (busyMessageId) {
        await this.removeBusyIndicator(message.channelId, busyMessageId);
      }
    }
  }

  /**
   * 處理語音訊息轉錄
   * @param message 訊息
   */
  async handleVoiceMessage(message: Message): Promise<void> {
    const state = this.getState(message.channelId);

    // 檢查是否啟用自動轉錄
    if (!state.autoTranscribe) {
      return;
    }

    // 檢查是否有語音附件
    const attachment = message.attachments.find((att) =>
      att.contentType?.startsWith('audio/') || att.contentType?.startsWith('video/')
    );

    if (!attachment) {
      return;
    }

    // TODO: 實現實際的語音轉錄邏輯
    // 這裡調用 Gemini API 或其他語音轉文字服務
    log.info(`[Passthrough] Voice message detected: ${attachment.id}`);

    // 轉發轉錄後的內容
    await this.forwardMessage(message);
  }

  /**
   * 處理頻道刪除
   * @param channelId 頻道 ID
   */
  handleChannelDelete(channelId: string): void {
    if (this.states.has(channelId)) {
      this.states.delete(channelId);
      this.busyMessages.delete(channelId);
      log.info(`[Passthrough] Cleaned up state for deleted channel: ${channelId}`);
    }
  }

  /**
   * 獲取所有啟用 Passthrough 的頻道
   * @returns 頻道 ID 列表
   */
  getEnabledChannels(): string[] {
    const enabled: string[] = [];
    for (const [channelId, state] of this.states) {
      if (state.enabled) {
        enabled.push(channelId);
      }
    }
    return enabled;
  }

  /**
   * 獲取統計資訊
   * @returns 統計物件
   */
  getStats(): {
    totalChannels: number;
    enabledChannels: number;
    processingChannels: number;
  } {
    let enabledChannels = 0;
    let processingChannels = 0;

    for (const [, state] of this.states) {
      if (state.enabled) {
        enabledChannels++;
      }
      if (state.isProcessing) {
        processingChannels++;
      }
    }

    return {
      totalChannels: this.states.size,
      enabledChannels,
      processingChannels,
    };
  }

  // ============== 私有方法 ==============

  /**
   * 構建 Prompt
   * @param message Discord 訊息
   * @param showPrefix 是否顯示 Prompt 前綴
   * @returns 處理後的 Prompt
   */
  private async buildPrompt(message: Message, showPrefix: boolean): Promise<string> {
    const parts: string[] = [];

    // 添加 Prompt 前綴
    if (showPrefix) {
      parts.push('📌');
    }

    // 添加訊息內容
    parts.push(message.content);

    // 添加附件資訊
    if (message.attachments.size > 0) {
      const attachmentInfo = message.attachments.map((att) => {
        return `[附件: ${att.name}](${att.url})`;
      });
      parts.push('\n**附件:**');
      parts.push(attachmentInfo.join('\n'));
    }

    // 添加引用訊息
    if (message.reference && message.reference.messageId) {
      try {
        const referencedMessage = await message.fetchReference();
        if (referencedMessage) {
          parts.push(`\n**引用回覆:** ${referencedMessage.content}`);
        }
      } catch {
        // 忽略獲取引用失敗
      }
    }

    return parts.join('\n');
  }

  /**
   * 顯示忙碌指示器
   * @param message Discord 訊息
   * @returns 發送的訊息 ID
   */
  private async showBusyIndicator(message: Message): Promise<string> {
    const channel = message.channel;

    // 檢查頻道類型是否支援發送訊息
    if (!channel || !('send' in channel)) {
      return '';
    }

    try {
      const busyMsg = await channel.send({
        content: '⏳ 正在處理...',
        allowedMentions: { repliedUser: false },
      });

      this.busyMessages.set(message.channelId, busyMsg.id);
      return busyMsg.id;
    } catch (error) {
      log.error(`[Passthrough] Error showing busy indicator:`, error);
      return '';
    }
  }

  /**
   * 移除忙碌指示器
   * @param channelId 頻道 ID
   * @param messageId 訊息 ID
   */
  private async removeBusyIndicator(channelId: string, messageId: string): Promise<void> {
    const channel = this.busyMessages.get(channelId);
    if (!channel) return;

    try {
      const msg = await (await this.busyMessages.get(channelId))?.fetch();
      if (msg) {
        await msg.delete();
      }
    } catch {
      // 忽略刪除失敗
    } finally {
      this.busyMessages.delete(channelId);
    }
  }
}

// ============== 單例實例 ==============

let passthroughServiceInstance: PassthroughService | null = null;

/**
 * 獲取 Passthrough 服務單例實例
 */
export function getPassthroughService(): PassthroughService {
  if (!passthroughServiceInstance) {
    passthroughServiceInstance = new PassthroughService();
  }
  return passthroughServiceInstance;
}

/**
 * 初始化 Passthrough 服務
 */
export function initializePassthroughService(): PassthroughService {
  passthroughServiceInstance = new PassthroughService();
  return passthroughServiceInstance;
}

// ============== 導出 ==============

export default {
  PassthroughService,
  getPassthroughService,
  initializePassthroughService,
};
