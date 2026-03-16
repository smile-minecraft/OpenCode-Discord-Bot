/**
 * SSE Client Service
 * @description Server-Sent Events 客戶端，支援即時串流更新
 */

import { EventSource } from 'eventsource';
import logger from '../utils/logger.js';
import { TIMEOUTS } from '../config/constants.js';

// ============== 類型定義 ==============

/**
 * SSE 事件類型
 */
export type SSEEventType =
  | 'message'
  | 'tool_request'
  | 'session_complete'
  | 'error'
  | 'connected'
  | 'disconnected';

/**
 * SSE 事件
 */
export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
  timestamp: number;
}

/**
 * 訊息事件數據
 */
export interface MessageEventData {
  sessionId: string;
  content: string;
  isComplete: boolean;
}

/**
 * 工具請求事件數據
 */
export interface ToolRequestEventData {
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  requestId: string;
}

/**
 * 連線事件數據
 */
export interface ConnectedEventData {
  sessionId: string;
}

/**
 * 錯誤事件數據
 */
export interface ErrorEventData {
  sessionId?: string;
  error: string;
}

/**
 * Session 完成事件數據
 */
export interface SessionCompleteEventData {
  sessionId: string;
}

/**
 * SSE 事件處理器
 */
export type SSEEventHandler = (event: SSEEvent) => void;

// ============== 常量 ==============

/** 預設主機地址 */
const DEFAULT_HOST = '127.0.0.1';

/** 最大重連次數 */
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;

/** 初始重連延遲（毫秒） */
const DEFAULT_RECONNECT_DELAY = 1000;

/** 最大重連延遲（毫秒） */
const MAX_RECONNECT_DELAY = TIMEOUTS.RECONNECT;

// ============== SSEClient 類別 ==============

/**
 * SSE 客戶端
 * @description 連接到 OpenCode SSE 端點並處理即時事件
 */
export class SSEClient {
  /** EventSource 實例 */
  private eventSource: EventSource | null = null;

  /** 事件處理器映射 */
  private handlers: Map<string, Set<SSEEventHandler>> = new Map();

  /** 重連嘗試次數 */
  private reconnectAttempts = 0;

  /** 最大重連次數 */
  private maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS;

  /** 重連延遲（毫秒） */
  private reconnectDelay = DEFAULT_RECONNECT_DELAY;

  /** 是否為手動關閉 */
  private isManualClose = false;

  /** 當前連接的端口 */
  private currentPort: number | null = null;

  /** 當前連接的 Session ID */
  private currentSessionId: string | null = null;

  /**
   * 連接到 SSE 端點
   * @param port 連接埠號
   * @param sessionId Session ID
   */
  connect(port: number, sessionId: string): void {
    // 如果已有連接，先斷開
    if (this.eventSource) {
      this.disconnect();
    }

    const url = `http://${DEFAULT_HOST}:${port}/events?sessionId=${sessionId}`;
    logger.info(`[SSEClient] 連接到 ${url}`);

    // 保存連接資訊以便重連
    this.currentPort = port;
    this.currentSessionId = sessionId;
    this.isManualClose = false;
    this.reconnectAttempts = 0;

    try {
      this.eventSource = new EventSource(url);

      // 連線開啟
      this.eventSource.onopen = () => {
        logger.info('[SSEClient] SSE 連線已建立');
        this.reconnectAttempts = 0;
        this.emit({
          type: 'connected',
          data: { sessionId } as ConnectedEventData,
          timestamp: Date.now(),
        });
      };

      // 處理訊息事件
      this.eventSource.onmessage = (event) => {
        this.handleMessage(event);
      };

      // 處理錯誤
      this.eventSource.onerror = (error) => {
        this.handleError(error);
      };
    } catch (error) {
      logger.error('[SSEClient] 建立 EventSource 失敗:', error);
      this.emit({
        type: 'error',
        data: { error: `建立連線失敗: ${error instanceof Error ? error.message : '未知錯誤'}` } as ErrorEventData,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 斷開連線
   */
  disconnect(): void {
    this.isManualClose = true;
    this.currentPort = null;
    this.currentSessionId = null;

    if (this.eventSource) {
      // 清除所有事件監聽器（防止記憶體洩漏）
      this.eventSource.onopen = null;
      this.eventSource.onmessage = null;
      this.eventSource.onerror = null;
      
      this.eventSource.close();
      this.eventSource = null;
      
      this.emit({
        type: 'disconnected',
        data: {},
        timestamp: Date.now(),
      });
      logger.info('[SSEClient] SSE 連線已關閉');
    }
  }

  /**
   * 處理接收到的訊息
   * @param event MessageEvent
   */
  private handleMessage(event: { data: string }): void {
    try {
      const data = JSON.parse(event.data);
      logger.debug(`[SSEClient] 收到事件: ${data.type}`);

      switch (data.type) {
        case 'message':
          this.emit({
            type: 'message',
            data: {
              sessionId: data.sessionId,
              content: data.content,
              isComplete: data.isComplete || false,
            } as MessageEventData,
            timestamp: Date.now(),
          });
          break;

        case 'tool_request':
          this.emit({
            type: 'tool_request',
            data: {
              sessionId: data.sessionId,
              toolName: data.tool,
              args: data.args || {},
              requestId: data.requestId,
            } as ToolRequestEventData,
            timestamp: Date.now(),
          });
          break;

        case 'complete':
        case 'session_complete':
          this.emit({
            type: 'session_complete',
            data: { sessionId: data.sessionId } as SessionCompleteEventData,
            timestamp: Date.now(),
          });
          break;

        case 'error':
          this.emit({
            type: 'error',
            data: {
              sessionId: data.sessionId,
              error: data.error || '未知錯誤',
            } as ErrorEventData,
            timestamp: Date.now(),
          });
          break;

        default:
          logger.warn(`[SSEClient] 未知的 SSE 事件類型: ${data.type}`);
      }
    } catch (error) {
      logger.error('[SSEClient] 解析事件失敗:', error);
    }
  }

  /**
   * 處理錯誤事件
   * @param error Event
   */
  private handleError(error: unknown): void {
    logger.error('[SSEClient] SSE 錯誤:', error);

    if (this.isManualClose) {
      return;
    }

    // 嘗試重連
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      // 指數退避，最長 30 秒
      const delay = Math.min(
        this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
        MAX_RECONNECT_DELAY
      );

      logger.info(
        `[SSEClient] ${delay}ms 後重連 (嘗試 ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      );

      setTimeout(() => {
        if (this.currentPort && this.currentSessionId && !this.isManualClose) {
          this.connect(this.currentPort, this.currentSessionId);
        }
      }, delay);
    } else {
      logger.error('[SSEClient] 重連次數超過上限');
      this.emit({
        type: 'error',
        data: { error: 'SSE 重連次數超過上限' } as ErrorEventData,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 訂閱特定類型的事件
   * @param eventType 事件類型
   * @param handler 事件處理器
   * @returns 取消訂閱函數
   */
  on(eventType: string, handler: SSEEventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    // 返回取消訂閱函數
    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  /**
   * 訂閱所有事件（通配符）
   * @param handler 事件處理器
   * @returns 取消訂閱函數
   */
  onAny(handler: SSEEventHandler): () => void {
    return this.on('*', handler);
  }

  /**
   * 移除所有事件處理器
   */
  removeAllHandlers(): void {
    this.handlers.clear();
  }

  /**
   * 發送事件給所有訂閱者
   * @param event SSE 事件
   */
  private emit(event: SSEEvent): void {
    // 發送給特定類型訂閱者
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(event);
        } catch (error) {
          logger.error('[SSEClient] 事件處理器錯誤:', error);
        }
      });
    }

    // 發送給通配符 '*' 訂閱者
    const allHandlers = this.handlers.get('*');
    if (allHandlers) {
      allHandlers.forEach((handler) => {
        try {
          handler(event);
        } catch (error) {
          logger.error('[SSEClient] 事件處理器錯誤:', error);
        }
      });
    }
  }

  /**
   * 檢查是否已連接
   */
  isConnected(): boolean {
    return this.eventSource !== null && 
           this.eventSource.readyState === EventSource.OPEN;
  }

  /**
   * 獲取連線狀態
   */
  getConnectionState(): 'connecting' | 'open' | 'closed' | 'none' {
    if (!this.eventSource) return 'none';
    switch (this.eventSource.readyState) {
      case EventSource.CONNECTING: return 'connecting';
      case EventSource.OPEN: return 'open';
      case EventSource.CLOSED: return 'closed';
      default: return 'none';
    }
  }

  /**
   * 獲取重連嘗試次數
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * 設置最大重連次數
   * @param maxAttempts 最大重連次數
   */
  setMaxReconnectAttempts(maxAttempts: number): void {
    this.maxReconnectAttempts = maxAttempts;
  }

  /**
   * 設置重連延遲
   * @param delay 初始延遲（毫秒）
   */
  setReconnectDelay(delay: number): void {
    this.reconnectDelay = delay;
  }
}

// ============== 單例實例 ==============

let sseClientInstance: SSEClient | null = null;

/**
 * 獲取 SSEClient 單例實例
 */
export function getSSEClient(): SSEClient {
  if (!sseClientInstance) {
    sseClientInstance = new SSEClient();
  }
  return sseClientInstance;
}

/**
 * 初始化 SSEClient
 */
export function initializeSSEClient(): SSEClient {
  sseClientInstance = new SSEClient();
  return sseClientInstance;
}

// ============== 導出 ==============

export default {
  SSEClient,
  getSSEClient,
  initializeSSEClient,
};
