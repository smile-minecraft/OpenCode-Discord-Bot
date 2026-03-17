/**
 * Streaming Message Manager - 打字機效果串流更新服務
 * @description 透過 SSE 接收 AI 回應片段，即時更新 Discord 訊息實現打字機效果
 */

import {
  Client,
  TextChannel,
  ThreadChannel,
  Message,
  EmbedBuilder,
} from 'discord.js';
import { createEventStreamAdapter, IEventStreamAdapter } from './EventStreamFactory.js';
import { Session } from '../database/models/Session.js';
import logger from '../utils/logger.js';

// ============== SSE 事件類型定義（從 SDK 適配器導入）==============

/**
 * SSE 事件類型
 */
export type SSEEventType = 
  | 'connected'
  | 'message'
  | 'tool_request'
  | 'error'
  | 'session_complete'
  | 'ping';

/**
 * SSE 事件處理器
 */
export type SSEEventHandler = (event: SSEEvent) => void;

/**
 * SSE 事件
 */
export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
}

/**
 * 訊息事件數據
 */
export interface MessageEventData {
  content: string;
  sessionId: string;
  isComplete?: boolean;
}

/**
 * Session 完成事件數據
 */
export interface SessionCompleteEventData {
  sessionId: string;
  success: boolean;
}

/**
 * 錯誤事件數據
 */
export interface ErrorEventData {
  message: string;
  sessionId: string;
}

// ============== 類型定義 ==============

/**
 * 活躍串流會話
 */
interface StreamingSession {
  /** Session ID */
  sessionId: string;
  /** 頻道 ID */
  channelId: string;
  /** 訊息 ID */
  messageId: string;
  /** 累積的內容 */
  content: string;
  /** 是否完成 */
  isComplete: boolean;
  /** 最後更新時間 */
  lastUpdateTime: number;
  /** 是否有待處理更新 */
  updateQueued: boolean;
  /** Discord Client */
  discordClient: Client;
}

// ============== 常量 ==============

/** 更新間隔（毫秒） */
const UPDATE_INTERVAL = 500;

/** Embed description 最大長度 */
const MAX_CONTENT_LENGTH = 4000;

// ============== Discord Rate Limiter 類別 ==============

/**
 * 全域 Discord API Rate Limiter
 * @description 確保 Discord API 請求不會觸發速率限制
 */
class DiscordRateLimiter {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;
  private lastRequestTime = 0;
  private readonly minInterval = 250; // 250ms = 4 requests/second (保守)

  /**
   * 將函數加入佇列等待執行
   */
  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  /**
   * 處理佇列中的請求
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      if (timeSinceLastRequest < this.minInterval) {
        await new Promise(resolve =>
          setTimeout(resolve, this.minInterval - timeSinceLastRequest)
        );
      }

      const fn = this.queue.shift();
      if (fn) {
        this.lastRequestTime = Date.now();
        await fn();
      }
    }

    this.processing = false;
  }
}

// ============== StreamingMessageManager 類別 ==============

/**
 * 打字機效果串流訊息管理器
 * @description 管理 SSE 串流事件與 Discord 訊息的同步更新
 */
export class StreamingMessageManager {
  /** Event Stream 適配器 */
  private eventStreamAdapter: IEventStreamAdapter;

  /** 活躍的串流會話映射 */
  private activeStreams: Map<string, StreamingSession> = new Map();

  /** 更新循環定時器 */
  private updateInterval: NodeJS.Timeout | null = null;

  /** Discord Client 實例 */
  private discordClient: Client | null = null;

  /** Discord API Rate Limiter */
  private rateLimiter = new DiscordRateLimiter();

  /**
   * 建構子
   * @param eventStreamAdapter Event Stream 適配器（可選，預設使用工廠創建）
   */
  constructor(eventStreamAdapter?: IEventStreamAdapter) {
    this.eventStreamAdapter = eventStreamAdapter || createEventStreamAdapter();
    this.setupEventHandlers();
    this.startUpdateLoop();
  }

  /**
   * 設置 Discord Client
   * @param client Discord Client 實例
   */
  setDiscordClient(client: Client): void {
    this.discordClient = client;
  }

  /**
   * 開始監聽 Session 的串流事件
   * @param session Session 實例
   * @param initialMessage 初始訊息
   * @param port SSE 連接端口
   */
  startStreaming(
    session: Session,
    initialMessage: Message,
    port: number
  ): void {
    if (!this.discordClient) {
      logger.warn('[StreamingMessageManager] Discord Client 未設置，無法啟動串流');
      return;
    }

    const streamKey = this.getStreamKey(session.channelId, session.sessionId);

    this.activeStreams.set(streamKey, {
      sessionId: session.sessionId,
      channelId: session.channelId,
      messageId: initialMessage.id,
      content: '',
      isComplete: false,
      lastUpdateTime: 0,
      updateQueued: false,
      discordClient: this.discordClient,
    });

    // 連接到 SSE
    const opencodeSessionId = session.opencodeSessionId;
    if (opencodeSessionId) {
      this.eventStreamAdapter.connect(port, opencodeSessionId);
      logger.info(`[StreamingMessageManager] 開始串流: ${streamKey}, port: ${port}, sessionId: ${opencodeSessionId}`);
    } else {
      logger.warn(`[StreamingMessageManager] Session ${session.sessionId} 缺少 opencodeSessionId`);
    }
  }

  /**
   * 停止串流
   * @param sessionId Session ID
   * @param channelId 頻道 ID
   */
  stopStreaming(sessionId: string, channelId: string): void {
    const streamKey = this.getStreamKey(channelId, sessionId);
    const stream = this.activeStreams.get(streamKey);

    if (stream) {
      stream.isComplete = true;
      stream.updateQueued = true;
      // 不立即刪除，等待最後一次更新完成
      logger.info(`[StreamingMessageManager] 標記串流完成: ${streamKey}`);
    }
  }

  /**
   * 移除串流（完全清理）
   * @param sessionId Session ID
   * @param channelId 頻道 ID
   */
  removeStream(sessionId: string, channelId: string): void {
    const streamKey = this.getStreamKey(channelId, sessionId);
    this.activeStreams.delete(streamKey);
    logger.info(`[StreamingMessageManager] 移除串流: ${streamKey}`);
  }

  /**
   * 檢查是否有活躍串流
   * @param sessionId Session ID
   * @param channelId 頻道 ID
   */
  hasActiveStream(sessionId: string, channelId: string): boolean {
    const streamKey = this.getStreamKey(channelId, sessionId);
    return this.activeStreams.has(streamKey);
  }

  /**
   * 設定 SSE 事件處理器
   */
  private setupEventHandlers(): void {
    // 監聽 AI 回應片段
    this.eventStreamAdapter.on('message', (event: unknown) => {
      const data = (event as SSEEvent).data as MessageEventData;
      this.handleMessageEvent(data);
    });

    // 監聽 Session 完成
    this.eventStreamAdapter.on('session_complete', (event: unknown) => {
      const data = (event as SSEEvent).data as SessionCompleteEventData;
      this.handleSessionComplete(data.sessionId);
    });

    // 監聽錯誤
    this.eventStreamAdapter.on('error', (event: unknown) => {
      const data = (event as SSEEvent).data as ErrorEventData;
      logger.error(`[StreamingMessageManager] SSE 錯誤:`, data);
    });

    // 監聽連接
    this.eventStreamAdapter.on('connected', () => {
      logger.debug('[StreamingMessageManager] SSE 連接成功');
    });

    // 監聽斷開
    this.eventStreamAdapter.on('disconnected', () => {
      logger.debug('[StreamingMessageManager] SSE 連接已關閉');
    });
  }

  /**
   * 處理訊息事件
   * @param data 訊息事件數據
   */
  private handleMessageEvent(data: MessageEventData): void {
    // 找到對應的串流
    for (const [key, stream] of this.activeStreams) {
      if (stream.sessionId === data.sessionId ||
          stream.sessionId.endsWith(data.sessionId) ||
          data.sessionId.endsWith(stream.sessionId)) {
        // 累積內容
        stream.content += data.content;
        stream.isComplete = data.isComplete ?? false;
        stream.updateQueued = true;

        // 如果內容太長，截斷
        if (stream.content.length > MAX_CONTENT_LENGTH) {
          stream.content = stream.content.substring(0, MAX_CONTENT_LENGTH - 3) + '...';
        }

        logger.debug(`[StreamingMessageManager] 更新內容: ${key}, length: ${stream.content.length}`);
        break;
      }
    }
  }

  /**
   * 處理 Session 完成
   * @param sessionId Session ID
   */
  private handleSessionComplete(sessionId: string): void {
    for (const [key, stream] of this.activeStreams) {
      if (stream.sessionId === sessionId ||
          stream.sessionId.endsWith(sessionId) ||
          sessionId.endsWith(stream.sessionId)) {
        stream.isComplete = true;
        stream.updateQueued = true;
        logger.info(`[StreamingMessageManager] Session 完成: ${key}`);
        break;
      }
    }
  }

  /**
   * 啟動定期更新循環
   */
  private startUpdateLoop(): void {
    this.updateInterval = setInterval(() => {
      this.processUpdates();
    }, UPDATE_INTERVAL);

    logger.info('[StreamingMessageManager] 更新循環已啟動');
  }

  /**
   * 停止更新循環
   */
  stopUpdateLoop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      logger.info('[StreamingMessageManager] 更新循環已停止');
    }
  }

  /**
   * 處理待更新的串流
   * @description 串行處理以避免觸發 Discord Rate Limit
   */
  private async processUpdates(): Promise<void> {
    const streamsToUpdate: Array<[string, StreamingSession]> = [];

    // 收集需要更新的串流
    for (const [key, stream] of this.activeStreams) {
      if (!stream.updateQueued) continue;

      const now = Date.now();
      if (now - stream.lastUpdateTime < UPDATE_INTERVAL && !stream.isComplete) {
        continue;
      }

      stream.updateQueued = false;
      stream.lastUpdateTime = now;
      streamsToUpdate.push([key, stream]);
    }

    // 串行處理以避免 Rate Limit
    for (const [key, stream] of streamsToUpdate) {
      try {
        await this.updateDiscordMessage(stream);

        if (stream.isComplete) {
          this.activeStreams.delete(key);
          logger.info(`[StreamingMessageManager] 串流已完成並移除: ${key}`);
        }

        // 添加小延遲避免觸發 rate limit
        if (streamsToUpdate.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (error) {
        logger.error('[StreamingMessageManager] 更新失敗:', error);

        // 如果是 rate limit 錯誤，等待更長時間
        if (this.isRateLimitError(error)) {
          stream.updateQueued = true; // 標記為待更新，稍後重試
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // 如果 stream 已完成，則移除
        if (stream.isComplete) {
          this.activeStreams.delete(key);
        }
      }
    }
  }

  /**
   * 更新 Discord 訊息
   * @param stream 串流會話
   * @description 使用 Rate Limiter 避免觸發 Discord API 限制
   */
  private async updateDiscordMessage(stream: StreamingSession): Promise<void> {
    // 使用 Rate Limiter 包裝 Discord API 請求
    await this.rateLimiter.enqueue(async () => {
      try {
        const channel = await this.getChannel(stream.channelId, stream.discordClient);
        if (!channel) {
          logger.warn(`[StreamingMessageManager] 找不到頻道: ${stream.channelId}`);
          return;
        }

        const message = await channel.messages.fetch(stream.messageId);
        if (!message) {
          logger.warn(`[StreamingMessageManager] 找不到訊息: ${stream.messageId}`);
          return;
        }

        // 建立更新後的 Embed
        const embed = this.createStreamingEmbed({
          content: stream.content,
          isComplete: stream.isComplete,
          sessionId: stream.sessionId,
        });

        // 更新訊息
        await message.edit({ embeds: [embed] });

        logger.debug(`[StreamingMessageManager] 訊息已更新: ${stream.messageId}, complete: ${stream.isComplete}`);
      } catch (error) {
        logger.error('[StreamingMessageManager] 更新 Discord 訊息失敗:', error);

        // 如果是 Discord API 錯誤（速率限制），拋出錯誤讓上層處理
        if (this.isRateLimitError(error)) {
          throw error;
        }
      }
    });
  }

  /**
   * 獲取頻道實例
   * @param channelId 頻道 ID
   * @param client Discord Client
   */
  private async getChannel(channelId: string, client: Client): Promise<TextChannel | ThreadChannel | null> {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && (channel instanceof TextChannel || channel instanceof ThreadChannel)) {
        return channel;
      }
      return null;
    } catch (error) {
      logger.error(`[StreamingMessageManager] 獲取頻道失敗: ${channelId}`, error);
      return null;
    }
  }

  /**
   * 檢查是否為速率限制錯誤
   */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('rate limit') ||
        message.includes('too many requests') ||
        message.includes('429')
      );
    }
    return false;
  }

  /**
   * 創建串流中的 Session Embed
   */
  private createStreamingEmbed(options: {
    content: string;
    isComplete: boolean;
    sessionId: string;
  }): EmbedBuilder {
    const statusEmoji = options.isComplete ? '✅' : '⏳';

    const embed = new EmbedBuilder()
      .setTitle(`${statusEmoji} AI 回應`)
      .setDescription(options.content || '等待回應...')
      .setColor(options.isComplete ? 0x00FF00 : 0xFFA500)
      .setFooter({ text: `Session: ${options.sessionId}` })
      .setTimestamp();

    if (!options.isComplete) {
      embed.addFields({
        name: '狀態',
        value: '🔵 正在生成回應...',
        inline: true,
      });
    }

    return embed;
  }

  /**
   * 生成串流鍵值
   */
  private getStreamKey(channelId: string, sessionId: string): string {
    return `${channelId}:${sessionId}`;
  }

  /**
   * 獲取所有活躍串流數量
   */
  getActiveStreamCount(): number {
    return this.activeStreams.size;
  }
}

// ============== 單例實例 ==============

let streamingManagerInstance: StreamingMessageManager | null = null;

/**
 * 獲取 StreamingMessageManager 單例實例
 * @description 自動使用工廠創建的 EventStreamAdapter
 */
export function getStreamingMessageManager(): StreamingMessageManager {
  if (!streamingManagerInstance) {
    streamingManagerInstance = new StreamingMessageManager();
  }
  return streamingManagerInstance;
}

/**
 * 初始化 StreamingMessageManager
 * @param eventStreamAdapter Event Stream 適配器（可選，預設使用工廠創建）
 */
export function initializeStreamingMessageManager(eventStreamAdapter?: IEventStreamAdapter): StreamingMessageManager {
  streamingManagerInstance = new StreamingMessageManager(eventStreamAdapter);
  return streamingManagerInstance;
}

// ============== 導出 ==============

export default {
  StreamingMessageManager,
  getStreamingMessageManager,
  initializeStreamingMessageManager,
};
