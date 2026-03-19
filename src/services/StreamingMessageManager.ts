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
import logger from '../utils/logger.js';

// ============== SSE 事件類型定義 ==============

/**
 * SSE 事件類型
 */
export type SSEEventType = 
  | 'connected'
  | 'message'
  | 'tool_request'
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

/**
 * Tool 狀態更新事件數據
 */
export interface ToolUpdateEventData {
  sessionId: string;
  toolId: string;
  toolName: string;
  status: 'pending' | 'running' | 'completed' | 'error';
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
  /** Discord Client */
  discordClient: Client;
}

// ============== 常量 ==============

/** Discord 訊息最大長度 */
const MAX_MESSAGE_LENGTH = 2000;

/** typing indicator 刷新間隔（毫秒）- 少於 10 秒以保持狀態 */
const TYPING_REFRESH_INTERVAL = 7500;

/** 工具狀態更新間隔（毫秒） */
const TOOL_STATE_UPDATE_INTERVAL = 1000;

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
 * - 盡量在換行符號處切分
 * - 避免在 Markdown 程式碼區塊中切斷
 */
function chunkContent(content: string): string[] {
  if (content.length <= MAX_MESSAGE_LENGTH) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > MAX_MESSAGE_LENGTH) {
    // 找到最佳切分點
    let splitPoint = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
    
    // 如果沒有找到換行符，嘗試找空格
    if (splitPoint === -1) {
      splitPoint = remaining.lastIndexOf(' ', MAX_MESSAGE_LENGTH);
    }

    // 如果都沒有，找到硬性切分點
    if (splitPoint === -1 || splitPoint === 0) {
      splitPoint = MAX_MESSAGE_LENGTH;
    }

    const chunk = remaining.slice(0, splitPoint);
    
    // 檢查是否在程式碼區塊中
    const openCodeBlocks = (chunk.match(/```/g) || []).length;
    if (openCodeBlocks % 2 === 1) {
      // 單數個 ``` - 需要補上結尾
      chunks.push(chunk + '```');
      remaining = '```' + remaining.slice(splitPoint);
    } else {
      chunks.push(chunk);
      remaining = remaining.slice(splitPoint);
    }

    // 防止無窮循環
    if (chunk.length === 0 && remaining.length > 0) {
      // 強制切分
      chunks.push(remaining.slice(0, MAX_MESSAGE_LENGTH));
      remaining = remaining.slice(MAX_MESSAGE_LENGTH);
    }
  }

  // 添加剩餘內容
  if (remaining.length > 0) {
    // 檢查是否需要補上 ``` 開始標籤
    const lastChunk = chunks[chunks.length - 1];
    const openCodeBlocks = (lastChunk.match(/```/g) || []).length;
    if (openCodeBlocks % 2 === 1) {
      chunks[chunks.length - 1] = lastChunk + '```';
      remaining = remaining.replace(/^```/, '');
    }
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

  /** 工具狀態消息映射 */
  private toolMessageMap: Map<string, string> = new Map(); // sessionId:toolId -> messageId

  /** 工具狀態定時器 */
  private toolUpdateInterval: NodeJS.Timeout | null = null;

  /** 事件處理器是否已設置 */
  private handlersSetup = false;

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
    this.setupEventHandlers();
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
    }

    // 創建 typing indicator 定時器
    const typingTimer = this.startTypingIndicator(channelId);

    this.activeStreams.set(streamKey, {
      sessionId: session.sessionId,
      channelId: channelId,
      content: existingStream?.content ?? '',
      isComplete: false,
      hasFlushed: false,
      typingTimer: typingTimer,
      discordClient: this.discordClient,
    });

    // 註冊 Session ID 雙向映射
    this.sessionIdToOpenCodeId.set(session.sessionId, session.opencodeSessionId || '');
    if (session.opencodeSessionId) {
      this.openCodeIdToSessionId.set(session.opencodeSessionId, session.sessionId);
    }

    // 如果提供了外部適配器，使用它；否則使用內部適配器連接
    if (adapter) {
      this.eventStreamAdapter = adapter as unknown as IEventStreamAdapter;
      this.setupEventHandlers();
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
        logger.debug(`[StreamingMessageManager] Sent typing indicator to ${channelId}`);
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
  private setupEventHandlers(): void {
    if (this.handlersSetup) return;
    this.handlersSetup = true;

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

    // 監聽工具請求
    this.eventStreamAdapter.on('tool_request', (event: unknown) => {
      const data = (event as SSEEvent).data as ToolUpdateEventData;
      this.handleToolRequestEvent(data);
    });

    // 監聽等待事件 (session.idle) - 不再自動結束
    this.eventStreamAdapter.on('waiting', (event: unknown) => {
      const data = (event as SSEEvent).data as SessionWaitingEventData;
      this.handleWaitingEvent(data);
    });

    // 監聽錯誤
    this.eventStreamAdapter.on('error', (event: unknown) => {
      const data = (event as SSEEvent).data as ErrorEventData;
      this.handleSessionErrorEvent(data);
    });

    // 監聽問題事件 (question.asked)
    this.eventStreamAdapter.on('question', (event: unknown) => {
      const data = (event as SSEEvent).data as QuestionEventData;
      this.handleQuestionEvent(data);
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
    for (const [_key, stream] of this.activeStreams) {
      if (this.isSessionIdMatch(stream.sessionId, data.sessionId)) {
        // 累積內容
        stream.content += data.content;
        stream.isComplete = data.isComplete ?? false;

        logger.debug(`[StreamingMessageManager] 累積內容: ${stream.sessionId}, length: ${stream.content.length}`);
        break;
      }
    }
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
        this.flushContent(stream);
        break;
      }
    }
  }

  /**
   * 將緩衝區內容發送到 Discord
   * @param stream 串流會話
   */
  private async flushContent(stream: StreamingSession): Promise<void> {
    if (stream.hasFlushed) {
      logger.debug(`[StreamingMessageManager] 內容已發送，跳過: ${stream.sessionId}`);
      return;
    }

    // 停止 typing indicator
    this.stopTypingIndicator(stream);

    if (!stream.content || stream.content.trim() === '') {
      logger.debug(`[StreamingMessageManager] 內容為空，跳過發送: ${stream.sessionId}`);
      stream.hasFlushed = true;
      this.cleanupStream(stream.sessionId, stream.channelId);
      return;
    }

    try {
      const channel = await this.getChannel(stream.channelId, stream.discordClient);
      if (!channel) {
        logger.warn(`[StreamingMessageManager] 找不到頻道: ${stream.channelId}`);
        return;
      }

      // 智能分段
      const chunks = chunkContent(stream.content);
      
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

      stream.hasFlushed = true;
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
      // 清理串流
      this.cleanupStream(stream.sessionId, stream.channelId);
    }
  }

  /**
   * 處理工具請求事件
   * @param data Tool 請求事件數據
   */
  private handleToolRequestEvent(data: ToolUpdateEventData): void {
    const toolStateTracker = getToolStateTracker();
    
    // 追蹤新的工具執行
    if (data.status === 'pending') {
      const toolExecution = toolStateTracker.trackTool(data.sessionId, data.toolName, data.args || {});
      this.queueToolStateUpdate(data.sessionId, toolExecution.id);
      logger.info(`[StreamingMessageManager] Tool requested: ${data.toolName} (${data.sessionId})`);
    } else if (data.status === 'running') {
      // 嘗試找到現有的工具並更新狀態
      const existingTools = toolStateTracker.getSessionTools(data.sessionId);
      const existingTool = existingTools.find(t => t.toolName === data.toolName && t.status === 'pending');
      if (existingTool) {
        toolStateTracker.startTool(data.sessionId, existingTool.id);
        this.queueToolStateUpdate(data.sessionId, existingTool.id);
      }
    } else if (data.status === 'completed') {
      const existingTools = toolStateTracker.getSessionTools(data.sessionId);
      const existingTool = existingTools.find(t => t.toolName === data.toolName && t.status === 'running');
      if (existingTool) {
        toolStateTracker.completeTool(data.sessionId, existingTool.id, data.result);
        this.queueToolStateUpdate(data.sessionId, existingTool.id);
      }
    } else if (data.status === 'error') {
      const existingTools = toolStateTracker.getSessionTools(data.sessionId);
      const existingTool = existingTools.find(t => t.toolName === data.toolName);
      if (existingTool) {
        toolStateTracker.errorTool(data.sessionId, existingTool.id, data.error || 'Unknown error');
        this.queueToolStateUpdate(data.sessionId, existingTool.id);
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

    for (const [sessionId, toolIds] of sessionsToProcess) {
      const toolIdsArray = Array.from(toolIds);
      
      // 獲取工具狀態
      const toolStateTracker = getToolStateTracker();
      const tools = toolIdsArray
        .map(toolId => toolStateTracker.getTool(sessionId, toolId))
        .filter((tool): tool is NonNullable<typeof tool> => tool !== undefined);

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
   * 發送工具狀態到 Discord（改用文字訊息）
   * @param stream 串流會話
   * @param tools 工具執行陣列
   */
  private async sendToolStateMessage(stream: StreamingSession, tools: Array<{ id: string; toolName: string; status: string; args?: Record<string, unknown>; result?: unknown; error?: string; startedAt: number; updatedAt: number }>): Promise<void> {
    // 使用 Rate Limiter 包裝 Discord API 請求
    await this.rateLimiter.enqueue(async () => {
      try {
        const channel = await this.getChannel(stream.channelId, stream.discordClient);
        if (!channel) {
          logger.warn(`[StreamingMessageManager] 找不到頻道: ${stream.channelId}`);
          return;
        }

        // 為每個工具發送狀態訊息
        for (const tool of tools) {
          const statusEmoji = {
            pending: '⏳',
            running: '🔄',
            completed: '✅',
            error: '❌',
          }[tool.status] || '❓';

          let content = `${statusEmoji} **${tool.toolName}** - `;
          
          switch (tool.status) {
            case 'pending':
              content += '等待執行...';
              break;
            case 'running':
              content += '執行中...';
              break;
            case 'completed':
              content += '完成';
              if (tool.result) {
                const resultStr = typeof tool.result === 'string' 
                  ? tool.result 
                  : JSON.stringify(tool.result, null, 2);
                // 截斷過長的結果
                const truncated = resultStr.length > 500 ? resultStr.slice(0, 500) + '...' : resultStr;
                content += `\n\`\`\`\n${truncated}\n\`\`\``;
              }
              break;
            case 'error':
              content += `錯誤: ${tool.error || 'Unknown error'}`;
              break;
          }

          // 發送到頻道
          await channel.send({ content });
          logger.debug(`[StreamingMessageManager] Tool state sent: ${tool.toolName} (${tool.status})`);
        }
      } catch (error) {
        logger.error('[StreamingMessageManager] 發送工具狀態失敗:', error);
        
        // 如果是 Discord API 錯誤（速率限制），拋出錯誤讓上層處理
        if (this.isRateLimitError(error)) {
          throw error;
        }
      }
    });
  }

  // ============== Session Completion Handling ==============

  /**
   * 處理 Session 等待事件 (session.idle)
   * @description 不再自動結束，而是繼續累積內容等待後續回應
   * @param data 等待事件數據
   */
  private handleWaitingEvent(data: SessionWaitingEventData): void {
    logger.info(`[StreamingMessageManager] Session waiting (idle): ${data.sessionId}`);
    // 找到對應的串流，如果還沒 flush 且有內容，就執行 flush
    for (const [_key, stream] of this.activeStreams) {
      if (this.isSessionIdMatch(stream.sessionId, data.sessionId)) {
        if (!stream.hasFlushed && stream.content.length > 0) {
          this.flushContent(stream);
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
    logger.error(`[StreamingMessageManager] Session error: ${data.sessionId}`, { message: data.message });

    // 找到對應的串流
    let targetStream: StreamingSession | undefined;
    for (const stream of this.activeStreams.values()) {
      if (this.isSessionIdMatch(stream.sessionId, data.sessionId)) {
        targetStream = stream;
        break;
      }
    }

    if (targetStream) {
      // 停止 typing
      this.stopTypingIndicator(targetStream);
      
      // 發送錯誤訊息
      this.sendErrorMessage(targetStream, data.message);
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
      optionsCount: data.options.length,
      multiple: data.multiple,
    });

    // 找到對應的串流
    let targetStream: StreamingSession | undefined;
    for (const stream of this.activeStreams.values()) {
      if (this.isSessionIdMatch(stream.sessionId, data.sessionId)) {
        targetStream = stream;
        break;
      }
    }

    if (!targetStream) {
      logger.warn(`[StreamingMessageManager] No active stream found for question: ${data.sessionId}`);
      return;
    }

    // 停止 typing indicator
    this.stopTypingIndicator(targetStream);

    // 先發送累積的內容（如果有的話）
    if (targetStream.content && targetStream.content.trim() !== '' && !targetStream.hasFlushed) {
      await this.flushContent(targetStream);
    }

    // 發送問題訊息
    await this.rateLimiter.enqueue(async () => {
      try {
        const channel = await this.getChannel(targetStream!.channelId, targetStream!.discordClient);
        if (!channel) {
          logger.warn(`[StreamingMessageManager] 找不到頻道: ${targetStream!.channelId}`);
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

        // 創建選擇選單
        // Discord 限制最多 25 個選項
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

        // 重新啟動 typing indicator（因為問題需要用戶回答）
        targetStream!.typingTimer = this.startTypingIndicator(targetStream!.channelId);
      } catch (error) {
        logger.error('[StreamingMessageManager] 發送問題失敗:', error);
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

    // 清理 toolMessageMap 中該 session 的所有消息映射
    for (const key of this.toolMessageMap.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.toolMessageMap.delete(key);
      }
    }

    logger.info(`[StreamingMessageManager] Stream cleaned up: ${sessionId}`);
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
