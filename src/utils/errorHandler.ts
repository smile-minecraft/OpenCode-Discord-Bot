import { EmbedBuilder, User } from 'discord.js';
import * as Sentry from '@sentry/node';
import logger from './logger.js';
import { shouldCaptureError } from './sentryHelper.js';

// ==================== 自訂錯誤類別 ====================

/**
 * 基礎錯誤類別
 */
export class BotError extends Error {
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly timestamp: Date;

  constructor(message: string, code: string = 'BOT_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.isOperational = true;
    this.timestamp = new Date();
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * 上報錯誤到 Sentry（僅非業務錯誤）
   */
  captureToSentry(): void {
    // 檢查是否應該上報
    if (!shouldCaptureError(this)) {
      return;
    }

    Sentry.captureException(this);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack
    };
  }
}

/**
 * 權限錯誤 - 用於權限不足的情況
 */
export class PermissionError extends BotError {
  public readonly requiredPermission: string;
  public readonly userId: string;

  constructor(message: string, requiredPermission: string, userId: string) {
    super(message, 'PERMISSION_DENIED');
    this.name = 'PermissionError';
    this.requiredPermission = requiredPermission;
    this.userId = userId;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      requiredPermission: this.requiredPermission,
      userId: this.userId
    };
  }
}

/**
 * 驗證錯誤 - 用於輸入驗證失敗
 */
export class ValidationError extends BotError {
  public readonly field: string;
  public readonly receivedValue: unknown;

  constructor(message: string, field: string, receivedValue?: unknown) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.field = field;
    this.receivedValue = receivedValue;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      field: this.field,
      receivedValue: this.receivedValue
    };
  }
}

/**
 * 會話錯誤 - 用於會話/狀態管理錯誤
 */
export class SessionError extends BotError {
  public readonly sessionId: string;
  public readonly sessionState: string;

  constructor(message: string, sessionId: string, sessionState?: string) {
    super(message, 'SESSION_ERROR');
    this.name = 'SessionError';
    this.sessionId = sessionId;
    this.sessionState = sessionState || 'unknown';
  }

  toJSON() {
    return {
      ...super.toJSON(),
      sessionId: this.sessionId,
      sessionState: this.sessionState
    };
  }
}

/**
 * Thread 映射錯誤 - 用於 Thread 映射操作錯誤
 */
export class ThreadMappingError extends BotError {
  public readonly threadId?: string;
  public readonly sessionId?: string;

  constructor(message: string, threadId?: string, sessionId?: string) {
    super(message, 'THREAD_MAPPING_ERROR');
    this.name = 'ThreadMappingError';
    this.threadId = threadId;
    this.sessionId = sessionId;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      threadId: this.threadId,
      sessionId: this.sessionId
    };
  }
}

// ==================== 錯誤回應格式化 ====================

/**
 * 錯誤嚴重程度
 */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * 獲取錯誤嚴重程度
 */
function getErrorSeverity(error: Error): ErrorSeverity {
  if (error instanceof PermissionError) return 'medium';
  if (error instanceof ValidationError) return 'low';
  if (error instanceof SessionError) return 'medium';
  if (error instanceof ThreadMappingError) return 'medium';
  if (error instanceof BotError) return 'low';
  return 'high';
}

/**
 * 獲取錯誤顏色
 */
function getErrorColor(severity: ErrorSeverity): number {
  switch (severity) {
    case 'critical':
    case 'high':
      return 0xFF0000; // 紅色
    case 'medium':
      return 0xFFA500; // 橙色
    case 'low':
      return 0xFFFF00; // 黃色
    default:
      return 0x808080; // 灰色
  }
}

/**
 * 生成錯誤 ID（用於追蹤）
 */
function generateErrorId(): string {
  return `err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * 將錯誤格式化為 Discord Embed
 */
export function formatErrorAsEmbed(error: Error, user?: User): EmbedBuilder {
  const severity = getErrorSeverity(error);
  const isOperational = error instanceof BotError && error.isOperational;
  const isProduction = process.env.NODE_ENV === 'production';
  
  // 根據錯誤類型生成訊息
  let title: string;
  let description: string;
  let errorId: string | undefined;
  
  if (!isOperational) {
    // 系統錯誤 - 隱藏詳細資訊
    errorId = generateErrorId();
    
    title = '⚠️ 系統錯誤';
    description = '發生了一個意外錯誤，請稍後再試。';
    
    // 上報到 Sentry
    if (shouldCaptureError(error)) {
      Sentry.captureException(error, {
        extra: {
          errorId,
          userId: user?.id,
        },
      });
    }
    
    if (isProduction) {
      // 生產環境：僅記錄錯誤 ID 和訊息
      logger.error(`[${errorId}] Unhandled error`, { 
        message: error.message,
        userId: user?.id 
      });
    } else {
      // 開發環境：記錄完整堆疊
      logger.error(`[${errorId}] Unhandled error`, { 
        stack: error.stack,
        userId: user?.id 
      });
    }
  } else {
    // 業務錯誤 - 顯示訊息
    switch (error.name) {
      case 'PermissionError':
        title = '🔒 權限不足';
        break;
      case 'ValidationError':
        title = '❌ 輸入驗證失敗';
        break;
      case 'SessionError':
        title = '⏳ 會話錯誤';
        break;
      case 'ThreadMappingError':
        title = '🧵 Thread 映射錯誤';
        break;
      default:
        title = '⚠️ 操作失敗';
    }
    description = error.message;
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(getErrorColor(severity))
    .setTimestamp();

  // 添加錯誤 ID（如果是系統錯誤）
  if (!isOperational && errorId) {
    embed.setFooter({ text: `錯誤 ID: ${errorId}` });
  }
  // 添加錯誤代碼（如果是 BotError）
  else if (error instanceof BotError) {
    embed.setFooter({ 
      text: `錯誤代碼: ${error.code}`,
      iconURL: undefined
    });
  }

  return embed;
}

/**
 * 格式化簡短錯誤訊息（用於回覆）
 */
export function formatErrorMessage(error: Error): string {
  const isOperational = error instanceof BotError && error.isOperational;
  
  if (!isOperational) {
    return '⚠️ 發生了一個錯誤，請稍後再試。';
  }
  
  return `⚠️ ${error.message}`;
}

// ==================== 全域錯誤捕獲 ====================

/**
 * 處理未捕獲的 Promise Rejection
 * 注意：此函數僅保留 logger 記錄，Sentry 上報由 index.ts 統一處理
 */
export function handleUnhandledRejection(): void {
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    
    logger.error('Unhandled Promise Rejection', {
      message: error.message,
      stack: error.stack,
      promise: String(promise)
    });
  });
}

/**
 * 處理未捕獲的 Exception
 * 注意：此函數僅保留 logger 記錄，Sentry 上報由 index.ts 統一處理
 */
export function handleUncaughtException(): void {
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception', {
      message: error.message,
      stack: error.stack
    });
    
    // 優雅退出
    process.kill(process.pid, 'SIGTERM');
    setTimeout(() => process.exit(1), 10000); // 10秒後強制退出
  });
}

/**
 * 初始化全域錯誤處理
 */
export function initErrorHandling(): void {
  handleUnhandledRejection();
  handleUncaughtException();
  logger.info('Global error handling initialized');
}

/**
 * 錯誤處理中間件 - 用於命令處理
 */
export function createErrorHandler() {
  return async (error: Error): Promise<void> => {
    const isOperational = error instanceof BotError && error.isOperational;
    
    if (isOperational) {
      logger.warn(`Operational error: ${error.message}`, {
        type: error.name,
        code: (error as BotError).code
      });
    } else {
      // 上報到 Sentry
      if (shouldCaptureError(error)) {
        Sentry.captureException(error);
      }
      
      logger.error(`Unexpected error: ${error.message}`, {
        stack: error.stack,
        type: error.name
      });
    }
    
    throw error;
  };
}

// 導出預設
export default {
  BotError,
  PermissionError,
  ValidationError,
  SessionError,
  ThreadMappingError,
  formatErrorAsEmbed,
  formatErrorMessage,
  initErrorHandling,
  createErrorHandler
};
