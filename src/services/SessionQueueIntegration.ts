/**
 * Session Queue Integration - Session 與 Queue 整合服務
 * @description 處理 Session 完成後自動執行下一個任務的邏輯
 */

import { getQueueManager, type QueueTask, type QueueSettings } from './QueueManager.js';
import { log } from '../utils/logger.js';

// ==================== Types ====================

/**
 * Session 完成事件
 */
export interface SessionCompletedEvent {
  /** Session ID */
  sessionId: string;
  /** 頻道 ID */
  channelId: string;
  /** 狀態 */
  status: 'completed' | 'failed' | 'aborted';
  /** 提示詞 */
  prompt?: string;
  /** 模型 */
  model?: string;
  /** Agent */
  agent?: string;
  /** 專案路徑 */
  projectPath?: string;
  /** 錯誤訊息（如有） */
  error?: string;
}

/**
 * 新 Session 請求
 */
export interface NewSessionRequest {
  /** 提示詞 */
  prompt: string;
  /** 頻道 ID */
  channelId: string;
  /** Thread ID */
  threadId?: string;
  /** 專案路徑 */
  projectPath?: string;
  /** 模型 */
  model?: string;
  /** Agent */
  agent?: string;
  /** 優先級 */
  priority?: number;
}

/**
 * Session 執行器回調
 */
type SessionExecutor = (task: QueueTask) => Promise<void>;

/**
 * Session 完成回調
 */
type SessionCompletionCallback = (event: SessionCompletedEvent) => void;

// ==================== Session Queue Integration ====================

/**
 * Session Queue 整合服務
 * @description 管理 Session 與 Queue 的整合，處理自動執行邏輯
 */
class SessionQueueIntegration {
  // ==================== State ====================

  /** Queue 管理器 */
  private queueManager = getQueueManager();

  /** Session 執行器 */
  private sessionExecutor: SessionExecutor | null = null;

  /** Session 完成回調列表 */
  private completionCallbacks: SessionCompletionCallback[] = [];

  /** 是否已初始化 */
  private initialized: boolean = false;

  // ==================== Constructor ====================

  constructor() {
    this.setupQueueListeners();
  }

  // ==================== Public Methods ====================

  /**
   * 初始化整合服務
   * @param executor Session 執行器回調
   */
  initialize(executor: SessionExecutor): void {
    if (this.initialized) {
      log.warn('[SessionQueueIntegration] Already initialized');
      return;
    }

    this.sessionExecutor = executor;
    this.initialized = true;

    log.info('[SessionQueueIntegration] Initialized');

    // 檢查並開始處理隊列
    this.processQueue();
  }

  /**
   * 新增 Session 到隊列
   * @param request Session 請求
   * @returns 任務 ID
   */
  addSessionToQueue(request: NewSessionRequest): string {
    const task = this.queueManager.addTask({
      type: 'session',
      data: {
        prompt: request.prompt,
        channelId: request.channelId,
        threadId: request.threadId,
        projectPath: request.projectPath,
        model: request.model || 'anthropic/claude-sonnet-4',
        agent: request.agent || 'general',
      },
      priority: request.priority || 10,
    });

    log.info('[SessionQueueIntegration] Session added to queue', {
      taskId: task.id,
      channelId: request.channelId,
      prompt: request.prompt.substring(0, 50),
    });

    return task.id;
  }

  /**
   * 移除 Session 從隊列
   * @param taskId 任務 ID
   * @returns 是否成功移除
   */
  removeSessionFromQueue(taskId: string): boolean {
    return this.queueManager.removeTask(taskId);
  }

  /**
   * 清空隊列
   * @returns 移除的任務數
   */
  clearQueue(): number {
    return this.queueManager.clearQueue();
  }

  /**
   * 暫停隊列
   */
  pause(): void {
    this.queueManager.pause();
  }

  /**
   * 恢復隊列
   */
  resume(): void {
    this.queueManager.resume();
  }

  /**
   * 更新設定
   * @param settings 新設定
   */
  updateSettings(settings: Partial<QueueSettings>): void {
    this.queueManager.updateSettings(settings);
  }

  /**
   * 取得設定
   * @returns 當前設定
   */
  getSettings(): QueueSettings {
    return this.queueManager.getSettings();
  }

  /**
   * 取得隊列狀態
   */
  getQueueState() {
    return this.queueManager.getState();
  }

  /**
   * 取得待處理任務
   * @param limit 數量限制
   */
  getPendingTasks(limit?: number) {
    return this.queueManager.getPendingTasks(limit);
  }

  /**
   * 取得下一個任務（預覽）
   */
  peek(): QueueTask | null {
    return this.queueManager.peek();
  }

  /**
   * 取得隊列長度
   */
  get queueLength(): number {
    return this.queueManager.length;
  }

  /**
   * 取得隊列是否為空
   */
  get isEmpty(): boolean {
    return this.queueManager.isEmpty;
  }

  /**
   * 取得隊列是否已暫停
   */
  get isPaused(): boolean {
    return this.queueManager.isPaused;
  }

  /**
   * 註冊 Session 完成回調
   * @param callback 回調函數
   */
  onSessionComplete(callback: SessionCompletionCallback): void {
    this.completionCallbacks.push(callback);
  }

  /**
   * 觸發 Session 完成事件
   * @param event 事件資料
   */
  triggerSessionComplete(event: SessionCompletedEvent): void {
    log.info('[SessionQueueIntegration] Session completed', {
      sessionId: event.sessionId,
      status: event.status,
    });

    for (const callback of this.completionCallbacks) {
      try {
        callback(event);
      } catch (error) {
        log.error('[SessionQueueIntegration] Error in completion callback', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // ==================== Private Methods ====================

  /**
   * 設定 Queue 監聽器
   */
  private setupQueueListeners(): void {
    const queue = this.queueManager;

    // 任務開始
    queue.on('taskStarted', (task: QueueTask) => {
      log.info('[SessionQueueIntegration] Task started', {
        taskId: task.id,
        type: task.type,
      });
    });

    // 任務完成
    queue.on('taskCompleted', (task: QueueTask) => {
      log.info('[SessionQueueIntegration] Task completed', {
        taskId: task.id,
      });

      // 觸發 Session 完成事件
      if (task.type === 'session') {
        this.triggerSessionComplete({
          sessionId: task.id,
          channelId: task.data.channelId,
          status: 'completed',
          prompt: task.data.prompt,
          model: task.data.model,
          agent: task.data.agent,
          projectPath: task.data.projectPath,
        });
      }
    });

    // 任務失敗
    queue.on('taskFailed', (task: QueueTask, error: Error) => {
      log.error('[SessionQueueIntegration] Task failed', {
        taskId: task.id,
        error: error.message,
      });

      // 觸發 Session 完成事件（失敗狀態）
      if (task.type === 'session') {
        this.triggerSessionComplete({
          sessionId: task.id,
          channelId: task.data.channelId,
          status: 'failed',
          prompt: task.data.prompt,
          model: task.data.model,
          agent: task.data.agent,
          projectPath: task.data.projectPath,
          error: error.message,
        });
      }
    });

    // 隊列暫停
    queue.on('queuePaused', () => {
      log.info('[SessionQueueIntegration] Queue paused');
    });

    // 隊列恢復
    queue.on('queueResumed', () => {
      log.info('[SessionQueueIntegration] Queue resumed');
      this.processQueue();
    });

    // 隊列為空
    queue.on('empty', () => {
      log.info('[SessionQueueIntegration] Queue is empty');
    });
  }

  /**
   * 處理隊列
   */
  private async processQueue(): Promise<void> {
    if (!this.sessionExecutor) {
      log.warn('[SessionQueueIntegration] No session executor configured');
      return;
    }

    // 這裡會在 QueueManager 處理任務時自動被調用
    // 實際的任務執行邏輯由外部提供
  }

  /**
   * 覆寫 QueueManager 的任務執行邏輯
   */
  protected async executeTaskLogic(task: QueueTask): Promise<void> {
    if (!this.sessionExecutor) {
      throw new Error('Session executor not configured');
    }

    await this.sessionExecutor(task);
  }
}

// ==================== Singleton ====================

let instance: SessionQueueIntegration | null = null;

/**
 * 取得 Session Queue 整合服務
 */
export function getSessionQueueIntegration(): SessionQueueIntegration {
  if (!instance) {
    instance = new SessionQueueIntegration();
  }
  return instance;
}

export default SessionQueueIntegration;
