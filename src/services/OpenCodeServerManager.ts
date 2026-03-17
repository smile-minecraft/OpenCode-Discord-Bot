/**
 * OpenCode Server Manager - 單一伺服器生命週期管理
 * @description 管理單一 OpenCode HTTP 伺服器的啟動、停止和健康檢查
 * 
 * 這是簡化架構的一部分，移除了多端口分配邏輯，
 * 所有用戶共用同一個 OpenCode 伺服器實例
 */

import { spawn, ChildProcess } from 'child_process';
import logger from '../utils/logger.js';
import { TIMEOUTS } from '../config/constants.js';

// ============== 常量 ==============

/** 預設端口 */
const DEFAULT_PORT = 4096;
/** 健康檢查超時（毫秒） */
const HEALTH_CHECK_TIMEOUT = 2000;
/** 健康檢查最大重試次數 */
const HEALTH_CHECK_MAX_RETRIES = 30;
/** 停止伺服器超時（毫秒） */
const STOP_SERVER_TIMEOUT = 5000;

// ============== OpenCodeServerManager 類別 ==============

/**
 * OpenCode 伺服器管理器
 * @description 單例服務，負責管理單一 OpenCode HTTP 伺服器
 */
export class OpenCodeServerManager {
  /** 單例實例 */
  private static instance: OpenCodeServerManager;
  
  /** 伺服器進程 */
  private serverProcess: ChildProcess | null = null;
  
  /** 伺服器端口 */
  private readonly port: number;
  
  /** 是否正在運行 */
  private isRunning = false;
  
  /** 當前專案路徑 */
  private currentProjectPath: string | null = null;

  /**
   * 私有建構函數（單例模式）
   */
  private constructor() {
    this.port = DEFAULT_PORT;
  }

  /**
   * 獲取單例實例
   */
  static getInstance(): OpenCodeServerManager {
    if (!OpenCodeServerManager.instance) {
      OpenCodeServerManager.instance = new OpenCodeServerManager();
    }
    return OpenCodeServerManager.instance;
  }

  /**
   * 啟動 OpenCode 伺服器
   * @param projectPath - 專案路徑（可選）
   * @throws {Error} 伺服器啟動失敗
   */
  async start(projectPath?: string): Promise<void> {
    if (this.isRunning) {
      logger.info('[OpenCodeServerManager] 伺服器已在運行中');
      return;
    }

    const targetPath = projectPath || process.cwd();
    this.currentProjectPath = targetPath;

    logger.info(`[OpenCodeServerManager] 啟動 OpenCode 伺服器於端口 ${this.port}...`);

    // 啟動伺服器進程
    // Windows 需要 shell: true 來執行 .cmd 文件，macOS/Linux 不需要
    const isWindows = process.platform === 'win32';
    this.serverProcess = spawn('opencode', ['serve', '--port', String(this.port)], {
      cwd: targetPath,
      shell: isWindows,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // 處理 stdout
    this.serverProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      if (output) {
        logger.debug(`[OpenCodeServerManager] ${output}`);
      }
    });

    // 處理 stderr
    this.serverProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      if (output) {
        logger.warn(`[OpenCodeServerManager] ${output}`);
      }
    });

    // 處理進程錯誤
    this.serverProcess.on('error', (error) => {
      logger.error(`[OpenCodeServerManager] 進程錯誤: ${error.message}`);
      // 確保殭屍進程被終止
      if (this.serverProcess && !this.serverProcess.killed) {
        this.serverProcess.kill('SIGKILL');
      }
      this.serverProcess = null;
      this.isRunning = false;
    });

    // 處理進程結束
    this.serverProcess.on('close', (code) => {
      logger.info(`[OpenCodeServerManager] 伺服器結束，代碼: ${code}`);
      this.serverProcess = null;
      this.isRunning = false;
    });

    // 等待伺服器就緒
    try {
      await this.waitForServer();
      this.isRunning = true;
      
      logger.info(`[OpenCodeServerManager] 伺服器已啟動於端口 ${this.port}`);
    } catch (error) {
      // 確保錯誤時清理資源
      if (this.serverProcess && !this.serverProcess.killed) {
        this.serverProcess.kill('SIGKILL');
      }
      this.serverProcess = null;
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * 停止 OpenCode 伺服器
   */
  async stop(): Promise<void> {
    if (!this.serverProcess) {
      logger.info('[OpenCodeServerManager] 伺服器未在運行');
      return;
    }

    logger.info('[OpenCodeServerManager] 停止伺服器...');

    return new Promise((resolve, reject) => {
      let timeout: NodeJS.Timeout;
      let isResolved = false;

      const onClose = (code: number | null) => {
        if (isResolved) return;
        isResolved = true;
        
        clearTimeout(timeout);
        this.serverProcess = null;
        this.isRunning = false;
        
        logger.info(`[OpenCodeServerManager] 伺服器已停止 (代碼: ${code})`);
        resolve();
      };

      const onError = (error: Error) => {
        if (isResolved) return;
        isResolved = true;
        
        clearTimeout(timeout);
        logger.error(`[OpenCodeServerManager] 停止伺服器時發生錯誤:`, error);
        this.serverProcess = null;
        this.isRunning = false;
        reject(error);
      };

      // 設定超時
      timeout = setTimeout(() => {
        if (isResolved) return;
        
        if (this.serverProcess && !this.serverProcess.killed) {
          logger.warn('[OpenCodeServerManager] 強制終止伺服器');
          this.serverProcess.kill('SIGKILL');
          
          setTimeout(() => {
            if (!isResolved) {
              isResolved = true;
              this.serverProcess = null;
              this.isRunning = false;
              resolve();
            }
          }, 2000);
        } else {
          isResolved = true;
          this.serverProcess = null;
          this.isRunning = false;
          resolve();
        }
      }, STOP_SERVER_TIMEOUT);

      // 確保 serverProcess 存在
      if (!this.serverProcess) {
        isResolved = true;
        resolve();
        return;
      }

      this.serverProcess.once('close', onClose);
      this.serverProcess.once('error', onError);

      // 在殺死進程前移除監聽器，避免殭屍監聽器
      const removeListeners = () => {
        if (this.serverProcess) {
          this.serverProcess.removeListener('close', onClose);
          this.serverProcess.removeListener('error', onError);
        }
      };

      // 發送 SIGTERM
      if (this.serverProcess && !this.serverProcess.killed) {
        this.serverProcess.kill('SIGTERM');
      } else {
        removeListeners();
      }
    });
  }

  /**
   * 健康檢查
   * @returns 伺服器是否健康
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${this.port}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 取得伺服器 URL
   * @returns 伺服器基礎 URL
   */
  getUrl(): string {
    return `http://localhost:${this.port}`;
  }

  /**
   * 取得伺服器端口
   */
  getPort(): number {
    return this.port;
  }

  /**
   * 檢查伺服器是否運行中
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * 取得當前專案路徑
   */
  getCurrentProjectPath(): string | null {
    return this.currentProjectPath;
  }

  /**
   * 等待伺服器就緒
   * @throws {Error} 伺服器啟動超時
   */
  private async waitForServer(): Promise<void> {
    for (let attempt = 1; attempt <= HEALTH_CHECK_MAX_RETRIES; attempt++) {
      logger.debug(`[OpenCodeServerManager] 健康檢查嘗試 ${attempt}/${HEALTH_CHECK_MAX_RETRIES}`);

      // 等待間隔
      if (attempt > 1) {
        await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.HEALTH_CHECK));
      }

      if (await this.isHealthy()) {
        logger.debug('[OpenCodeServerManager] 健康檢查通過');
        return;
      }
    }

    throw new Error(`伺服器啟動超時（${HEALTH_CHECK_MAX_RETRIES} 次嘗試）`);
  }
}

// ============== 導出工廠函數 =============

let openCodeServerManagerInstance: OpenCodeServerManager | null = null;

/**
 * 獲取 OpenCodeServerManager 單例實例
 */
export function getOpenCodeServerManager(): OpenCodeServerManager {
  return OpenCodeServerManager.getInstance();
}

/**
 * 初始化 OpenCodeServerManager
 */
export function initializeOpenCodeServerManager(): OpenCodeServerManager {
  openCodeServerManagerInstance = OpenCodeServerManager.getInstance();
  return openCodeServerManagerInstance;
}

// ============== 導出 =============

export default {
  OpenCodeServerManager,
  getOpenCodeServerManager,
  initializeOpenCodeServerManager,
};
