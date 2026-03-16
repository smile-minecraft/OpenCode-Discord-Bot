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
  | 'message.updated'
  | 'message.created'
  | 'tool_call'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'session.created'
  | 'session.deleted'
  | 'session.idle'
  | 'session.error'
  | 'session.compacted'
  | 'session.started'
  | 'session.ended'
  | 'error';

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
  | 'error'
  | 'connected'
  | 'disconnected';

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
}

/**
 * Session 完成事件數據（與 SSEClient 保持一致）
 */
export interface SessionCompleteEventData {
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
    | SessionCompleteEventData;
  timestamp: number;
}

/**
 * SSE 事件處理器
 */
export type SSEEventHandler = (event: SSEEventInternal) => void;

// ============== 常量 ==============

/** SDK 事件類型到內部事件類型的映射 */
const EVENT_TYPE_MAP: Record<SDKEventType, SSEEventTypeInternal | null> = {
  'message.updated': 'message',
  'message.created': 'message',
  'tool_call': 'tool_request',
  'tool_call_start': 'tool_request',
  'tool_call_end': 'tool_request',
  'session.created': 'connected',
  'session.started': 'connected',
  'session.deleted': 'disconnected',
  'session.ended': 'session_complete',
  'session.idle': 'session_complete',
  'session.error': 'error',
  'session.compacted': 'session_complete',
  'error': 'error',
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
      while (this.isProcessing) {
        // 使用 AbortSignal 支援取消
        const result = await Promise.race([
          this.iterator.next(),
          new Promise<IteratorResult<SDKEvent>>((resolve) => {
            // 立即解析，讓迴圈繼續檢查 isProcessing
            setTimeout(() => resolve({ done: true, value: undefined as unknown as SDKEvent }), 0);
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
      // 忽略中止錯誤
      if (error instanceof Error && error.message === 'Aborted') {
        logger.debug('[SSEEventEmitterAdapter] 事件流已中止');
        return;
      }

      logger.error('[SSEEventEmitterAdapter] 處理事件流時發生錯誤:', error);

      this.emitEvent('error', {
        sessionId: this.currentSessionId ?? undefined,
        error: error instanceof Error ? error.message : '未知錯誤',
      } as ErrorEventData);
    } finally {
      // 確保發送 session_complete 事件
      if (this.currentSessionId && this.isProcessing) {
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

    if (!internalType) {
      logger.warn(`[SSEEventEmitterAdapter] 未知的 SDK 事件類型: ${event.type}`);
      return;
    }

    const props = event.properties;

    switch (internalType) {
      case 'message':
        this.emitEvent('message', {
          sessionId: props.session_id || props.sessionId || this.currentSessionId || '',
          content: props.content || '',
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

      case 'error':
        this.emitEvent('error', {
          sessionId: props.session_id || props.sessionId,
          error: props.error || '未知錯誤',
        } as ErrorEventData);
        break;

      case 'connected':
        // 連接事件已在 start 時發送
        break;

      case 'disconnected':
        // 斷開事件已在 stop 時發送
        break;
    }

    logger.debug(`[SSEEventEmitterAdapter] 處理事件: ${event.type} -> ${internalType}`);
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
  ): void {
    const event: SSEEventInternal = {
      type,
      data,
      timestamp: Date.now(),
    };

    this.emit(type, event);
    this.emit('*', event); // 通配符事件

    logger.debug(`[SSEEventEmitterAdapter] 發送事件: ${type}`);
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
