/**
 * Bot Entry Point - 程式進入點
 * @description Discord Bot 啟動、錯誤處理與優雅關閉
 * 
 * 啟動流程：
 * 1. 載入環境變數
 * 2. 驗證必要環境變數
 * 3. 初始化所有服務（SessionManager, ProjectManager, QueueManager, 等）
 * 4. 建立 Discord Client
 * 5. 登入 Discord
 * 6. 註冊 Slash Commands
 * 7. 設定 Presence
 */

import { createDiscordClient } from './client.js';
import { loadConfig, getEnvInfo, checkRequiredEnvVars } from '../config/config.js';
import { TIMEOUTS } from '../config/constants.js';
import logger from '../utils/logger.js';
import * as Sentry from '@sentry/node';
import { shouldCaptureError } from '../utils/sentryHelper.js';
import * as fs from 'fs';
import * as path from 'path';

// 服務匯入
import {
  initializeSessionManager,
  initializeProjectManager,
  getQueueManager,
  initializeGitWorktreeService,
  initializeToolApprovalService,
  initializePermissionService,
  initializeSessionQueueIntegration,
  initializeThreadManager,
} from '../services/index.js';

// ==================== 全域錯誤處理 ====================

/**
 * 緊急關閉函數（用於未捕獲的異常）
 */
function emergencyShutdown(signal: string): void {
  logger.error(`[Fatal] Received ${signal}, starting emergency shutdown...`);
  shutdown(1).catch(() => {
    // 僅在 shutdown 失敗時退出
    setTimeout(() => process.exit(1), 1000);
  });
}

/**
 * 處理未捕獲的 Promise Rejection
 */
process.on('unhandledRejection', (reason, promise) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  
  // 上報到 Sentry
  if (shouldCaptureError(error)) {
    Sentry.captureException(error, {
      extra: {
        promise: String(promise),
      },
    });
  }
  
  logger.error('[Process] Unhandled Promise Rejection', {
    reason: error.message,
    promise: String(promise),
  });

  // 生產環境記錄完整錯誤
  if (getEnvInfo().isProduction) {
    console.error('[UnhandledRejection]', reason);
  }

  // 觸發 graceful shutdown
  emergencyShutdown('unhandledRejection');
});

/**
 * 處理未捕獲的 Exception
 */
process.on('uncaughtException', (error) => {
  // 上報到 Sentry
  if (shouldCaptureError(error)) {
    Sentry.captureException(error);
  }
  
  logger.error('[Process] Uncaught Exception', {
    message: error.message,
    stack: error.stack,
  });

  // 緊急關閉
  emergencyShutdown('uncaughtException');
});

/**
 * 優雅關閉函數
 * @param exitCode 退出代碼
 */
async function shutdown(exitCode: number = 0): Promise<void> {
  logger.info(`[Shutdown] Starting graceful shutdown (exit code: ${exitCode})`);

  try {
    // 1. 清理所有活動的 Session
    try {
      const { getSessionManager } = await import('../services/SessionManager.js');
      const sessionManager = getSessionManager();
      sessionManager.cleanupEndedSessions();
      logger.info('[Shutdown] Sessions cleaned up');
    } catch (error) {
      logger.error('[Shutdown] Error cleaning up sessions', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 2. 暫停 Queue 處理
    try {
      const queueManager = getQueueManager();
      queueManager.pause();
      logger.info('[Shutdown] Queue paused');
    } catch (error) {
      logger.error('[Shutdown] Error pausing queue', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 3. 關閉 Discord 客戶端
    try {
      if (global.client?.isReady) {
        await global.client.destroy();
        logger.info('[Shutdown] Discord client destroyed');
      }
    } catch (error) {
      logger.error('[Shutdown] Error destroying Discord client', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 4. 關閉 SDK Adapter
    try {
      const { getOpenCodeSDKAdapter } = await import('../services/OpenCodeSDKAdapter.js');
      const sdkAdapter = getOpenCodeSDKAdapter();
      await sdkAdapter.destroy();
      logger.info('[Shutdown] SDK Adapter destroyed');
    } catch (error) {
      logger.error('[Shutdown] Error destroying SDK Adapter', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 5. 關閉 Event Stream
    try {
      const { getEventStreamAdapter } = await import('../services/EventStreamFactory.js');
      const eventStreamAdapter = getEventStreamAdapter();
      eventStreamAdapter.disconnect();
      logger.info('[Shutdown] Event stream connections closed');
    } catch (error) {
      logger.error('[Shutdown] Error closing event stream connections', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 6. 關閉 SQLite 資料庫
    try {
      const { SQLiteDatabase } = await import('../database/SQLiteDatabase.js');
      const db = SQLiteDatabase.getInstance();
      if (db.isReady()) {
        db.close();
        logger.info('[Shutdown] SQLite database closed');
      }
    } catch (error) {
      logger.error('[Shutdown] Error closing SQLite database', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 7. 關閉舊的 JSON 資料庫（向後相容）
    try {
      const { Database } = await import('../database/index.js');
      await Database.getInstance().close();
      logger.info('[Shutdown] JSON database closed');
    } catch (error) {
      logger.error('[Shutdown] Error closing JSON database', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 8. 刷新 Sentry 緩衝區
    try {
      await Sentry.flush(2000);
      logger.info('[Shutdown] Sentry flushed');
    } catch (error) {
      logger.error('[Shutdown] Error flushing Sentry', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('[Shutdown] Graceful shutdown completed');
  } catch (error) {
    logger.error('[Shutdown] Error during shutdown', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    process.exit(exitCode);
  }
}

// 全域 client 參考（用於關閉時存取）
declare global {
  var client: import('discord.js').Client | undefined;
}

// 監聽終端訊號
process.on('SIGINT', () => {
  logger.info('[Process] Received SIGINT');
  shutdown(0);
});

process.on('SIGTERM', () => {
  logger.info('[Process] Received SIGTERM');
  shutdown(0);
});

// ==================== 主程式 ====================

/**
 * 初始化所有服務
 * @param config 應用程式配置
 */
async function initializeServices(_config: ReturnType<typeof loadConfig>): Promise<void> {
  logger.info('[Bootstrap] Initializing services...');

  // 1. 初始化 SDK
  try {
    const { initializeOpenCodeServerManager, initializeOpenCodeSDKAdapter } = await import('../services/index.js');
    
    initializeOpenCodeServerManager();
    
    const sdkAdapter = initializeOpenCodeSDKAdapter();
    const projectPath = process.env.OPENCODE_PROJECT_PATH || process.cwd();
    
    await sdkAdapter.initialize({
      projectPath,
      port: 4096,
    });
    
    logger.info('[Bootstrap] SDK 適配器已初始化');
  } catch (error) {
    logger.error('[Bootstrap] SDK 初始化失敗', { error });
    throw error;
  }

  // 2. 初始化 JSON 資料庫（向後相容）
  try {
    const { Database } = await import('../database/index.js');
    await Database.getInstance().initialize();
    logger.info('[Bootstrap] JSON Database initialized');
  } catch (error) {
    logger.error('[Bootstrap] Failed to initialize JSON database', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  // 2. 初始化 SQLite 資料庫
  try {
    const { SQLiteDatabase } = await import('../database/SQLiteDatabase.js');
    const sqliteDb = SQLiteDatabase.getInstance();
    await sqliteDb.initialize();
    logger.info('[Bootstrap] SQLite Database initialized');
  } catch (error) {
    logger.error('[Bootstrap] Failed to initialize SQLite database', {
      error: error instanceof Error ? error.message : String(error),
    });
    // 不阻塞啟動，SQLite 是可選的
    logger.warn('[Bootstrap] Continuing without SQLite database');
  }

  // 3. 初始化 Permission Service
  try {
    await initializePermissionService();
    logger.info('[Bootstrap] Permission Service initialized');
  } catch (error) {
    logger.error('[Bootstrap] Failed to initialize Permission Service', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  // 4. 初始化 Project Manager
  try {
    const projectDataPath = process.env.PROJECTS_PATH || path.join(process.cwd(), 'data', 'projects.json');
    
    // 確保資料目錄存在
    const dataDir = path.dirname(projectDataPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // 解析允許的基礎路徑（支持多個路徑，用冒號分隔）
    const allowedPathsStr = process.env.ALLOWED_PROJECT_PATHS;
    const allowedBasePaths = allowedPathsStr 
      ? allowedPathsStr.split(':').map(p => path.resolve(p.trim())).filter(p => p)
      : undefined;
    
    // 初始化 ProjectManager
    const projectManager = initializeProjectManager({
      dataPath: projectDataPath,
      allowedBasePaths,
    });
    
    // 設置保存回調 - 將資料寫入 JSON 檔案
    projectManager.setSaveCallback(async (data) => {
      try {
        await fs.promises.writeFile(projectDataPath, JSON.stringify(data, null, 2), 'utf-8');
        logger.debug('[Bootstrap] Project data saved to file');
      } catch (error) {
        logger.error('[Bootstrap] Failed to save project data', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });
    
    // 設置載入回調 - 從 JSON 檔案讀取資料
    projectManager.setLoadCallback(async () => {
      try {
        if (fs.existsSync(projectDataPath)) {
          const content = await fs.promises.readFile(projectDataPath, 'utf-8');
          return JSON.parse(content);
        }
        return null;
      } catch (error) {
        logger.error('[Bootstrap] Failed to load project data', {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    });
    
    // 初始化並載入既有資料
    await projectManager.initialize();
    
    logger.info('[Bootstrap] Project Manager initialized');
  } catch (error) {
    logger.error('[Bootstrap] Failed to initialize Project Manager', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  // 4. 初始化 Session Manager
  try {
    initializeSessionManager();
    logger.info('[Bootstrap] Session Manager initialized');
  } catch (error) {
    logger.error('[Bootstrap] Failed to initialize Session Manager', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  // 5. 初始化 Queue Manager
  try {
    const queueManager = getQueueManager();
    queueManager.updateSettings({
      taskTimeout: (parseInt(process.env.QUEUE_TIMEOUT || '30') * 60 * 1000),
      maxRetries: parseInt(process.env.QUEUE_MAX_RETRIES || '3'),
      continueOnFailure: process.env.QUEUE_CONTINUE_ON_FAILURE !== 'false',
      freshContext: process.env.QUEUE_FRESH_CONTEXT === 'true',
    });
    logger.info('[Bootstrap] Queue Manager initialized');
  } catch (error) {
    logger.error('[Bootstrap] Failed to initialize Queue Manager', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  // 6. 初始化 Git Worktree Service
  try {
    initializeGitWorktreeService({
      repoPath: process.env.GIT_REPO_PATH,
      githubToken: process.env.GITHUB_TOKEN,
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
    });
    logger.info('[Bootstrap] Git Worktree Service initialized');
  } catch (error) {
    logger.warn('[Bootstrap] Git Worktree Service initialization skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 7. 初始化 Tool Approval Service
  try {
    initializeToolApprovalService({
      enabled: true,
      autoApprovedTools: process.env.AUTO_APPROVE_PATTERNS?.split(',') || [],
      requireApprovalTools: process.env.REQUIRE_APPROVAL_PATTERNS?.split(',') || [],
      approvalTimeout: parseInt(process.env.TOOL_APPROVAL_TIMEOUT || TIMEOUTS.TOOL_APPROVAL.toString()),
    });
    logger.info('[Bootstrap] Tool Approval Service initialized');
  } catch (error) {
    logger.warn('[Bootstrap] Tool Approval Service initialization skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 8. 初始化 Session Queue Integration
  try {
    initializeSessionQueueIntegration();
    logger.info('[Bootstrap] Session Queue Integration initialized');
  } catch (error) {
    logger.warn('[Bootstrap] Session Queue Integration initialization skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 9. 初始化 Thread Manager
  try {
    const { SQLiteDatabase } = await import('../database/SQLiteDatabase.js');
    const sqliteDb = SQLiteDatabase.getInstance();
    await initializeThreadManager(sqliteDb);
    logger.info('[Bootstrap] Thread Manager initialized');
  } catch (error) {
    logger.warn('[Bootstrap] Thread Manager initialization skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('[Bootstrap] All services initialized successfully');
}

/**
 * 驗證環境變數
 */
function validateEnvironment(): void {
  const requiredVars = ['DISCORD_TOKEN'];
  const missingVars = checkRequiredEnvVars(requiredVars);

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  // 驗證可選環境變數
  const envInfo = getEnvInfo();
  if (envInfo.isDevelopment) {
    logger.info('[Bootstrap] Running in development mode');
  }

  logger.info('[Bootstrap] Environment validation passed');
}

/**
 * 啟動 Bot
 */
async function startBot(): Promise<void> {
  // 顯示啟動banner
  printBanner();

  // 載入環境變數
  logger.info('[Bootstrap] Loading configuration...');
  const config = loadConfig();

  // 顯示環境資訊
  const envInfo = getEnvInfo();
  logger.info(`[Bootstrap] Environment: ${envInfo.nodeEnv}`);
  logger.info(`[Bootstrap] Log Level: ${process.env.LOG_LEVEL || 'info'}`);

  // 驗證環境變數
  logger.info('[Bootstrap] Validating environment...');
  validateEnvironment();

  // 初始化所有服務
  logger.info('[Bootstrap] Starting service initialization...');
  await initializeServices(config);

  // 建立 Client
  logger.info('[Bootstrap] Creating Discord client...');
  const client = createDiscordClient({
    debug: envInfo.isDevelopment,
    registerCommands: true,
  });

  // 儲存 client 到全域變數（用於關閉時存取）
  global.client = client;

  // 登入 Discord
  logger.info('[Bootstrap] Logging in to Discord...');
  try {
    await client.login(config.DISCORD_TOKEN);
    logger.info('[Bootstrap] Login successful');
  } catch (error) {
    logger.error('[Bootstrap] Failed to login', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

/**
 * 印出啟動 Banner
 */
function printBanner(): void {
  const banner = `
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   ██████╗ ███████╗████████╗██████╗  ██████╗               ║
║   ██╔══██╗██╔════╝╚══██╔══╝██╔══██╗██╔═══██╗              ║
║   ██████╔╝█████╗     ██║   ██████╔╝██║   ██║              ║
║   ██╔══██╗██╔══╝     ██║   ██╔══██╗██║   ██║              ║
║   ██║  ██║███████╗   ██║   ██║  ██║╚██████╔╝              ║
║   ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝               ║
║                      Discord Bot                          ║
║                      TypeScript + Discord.js v14          ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `;
  console.log(banner);
}

// ==================== 啟動程式 ====================

// 執行主程式
startBot().catch((error) => {
  logger.error('[Bootstrap] Fatal error during startup', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});

export { startBot, shutdown };
export default { startBot, shutdown };
