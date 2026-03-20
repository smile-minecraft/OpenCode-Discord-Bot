/**
 * Process Manager - OpenCode 伺服器進程管理
 * @description 管理 OpenCode HTTP 伺服器的生命週期，包括啟動、停止和垃圾回收
 * 
 * P2-13: 簡化設計 - 採用單一伺服器架構（固定端口 3000）
 */

import { spawn, ChildProcess } from 'child_process';
import logger from '../utils/logger.js';
import { TIMEOUTS } from '../config/constants.js';

// ============== 常量 =============

/** 垃圾回收間隔（毫秒） */
const GARBAGE_COLLECTION_INTERVAL = 30000; // 30秒
/** 健康檢查超時（毫秒） */
const HEALTH_CHECK_TIMEOUT = 2000;
/** 停止伺服器超時（毫秒） */
const STOP_SERVER_TIMEOUT = 5000;
/** 健康檢查最大重試次數 */
const HEALTH_CHECK_MAX_RETRIES = 5;
/** 預設主機地址 */
const DEFAULT_HOST = '127.0.0.1';
/** 固定端口 - OpenCode 預設端口 4096 */
const DEFAULT_PORT = 4096;

// ============== ProcessManager 類別 ========

/**
 * OpenCode 伺服器進程管理器
 * @description 單例服務，負責管理 OpenCode HTTP 伺服器進程的生命週期
 * P2-13: 簡化設計 - 移除多餘的 Map 和端口分配邏輯
 */
export class ProcessManager {
  /** 當前伺服器進程（單一伺服器架構，無需 Map） */
  private serverProcess: ChildProcess | null = null;
  /** 伺服器當前端口 */
  private currentPort: number | null = null;
  /** 垃圾回收定時器 */
  private gcInterval: NodeJS.Timeout | null = null;

  /**
   * 創建 ProcessManager 實例
   */
  constructor() {
    // 啟動垃圾回收機制
    this.startGarbageCollection();
    logger.info('[ProcessManager] 初始化完成 (單一伺服器模式)');
  }

  /**
   * 啟動垃圾回收機制
   * @description 定時檢查並清理已終止但未移除的進程
   */
  private startGarbageCollection(): void {
    if (this.gcInterval) {
      return;
    }
    
    this.gcInterval = setInterval(() => {
      this.cleanupStaleProcesses();
    }, GARBAGE_COLLECTION_INTERVAL);
    
    // 防止定時器阻止程序退出
    this.gcInterval.unref();
    logger.debug('[ProcessManager] 垃圾回收機制已啟動');
  }

  /**
   * 停止垃圾回收機制
   */
  private stopGarbageCollection(): void {
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = null;
      logger.debug('[ProcessManager] 垃圾回收機制已停止');
    }
  }

  /**
   * 清理已終止的陳舊進程
   * @description 檢查當前記錄的進程是否仍在運行
   */
  public cleanupStaleProcesses(): void {
    if (!this.serverProcess) {
      return;
    }
    
    // 檢查進程是否已終止
    if (this.serverProcess.pid === undefined || this.serverProcess.killed) {
      logger.warn(`[ProcessManager:${this.currentPort}] 清理陳舊進程記錄 (PID: ${this.serverProcess.pid})`);
      this.serverProcess = null;
      this.currentPort = null;
      return;
    }
    
    // 嘗試 kill(0) 檢查進程是否存在（信號 0 不會殺死進程，只檢查是否存在）
    try {
      this.serverProcess.kill(0);
    } catch {
      // 進程已終止但仍有記錄
      logger.warn(`[ProcessManager:${this.currentPort}] 清理已崩潰的進程記錄 (PID: ${this.serverProcess.pid})`);
      this.serverProcess = null;
      this.currentPort = null;
    }
  }

  /**
   * 獲取當前端口
   * @returns 當前端口號
   */
  public getCurrentPort(): number | null {
    return this.currentPort;
  }

  /**
   * 獲取進程基礎 URL
   * @param port 端口號
   */
  public getBaseUrl(port: number): string {
    return `http://${DEFAULT_HOST}:${port}`;
  }

  /**
   * 啟動 OpenCode HTTP 伺服器
   * @param projectPath 專案路徑
   * @param port 連接埠號（可選，不提供則使用預設端口）
   * @throws {Error} 伺服器啟動失敗
   */
  public async startServer(projectPath: string, port?: number): Promise<number> {
    // P2-13: 簡化設計 - 使用預設端口
    const targetPort = port ?? DEFAULT_PORT;

    // 檢查伺服器是否已經運行
    if (await this.isServerRunning(targetPort)) {
      logger.info(`[ProcessManager] 伺服器已在端口 ${targetPort} 運行`);
      return targetPort;
    }

    logger.info(`[ProcessManager] 啟動 OpenCode 伺服器於端口 ${targetPort}...`);

    // 啟動伺服器進程
    // Windows 需要 shell: true 來執行 .cmd 文件，macOS/Linux 不需要
    const isWindows = process.platform === 'win32';
    const serverProcess = spawn('opencode', ['serve', '--port', String(targetPort)], {
      cwd: projectPath,
      shell: isWindows,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // 註冊進程 (P2-13: 簡化為單一變數)
    this.serverProcess = serverProcess;
    this.currentPort = targetPort;

    // 處理 stdout
    serverProcess.stdout?.on('data', (data: Buffer) => {
      logger.debug(`[ProcessManager:${targetPort}] ${data.toString().trim()}`);
    });

    // 處理 stderr
    serverProcess.stderr?.on('data', (data: Buffer) => {
      logger.warn(`[ProcessManager:${targetPort}] ${data.toString().trim()}`);
    });

    // 處理進程錯誤
    serverProcess.on('error', (error) => {
      logger.error(`[ProcessManager:${targetPort}] 進程錯誤: ${error.message}`);
      this.serverProcess = null;
      this.currentPort = null;
    });

    // 處理進程結束
    serverProcess.on('close', (code) => {
      logger.info(`[ProcessManager:${targetPort}] 伺服器結束，代碼: ${code}`);
      this.serverProcess = null;
      this.currentPort = null;
    });

    // 等待健康檢查通過
    await this.waitForHealthCheck(targetPort);
    logger.info(`[ProcessManager] 伺服器已啟動於端口 ${targetPort}`);
    
    return targetPort;
  }

  /**
   * 停止 OpenCode HTTP 伺服器
   * @param port 連接埠號
   */
  public async stopServer(port: number): Promise<void> {
    // P2-13: 簡化設計 - 直接檢查 serverProcess
    if (!this.serverProcess || this.currentPort !== port) {
      logger.warn(`[ProcessManager:${port}] 嘗試停止不存在的伺服器程序`);
      return;
    }

    const process = this.serverProcess;
    logger.info(`[ProcessManager] 停止端口 ${port} 的伺服器...`);

    return new Promise((resolve, reject) => {
      let timeout: NodeJS.Timeout;
      let isResolved = false;

      // 監聽進程結束事件
      const onClose = (code: number | null) => {
        if (isResolved) return;
        isResolved = true;
        
        clearTimeout(timeout);
        this.serverProcess = null;
        this.currentPort = null;
        
        logger.info(`[ProcessManager] 伺服器已停止於端口 ${port} (代碼: ${code})`);
        resolve();
      };

      const onError = (error: Error) => {
        if (isResolved) return;
        isResolved = true;
        
        clearTimeout(timeout);
        logger.error(`[ProcessManager:${port}] 停止伺服器時發生錯誤:`, error);
        reject(error);
      };

      // 設定超時
      timeout = setTimeout(() => {
        if (isResolved) return;
        
        if (!process.killed) {
          logger.warn(`[ProcessManager:${port}] 強制終止伺服器`);
          process.kill('SIGKILL');
          
          // 再等待一段時間
          setTimeout(() => {
            if (!isResolved) {
              isResolved = true;
              this.serverProcess = null;
              this.currentPort = null;
              resolve(); // 強制 resolve，避免卡住
            }
          }, 2000);
        }
      }, STOP_SERVER_TIMEOUT);

      // 綁定事件監聽器
      process.once('close', onClose);
      process.once('error', onError);

      // 發送 SIGTERM
      process.kill('SIGTERM');
    });
  }

  /**
   * 檢查伺服器是否運行
   * @param port 連接埠號
   * @returns 是否運行中
   */
  public async isServerRunning(port: number): Promise<boolean> {
    try {
      const response = await fetch(`${this.getBaseUrl(port)}/global/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 等待健康檢查通過
   * @param port 連接埠號
   * @throws {Error} 健康檢查超時
   */
  private async waitForHealthCheck(port: number): Promise<void> {
    for (let attempt = 1; attempt <= HEALTH_CHECK_MAX_RETRIES; attempt++) {
      logger.debug(`[ProcessManager:${port}] 健康檢查嘗試 ${attempt}/${HEALTH_CHECK_MAX_RETRIES}`);

      // 等待間隔
      if (attempt > 1) {
        await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.HEALTH_CHECK));
      }

      if (await this.isServerRunning(port)) {
        logger.debug(`[ProcessManager:${port}] 健康檢查通過`);
        return;
      }
    }

    throw new Error(`健康檢查超時（${HEALTH_CHECK_MAX_RETRIES} 次嘗試）於端口 ${port}`);
  }

  /**
   * 獲取所有運行的伺服器端口
   * @returns 端口列表
   */
  public getActiveServers(): number[] {
    // P2-13: 簡化設計 - 檢查 serverProcess 是否存在
    if (this.serverProcess && this.currentPort !== null) {
      return [this.currentPort];
    }
    return [];
  }

  /**
   * 清理所有伺服器
   */
  public async cleanupAll(): Promise<void> {
    // 停止垃圾回收機制
    this.stopGarbageCollection();
    
    const ports = this.getActiveServers();
    if (ports.length === 0) {
      logger.info('[ProcessManager] 沒有活躍伺服器需要清理');
      return;
    }
    
    logger.info(`[ProcessManager] 清理 ${ports.length} 個活躍伺服器...`);
    
    // 使用 Promise.allSettled 確保所有都嘗試關閉
    const results = await Promise.allSettled(
      ports.map((port) => this.stopServer(port))
    );
    
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      logger.error(`[ProcessManager] ${failed.length} 個伺服器關閉失敗`);
    }
    
    logger.info('[ProcessManager] 清理完成');
  }

  /**
   * 銷毀管理器實例
   * @description 清理所有資源
   */
  public async destroy(): Promise<void> {
    await this.cleanupAll();
  }
}

// ============== 單例實例 =============

let processManagerInstance: ProcessManager | null = null;

/**
 * 獲取 ProcessManager 單例實例
 */
export function getProcessManager(): ProcessManager {
  if (!processManagerInstance) {
    processManagerInstance = new ProcessManager();
  }
  return processManagerInstance;
}

/**
 * 初始化 ProcessManager
 */
export function initializeProcessManager(): ProcessManager {
  processManagerInstance = new ProcessManager();
  return processManagerInstance;
}

// ============== 導出 =============

export default {
  ProcessManager,
  getProcessManager,
  initializeProcessManager,
};
