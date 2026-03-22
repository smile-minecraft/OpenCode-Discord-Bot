/**
 * Streaming Message Manager - 打字機效果串流更新服務
 * @description 透過 SSE 接收 AI 回應片段，累積後一次性發送到 Discord
 * 
 * 重構重點：
 * - 移除初始佔位 Embed，改用 Typing Indicator
 * - 記憶體緩衝區，收到 session_complete 時一次性發送
 * - Markdown 智能分段（2000 字元限制）
 * - 移除 Embed，改用一般文字訊息
 */

import {
  Client,
  TextChannel,
  ThreadChannel,
} from 'discord.js';
import { IEventStreamAdapter } from './EventStreamFactory.js';
import { SSEEventEmitterAdapter } from './SSEEventEmitterAdapter.js';
import { Session } from '../database/models/Session.js';
import { getToolStateTracker } from './ToolStateTracker.js';
import { getThreadManager } from './ThreadManager.js';
import logger from '../utils/logger.js';

// ============== SSE 事件類型定義 ==============

/**
 * SSE 事件類型
 */
export type SSEEventType =
  | 'connected'
  | 'message'
  | 'tool_request'
  | 'sdk_event'
  | 'thinking'
  | 'waiting'
  | 'error'
  | 'session_complete'
  | 'ping'
  | 'question';

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
  isThinking?: boolean;
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
  message?: string;
  error?: string;
  sessionId?: string;
}

/**
 * Tool 狀態更新事件數據
 */
export interface ToolUpdateEventData {
  sessionId: string;
  toolId?: string;
  toolName: string;
  requestId?: string;
  status?: 'pending' | 'running' | 'completed' | 'error';
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

/**
 * Session 等待事件數據（session.idle）
 */
export interface SessionWaitingEventData {
  sessionId: string;
}

/**
 * Question 事件數據
 */
export interface QuestionEventData {
  sessionId: string;
  questionId: string;
  text: string;
  options: Array<{ label: string; value: string; description?: string }>;
  multiple: boolean;
}

/**
 * Thinking 開始事件
 */
export interface ThinkingEventData {
  sessionId: string;
}

interface ConnectionEventData {
  sessionId: string;
}

interface GenericSDKEventData {
  sessionId: string;
  eventType: string;
  properties: Record<string, unknown>;
}

// ============== 類型定義 ==============

/**
 * 活躍串流會話
 */
interface StreamingSession {
  /** Session ID */
  sessionId: string;
  /** 頻道 ID (Thread ID) */
  channelId: string;
  /** 累積的內容 */
  content: string;
  /** 是否完成 */
  isComplete: boolean;
  /** 是否已發送內容 */
  hasFlushed: boolean;
  /** typing indicator 定時器 */
  typingTimer: NodeJS.Timeout | null;
  /** 無事件逾時定時器 */
  stallTimer: NodeJS.Timeout | null;
  /** 最後一次收到有效事件的時間戳 */
  lastEventAt: number;
  /** 是否已發送「思考中」提示 */
  hasSentThinkingNotice: boolean;
  /** Discord Client */
  discordClient: Client;
  /** 用戶發送的原始 prompt（用於去除 AI 回覆開頭的重複前綴） */
  userPrompt?: string;
}

// ============== 常量 ==============

/** Discord 訊息最大長度 */
const MAX_MESSAGE_LENGTH = 2000;

/** 工具參數截斷長度 */
const TOOL_ARGS_TRUNCATE_LENGTH = 180;

/** typing indicator 刷新間隔（毫秒）- 少於 10 秒以保持狀態 */
const TYPING_REFRESH_INTERVAL = 7500;

/** 串流無事件逾時（毫秒） */
const STREAM_IDLE_TIMEOUT = 60000;

/** 工具狀態更新間隔（毫秒） */
const TOOL_STATE_UPDATE_INTERVAL = 1000;

/**
 * 保守去重時間窗口（毫秒）
 * @description 無 requestId 時，只有在極短時間內（<=300ms）且 payload signature 完全相同時
 *              才視為 duplicate event echo。超過此窗口一律視為新調用，避免誤殺合法重複呼叫。
 */
const CONSERVATIVE_DEDUP_WINDOW_MS = 300;

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

// ============== Markdown 智能分段 ==============

/**
 * 智能分段函數
 * @description 將長內容切分為 Discord 訊息上限以內的多個區塊
 * - 優先按 Markdown 標題分段
 * - 再以行/空白切分
 * - 避免在 Markdown 程式碼區塊中切斷
 */
function chunkContent(content: string): string[] {
  if (content.length <= MAX_MESSAGE_LENGTH) {
    return [content];
  }

  const sections = splitByMarkdownHeadings(content);
  if (sections.length <= 1) {
    return splitLargeChunk(content);
  }

  const chunks: string[] = [];
  let buffer = '';

  for (const section of sections) {
    if (section.length > MAX_MESSAGE_LENGTH) {
      if (buffer) {
        chunks.push(buffer);
        buffer = '';
      }
      chunks.push(...splitLargeChunk(section));
      continue;
    }

    const candidate = buffer ? `${buffer}\n\n${section}` : section;
    if (candidate.length <= MAX_MESSAGE_LENGTH) {
      buffer = candidate;
    } else {
      if (buffer) {
        chunks.push(buffer);
      }
      buffer = section;
    }
  }

  if (buffer) {
    chunks.push(buffer);
  }

  return chunks.filter(chunk => chunk.length > 0);
}

/**
 * 依 Markdown 標題切分內容
 */
function splitByMarkdownHeadings(content: string): string[] {
  const lines = content.split('\n');
  const sections: string[] = [];
  let currentSection: string[] = [];

  for (const line of lines) {
    const isHeading = /^\s*#{1,6}\s+\S+/.test(line);
    if (isHeading && currentSection.length > 0) {
      sections.push(currentSection.join('\n').trim());
      currentSection = [line];
    } else {
      currentSection.push(line);
    }
  }

  if (currentSection.length > 0) {
    sections.push(currentSection.join('\n').trim());
  }

  return sections.filter(section => section.length > 0);
}

/**
 * 對超大段落做保底切分（保留程式碼區塊完整性）
 */
function splitLargeChunk(content: string): string[] {
  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > MAX_MESSAGE_LENGTH) {
    let splitPoint = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
    if (splitPoint === -1) {
      splitPoint = remaining.lastIndexOf(' ', MAX_MESSAGE_LENGTH);
    }
    if (splitPoint === -1 || splitPoint === 0) {
      splitPoint = MAX_MESSAGE_LENGTH;
    }

    const chunk = remaining.slice(0, splitPoint);
    const openCodeBlocks = (chunk.match(/```/g) || []).length;

    if (openCodeBlocks % 2 === 1) {
      chunks.push(chunk + '```');
      remaining = '```' + remaining.slice(splitPoint);
    } else {
      chunks.push(chunk);
      remaining = remaining.slice(splitPoint);
    }

    if (chunk.length === 0 && remaining.length > 0) {
      chunks.push(remaining.slice(0, MAX_MESSAGE_LENGTH));
      remaining = remaining.slice(MAX_MESSAGE_LENGTH);
    }
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks.filter(chunk => chunk.length > 0);
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

  /** 本地 Session ID 到 OpenCode SDK Session ID 的映射 */
  private sessionIdToOpenCodeId: Map<string, string> = new Map();

  /** OpenCode SDK Session ID 到本地 Session ID 的映射 */
  private openCodeIdToSessionId: Map<string, string> = new Map();

  /** Discord Client 實例 */
  private discordClient: Client | null = null;

  /** Discord API Rate Limiter */
  private rateLimiter = new DiscordRateLimiter();

  // ============== Tool State Update Queue ==============

  /** 工具狀態更新佇列 */
  private toolUpdateQueue: Map<string, Set<string>> = new Map();

  /** Session 級時間線消息映射: sessionId -> Discord messageId */
  private sessionMessageMap: Map<string, string> = new Map();

  /** 工具狀態定時器 */
  private toolUpdateInterval: NodeJS.Timeout | null = null;

  /** 已設置事件處理器的適配器集合 */
  private adaptersWithHandlers = new WeakSet<SSEEventEmitterAdapter>();

  /** Tool 追蹤去重映射: sessionId+requestId -> toolId (避免 tool_call* + message.part.* 同時出現造成重複) */
  private toolTrackingDedup: Map<string, string> = new Map();

  /**
   * 建構子
   * @param eventStreamAdapter Event Stream 適配器（可選，不傳入則不會自動連接，需外部傳入）
   */
  constructor(eventStreamAdapter?: IEventStreamAdapter) {
    this.eventStreamAdapter = eventStreamAdapter || ({} as IEventStreamAdapter);
    // 不再自動設置事件處理器，等待外部適配器傳入
    this.startToolUpdateLoop();
  }

  /**
   * 設置 Discord Client
   * @param client Discord Client 實例
   */
  setDiscordClient(client: Client): void {
    this.discordClient = client;
  }

  /**
   * 設置外部 SSE 適配器（從 SessionEventManager 獲取）
   * @param adapter SSE 適配器實例
   */
  setExternalAdapter(adapter: SSEEventEmitterAdapter): void {
    this.eventStreamAdapter = adapter as unknown as IEventStreamAdapter;
    this.setupEventHandlers(adapter);
    logger.info('[StreamingMessageManager] 已設置外部適配器');
  }

  /**
   * 開始監聽 Session 的串流事件
   * @param session Session 實例
   * @param channelId Thread 頻道 ID
   * @param port SSE 連接端口
   * @param adapter 可選的外部適配器（如果未設置，則使用內部適配器連接）
   */
  startStreaming(
    session: Session,
    channelId: string,
    port: number,
    adapter?: SSEEventEmitterAdapter
  ): void {
    if (!this.discordClient) {
      logger.warn('[StreamingMessageManager] Discord Client 未設置，無法啟動串流');
      return;
    }

    const streamKey = this.getStreamKey(channelId, session.sessionId);
    const existingStream = this.activeStreams.get(streamKey);

    if (existingStream) {
      this.stopTypingIndicator(existingStream);
      this.clearStallTimer(existingStream);
    }

    // 創建 typing indicator 定時器
    const typingTimer = this.startTypingIndicator(channelId);

    const streamSession: StreamingSession = {
      sessionId: session.sessionId,
      channelId: channelId,
      content: existingStream?.content ?? '',
      isComplete: false,
      hasFlushed: false,
      typingTimer: typingTimer,
      stallTimer: null,
      lastEventAt: Date.now(),
      hasSentThinkingNotice: existingStream?.hasSentThinkingNotice ?? false,
      discordClient: this.discordClient,
      userPrompt: session.prompt || undefined,
    };
    this.activeStreams.set(streamKey, streamSession);
    this.refreshStreamTimeout(streamSession);

    // 註冊 Session ID 雙向映射
    this.sessionIdToOpenCodeId.set(session.sessionId, session.opencodeSessionId || '');
    if (session.opencodeSessionId) {
      this.openCodeIdToSessionId.set(session.opencodeSessionId, session.sessionId);
    }

    // 如果提供了外部適配器，使用它；否則使用內部適配器連接
    if (adapter) {
      this.eventStreamAdapter = adapter as unknown as IEventStreamAdapter;
      this.setupEventHandlers(adapter);
      logger.info(`[StreamingMessageManager] 使用外部適配器串流: ${streamKey}`);
    } else {
      // 連接到 SSE（使用內部適配器）
      const opencodeSessionId = session.opencodeSessionId;
      if (opencodeSessionId) {
        // 內部適配器需要連接
        if ('connect' in this.eventStreamAdapter && typeof this.eventStreamAdapter.connect === 'function') {
          (this.eventStreamAdapter as any).connect(port, opencodeSessionId);
        }

        logger.info(`[StreamingMessageManager] 開始串流: ${streamKey}, port: ${port}, sessionId: ${opencodeSessionId}`);
      } else {
        logger.warn(`[StreamingMessageManager] Session ${session.sessionId} 缺少 opencodeSessionId`);
      }
    }
  }

  /**
   * 設置用戶的原始 prompt（用於去除 AI 回覆開頭的重复前綴）
   * @param sessionId Session ID
   * @param channelId Channel ID
   * @param prompt 用戶發送的原始 prompt
   */
  setUserPrompt(sessionId: string, channelId: string, prompt: string): void {
    const streamKey = this.getStreamKey(channelId, sessionId);
    const stream = this.activeStreams.get(streamKey);
    if (stream) {
      stream.userPrompt = prompt;
      logger.debug(`[StreamingMessageManager] User prompt set for ${streamKey}: "${prompt.substring(0, 50)}..."`);
    }
  }

  /**
   * 去除 AI 回覆開頭的用戶 prompt 重複前綴
   * @description 僅在「完全相同前綴」時移除，不做模糊比對
   * @param content AI 回覆內容
   * @param userPrompt 用戶原始 prompt
   * @returns 去除前綴後的內容
   */
  private stripPromptPrefix(content: string, userPrompt?: string): string {
    if (!userPrompt || !content) {
      return content;
    }

    // 只在「完全相同前綴」時移除
    if (content.startsWith(userPrompt)) {
      const stripped = content.substring(userPrompt.length);
      // 如果去除前綴後開頭不是換行或空白，補一個換行使內容連貫
      if (stripped.length > 0 && !stripped.startsWith('\n') && !stripped.startsWith(' ')) {
        return '\n' + stripped;
      }
      return stripped;
    }

    return content;
  }

  /**
   * 啟動 typing indicator 定時器
   * @param channelId 頻道 ID
   */
  private startTypingIndicator(channelId: string): NodeJS.Timeout {
    // 先發送一次 typing
    this.sendTyping(channelId);

    // 每 7.5 秒刷新一次 typing 狀態
    return setInterval(() => {
      this.sendTyping(channelId);
    }, TYPING_REFRESH_INTERVAL);
  }

  /**
   * 發送 typing indicator
   * @param channelId 頻道 ID
   */
  private async sendTyping(channelId: string): Promise<void> {
    if (!this.discordClient) return;

    try {
      const channel = await this.getChannel(channelId, this.discordClient);
      if (channel && 'sendTyping' in channel) {
        await channel.sendTyping();
      }
    } catch (error) {
      logger.debug(`[StreamingMessageManager] Failed to send typing:`, error);
    }
  }

  /**
   * 停止 typing indicator 定時器
   * @param stream 串流會話
   */
  private stopTypingIndicator(stream: StreamingSession): void {
    if (stream.typingTimer) {
      clearInterval(stream.typingTimer);
      stream.typingTimer = null;
      logger.debug(`[StreamingMessageManager] Stopped typing indicator for ${stream.sessionId}`);
    }
  }

  /**
   * 清理串流逾時計時器
   */
  private clearStallTimer(stream: StreamingSession): void {
    if (stream.stallTimer) {
      clearTimeout(stream.stallTimer);
      stream.stallTimer = null;
    }
  }

  /**
   * 刷新串流無事件逾時計時器
   */
  private refreshStreamTimeout(stream: StreamingSession): void {
    stream.lastEventAt = Date.now();
    this.clearStallTimer(stream);

    stream.stallTimer = setTimeout(() => {
      const streamKey = this.getStreamKey(stream.channelId, stream.sessionId);
      const activeStream = this.activeStreams.get(streamKey);
      if (!activeStream || activeStream.hasFlushed) {
        return;
      }

      logger.warn(`[StreamingMessageManager] Stream idle timeout: ${activeStream.sessionId}`);
      void this.flushContent(activeStream);
    }, STREAM_IDLE_TIMEOUT);

    // 避免 watchdog 計時器阻止程序退出
    stream.stallTimer.unref?.();
  }

  /**
   * 更新指定 Session 的串流活動時間
   */
  private touchStreamBySession(sessionId: string): void {
    for (const stream of this.activeStreams.values()) {
      if (this.isSessionIdMatch(stream.sessionId, sessionId)) {
        this.refreshStreamTimeout(stream);
        break;
      }
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
      // 不立即刪除，等待最後一次發送完成
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

    // 停止 typing indicator
    const stream = this.activeStreams.get(streamKey);
    if (stream) {
      this.stopTypingIndicator(stream);
      this.clearStallTimer(stream);
    }

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
  private setupEventHandlers(adapter: SSEEventEmitterAdapter): void {
    if (this.adaptersWithHandlers.has(adapter)) return;
    this.adaptersWithHandlers.add(adapter);

    // 監聽 AI 回應片段
    adapter.on('message', (event: unknown) => {
      const data = (event as SSEEvent).data as MessageEventData;
      this.handleMessageEvent(data);
    });

    // 監聽思考事件
    adapter.on('thinking', (event: unknown) => {
      const data = (event as SSEEvent).data as ThinkingEventData;
      void this.handleThinkingEvent(data);
    });

    // 監聽 Session 完成
    adapter.on('session_complete', (event: unknown) => {
      const data = (event as SSEEvent).data as SessionCompleteEventData;
      this.handleSessionComplete(data.sessionId);
    });

    // 監聽工具請求
    adapter.on('tool_request', (event: unknown) => {
      const data = (event as SSEEvent).data as ToolUpdateEventData;
      this.handleToolRequestEvent(data);
    });

    // 監聽等待事件 (session.idle) - 不再自動結束
    adapter.on('waiting', (event: unknown) => {
      const data = (event as SSEEvent).data as SessionWaitingEventData;
      this.handleWaitingEvent(data);
    });

    // 監聽錯誤
    adapter.on('error', (event: unknown) => {
      const data = (event as SSEEvent).data as ErrorEventData;
      this.handleSessionErrorEvent(data);
    });

    // 監聽問題事件 (question.asked)
    adapter.on('question', (event: unknown) => {
      const data = (event as SSEEvent).data as QuestionEventData;
      this.handleQuestionEvent(data);
    });

    // 監聽連接
    adapter.on('connected', () => {
      logger.debug('[StreamingMessageManager] SSE 連接成功');
    });

    // 通用 SDK 事件 fallback，確保未映射事件也會刷新活動狀態
    adapter.on('sdk_event', (event: unknown) => {
      const data = (event as SSEEvent).data as GenericSDKEventData;
      if (data?.sessionId) {
        this.touchStreamBySession(data.sessionId);
      }
    });

    // 監聽斷開
    adapter.on('disconnected', (event: unknown) => {
      const data = (event as SSEEvent).data as ConnectionEventData;
      logger.debug(`[StreamingMessageManager] SSE 連接已關閉: ${data.sessionId}`);
      this.cleanupStreamsForSession(data.sessionId);
    });
  }

  /**
   * 處理訊息事件
   * @param data 訊息事件數據
   */
  private handleMessageEvent(data: MessageEventData): void {
    const stream = this.findActiveStreamBySessionId(data.sessionId);
    if (!stream) {
      return;
    }

    if (data.isThinking) {
      void this.handleThinkingEvent({ sessionId: data.sessionId });
      return;
    }

    if (data.content && data.content.trim() !== '') {
      // 在內容合併前，先去除 AI 回覆開頭的用戶 prompt 重複前綴（保守策略：僅完全相同前綴）
      let processedContent = this.stripPromptPrefix(data.content, stream.userPrompt);
      stream.content = this.mergeIncomingContent(stream.content, processedContent);
      this.refreshStreamTimeout(stream);
    }

    if (data.isComplete !== undefined) {
      stream.isComplete = data.isComplete;
    }
  }

  /**
   * 合併串流內容（同時兼容「完整快照」與「增量片段」）
   * @description 避免 message.updated 反覆回傳完整內容時造成重覆拼接與 Markdown 黏連。
   */
  private mergeIncomingContent(currentContent: string, incomingContent: string): string {
    if (!incomingContent) {
      return currentContent;
    }

    if (!currentContent) {
      return incomingContent;
    }

    // 完全重複
    if (incomingContent === currentContent) {
      return currentContent;
    }

    // incoming 是完整快照（比 current 長，且以 current 為前綴）
    if (incomingContent.startsWith(currentContent)) {
      return incomingContent;
    }

    // incoming 是舊快照（比 current 短，或 current 已包含）
    if (currentContent.startsWith(incomingContent) || currentContent.includes(incomingContent)) {
      return currentContent;
    }

    // 一般增量片段 append，並在 Markdown 標題前補換行，避免出現 "文字## 標題"
    if (/^\s*#{1,6}\s+\S+/.test(incomingContent) && !currentContent.endsWith('\n')) {
      return `${currentContent}\n${incomingContent}`;
    }

    return `${currentContent}${incomingContent}`;
  }

  /**
   * 處理 Session 完成
   * @param sessionId Session ID
   */
  private handleSessionComplete(sessionId: string): void {
    for (const [_key, stream] of this.activeStreams) {
      if (this.isSessionIdMatch(stream.sessionId, sessionId)) {
        stream.isComplete = true;
        logger.info(`[StreamingMessageManager] Session 完成: ${stream.sessionId}`);

        // 立即 flush 內容到 Discord
        void this.flushContent(stream);
        break;
      }
    }
  }

  /**
   * 將緩衝區內容發送到 Discord
   * @param stream 串流會話
   */
  private async flushContent(
    stream: StreamingSession,
    options: { keepStream?: boolean } = {}
  ): Promise<void> {
    const keepStream = options.keepStream ?? false;

    if (stream.hasFlushed && !keepStream) {
      logger.debug(`[StreamingMessageManager] 內容已發送，跳過: ${stream.sessionId}`);
      return;
    }

    // 停止 typing indicator
    this.stopTypingIndicator(stream);
    this.clearStallTimer(stream);

    if (!stream.content || stream.content.trim() === '') {
      logger.debug(`[StreamingMessageManager] 內容為空，跳過發送: ${stream.sessionId}`);
      if (!keepStream) {
        stream.hasFlushed = true;
        this.cleanupStream(stream.sessionId, stream.channelId);
      }
      return;
    }

    // 保險清理：再次去除 AI 回覆開頭的用戶 prompt 重複前綴（僅完全相同前綴）
    const finalContent = this.stripPromptPrefix(stream.content, stream.userPrompt);

    try {
      const channel = await this.getChannel(stream.channelId, stream.discordClient);
      if (!channel) {
        logger.warn(`[StreamingMessageManager] 找不到頻道: ${stream.channelId}`);
        return;
      }

      // 智能分段
      const chunks = chunkContent(finalContent);

      if (chunks.length === 1) {
        // 單一訊息
        await channel.send({ content: chunks[0] });
        logger.info(`[StreamingMessageManager] 訊息已發送: ${stream.sessionId}, length: ${chunks[0].length}`);
      } else {
        // 多個訊息
        for (let i = 0; i < chunks.length; i++) {
          await channel.send({ content: chunks[i] });

          // 添加小延遲避免觸發 rate limit
          if (i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        logger.info(`[StreamingMessageManager] 訊息已分發送: ${stream.sessionId}, chunks: ${chunks.length}`);
      }

      if (keepStream) {
        stream.content = '';
        stream.hasFlushed = false;
      } else {
        stream.hasFlushed = true;
      }
    } catch (error) {
      logger.error('[StreamingMessageManager] 發送訊息失敗:', error);

      // 嘗試發送錯誤訊息
      try {
        const channel = await this.getChannel(stream.channelId, stream.discordClient);
        if (channel) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          await channel.send({ content: `❌ 發送訊息失敗: ${errorMessage}` });
        }
      } catch {
        // 忽略錯誤
      }
    } finally {
      if (!keepStream) {
        // 清理串流
        this.cleanupStream(stream.sessionId, stream.channelId);
      }
    }
  }

  /**
   * 處理工具請求事件
   * @param data Tool 請求事件數據
   */
  private handleToolRequestEvent(data: ToolUpdateEventData): void {
    this.touchStreamBySession(data.sessionId);
    const normalizedStatus = data.status ?? 'pending';
    const toolStateTracker = getToolStateTracker();

    // 生成去重鍵：優先使用 sessionId + requestId（強去重）
    const dedupKey = data.requestId
      ? `${data.sessionId}:${data.requestId}`
      : null;

    // 獲取該 session 的所有工具（確保是陣列）
    const allTools = toolStateTracker.getSessionTools(data.sessionId) || [];

    // 嘗試找到現有的工具並更新狀態
    let existingTool: { id: string; toolName: string; status: string; args?: Record<string, unknown>; startedAt: number } | undefined;

    // 優先用 requestId 匹配
    if (dedupKey) {
      existingTool = allTools.find(t => this.toolTrackingDedup.get(dedupKey!) === t.id);
    }

    // 若無法用 requestId 匹配，嘗試用 toolName + argsSignature + 可轉移狀態匹配
    // 這是保守策略：只有狀態可轉移時才匹配
    if (!existingTool && normalizedStatus !== 'pending') {
      const argsSignature = this.hashArgs(data.args);

      if (normalizedStatus === 'running') {
        // running 只能匹配 pending 狀態，且 args 必須相同
        existingTool = allTools.find(t =>
          t.toolName === data.toolName &&
          t.status === 'pending' &&
          this.hashArgs(t.args) === argsSignature
        );
      } else if (normalizedStatus === 'completed') {
        // completed 優先匹配 running 狀態，其次匹配 pending（視為快速完成）
        // 使用兩段式匹配，避免陣列順序錯配
        existingTool = allTools.find(t =>
          t.toolName === data.toolName &&
          t.status === 'running' &&
          this.hashArgs(t.args) === argsSignature
        );
        if (!existingTool) {
          existingTool = allTools.find(t =>
            t.toolName === data.toolName &&
            t.status === 'pending' &&
            this.hashArgs(t.args) === argsSignature
          );
        }
        // Fallback: completed 無 requestId + 空 args 時，以 toolName+running 匹配最新一筆
        // 避免丟失先前既有 args（如 running 事件的非空 args）
        if (!existingTool && !data.requestId && this.hashArgs(data.args) === 'empty') {
          const runningTools = allTools
            .filter(t => t.toolName === data.toolName && t.status === 'running')
            .sort((a, b) => b.startedAt - a.startedAt); // 取最新
          if (runningTools.length > 0) {
            existingTool = runningTools[0];
            logger.debug(`[StreamingMessageManager] Fallback: matched completed to running tool ${existingTool.id} by name`);
          }
        }
      } else if (normalizedStatus === 'error') {
        // error 可以匹配 running 或 pending（視為執行失敗）
        existingTool = allTools.find(t =>
          t.toolName === data.toolName &&
          (t.status === 'running' || t.status === 'pending') &&
          this.hashArgs(t.args) === argsSignature
        );
      }
    }

    // 補全 args：若先收到空參數事件，後續狀態事件帶到非空 args 時回填
    // 避免時間線長期顯示 read()/glob() 而丟失工具參數細節
    if (existingTool) {
      const incomingArgs = data.args;
      const existingArgsHash = this.hashArgs(existingTool.args);
      const incomingArgsHash = this.hashArgs(incomingArgs);
      if (existingArgsHash === 'empty' && incomingArgsHash !== 'empty') {
        existingTool.args = incomingArgs as Record<string, unknown>;
        logger.debug(`[StreamingMessageManager] Backfilled args for tool ${existingTool.id} (${existingTool.toolName})`);
      }
    }

    // 追蹤新的工具執行（避免重複）
    if (normalizedStatus === 'pending') {
      // 檢查是否已追蹤過（舊 tool_call* + 新 message.part.* 同時出現時）
      if (dedupKey && this.toolTrackingDedup.has(dedupKey)) {
        logger.debug(`[StreamingMessageManager] Tool already tracked, skipping duplicate: ${dedupKey}`);
        return;
      }

      // 無 requestId 時：保守去重策略
      // 只在極短時間內（CONSERVATIVE_DEDUP_WINDOW_MS=300ms）且 payload signature 完全相同時
      // 才視為 duplicate event echo，避免誤殺合法重複呼叫
      if (!dedupKey) {
        const conservativeTime = Date.now() - CONSERVATIVE_DEDUP_WINDOW_MS;
        const argsHash = this.hashArgs(data.args);

        for (const tool of allTools) {
          if (
            tool.toolName === data.toolName &&
            tool.startedAt >= conservativeTime
          ) {
            const existingArgsHash = this.hashArgs(tool.args);
            if (existingArgsHash === argsHash) {
              // 在極短窗口內且 args 相同，視為重複
              logger.debug(`[StreamingMessageManager] Tool in conservative window with same args, skipping: ${data.toolName}`);
              return;
            }
          }
        }
      }

      const toolExecution = toolStateTracker.trackTool(data.sessionId, data.toolName, data.args || {});
      // 記錄去重映射
      if (dedupKey) {
        this.toolTrackingDedup.set(dedupKey, toolExecution.id);
      }
      this.queueToolStateUpdate(data.sessionId, toolExecution.id);
      logger.info(`[StreamingMessageManager] Tool requested: ${data.toolName} (${data.sessionId})`);
    } else if (normalizedStatus === 'running') {
      if (existingTool) {
        toolStateTracker.startTool(data.sessionId, existingTool.id);
        this.queueToolStateUpdate(data.sessionId, existingTool.id);
      } else {
        // 找不到既有工具時（可能是第一個事件就是 running），直接建立追蹤
        logger.debug(`[StreamingMessageManager] No existing tool found for running, creating new tracking: ${data.toolName}`);
        const toolExecution = toolStateTracker.trackTool(data.sessionId, data.toolName, data.args || {});
        toolStateTracker.startTool(data.sessionId, toolExecution.id);
        if (dedupKey) {
          this.toolTrackingDedup.set(dedupKey, toolExecution.id);
        }
        this.queueToolStateUpdate(data.sessionId, toolExecution.id);
      }
    } else if (normalizedStatus === 'completed') {
      if (existingTool) {
        toolStateTracker.completeTool(data.sessionId, existingTool.id, data.result);
        this.queueToolStateUpdate(data.sessionId, existingTool.id);
      } else {
        // 找不到既有工具時（可能是第一個事件就是 completed），直接建立追蹤
        logger.debug(`[StreamingMessageManager] No existing tool found for completed, creating new tracking: ${data.toolName}`);
        const toolExecution = toolStateTracker.trackTool(data.sessionId, data.toolName, data.args || {});
        toolStateTracker.completeTool(data.sessionId, toolExecution.id, data.result);
        if (dedupKey) {
          this.toolTrackingDedup.set(dedupKey, toolExecution.id);
        }
        this.queueToolStateUpdate(data.sessionId, toolExecution.id);
      }
    } else if (normalizedStatus === 'error') {
      if (existingTool) {
        toolStateTracker.errorTool(data.sessionId, existingTool.id, data.error || 'Unknown error');
        this.queueToolStateUpdate(data.sessionId, existingTool.id);
      } else {
        // 找不到既有工具時（可能是第一個事件就是 error），直接建立追蹤
        logger.debug(`[StreamingMessageManager] No existing tool found for error, creating new tracking: ${data.toolName}`);
        const toolExecution = toolStateTracker.trackTool(data.sessionId, data.toolName, data.args || {});
        toolStateTracker.errorTool(data.sessionId, toolExecution.id, data.error || 'Unknown error');
        if (dedupKey) {
          this.toolTrackingDedup.set(dedupKey, toolExecution.id);
        }
        this.queueToolStateUpdate(data.sessionId, toolExecution.id);
      }
    }
  }

  /**
   * 啟動工具狀態更新定時器
   */
  private startToolUpdateLoop(): void {
    this.toolUpdateInterval = setInterval(() => {
      this.processToolUpdates();
    }, TOOL_STATE_UPDATE_INTERVAL);

    logger.info('[StreamingMessageManager] 工具狀態更新循環已啟動');
  }

  /**
   * 停止工具狀態更新定時器
   */
  stopToolUpdateLoop(): void {
    if (this.toolUpdateInterval) {
      clearInterval(this.toolUpdateInterval);
      this.toolUpdateInterval = null;
    }
    logger.info('[StreamingMessageManager] 工具狀態更新循環已停止');
  }

  // ============== Tool State Update Queue ==============

  /**
   * 將工具狀態更新加入佇列
   * @param sessionId Session ID
   * @param toolId Tool ID
   */
  queueToolStateUpdate(sessionId: string, toolId: string): void {
    if (!this.toolUpdateQueue.has(sessionId)) {
      this.toolUpdateQueue.set(sessionId, new Set());
    }
    this.toolUpdateQueue.get(sessionId)!.add(toolId);
    logger.debug(`[StreamingMessageManager] Tool state update queued: ${sessionId}:${toolId}`);
  }

  /**
   * 處理工具狀態更新
   * @description 定期批量處理工具狀態更新，發送到 Discord
   */
  private async processToolUpdates(): Promise<void> {
    // 獲取需要處理的 session 和 tool
    const sessionsToProcess = Array.from(this.toolUpdateQueue.entries());
    if (sessionsToProcess.length === 0) return;

    // 清空佇列
    this.toolUpdateQueue.clear();

    for (const [sessionId, _toolIds] of sessionsToProcess) {
      // 獲取該 session 所有工具狀態（從 tracker 渲染完整時間線）
      const toolStateTracker = getToolStateTracker();
      const tools = toolStateTracker.getSessionTools(sessionId);

      if (tools.length === 0) continue;

      // 找到對應的串流會話
      let targetStream: StreamingSession | undefined;
      for (const stream of this.activeStreams.values()) {
        if (this.isSessionIdMatch(stream.sessionId, sessionId)) {
          targetStream = stream;
          break;
        }
      }

      if (!targetStream) {
        logger.debug(`[StreamingMessageManager] No active stream for tool update: ${sessionId}`);
        continue;
      }

      try {
        await this.sendToolStateMessage(targetStream, tools);
      } catch (error) {
        logger.error(`[StreamingMessageManager] Failed to send tool state:`, error);
      }
    }
  }

  /**
   * 發送工具狀態到 Discord（單一可編輯時間線）
   * @param stream 串流會話
   * @param tools 工具執行陣列（從 tracker 獲取的完整狀態）
   */
  private async sendToolStateMessage(stream: StreamingSession, tools: Array<{ id: string; toolName: string; status: string; args?: unknown; result?: unknown; error?: string; startedAt: number; updatedAt: number }>): Promise<void> {
    // 使用 Rate Limiter 包裝 Discord API 請求
    await this.rateLimiter.enqueue(async () => {
      try {
        const channel = await this.getChannel(stream.channelId, stream.discordClient);
        if (!channel) {
          logger.warn(`[StreamingMessageManager] 找不到頻道: ${stream.channelId}`);
          return;
        }

        // 建構多行工具時間線
        const timelineContent = this.renderToolTimeline(tools);

        // 檢查是否有現有的時間線消息
        const existingMessageId = this.sessionMessageMap.get(stream.sessionId);

        if (existingMessageId) {
          // 嘗試編輯現有消息
          try {
            const existingMessage = await channel.messages.fetch(existingMessageId);
            if (existingMessage && existingMessage.editable) {
              await existingMessage.edit({ content: timelineContent });
              logger.debug(`[StreamingMessageManager] Tool timeline edited: ${stream.sessionId}, tools: ${tools.length}`);
              return;
            }
          } catch (fetchError) {
            // 消息不存在或無法獲取，發送新消息
            logger.debug(`[StreamingMessageManager] Could not edit message ${existingMessageId}, sending new:`, fetchError);
            this.sessionMessageMap.delete(stream.sessionId);
          }
        }

        // 發送新時間線消息
        const message = await channel.send({ content: timelineContent });
        this.sessionMessageMap.set(stream.sessionId, message.id);
        logger.debug(`[StreamingMessageManager] Tool timeline sent: ${stream.sessionId}, tools: ${tools.length}`);
      } catch (error) {
        logger.error('[StreamingMessageManager] 發送工具狀態失敗:', error);

        // 如果是 Discord API 錯誤（速率限制），拋出錯誤讓上層處理
        if (this.isRateLimitError(error)) {
          throw error;
        }
      }
    });
  }

  /**
   * 建構工具時間線內容
   * @param tools 工具執行陣列
   * @returns 多行時間線字串
   */
  private renderToolTimeline(tools: Array<{ id: string; toolName: string; status: string; args?: unknown; result?: unknown; error?: string; startedAt: number; updatedAt: number }>): string {
    if (tools.length === 0) {
      return '';
    }

    // 狀態圖示映射
    const statusIcons: Record<string, string> = {
      pending: '⏳',
      running: '🔄',
      completed: '✅',
      error: '❌',
    };

    const lines = tools.map(tool => {
      const icon = statusIcons[tool.status] ?? '❓';
      // args 格式化：支援物件/字串/陣列/其他類型
      const argsSummary = this.formatToolArgsSummary(tool.args);
      return `${icon} \`${tool.toolName}${argsSummary}\``;
    });

    const content = lines.join('\n');
    // 確保不超過 Discord 訊息上限
    return content.length > MAX_MESSAGE_LENGTH ? content.slice(0, MAX_MESSAGE_LENGTH - 3) + '...' : content;
  }

  /**
   * 格式化工具參數為摘要字串（支援多種輸入類型）
   * @param args 工具參數（可能是物件/字串/陣列/其他）
   * @returns 格式化的參數摘要
   */
  private formatToolArgsSummary(args?: unknown): string {
    if (args === undefined || args === null) {
      return '()';
    }

    if (typeof args === 'object') {
      if (Array.isArray(args)) {
        // 陣列：顯示長度
        if (args.length === 0) return '([])';
        return `([${args.length} items])`;
      }
      // 一般物件
      const keys = Object.keys(args as Record<string, unknown>);
      if (keys.length === 0) return '()';
      const serialized = this.serializeArgsForSummary(args as Record<string, unknown>);
      return `(${serialized})`;
    }

    // 非物件類型：直接轉字串
    const str = String(args);
    if (str.length === 0) return '("")';
    return `("${str.length > TOOL_ARGS_TRUNCATE_LENGTH ? str.slice(0, TOOL_ARGS_TRUNCATE_LENGTH) + '...' : str}")`;
  }

  /**
   * 將物件參數序列化為摘要字串
   * @param args 工具參數物件
   * @returns 序列化後的字串
   */
  private serializeArgsForSummary(args: Record<string, unknown>): string {
    const entries = Object.entries(args);
    if (entries.length === 0) return '{}';

    try {
      const serialized = entries.map(([key, value]) => {
        const formatted = this.formatSingleArg(value);
        return `${key}: ${formatted}`;
      });

      const result = `{${serialized.join(', ')}}`;
      // 總長度超過 TOOL_ARGS_TRUNCATE_LENGTH 時截斷
      if (result.length > TOOL_ARGS_TRUNCATE_LENGTH) {
        // 嘗試只保留第一個項目並截斷
        const first = `${entries[0][0]}: ${this.formatSingleArg(entries[0][1])}`;
        if (first.length + 5 < TOOL_ARGS_TRUNCATE_LENGTH) {
          return first.slice(0, TOOL_ARGS_TRUNCATE_LENGTH - 3) + '...';
        }
        return result.slice(0, TOOL_ARGS_TRUNCATE_LENGTH - 3) + '...';
      }
      return result;
    } catch {
      return '{...}';
    }
  }

  /**
   * 格式化單一參數值
   * @param value 參數值
   * @returns 格式化後的字串
   */
  private formatSingleArg(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') {
      if (value.length > 30) return `"${value.slice(0, 30)}..."`;
      return `"${value}"`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      return `[${value.length} items]`;
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value as Record<string, unknown>);
      return `{${keys.length} keys}`;
    }
    return '?';
  }

  // ============== Session Completion Handling ==============

  /**
   * 處理 Session 等待事件 (session.idle)
   * @description 不再自動結束，而是繼續累積內容等待後續回應
   * @param data 等待事件數據
   */
  private handleWaitingEvent(data: SessionWaitingEventData): void {
    logger.info(`[StreamingMessageManager] Session waiting (idle): ${data.sessionId}`);
    // 找到對應的串流後一律 flush，空內容時也要停止 typing 並清理狀態。
    for (const [_key, stream] of this.activeStreams) {
      if (this.isSessionIdMatch(stream.sessionId, data.sessionId)) {
        if (!stream.hasFlushed) {
          void this.flushContent(stream);
        }
        break;
      }
    }
  }

  /**
   * 處理 Session 錯誤事件 (session.error)
   * @param data 錯誤事件數據
   */
  /**
   * 處理 Session 錯誤事件 (session.error)
   * @param data 錯誤事件數據
   */
  private handleSessionErrorEvent(data: ErrorEventData): void {
    const sessionId = data.sessionId ?? '';
    const message = data.message ?? data.error ?? '未知錯誤';
    logger.error(`[StreamingMessageManager] Session error: ${sessionId || 'unknown'}`, { message });

    if (!sessionId) {
      return;
    }

    // 找到對應的串流
    let targetStream: StreamingSession | undefined;
    for (const stream of this.activeStreams.values()) {
      if (this.isSessionIdMatch(stream.sessionId, sessionId)) {
        targetStream = stream;
        break;
      }
    }

    if (targetStream) {
      // 停止 typing
      this.stopTypingIndicator(targetStream);

      // 發送錯誤訊息
      this.sendErrorMessage(targetStream, message);
    }
  }

  /**
   * 發送錯誤訊息
   * @param stream 串流會話
   * @param errorMessage 錯誤訊息
   */
  private async sendErrorMessage(stream: StreamingSession, errorMessage: string): Promise<void> {
    await this.rateLimiter.enqueue(async () => {
      try {
        const channel = await this.getChannel(stream.channelId, stream.discordClient);
        if (!channel) {
          logger.warn(`[StreamingMessageManager] 找不到頻道: ${stream.channelId}`);
          return;
        }

        // 截斷錯誤訊息
        const truncatedError = errorMessage.length > 1000
          ? errorMessage.slice(0, 1000) + '...'
          : errorMessage;

        await channel.send({ content: `❌ 發生錯誤: ${truncatedError}` });
        logger.info(`[StreamingMessageManager] Error message sent: ${stream.sessionId}`);

        // 清理串流
        this.cleanupStream(stream.sessionId, stream.channelId);
      } catch (error) {
        logger.error('[StreamingMessageManager] 發送錯誤訊息失敗:', error);
      }
    });
  }

  /**
   * 處理 Question 事件 (question.asked)
   * @param data 問題事件數據
   */
  private async handleQuestionEvent(data: QuestionEventData): Promise<void> {
    logger.info(`[StreamingMessageManager] Question event received: ${data.questionId}`, {
      sessionId: data.sessionId,
      text: data.text,
      optionsCount: data.options?.length ?? 0,
      multiple: data.multiple,
    });

    const targetStream = this.findActiveStreamBySessionId(data.sessionId);

    if (targetStream) {
      // 停止 typing indicator
      this.stopTypingIndicator(targetStream);
      this.clearStallTimer(targetStream);

      // 先發送累積的內容（如果有的話），但保留 stream 以等待使用者回答後續流程
      if (targetStream.content && targetStream.content.trim() !== '' && !targetStream.hasFlushed) {
        await this.flushContent(targetStream, { keepStream: true });
      }
    }

    const context = this.resolveChannelContextForSession(data.sessionId, targetStream);
    if (!context) {
      logger.warn(`[StreamingMessageManager] No channel context found for question: ${data.sessionId}`);
      return;
    }

    // 發送問題訊息
    await this.rateLimiter.enqueue(async () => {
      try {
        const channel = await this.getChannel(context.channelId, context.discordClient);
        if (!channel) {
          logger.warn(`[StreamingMessageManager] 找不到頻道: ${context.channelId}`);
          return;
        }

        // 創建問題 Embed
        const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = await import('discord.js');

        const embed = new EmbedBuilder()
          .setTitle('❓ AI 提問')
          .setDescription(data.text)
          .setColor(0xFFA500)
          .setTimestamp()
          .addFields([
            {
              name: '🆔 Session ID',
              value: `\`${data.sessionId}\``,
              inline: true,
            },
            {
              name: '📝 選項類型',
              value: data.multiple ? '可選擇多個' : '只能選擇一個',
              inline: true,
            },
          ]);

        // 問題不一定附帶選項；無選項時改成純文字回覆模式
        if (!data.options || data.options.length === 0) {
          await channel.send({
            content: '請直接回覆這個問題的答案。',
            embeds: [embed],
          });
          logger.info(`[StreamingMessageManager] Open question sent: ${data.questionId}`);
          return;
        }

        // 創建選擇選單（Discord 限制最多 25 個選項）
        const maxOptions = Math.min(data.options.length, 25);
        const selectOptions = data.options.slice(0, maxOptions).map(option =>
          new StringSelectMenuOptionBuilder()
            .setLabel(option.label.substring(0, 100))
            .setValue(option.value.substring(0, 100))
            .setDescription(option.description ? option.description.substring(0, 100) : '')
        );

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`session:question:${data.sessionId}:${data.questionId}`)
          .setPlaceholder('請選擇...')
          .setMinValues(1)
          .setMaxValues(data.multiple ? maxOptions : 1)
          .addOptions(selectOptions);

        const actionRow = new ActionRowBuilder<typeof selectMenu>().addComponents(selectMenu);

        // 發送到頻道
        await channel.send({ embeds: [embed], components: [actionRow] });
        logger.info(`[StreamingMessageManager] Question sent: ${data.questionId}`);
      } catch (error) {
        logger.error('[StreamingMessageManager] 發送問題失敗:', error);
      }
    });
  }

  /**
   * 處理 Thinking 事件
   * @param data Thinking 事件
   */
  private async handleThinkingEvent(data: ThinkingEventData): Promise<void> {
    const targetStream = this.findActiveStreamBySessionId(data.sessionId);
    if (!targetStream) {
      return;
    }

    this.refreshStreamTimeout(targetStream);

    if (targetStream.hasSentThinkingNotice) {
      return;
    }

    targetStream.hasSentThinkingNotice = true;

    await this.rateLimiter.enqueue(async () => {
      try {
        const channel = await this.getChannel(targetStream.channelId, targetStream.discordClient);
        if (!channel) {
          logger.warn(`[StreamingMessageManager] 找不到頻道: ${targetStream.channelId}`);
          return;
        }

        await channel.send({ content: '```思考中```' });
        logger.info(`[StreamingMessageManager] Thinking notice sent: ${targetStream.sessionId}`);
      } catch (error) {
        logger.error('[StreamingMessageManager] 發送思考提示失敗:', error);
      }
    });
  }

  /**
   * 清理串流資源
   * @param sessionId Session ID
   * @param channelId Channel ID
   */
  private cleanupStream(sessionId: string, channelId: string): void {
    // 獲取對應的 OpenCode Session ID 並清理映射
    const opencodeSessionId = this.sessionIdToOpenCodeId.get(sessionId);
    if (opencodeSessionId) {
      this.sessionIdToOpenCodeId.delete(sessionId);
      this.openCodeIdToSessionId.delete(opencodeSessionId);
    }

    // 移除串流
    this.removeStream(sessionId, channelId);

    // 清理工具狀態
    const toolStateTracker = getToolStateTracker();
    toolStateTracker.clearSessionTools(sessionId);

    // 清理 toolUpdateQueue 中該 session 的所有工具 ID
    const sessionToolIds = this.toolUpdateQueue.get(sessionId);
    if (sessionToolIds) {
      this.toolUpdateQueue.delete(sessionId);
    }

    // 清理 sessionMessageMap 中該 session 的消息映射
    this.sessionMessageMap.delete(sessionId);

    // 清理 toolTrackingDedup 中該 session 的所有去重映射
    for (const key of this.toolTrackingDedup.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.toolTrackingDedup.delete(key);
      }
    }

    logger.info(`[StreamingMessageManager] Stream cleaned up: ${sessionId}`);
  }

  /**
   * 清理指定 Session 的所有串流資源
   * @param sessionId Session ID
   */
  private cleanupStreamsForSession(sessionId: string): void {
    const streams = [...this.activeStreams.values()].filter((stream) =>
      this.isSessionIdMatch(stream.sessionId, sessionId)
    );

    for (const stream of streams) {
      this.stopTypingIndicator(stream);
      this.cleanupStream(stream.sessionId, stream.channelId);
    }
  }

  /**
   * 生成 args 的簡單 hash（用於去重檢測）
   * @description 使用簡單的字串化+長度截取作為 hash，避免循環引用
   */
  private hashArgs(args?: Record<string, unknown>): string {
    if (!args || Object.keys(args).length === 0) {
      return 'empty';
    }
    try {
      return JSON.stringify(args, Object.keys(args).sort());
    } catch {
      return 'unstringifiable';
    }
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
   * 生成串流鍵值
   */
  private getStreamKey(channelId: string, sessionId: string): string {
    return `${channelId}:${sessionId}`;
  }

  /**
   * 檢查 Session ID 是否匹配（使用雙向映射）
   * @param streamSessionId 流中的 Session ID
   * @param eventSessionId 事件中的 Session ID
   */
  private isSessionIdMatch(streamSessionId: string, eventSessionId: string): boolean {
    if (!streamSessionId || !eventSessionId) {
      return false;
    }

    // 直接匹配
    if (streamSessionId === eventSessionId) {
      return true;
    }

    // 後綴匹配（向後相容）
    if (streamSessionId.endsWith(eventSessionId) || eventSessionId.endsWith(streamSessionId)) {
      return true;
    }

    // 雙向映射匹配
    if (this.sessionIdToOpenCodeId.get(streamSessionId) === eventSessionId) {
      return true;
    }

    if (this.openCodeIdToSessionId.get(eventSessionId) === streamSessionId) {
      return true;
    }

    return false;
  }

  /**
   * 透過 Session ID 尋找活躍串流
   */
  private findActiveStreamBySessionId(sessionId: string): StreamingSession | undefined {
    for (const stream of this.activeStreams.values()) {
      if (this.isSessionIdMatch(stream.sessionId, sessionId)) {
        return stream;
      }
    }
    return undefined;
  }

  /**
   * 解析 Session 對應的 Discord 頻道上下文
   */
  private resolveChannelContextForSession(
    sessionId: string,
    stream?: StreamingSession
  ): { channelId: string; discordClient: Client } | null {
    if (stream) {
      return {
        channelId: stream.channelId,
        discordClient: stream.discordClient,
      };
    }

    const normalizedSessionId = this.openCodeIdToSessionId.get(sessionId) || sessionId;
    const threadManager = getThreadManager();
    const threadId = threadManager.getThreadIdBySessionId(normalizedSessionId);
    if (!threadId || !this.discordClient) {
      return null;
    }

    return {
      channelId: threadId,
      discordClient: this.discordClient,
    };
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

export type { SSEEventEmitterAdapter };
export default {
  StreamingMessageManager,
  getStreamingMessageManager,
  initializeStreamingMessageManager,
};
