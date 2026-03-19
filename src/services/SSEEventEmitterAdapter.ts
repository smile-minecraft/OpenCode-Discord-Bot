/**
 * SSE Event Emitter Adapter - SDK 事件串流適配器
 * @description 將 SDK 的 AsyncGenerator 轉換為 EventEmitter 格式，實現統一的事件處理介面
 */

import { EventEmitter } from 'events';
import logger from '../utils/logger.js';

// ============== 類型定義 ==============

/**
 * SDK 事件類型
 * 對應 SDK 發送的實際事件類型
 */
export type SDKEventType =
  // Message events
  | 'message.updated'
  | 'message.created'
  | 'message.part.updated'
  | 'message.part.delta'
  // Tool events
  | 'tool_call'
  | 'tool_call_start'
  | 'tool_call_end'
  // Session events
  | 'session.created'
  | 'session.deleted'
  | 'session.idle'
  | 'session.error'
  | 'session.compacted'
  | 'session.started'
  | 'session.ended'
  | 'session.updated'
  | 'session.status'
  | 'session.diff'
  // File watcher events
  | 'file.watcher.updated'
  | 'file.watcher.created'
  | 'file.watcher.deleted'
  // Question events
  | 'question.asked'
  // Error events
  | 'error'
  // Server events
  | 'server.connected'
  | 'server.heartbeat';

/**
 * SDK 事件屬性
 */
export interface SDKEventProperties {
  /** Session ID */
  session_id?: string;
  sessionId?: string;
  /** 訊息 ID */
  message_id?: string;
  messageId?: string;
  /** 內容 */
  content?: string;
  /** 訊息角色 */
  role?: string;
  /** 完整標記 */
  is_complete?: boolean;
  isComplete?: boolean;
  /** 工具名稱 */
  tool_name?: string;
  toolName?: string;
  /** 工具參數 */
  tool_args?: Record<string, unknown>;
  toolArgs?: Record<string, unknown>;
  /** 請求 ID */
  request_id?: string;
  requestId?: string;
  /** 錯誤訊息 */
  error?: string;
  /** 問題屬性 */
  question?: {
    id: string;
    text: string;
    options: Array<{ label: string; value: string; description?: string }>;
    multiple?: boolean;
    session_id?: string;
    sessionId?: string;
  };
  /** 問題 ID（部分事件格式會放在頂層） */
  question_id?: string;
  questionId?: string;
  /** 問題文字（部分事件格式會放在頂層） */
  text?: string;
  /** 問題選項（部分事件格式會放在頂層） */
  options?: Array<{ label?: string; value?: string; description?: string } | string>;
  /** 是否可複選（部分事件格式會放在頂層） */
  multiple?: boolean;
  /** 其他屬性 */
  [key: string]: unknown;
}

/**
 * SDK 事件
 */
export interface SDKEvent {
  type: SDKEventType;
  properties: SDKEventProperties;
}

/**
 * SSE 內部事件類型（與 SSEClient 保持一致）
 */
export type SSEEventTypeInternal =
  | 'message'
  | 'tool_request'
  | 'session_complete'
  | 'waiting'
  | 'error'
  | 'connected'
  | 'disconnected'
  | 'thinking'
  | 'question';

/**
 * 訊息事件數據（與 SSEClient 保持一致）
 */
export interface MessageEventData {
  sessionId: string;
  content: string;
  isComplete: boolean;
}

/**
 * 工具請求事件數據（與 SSEClient 保持一致）
 */
export interface ToolRequestEventData {
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  requestId: string;
}

/**
 * 連線事件數據（與 SSEClient 保持一致）
 */
export interface ConnectedEventData {
  sessionId: string;
}

/**
 * 錯誤事件數據（與 SSEClient 保持一致）
 */
export interface ErrorEventData {
  sessionId?: string;
  error: string;
  message?: string;
}

/**
 * Session 完成事件數據（與 SSEClient 保持一致）
 */
export interface SessionCompleteEventData {
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

/**
 * 內部 SSE 事件
 */
export interface SSEEventInternal {
  type: SSEEventTypeInternal;
  data:
    | MessageEventData
    | ToolRequestEventData
    | ConnectedEventData
    | ErrorEventData
    | SessionCompleteEventData
    | ThinkingEventData
    | QuestionEventData;
  timestamp: number;
}

/**
 * SSE 事件處理器
 */
export type SSEEventHandler = (event: SSEEventInternal) => void;

// ============== 常量 ==============

/** SDK 事件類型到內部事件類型的映射 */
const EVENT_TYPE_MAP: Record<SDKEventType, SSEEventTypeInternal | null> = {
  // Message events - map to 'message'
  'message.updated': 'message',
  'message.created': 'message',
  'message.part.updated': 'message',
  'message.part.delta': 'message',
  
  // Tool events - map to 'tool_request'
  'tool_call': 'tool_request',
  'tool_call_start': 'tool_request',
  'tool_call_end': 'tool_request',
  
  // Session events
  'session.created': 'connected',
  'session.started': 'connected',
  'session.deleted': 'disconnected',
  'session.ended': 'session_complete',
  'session.idle': 'waiting',
  'session.error': 'error',
  'session.compacted': 'session_complete',
  'session.updated': null,
  'session.status': null,
  'session.diff': null,
  'file.watcher.updated': null,
  'file.watcher.created': null,
  'file.watcher.deleted': null,
  
  // Question events
  'question.asked': 'question',
  
  // Error events
  'error': 'error',
  
  // Server events
  'server.connected': 'connected',
  'server.heartbeat': null,
};

// ============== 介面定義 ==============

/**
 * SSEEventEmitterAdapter 公開介面
 */
export interface ISSEEventEmitterAdapter {
  start(eventStream: AsyncIterable<SDKEvent>, sessionId: string): void;
  stop(): void;
  dispose(): void;
  isActive(): boolean;
  getSessionId(): string | null;
  on(eventType: string, handler: SSEEventHandler): this;
  once(eventType: string, handler: SSEEventHandler): this;
  off(eventType: string, handler: SSEEventHandler): this;
}

// ============== SSEEventEmitterAdapter 類別 ==============

/**
 * SSE 事件發射器適配器
 * @description 將 SDK 的 AsyncGenerator 事件轉換為標準 EventEmitter 事件
 *              保持與現有 SSEClient 相同的事件介面
 */
export class SSEEventEmitterAdapter
  extends EventEmitter
  implements ISSEEventEmitterAdapter
{
  /** SDK AsyncIterable 實例 (用於保持引用) */
  private eventStreamRef: AsyncIterable<SDKEvent> | null = null;

  /** 異步迭代器 */
  private iterator: AsyncIterator<SDKEvent> | null = null;

  /** 是否正在處理 */
  private isProcessing = false;

  /** 是否已清理 */
  private isDisposed = false;

  /** 當前 Session ID */
  private currentSessionId: string | null = null;

  /** AbortController for cancellation */
  private abortController: AbortController | null = null;

  /**
   * 建構子
   */
  constructor() {
    super();
    logger.debug('[SSEEventEmitterAdapter] 實例已創建');
  }

  /**
   * 啟動事件監聽
   * @param eventStream SDK 的 AsyncIterable 事件流
   * @param sessionId Session ID
   */
  public start(eventStream: AsyncIterable<SDKEvent>, sessionId: string): void {
    if (this.isDisposed) {
      throw new Error('SSEEventEmitterAdapter 已被銷毀，無法重複使用');
    }

    // 如果已有運行中的流，先停止
    if (this.isProcessing) {
      this.stop();
    }

    this.eventStreamRef = eventStream;
    this.currentSessionId = sessionId;
    this.isProcessing = true;
    this.abortController = new AbortController();

    // 創建異步迭代器
    this.iterator = eventStream[Symbol.asyncIterator]();

    // 發送連接事件
    this.emitEvent('connected', {
      sessionId,
    } as ConnectedEventData);

    // 開始處理事件流（不等待完成）
    this.processStream().catch((error) => {
      logger.error('[SSEEventEmitterAdapter] 事件流處理錯誤:', error);
    });

    logger.debug(`[SSEEventEmitterAdapter] 開始監聽事件, sessionId: ${sessionId}`);
  }

  /**
   * 停止事件監聽
   */
  public stop(): void {
    if (!this.isProcessing) {
      return;
    }

    this.isProcessing = false;

    // 中止迭代
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // 發送斷開事件
    if (this.currentSessionId) {
      this.emitEvent('disconnected', {
        sessionId: this.currentSessionId,
      } as ConnectedEventData);
    }

    this.eventStreamRef = null;
    this.iterator = null;

    logger.debug('[SSEEventEmitterAdapter] 已停止監聽');
  }

  /**
   * 處理事件流
   */
  private async processStream(): Promise<void> {
    if (!this.iterator) {
      return;
    }

    try {
      // Stream timeout constant (30 seconds)
      const STREAM_TIMEOUT = 30000;

      while (this.isProcessing) {
        // Use Promise.race with timeout to prevent hanging
        const result = await Promise.race([
          this.iterator.next(),
          new Promise<IteratorResult<SDKEvent>>((_, reject) => {
            setTimeout(() => reject(new Error('Stream timeout')), STREAM_TIMEOUT);
          }),
        ]);

        if (result.done) {
          logger.debug('[SSEEventEmitterAdapter] 事件流已完成');
          break;
        }

        const event = result.value;
        this.handleSDKEvent(event);
      }
    } catch (error) {
      // Ignore abort errors
      if (error instanceof Error && error.message === 'Aborted') {
        logger.debug('[SSEEventEmitterAdapter] 事件流已中止');
        return;
      }

      // Log timeout errors specially
      if (error instanceof Error && error.message === 'Stream timeout') {
        logger.warn('[SSEEventEmitterAdapter] 事件流逾時');
      } else {
        logger.error('[SSEEventEmitterAdapter] 處理事件流時發生錯誤:', error);
      }

      this.emitEvent('error', {
        sessionId: this.currentSessionId ?? undefined,
        error: error instanceof Error ? error.message : '未知錯誤',
      } as ErrorEventData);
    } finally {
      // Cleanup references
      this.isProcessing = false;
      this.eventStreamRef = null;
      this.iterator = null;

      // Ensure session_complete is emitted if still processing
      if (this.currentSessionId) {
        this.emitEvent('session_complete', {
          sessionId: this.currentSessionId,
        } as SessionCompleteEventData);
      }
    }
  }

  /**
   * 處理 SDK 事件
   * @param event SDK 事件
   */
  private handleSDKEvent(event: SDKEvent): void {
    const internalType = EVENT_TYPE_MAP[event.type];

    // null means we want to explicitly ignore this event
    // undefined means the event type is not recognized
    if (internalType === undefined) {
      if (typeof event.type === 'string' && event.type.startsWith('file.watcher.')) {
        return;
      }
      logger.warn(`[SSEEventEmitterAdapter] 未知的 SDK 事件類型: ${event.type}`);
      return;
    }

    // null means we want to silently ignore this event type
    if (internalType === null) {
      return;
    }

    const props = event.properties;

    switch (internalType) {
      case 'message':
        const messageRole = this.extractMessageRole(props);
        if (this.isIgnoredMessageRole(messageRole)) {
          break;
        }

        const hasThinkingSignal = this.hasThinkingSignal(props);
        if (hasThinkingSignal) {
          this.emitEvent('thinking', {
            sessionId: props.session_id || props.sessionId || this.currentSessionId || '',
          } as ThinkingEventData);
        }

        // 提取內容 - 支援多種 SDK 格式
        let extractedContent = props.content || '';
        
        // 處理 OpenCode SDK v2 的 part 結構 (message.part.updated, message.part.delta)
        if (!extractedContent && props.part && typeof props.part === 'object') {
          const part = props.part as any;
          if (part.type === 'text' && part.text) {
            extractedContent = String(part.text);
          }
        }
        
        // 處理 delta 結構 (message.part.delta)
        if (!extractedContent && props.delta && typeof props.delta === 'object') {
          const delta = props.delta as any;
          if (delta.type === 'text' && delta.text) {
            extractedContent = String(delta.text);
          }
        }
        
        // 處理直接的 text 屬性
        if (!extractedContent && props.text) {
          extractedContent = String(props.text);
        }

        // 處理 props.info 結構 (常見於 message.updated 事件)
        // 優先順序：直接 content > info.content > info.parts
        if (!extractedContent && props.info && typeof props.info === 'object') {
          const info = props.info as any;
          
          // 首先檢查 info.content
          if (info.content) {
            extractedContent = String(info.content);
          }
          
          // 如果沒有 content，檢查 info.parts 陣列
          if (!extractedContent && Array.isArray(info.parts) && info.parts.length > 0) {
            // 合併所有 parts 的 text 內容
            const textParts = info.parts
              .filter((p: any) => p && (p.type === 'text' || p.type === 'output_text') && p.text)
              .map((p: any) => p.text);
            if (textParts.length > 0) {
              extractedContent = textParts.join('');
            }
          }

          // 處理 info.part (單一 part 結構)
          if (!extractedContent && info.part && typeof info.part === 'object') {
            const infoPart = info.part as any;
            if ((infoPart.type === 'text' || infoPart.type === 'output_text') && infoPart.text) {
              extractedContent = String(infoPart.text);
            }
          }
        }
        
        this.emitEvent('message', {
          sessionId: props.session_id || props.sessionId || this.currentSessionId || '',
          content: extractedContent,
          isComplete: props.is_complete || props.isComplete || false,
        } as MessageEventData);
        break;

      case 'tool_request':
        this.emitEvent('tool_request', {
          sessionId: props.session_id || props.sessionId || this.currentSessionId || '',
          toolName: props.tool_name || props.toolName || 'unknown',
          args: props.tool_args || props.toolArgs || {},
          requestId: props.request_id || props.requestId || '',
        } as ToolRequestEventData);
        break;

      case 'session_complete':
        this.emitEvent('session_complete', {
          sessionId: props.session_id || props.sessionId || this.currentSessionId || '',
        } as SessionCompleteEventData);
        break;

      case 'waiting':
        // session.idle means waiting for input - emit as 'waiting' event
        this.emitEvent('waiting', {
          sessionId: props.session_id || props.sessionId || this.currentSessionId || '',
        } as SessionCompleteEventData);
        break;

      case 'error':
        const errorMessage = typeof props.error === 'string' && props.error.trim() !== ''
          ? props.error
          : typeof props.message === 'string' && props.message.trim() !== ''
            ? props.message
            : '未知錯誤';
        this.emitEvent('error', {
          sessionId: props.session_id || props.sessionId || this.currentSessionId || '',
          error: errorMessage,
          message: errorMessage,
        } as ErrorEventData);
        break;

      case 'connected':
        // 連接事件已在 start 時發送
        break;

      case 'disconnected':
        // 斷開事件已在 stop 時發送
        break;

      case 'question': {
        const parsedQuestion = this.parseQuestionEvent(props);
        if (parsedQuestion) {
          this.emitEvent('question', parsedQuestion);
        } else {
          logger.warn('[SSEEventEmitterAdapter] question 事件解析失敗', {
            sessionId: props.session_id || props.sessionId || this.currentSessionId || '',
            keys: Object.keys(props),
          });
        }
        break;
      }
    }

    if (internalType !== 'message' && internalType !== 'thinking') {
      logger.debug(`[SSEEventEmitterAdapter] 處理事件: ${event.type} -> ${internalType}`);
    }
  }

  /**
   * 發送內部事件
   * @param type 事件類型
   * @param data 事件數據
   */
  private emitEvent(
    type: SSEEventTypeInternal,
    data:
      | MessageEventData
      | ToolRequestEventData
      | ConnectedEventData
      | ErrorEventData
      | SessionCompleteEventData
      | ThinkingEventData
      | QuestionEventData
  ): void {
    const event: SSEEventInternal = {
      type,
      data,
      timestamp: Date.now(),
    };

    this.emit(type, event);
    this.emit('*', event); // 通配符事件

    if (type !== 'message' && type !== 'thinking') {
      logger.debug(`[SSEEventEmitterAdapter] 發送事件: ${type}`);
    }
  }

  /**
   * 提取訊息角色
   */
  private extractMessageRole(props: SDKEventProperties): string | null {
    const info = props.info && typeof props.info === 'object'
      ? (props.info as Record<string, unknown>)
      : null;
    const infoMessage = info?.message && typeof info.message === 'object'
      ? (info.message as Record<string, unknown>)
      : null;
    const message = props.message && typeof props.message === 'object'
      ? (props.message as Record<string, unknown>)
      : null;

    const candidates = [
      props.role,
      info?.role,
      infoMessage?.role,
      message?.role,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim() !== '') {
        return candidate.trim().toLowerCase();
      }
    }

    return null;
  }

  /**
   * 判斷是否應忽略該角色的訊息
   */
  private isIgnoredMessageRole(role: string | null): boolean {
    if (!role) return false;
    return role === 'user' || role === 'human' || role === 'system' || role === 'tool';
  }

  /**
   * 判斷事件是否為「思考中」訊號
   */
  private hasThinkingSignal(props: SDKEventProperties): boolean {
    const part = props.part && typeof props.part === 'object'
      ? (props.part as Record<string, unknown>)
      : null;
    if (part && this.isThinkingPartType(part.type)) {
      return true;
    }

    const delta = props.delta && typeof props.delta === 'object'
      ? (props.delta as Record<string, unknown>)
      : null;
    if (delta && this.isThinkingPartType(delta.type)) {
      return true;
    }

    const info = props.info && typeof props.info === 'object'
      ? (props.info as Record<string, unknown>)
      : null;
    const infoPart = info?.part && typeof info.part === 'object'
      ? (info.part as Record<string, unknown>)
      : null;
    if (infoPart && this.isThinkingPartType(infoPart.type)) {
      return true;
    }

    if (Array.isArray(info?.parts)) {
      return info.parts.some((candidate) => {
        if (!candidate || typeof candidate !== 'object') return false;
        return this.isThinkingPartType((candidate as Record<string, unknown>).type);
      });
    }

    return false;
  }

  /**
   * 判斷 part type 是否屬於思考類型
   */
  private isThinkingPartType(type: unknown): boolean {
    if (typeof type !== 'string') return false;
    const normalized = type.toLowerCase();
    return normalized === 'thinking'
      || normalized === 'reasoning'
      || normalized === 'reasoning_text'
      || normalized === 'analysis';
  }

  /**
   * 解析 question 事件（兼容多種 SDK payload）
   */
  private parseQuestionEvent(props: SDKEventProperties): QuestionEventData | null {
    const questionObject = props.question && typeof props.question === 'object'
      ? props.question
      : null;

    const questionId = questionObject?.id
      || (typeof props.question_id === 'string' ? props.question_id : '')
      || (typeof props.questionId === 'string' ? props.questionId : '')
      || (typeof props.request_id === 'string' ? props.request_id : '')
      || (typeof props.requestId === 'string' ? props.requestId : '')
      || (typeof props.id === 'string' ? props.id : '');

    const text = questionObject?.text
      || (typeof props.text === 'string' ? props.text : '')
      || (typeof props.prompt === 'string' ? props.prompt : '')
      || (typeof props.title === 'string' ? props.title : '');

    if (!questionId || !text) {
      return null;
    }

    const rawOptions = questionObject?.options ?? props.options;
    const options = this.normalizeQuestionOptions(rawOptions);

    const sessionId = questionObject?.session_id
      || questionObject?.sessionId
      || props.session_id
      || props.sessionId
      || this.currentSessionId
      || '';

    return {
      sessionId,
      questionId,
      text,
      options,
      multiple: questionObject?.multiple || props.multiple || false,
    };
  }

  /**
   * 正規化 question options
   */
  private normalizeQuestionOptions(
    rawOptions: unknown
  ): Array<{ label: string; value: string; description?: string }> {
    if (!Array.isArray(rawOptions)) {
      return [];
    }

    return rawOptions
      .map((option) => {
        if (typeof option === 'string') {
          const text = option.trim();
          if (!text) return null;
          return { label: text, value: text };
        }

        if (!option || typeof option !== 'object') {
          return null;
        }

        const candidate = option as Record<string, unknown>;
        const label = typeof candidate.label === 'string' && candidate.label.trim() !== ''
          ? candidate.label
          : typeof candidate.text === 'string' && candidate.text.trim() !== ''
            ? candidate.text
            : typeof candidate.value === 'string'
              ? candidate.value
              : '';
        if (!label) return null;

        const value = typeof candidate.value === 'string' && candidate.value.trim() !== ''
          ? candidate.value
          : label;

        const description = typeof candidate.description === 'string' && candidate.description.trim() !== ''
          ? candidate.description
          : undefined;

        return { label, value, description };
      })
      .filter((option): option is { label: string; value: string; description?: string } => option !== null);
  }

  /**
   * 檢查是否正在處理
   */
  public isActive(): boolean {
    return this.isProcessing && !this.isDisposed;
  }

  /**
   * 獲取當前 Session ID
   */
  public getSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * 獲取事件流引用（用於調試）
   */
  public getStream(): AsyncIterable<SDKEvent> | null {
    return this.eventStreamRef;
  }

  /**
   * 清理資源
   */
  public dispose(): void {
    this.stop();
    this.isDisposed = true;
    this.removeAllListeners();
    logger.debug('[SSEEventEmitterAdapter] 資源已清理');
  }
}

// ============== 導出 ==============

export default {
  SSEEventEmitterAdapter,
};
