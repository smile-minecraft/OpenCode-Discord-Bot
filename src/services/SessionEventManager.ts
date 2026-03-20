/**
 * Session Event Manager - Session 事件訂閱管理服務
 * @description 管理 SSE 事件訂閱的生命週期，確保正確的訂閱和清理
 */

import { SSEEventEmitterAdapter } from './SSEEventEmitterAdapter.js';
import { getOpenCodeSDKAdapter, OpenCodeSDKAdapter } from './OpenCodeSDKAdapter.js';
import logger from '../utils/logger.js';

// ============== 類型定義 ==============

/**
 * Session 事件訂閱
 */
export interface SessionEventSubscription {
  /** Session ID */
  sessionId: string;
  /** SSE 適配器實例 */
  adapter: SSEEventEmitterAdapter;
  /** 清理函數 */
  cleanup: () => void;
  /** 訂閱時間 */
  subscribedAt: Date;
}

/**
 * SessionEventManager 公開介面
 */
export interface ISessionEventManager {
  subscribe(sessionId: string): Promise<SSEEventEmitterAdapter>;
  unsubscribe(sessionId: string): void;
  getSubscription(sessionId: string): SessionEventSubscription | undefined;
  hasSubscription(sessionId: string): boolean;
  unsubscribeAll(): void;
}

// ============== SessionEventManager 類別 ==============

/**
 * Session 事件訂閱管理器
 * @description 統一管理 SSE 事件訂閱，確保每個 Session 正確訂閱和取消訂閱
 */
export class SessionEventManager implements ISessionEventManager {
  /** SDK 適配器 */
  private sdkAdapter: OpenCodeSDKAdapter;
  /** 活躍的訂閱映射 */
  private subscriptions: Map<string, SessionEventSubscription> = new Map();

  /**
   * 創建 SessionEventManager 實例
   */
  constructor() {
    this.sdkAdapter = getOpenCodeSDKAdapter();
    logger.info('[SessionEventManager] 初始化完成');
  }

  /**
   * 訂閱 Session 事件
   * @param sessionId Session ID
   * @returns SSEEventEmitterAdapter 實例
   */
  async subscribe(sessionId: string): Promise<SSEEventEmitterAdapter> {
    // 檢查是否已有訂閱
    const existingSubscription = this.subscriptions.get(sessionId);
    if (existingSubscription) {
      logger.debug(`[SessionEventManager] Session ${sessionId} 已有訂閱，跳過重複訂閱`);
      return existingSubscription.adapter;
    }

    // 確保 SDK 適配器已初始化
    if (!this.sdkAdapter.isInitialized()) {
      throw new Error('[SessionEventManager] SDK 適配器未初始化，無法訂閱事件');
    }

    try {
      // 調用 SDK 適配器訂閱事件
      const adapter = await this.sdkAdapter.subscribeToEvents(sessionId);

      // 創建清理函數
      const cleanup = () => {
        this.unsubscribe(sessionId);
      };

      // 保存訂閱
      const subscription: SessionEventSubscription = {
        sessionId,
        adapter,
        cleanup,
        subscribedAt: new Date(),
      };

      this.subscriptions.set(sessionId, subscription);
      logger.info(`[SessionEventManager] 已訂閱 Session ${sessionId} 事件`);

      return adapter;
    } catch (error) {
      logger.error(`[SessionEventManager] 訂閱 Session ${sessionId} 事件失敗:`, error);
      throw error;
    }
  }

  /**
   * 取消訂閱 Session 事件
   * @param sessionId Session ID
   */
  unsubscribe(sessionId: string): void {
    const subscription = this.subscriptions.get(sessionId);

    if (!subscription) {
      logger.debug(`[SessionEventManager] Session ${sessionId} 沒有活躍的訂閱`);
      return;
    }

    try {
      // 停止並清理 SSE 適配器
      subscription.adapter.stop();
      subscription.adapter.dispose();

      this.subscriptions.delete(sessionId);
      logger.info(`[SessionEventManager] 已取消訂閱 Session ${sessionId} 事件`);
    } catch (error) {
      logger.error(`[SessionEventManager] 取消訂閱 Session ${sessionId} 事件失敗:`, error);
      // 即使失敗，也從映射中移除
      this.subscriptions.delete(sessionId);
    }
  }

  /**
   * 獲取 Session 訂閱
   * @param sessionId Session ID
   * @returns 訂閱資訊（如有）
   */
  getSubscription(sessionId: string): SessionEventSubscription | undefined {
    return this.subscriptions.get(sessionId);
  }

  /**
   * 檢查是否有 Session 訂閱
   * @param sessionId Session ID
   * @returns 是否有訂閱
   */
  hasSubscription(sessionId: string): boolean {
    return this.subscriptions.has(sessionId);
  }

  /**
   * 取消所有訂閱
   */
  unsubscribeAll(): void {
    logger.info(`[SessionEventManager] 取消所有訂閱 (${this.subscriptions.size} 個)`);

    for (const [sessionId, subscription] of this.subscriptions) {
      try {
        subscription.adapter.stop();
        subscription.adapter.dispose();
      } catch (error) {
        logger.warn(`[SessionEventManager] 清理 Session ${sessionId} 訂閱失敗:`, error);
      }
    }

    this.subscriptions.clear();
    logger.info('[SessionEventManager] 所有訂閱已取消');
  }

  /**
   * 獲取活躍訂閱數量
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }
}

// ============== 單例實例 ==============

let sessionEventManagerInstance: SessionEventManager | null = null;

/**
 * 獲取 SessionEventManager 單例實例
 */
export function getSessionEventManager(): SessionEventManager {
  if (!sessionEventManagerInstance) {
    sessionEventManagerInstance = new SessionEventManager();
  }
  return sessionEventManagerInstance;
}

/**
 * 初始化 SessionEventManager
 */
export function initializeSessionEventManager(): SessionEventManager {
  sessionEventManagerInstance = new SessionEventManager();
  return sessionEventManagerInstance;
}

// ============== 導出 ==============

export default {
  SessionEventManager,
  getSessionEventManager,
  initializeSessionEventManager,
};
