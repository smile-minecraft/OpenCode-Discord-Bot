/**
 * Process Manager - OpenCode 伺服器進程管理
 * @description 管理 OpenCode HTTP 伺服器的生命週期，包括啟動、停止和垃圾回收
 */

import { spawn, ChildProcess } from 'child_process';
import logger from '../utils/logger.js';
import { OPENCODE_SERVER, TIMEOUTS } from '../config/constants.js';

// ============== 常量 ==============

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

// ============== ProcessManager 類別 =============

/**
 * OpenCode 伺服器進程管理器
 * @description 單例服務，負責管理 OpenCode HTTP 伺服器進程的生命週期
 */
export class ProcessManager {
  /** 運行的伺服器程序映射 */
  private serverProcesses: Map<number, ChildProcess> = new Map();
  /** 垃圾回收定時器 */
  private gcInterval: NodeJS.Timeout | null = null;
  /** 當前使用的端口 */
  private currentPort: number = OPENCODE_SERVER.PORT_RANGE_START;
  /** 端口範圍 */
  private readonly portRangeStart: number;
  private readonly portRangeEnd: number;

  /**
   * 創建 ProcessManager 實例
   */
  constructor() {
    this.portRangeStart = OPENCODE_SERVER.PORT_RANGE_START;
    this.portRangeEnd = OPENCODE_SERVER.PORT_RANGE_END;
    
    // 啟動垃圾回收機制
    this.startGarbageCollection();
    logger.info('[ProcessManager] 初始化完成');
  }

  /**
   * 啟動垃圾回收機制
   * @description 定時檢查並清理已終止但未從 Map 中移除的進程
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
   * @description 檢查每個記錄的進程是否仍在運行，若已終止則從 Map 中移除
   */
  public cleanupStaleProcesses(): void {
    const ports = Array.from(this.serverProcesses.keys());
    let cleanedCount = 0;
    
    for (const port of ports) {
      const process = this.serverProcesses.get(port);
      if (!process) {
        this.serverProcesses.delete(port);
        cleanedCount++;
        continue;
      }
      
      // 檢查進程是否已終止 (pid 為 undefined 或 kill 失敗表示已終止)
      if (process.pid === undefined || process.killed) {
        logger.warn(`[ProcessManager:${port}] 清理陳舊進程記錄 (PID: ${process.pid})`);
        this.serverProcesses.delete(port);
        cleanedCount++;
        continue;
      }
      
      // 嘗試 kill(0) 檢查進程是否存在（信號 0 不會殺死進程，只檢查是否存在）
      try {
        process.kill(0);
      } catch {
        // 進程已終止但 Map 中仍有記錄
        logger.warn(`[ProcessManager:${port}] 清理已崩潰的進程記錄 (PID: ${process.pid})`);
        this.serverProcesses.delete(port);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      logger.debug(`[ProcessManager] 垃圾回收完成，清理了 ${cleanedCount} 個陳舊進程記錄`);
    }
  }

  /**
   * 分配一個可用端口
   * @returns 可用端口號
   */
  public allocatePort(): number {
    // 首先嘗試找到未使用的端口
    for (let port = this.portRangeStart; port <= this.portRangeEnd; port++) {
      if (!this.serverProcesses.has(port)) {
        return port;
      }
    }
    
    // 如果範圍內沒有可用端口，返回當前端口（將會覆蓋）
    const port = this.currentPort;
    this.currentPort = this.currentPort >= this.portRangeEnd 
      ? this.portRangeStart 
      : this.currentPort + 1;
    
    logger.warn(`[ProcessManager] 端口範圍已滿，使用臨時端口: ${port}`);
    return port;
  }

  /**
   * 釋放端口
   * @param port 端口號
   */
  public releasePort(port: number): void {
    // 端口釋放不需要特別處理，進程停止後會自動清理
    logger.debug(`[ProcessManager:${port}] 端口已標記為可釋放`);
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
   * @param port 連接埠號（可選，不提供則自動分配）
   * @throws {Error} 伺服器啟動失敗
   */
  public async startServer(projectPath: string, port?: number): Promise<number> {
    // 如果未指定端口，自動分配
    const targetPort = port ?? this.allocatePort();

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

    // 註冊進程
    this.serverProcesses.set(targetPort, serverProcess);

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
      this.serverProcesses.delete(targetPort);
    });

    // 處理進程結束
    serverProcess.on('close', (code) => {
      logger.info(`[ProcessManager:${targetPort}] 伺服器結束，代碼: ${code}`);
      this.serverProcesses.delete(targetPort);
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
    const process = this.serverProcesses.get(port);

    if (!process) {
      logger.warn(`[ProcessManager:${port}] 嘗試停止不存在的伺服器程序`);
      return;
    }

    logger.info(`[ProcessManager] 停止端口 ${port} 的伺服器...`);

    return new Promise((resolve, reject) => {
      let timeout: NodeJS.Timeout;
      let isResolved = false;

      // 監聽進程結束事件
      const onClose = (code: number | null) => {
        if (isResolved) return;
        isResolved = true;
        
        clearTimeout(timeout);
        this.serverProcesses.delete(port);
        
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
              this.serverProcesses.delete(port);
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
      const response = await fetch(`${this.getBaseUrl(port)}/health`, {
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
    return Array.from(this.serverProcesses.keys());
  }

  /**
   * 清理所有伺服器
   */
  public async cleanupAll(): Promise<void> {
    // 停止垃圾回收機制
    this.stopGarbageCollection();
    
    const ports = this.getActiveServers();
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
