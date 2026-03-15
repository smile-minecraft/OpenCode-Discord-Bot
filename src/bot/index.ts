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
});

/**
 * 處理未捕獲的 Exception
 */
process.on('uncaughtException', (error) => {
  logger.error('[Process] Uncaught Exception', {
    message: error.message,
    stack: error.stack,
  });

  // 優雅關閉
  shutdown(1);
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

    // 3. 關閉資料庫連線
    try {
      const { Database } = await import('../database/index.js');
      await Database.getInstance().close();
      logger.info('[Shutdown] Database closed');
    } catch (error) {
      logger.error('[Shutdown] Error closing database', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 4. 登出 Discord
    if (global.client?.isReady) {
      await global.client.destroy();
      logger.info('[Shutdown] Discord client destroyed');
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

  // 1. 初始化資料庫
  try {
    const { Database } = await import('../database/index.js');
    await Database.getInstance().initialize();
    logger.info('[Bootstrap] Database initialized');
  } catch (error) {
    logger.error('[Bootstrap] Failed to initialize database', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  // 2. 初始化 Permission Service
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
    initializeSessionManager({
      cliPath: process.env.OPENCODE_CLI_PATH || 'opencode',
    });
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
