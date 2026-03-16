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
import logger from '../utils/logger.js';

// 服務匯入
import {
  initializeSessionManager,
  initializeProjectManager,
  getQueueManager,
  initializeGitWorktreeService,
  initializeToolApprovalService,
  initializePermissionService,
  initializeSessionQueueIntegration,
} from '../services/index.js';

// ==================== 全域錯誤處理 ====================

/**
 * 緊急關閉函數（用於未捕獲的異常）
 */
function emergencyShutdown(signal: string): void {
  logger.error(`[Fatal] Received ${signal}, starting emergency shutdown...`);
  shutdown(1).catch(() => process.exit(1));
}

/**
 * 處理未捕獲的 Promise Rejection
 */
process.on('unhandledRejection', (reason, promise) => {
  logger.error('[Process] Unhandled Promise Rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
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

    // 4. 關閉 OpenCode HTTP 伺服器
    try {
      const { getOpenCodeClient } = await import('../services/OpenCodeClient.js');
      const openCodeClient = getOpenCodeClient();
      await openCodeClient.cleanupAll();
      logger.info('[Shutdown] OpenCode servers stopped');
    } catch (error) {
      logger.error('[Shutdown] Error stopping OpenCode servers', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 5. 關閉 SSE 連線
    try {
      const { getSSEClient } = await import('../services/SSEClient.js');
      const sseClient = getSSEClient();
      sseClient.disconnect();
      logger.info('[Shutdown] SSE connections closed');
    } catch (error) {
      logger.error('[Shutdown] Error closing SSE connections', {
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

  // 1. 初始化 JSON 資料庫（向後相容）
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

  // 3. 初始化 Project Manager
  try {
    await initializeProjectManager({
      dataPath: process.env.PROJECTS_PATH || './data/projects',
    });
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
      approvalTimeout: parseInt(process.env.TOOL_APPROVAL_TIMEOUT || '300000'),
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
