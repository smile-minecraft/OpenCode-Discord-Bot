/**
 * QueueManager - 任務隊列管理服務
 * @description 管理任務隊列的排程、執行和狀態追蹤
 */

import { EventEmitter } from 'events';
import { log } from '../utils/logger.js';

// ==================== Types ====================

/**
 * 隊列任務
 */
export interface QueueTask {
  /** 任務 ID */
  id: string;
  /** 任務類型 */
  type: 'session' | 'command';
  /** 任務資料 */
  data: {
    prompt?: string;
    channelId: string;
    threadId?: string;
    projectPath?: string;
    model?: string;
    agent?: string;
    [key: string]: unknown;
  };
  /** 優先級（數字越小越優先） */
  priority: number;
  /** 建立的時間戳 */
  createdAt: number;
  /** 狀態 */
  status: TaskStatus;
  /** 嘗試次數 */
  attempts: number;
  /** 錯誤訊息（如有） */
  error?: string;
}

/**
 * 任務狀態
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * 隊列設定
 */
export interface QueueSettings {
  /** 失敗後是否繼續執行 */
  continueOnFailure: boolean;
  /** 是否使用新的上下文 */
  freshContext: boolean;
  /** 最大並發任務數 */
  maxConcurrent: number;
  /** 任務超時時間（毫秒） */
  taskTimeout: number;
  /** 最大重試次數 */
  maxRetries: number;
}

/**
 * 隊列狀態
 */
export interface QueueState {
  /** 是否暫停 */
  isPaused: boolean;
  /** 是否正在處理 */
  isProcessing: boolean;
  /** 當前任務 */
  currentTask: QueueTask | null;
  /** 待處理任務數 */
  pendingCount: number;
  /** 已完成任務數 */
  completedCount: number;
  /** 失敗任務數 */
  failedCount: number;
}

/**
 * 隊列事件
 */
export interface QueueEvents {
  taskAdded: (task: QueueTask) => void;
  taskStarted: (task: QueueTask) => void;
  taskCompleted: (task: QueueTask) => void;
  taskFailed: (task: QueueTask, error: Error) => void;
  taskRemoved: (task: QueueTask) => void;
  queueCleared: () => void;
  queuePaused: () => void;
  queueResumed: () => void;
  settingsChanged: (settings: QueueSettings) => void;
  empty: () => void;
}

// ==================== Default Settings ====================

const DEFAULT_SETTINGS: QueueSettings = {
  continueOnFailure: false,
  freshContext: false,
  maxConcurrent: 1,
  taskTimeout: 300000, // 5 分鐘
  maxRetries: 3,
};

// ==================== Queue Manager ====================

/**
 * 任務隊列管理器
 * @description 負責管理任務的排隊、執行順序和狀態追蹤
 */
export class QueueManager extends EventEmitter {
  // ==================== State ====================

  /** 任務隊列 */
  private queue: QueueTask[] = [];

  /** 當前正在運行的任務 */
  private currentTask: QueueTask | null = null;

  /** 隊列設定 */
  private settings: QueueSettings;

  /** 是否暫停 */
  private paused: boolean = false;

  /** 是否正在處理 */
  private processing: boolean = false;

  /** 任務計數器 */
  private taskCounter: number = 0;

  /** 統計數據 */
  private stats = {
    completed: 0,
    failed: 0,
    totalProcessed: 0,
  };

  // ==================== Constructor ====================

  /**
   * 建立 QueueManager 實例
   * @param settings 初始設定
   */
  constructor(settings: Partial<QueueSettings> = {}) {
    super();
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    log.info('[QueueManager] Initialized with settings', this.settings);
  }

  // ==================== Public Methods ====================

  /**
   * 新增任務到隊列
   * @param taskData 任務資料
   * @returns 建立的任務
   */
  addTask(taskData: Omit<QueueTask, 'id' | 'createdAt' | 'status' | 'attempts'>): QueueTask {
    const task: QueueTask = {
      ...taskData,
      id: this.generateTaskId(),
      createdAt: Date.now(),
      status: 'pending',
      attempts: 0,
    };

    // 按優先級插入隊列
    this.insertTaskByPriority(task);

    log.info('[QueueManager] Task added to queue', {
      taskId: task.id,
      type: task.type,
      priority: task.priority,
      queueLength: this.queue.length,
    });

    this.emit('taskAdded', task);

    // 如果未暫停且未在處理，開始處理
    if (!this.paused && !this.processing) {
      this.processNext();
    }

    return task;
  }

  /**
   * 移除任務
   * @param taskId 任務 ID
   * @returns 是否成功移除
   */
  removeTask(taskId: string): boolean {
    const index = this.queue.findIndex((t) => t.id === taskId);
    if (index === -1) {
      return false;
    }

    const task = this.queue[index];
    
    // 不能移除正在運行的任務
    if (task.status === 'running') {
      log.warn('[QueueManager] Cannot remove running task', { taskId });
      return false;
    }

    this.queue.splice(index, 1);
    
    log.info('[QueueManager] Task removed from queue', {
      taskId,
      remaining: this.queue.length,
    });

    this.emit('taskRemoved', task);
    return true;
  }

  /**
   * 清空隊列
   */
  clearQueue(): number {
    const pendingTasks = this.queue.filter((t) => t.status === 'pending');
    const count = pendingTasks.length;

    // 取消所有待處理任務
    this.queue = this.queue.filter((t) => t.status === 'running');
    
    log.info('[QueueManager] Queue cleared', { removedCount: count });
    
    this.emit('queueCleared');
    
    if (this.queue.length === 0) {
      this.emit('empty');
    }

    return count;
  }

  /**
   * 暫停隊列
   */
  pause(): void {
    if (this.paused) {
      log.warn('[QueueManager] Queue already paused');
      return;
    }

    this.paused = true;
    
    log.info('[QueueManager] Queue paused');
    this.emit('queuePaused');
  }

  /**
   * 恢復隊列
   */
  resume(): void {
    if (!this.paused) {
      log.warn('[QueueManager] Queue not paused');
      return;
    }

    this.paused = false;
    
    log.info('[QueueManager] Queue resumed');
    this.emit('queueResumed');

    // 恢復處理
    if (!this.processing) {
      this.processNext();
    }
  }

  /**
   * 更新設定
   * @param newSettings 新設定
   */
  updateSettings(newSettings: Partial<QueueSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    
    log.info('[QueueManager] Settings updated', this.settings);
    this.emit('settingsChanged', this.settings);
  }

  /**
   * 取得設定
   * @returns 當前設定
   */
  getSettings(): QueueSettings {
    return { ...this.settings };
  }

  /**
   * 取得隊列狀態
   * @returns 隊列狀態
   */
  getState(): QueueState {
    return {
      isPaused: this.paused,
      isProcessing: this.processing,
      currentTask: this.currentTask,
      pendingCount: this.queue.filter((t) => t.status === 'pending').length,
      completedCount: this.stats.completed,
      failedCount: this.stats.failed,
    };
  }

  /**
   * 取得待處理任務列表
   * @param limit 最多返回數量
   * @returns 任務列表
   */
  getPendingTasks(limit: number = 10): QueueTask[] {
    return this.queue
      .filter((t) => t.status === 'pending')
      .slice(0, limit);
  }

  /**
   * 取得所有任務
   * @returns 所有任務
   */
  getAllTasks(): QueueTask[] {
    return [...this.queue];
  }

  /**
   * 取得下一個任務（不執行）
   * @returns 下一個待處理的任務
   */
  peek(): QueueTask | null {
    return this.queue.find((t) => t.status === 'pending') || null;
  }

  /**
   * 取得隊列長度
   * @returns 待處理任務數量
   */
  get length(): number {
    return this.queue.filter((t) => t.status === 'pending').length;
  }

  /**
   * 檢查隊列是否為空
   * @returns 是否為空
   */
  get isEmpty(): boolean {
    return this.queue.filter((t) => t.status === 'pending').length === 0;
  }

  /**
   * 檢查是否已暫停
   * @returns 是否已暫停
   */
  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * 取得統計數據
   * @returns 統計數據
   */
  getStats(): { completed: number; failed: number; total: number } {
    return {
      completed: this.stats.completed,
      failed: this.stats.failed,
      total: this.stats.totalProcessed,
    };
  }

  // ==================== Private Methods ====================

  /**
   * 按優先級插入任務
   */
  private insertTaskByPriority(task: QueueTask): void {
    // 尋找第一個優先級低於新任務的位置
    let insertIndex = this.queue.findIndex((t) => t.priority > task.priority);
    
    // 如果沒找到，插入末尾
    if (insertIndex === -1) {
      insertIndex = this.queue.length;
    }
    
    this.queue.splice(insertIndex, 0, task);
  }

  /**
   * 處理下一個任務
   */
  private async processNext(): Promise<void> {
    // 如果已暫停或正在處理，不進行處理
    if (this.paused || this.processing) {
      return;
    }

    // 尋找下一個待處理的任務
    const nextTask = this.queue.find((t) => t.status === 'pending');
    
    if (!nextTask) {
      this.processing = false;
      log.info('[QueueManager] Queue is empty');
      this.emit('empty');
      return;
    }

    this.processing = true;
    this.currentTask = nextTask;
    nextTask.status = 'running';
    
    log.info('[QueueManager] Processing task', {
      taskId: nextTask.id,
      type: nextTask.type,
      remaining: this.queue.filter((t) => t.status === 'pending').length,
    });

    this.emit('taskStarted', nextTask);

    try {
      // 執行任務
      await this.executeTask(nextTask);
      
      // 任務完成
      nextTask.status = 'completed';
      this.stats.completed++;
      this.stats.totalProcessed++;
      
      log.info('[QueueManager] Task completed', {
        taskId: nextTask.id,
        totalCompleted: this.stats.completed,
      });

      this.emit('taskCompleted', nextTask);
      
      // 從隊列中移除
      this.queue = this.queue.filter((t) => t.id !== nextTask.id);
      
      // 處理下一個任務
      this.currentTask = null;
      this.processNext();
    } catch (error) {
      await this.handleTaskError(nextTask, error as Error);
    }
  }

  /**
   * 執行任務
   * @param task 要執行的任務
   */
  private async executeTask(task: QueueTask): Promise<void> {
    // 建立執行 Promise，可設定超時
    const executePromise = this.executeTaskLogic(task);
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Task timeout after ${this.settings.taskTimeout}ms`));
      }, this.settings.taskTimeout);
    });

    await Promise.race([executePromise, timeoutPromise]);
  }

  /**
   * 任務邏輯（由子類或外部覆寫）
   * @param task 任務
   */
  protected async executeTaskLogic(task: QueueTask): Promise<void> {
    // 預設實現：直接觸發 taskCompleted 事件
    // 實際的任務執行由外部通過監聽事件處理
    log.debug('[QueueManager] Executing task logic (default)', { taskId: task.id });
    
    // 這裡可以調用外部的任務執行器
    // 例如：this.taskExecutor?.(task);
  }

  /**
   * 處理任務錯誤
   */
  private async handleTaskError(task: QueueTask, error: Error): Promise<void> {
    task.attempts++;
    task.error = error.message;
    
    log.error('[QueueManager] Task failed', {
      taskId: task.id,
      error: error.message,
      attempts: task.attempts,
      maxRetries: this.settings.maxRetries,
    });

    this.emit('taskFailed', task, error);

    // 檢查是否應該重試
    if (task.attempts < this.settings.maxRetries) {
      // 重置任務狀態
      task.status = 'pending';
      
      log.info('[QueueManager] Retrying task', {
        taskId: task.id,
        attempt: task.attempts + 1,
      });
      
      // 繼續處理下一個任務（會重試當前任務）
      this.processNext();
    } else {
      // 超過最大重試次數，標記為失敗
      task.status = 'failed';
      this.stats.failed++;
      this.stats.totalProcessed++;
      
      log.error('[QueueManager] Task permanently failed', {
        taskId: task.id,
        totalFailed: this.stats.failed,
      });

      // 根據設定決定是否繼續
      if (this.settings.continueOnFailure) {
        this.currentTask = null;
        this.processNext();
      } else {
        // 停止處理
        this.processing = false;
        this.currentTask = null;
        this.pause(); // 自動暫停
        
        log.warn('[QueueManager] Queue paused due to task failure (continue_on_failure is disabled)');
      }
    }
  }

  /**
   * 生成任務 ID
   */
  private generateTaskId(): string {
    this.taskCounter++;
    return `task_${Date.now()}_${this.taskCounter}`;
  }
}

// ==================== Singleton ====================

let queueManagerInstance: QueueManager | null = null;

/**
 * 取得 QueueManager 單例
 * @param settings 初始設定
 * @returns QueueManager 實例
 */
export function getQueueManager(settings?: Partial<QueueSettings>): QueueManager {
  if (!queueManagerInstance) {
    queueManagerInstance = new QueueManager(settings);
  } else if (settings) {
    // 如果已存在，合併新設定
    queueManagerInstance.updateSettings(settings);
  }
  return queueManagerInstance;
}

/**
 * 重置 QueueManager 單例（用於測試）
 */
export function resetQueueManager(): void {
  queueManagerInstance = null;
}

export default QueueManager;
