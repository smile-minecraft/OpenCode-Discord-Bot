/**
 * Event Stream Factory - SDK 適配器工廠
 * @description 統一介面以確保 StreamingMessageManager 可以使用 SDK Adapter
 */

import logger from '../utils/logger.js';
import { SSEEventEmitterAdapter, SDKEvent, ISSEEventEmitterAdapter } from './SSEEventEmitterAdapter.js';

// ============== 類型定義 ==============

/**
 * 統一的事件處理器類型
 */
export type EventStreamEventHandler = (event: unknown) => void;

/**
 * Event Stream Adapter 統一介面
 * @description 定義適配器必須實現的共同方法
 */
export interface IEventStreamAdapter {
  /** 連接/啟動 */
  connect(port: number, sessionId: string): void;
  /** 斷開/停止 */
  disconnect(): void;
  /** 訂閱事件 */
  on(eventType: string, handler: EventStreamEventHandler): () => void;
  /** 檢查連接狀態 */
  isConnected(): boolean;
  /** 獲取連接狀態 */
  getConnectionState(): 'connecting' | 'open' | 'closed' | 'none';
  /** 清理資源 */
  dispose(): void;
}

/**
 * SDK 專用介面（擴展）
 */
export interface ISDKEventStreamAdapter extends IEventStreamAdapter {
  /** SDK 適配器專用：開始監聽事件流 */
  start(eventStream: AsyncIterable<SDKEvent>, sessionId: string): void;
}

// ============== 工廠實現 ==============

/**
 * 創建 Event Stream 適配器
 * @returns SDKAdapterWrapper 實例
 */
export function createEventStreamAdapter(): IEventStreamAdapter {
  logger.info('[EventStreamFactory] 使用 SDK 適配器 (SSEEventEmitterAdapter)');
  return new SDKAdapterWrapper();
}

/**
 * SDK 適配器包裝類
 * @description 將 SSEEventEmitterAdapter 的 start/stop 接口轉換為 connect/disconnect
 *              以提供統一接口模式
 */
export class SDKAdapterWrapper implements IEventStreamAdapter {
  private adapter: ISSEEventEmitterAdapter | null = null;
  private currentEventStream: AsyncIterable<SDKEvent> | null = null;
  private currentSessionId: string | null = null;
  private isActive = false;

  // 內部事件處理器
  private handlers: Map<string, Set<EventStreamEventHandler>> = new Map();

  /**
   * 連接到事件流（模擬 connect）
   * @param _port 端口（SDK 模式下不需要）
   * @param sessionId Session ID
   */
  connect(_port: number, sessionId: string): void {
    // Dispose existing adapter first to prevent memory leak
    if (this.adapter) {
      this.adapter.dispose();
      this.adapter = null;
    }

    // Clear existing handlers to prevent duplicate registration
    this.handlers.clear();

    this.currentSessionId = sessionId;
    this.isActive = true;

    // Create new adapter instance
    this.adapter = new SSEEventEmitterAdapter();

    // Register event forwarding - only once per adapter
    this.adapter.on('*', (event: unknown) => {
      const handlers = this.handlers.get('*');
      if (handlers) {
        handlers.forEach(handler => {
          try {
            handler(event);
          } catch (error) {
            logger.error('[SDKAdapterWrapper] 事件處理器錯誤:', error);
          }
        });
      }
    });

    logger.debug(`[SDKAdapterWrapper] 已準備連接, sessionId: ${sessionId}`);
  }

  /**
   * 開始監聽 SDK 事件流
   * @param eventStream SDK AsyncIterable
   * @param sessionId Session ID
   */
  start(eventStream: AsyncIterable<SDKEvent>, sessionId: string): void {
    if (!this.adapter) {
      this.adapter = new SSEEventEmitterAdapter();
      this.currentSessionId = sessionId;
    }

    // 設置事件轉發
    this.adapter.on('*', (event: unknown) => {
      // 轉發給所有訂閱者
      const eventType = (event as { type: string }).type;
      
      // 發送給特定類型訂閱者
      const typeHandlers = this.handlers.get(eventType);
      if (typeHandlers) {
        typeHandlers.forEach(handler => {
          try {
            handler(event);
          } catch (error) {
            logger.error('[SDKAdapterWrapper] 事件處理器錯誤:', error);
          }
        });
      }

      // 發送給通配符訂閱者
      const allHandlers = this.handlers.get('*');
      if (allHandlers) {
        allHandlers.forEach(handler => {
          try {
            handler(event);
          } catch (error) {
            logger.error('[SDKAdapterWrapper] 事件處理器錯誤:', error);
          }
        });
      }
    });

    this.adapter.start(eventStream, sessionId);
    this.isActive = true;
    this.currentEventStream = eventStream;

    logger.debug(`[SDKAdapterWrapper] 開始監聽事件流, sessionId: ${sessionId}`);
  }

  /**
   * 斷開連接
   */
  disconnect(): void {
    if (this.adapter) {
      this.adapter.stop();
      this.adapter.dispose();
      this.adapter = null;
    }

    this.isActive = false;
    this.currentEventStream = null;
    this.currentSessionId = null;

    // 清除所有處理器
    this.handlers.clear();

    logger.debug('[SDKAdapterWrapper] 已斷開連接');
  }

  /**
   * 訂閱事件
   */
  on(eventType: string, handler: EventStreamEventHandler): () => void {
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
   * 檢查是否已連接
   */
  isConnected(): boolean {
    return this.isActive && (this.adapter?.isActive() ?? false);
  }

  /**
   * 獲取連接狀態
   */
  getConnectionState(): 'connecting' | 'open' | 'closed' | 'none' {
    if (!this.adapter || !this.isActive) {
      return 'none';
    }
    return this.adapter.isActive() ? 'open' : 'closed';
  }

  /**
   * 清理資源
   */
  dispose(): void {
    this.disconnect();
    this.handlers.clear();
    logger.debug('[SDKAdapterWrapper] 資源已清理');
  }

  /**
   * 獲取當前 Session ID
   */
  getSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * 獲取事件流引用（用於調試）
   */
  getEventStream(): AsyncIterable<SDKEvent> | null {
    return this.currentEventStream;
  }
}

// ============== 單例實例 ==============

let eventStreamAdapterInstance: IEventStreamAdapter | null = null;

/**
 * 獲取 EventStreamAdapter 單例實例
 */
export function getEventStreamAdapter(): IEventStreamAdapter {
  if (!eventStreamAdapterInstance) {
    eventStreamAdapterInstance = createEventStreamAdapter();
  }
  return eventStreamAdapterInstance;
}

/**
 * 初始化 EventStreamAdapter
 */
export function initializeEventStreamAdapter(): IEventStreamAdapter {
  // 釋放舊資源
  if (eventStreamAdapterInstance) {
    eventStreamAdapterInstance.dispose();
  }
  
  eventStreamAdapterInstance = createEventStreamAdapter();
  return eventStreamAdapterInstance;
}

/**
 * 獲取當前適配器類型
 */
export function getAdapterType(): 'SDKAdapter' {
  return 'SDKAdapter';
}

// ============== 導出 ==============

export default {
  createEventStreamAdapter,
  getEventStreamAdapter,
  initializeEventStreamAdapter,
  getAdapterType,
};
