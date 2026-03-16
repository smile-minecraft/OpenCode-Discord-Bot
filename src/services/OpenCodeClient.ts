/**
 * OpenCode HTTP API Client
 * @description 與 OpenCode HTTP 伺服器通訊的客戶端
 */

import { spawn, ChildProcess } from 'child_process';
import logger from '../utils/logger.js';
import { TIMEOUTS } from '../config/constants.js';

// ============== 類型定義 ==============

/**
 * Session 創建選項
 */
export interface CreateSessionOptions {
  /** 使用的模型 */
  model: string;
  /** 使用的 Agent */
  agent: string;
  /** 專案路徑 */
  projectPath: string;
  /** 初始提示詞（可選） */
  initialPrompt?: string;
}

/**
 * Session 資訊
 */
export interface SessionInfo {
  /** Session ID */
  id: string;
  /** Session 狀態 */
  status: 'pending' | 'running' | 'completed' | 'error';
  /** 使用的模型 */
  model: string;
  /** 使用的 Agent */
  agent: string;
}

/**
 * OpenCode 錯誤
 */
export class OpenCodeError extends Error {
  /** 錯誤碼 */
  code: 'SERVER_NOT_RUNNING' | 'NETWORK_ERROR' | 'API_ERROR' | 'TIMEOUT' | 'SPAWN_ERROR';
  /** 連接埠號 */
  port?: number;
  /** HTTP 狀態碼 */
  statusCode?: number;

  constructor(
    message: string,
    code: OpenCodeError['code'],
    options?: { port?: number; statusCode?: number }
  ) {
    super(message);
    this.name = 'OpenCodeError';
    this.code = code;
    this.port = options?.port;
    this.statusCode = options?.statusCode;
  }
}

// ============== 常量 ==============

/** 健康檢查重試次數 */
const HEALTH_CHECK_MAX_RETRIES = 5;
/** 健康檢查重試間隔（毫秒） */
const HEALTH_CHECK_RETRY_INTERVAL = TIMEOUTS.HEALTH_CHECK;
/** 預設主機地址 */
const DEFAULT_HOST = '127.0.0.1';
/** 垃圾回收間隔（毫秒） */
const GARBAGE_COLLECTION_INTERVAL = 30000; // 30秒

// ============== OpenCodeClient 類別 ==============

/**
 * OpenCode HTTP API 客戶端
 * @description 管理 OpenCode HTTP 伺服器的生命週期並提供 HTTP API 呼叫
 * 支持本地進程啟動或連接到外部 OpenCode 服務
 */
export class OpenCodeClient {
  /** 運行的伺服器程序映射 */
  private serverProcesses: Map<number, ChildProcess> = new Map();
  /** 外部 OpenCode 服務 URL（如使用外部服務） */
  private externalUrl: string | null = null;
  /** API Key（用於外部服務認證） */
  private apiKey: string | null = null;
  /** 垃圾回收定時器 */
  private gcInterval: NodeJS.Timeout | null = null;

  /**
   * 創建 OpenCodeClient 實例
   */
  constructor() {
    // 從環境變數讀取外部服務配置
    this.externalUrl = process.env.OPENCODE_API_URL || null;
    this.apiKey = process.env.OPENCODE_API_KEY || null;
    
    // 啟動垃圾回收機制
    this.startGarbageCollection();
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
    logger.debug('[OpenCodeClient] 垃圾回收機制已啟動');
  }

  /**
   * 清理已終止的陳舊進程
   * @description 檢查每個記錄的進程是否仍在運行，若已終止則從 Map 中移除
   */
  private cleanupStaleProcesses(): void {
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
        logger.warn(`[OpenCodeClient:${port}] 清理陳舊進程記錄 (PID: ${process.pid})`);
        this.serverProcesses.delete(port);
        cleanedCount++;
        continue;
      }
      
      // 嘗試 kill(0) 檢查進程是否存在（信號 0 不會殺死進程，只檢查是否存在）
      try {
        process.kill(0);
      } catch {
        // 進程已終止但 Map 中仍有記錄
        logger.warn(`[OpenCodeClient:${port}] 清理已崩潰的進程記錄 (PID: ${process.pid})`);
        this.serverProcesses.delete(port);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      logger.debug(`[OpenCodeClient] 垃圾回收完成，清理了 ${cleanedCount} 個陳舊進程記錄`);
    }
  }

  /**
   * 停止垃圾回收機制
   */
  private stopGarbageCollection(): void {
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = null;
      logger.debug('[OpenCodeClient] 垃圾回收機制已停止');
    }
  }

  /**
   * 檢查是否使用外部 OpenCode 服務
   */
  isExternal(): boolean {
    return this.externalUrl !== null;
  }

  /**
   * 取得 API 基礎 URL
   * @param port 端口號（本地模式使用）
   */
  getBaseUrl(port?: number): string {
    if (this.externalUrl) {
      return this.externalUrl;
    }
    return `http://${DEFAULT_HOST}:${port}`;
  }

  /**
   * 獲取認證 Headers
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * 啟動 OpenCode HTTP 伺服器
   * @param projectPath 專案路徑
   * @param port 連接埠號
   * @throws {OpenCodeError} 伺服器啟動失敗
   */
  async startServer(projectPath: string, port: number): Promise<void> {
    // 如果使用外部服務，跳過本地進程啟動
    if (this.isExternal()) {
      logger.info(`[OpenCodeClient] 使用外部 OpenCode 服務: ${this.externalUrl}`);
      
      // 檢查外部服務是否可用
      await this.waitForHealthCheck(port);
      logger.info(`[OpenCodeClient] 外部服務已就緒`);
      return;
    }

    // 檢查伺服器是否已經運行
    if (await this.isServerRunning(port)) {
      logger.info(`[OpenCodeClient] 伺服器已在端口 ${port} 運行`);
      return;
    }

    logger.info(`[OpenCodeClient] 啟動 OpenCode 伺服器於端口 ${port}...`);

    // 啟動伺服器進程
    // Windows 需要 shell: true 來執行 .cmd 文件，macOS/Linux 不需要
    const isWindows = process.platform === 'win32';
    const serverProcess = spawn('opencode', ['serve', '--port', String(port)], {
      cwd: projectPath,
      shell: isWindows,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // 註冊進程
    this.serverProcesses.set(port, serverProcess);

    // 處理 stdout
    serverProcess.stdout?.on('data', (data: Buffer) => {
      logger.debug(`[OpenCodeClient:${port}] ${data.toString().trim()}`);
    });

    // 處理 stderr
    serverProcess.stderr?.on('data', (data: Buffer) => {
      logger.warn(`[OpenCodeClient:${port}] ${data.toString().trim()}`);
    });

    // 處理進程錯誤
    serverProcess.on('error', (error) => {
      logger.error(`[OpenCodeClient:${port}] 進程錯誤: ${error.message}`);
      this.serverProcesses.delete(port);
    });

    // 處理進程結束
    serverProcess.on('close', (code) => {
      logger.info(`[OpenCodeClient:${port}] 伺服器結束，代碼: ${code}`);
      this.serverProcesses.delete(port);
    });

    // 等待健康檢查通過
    await this.waitForHealthCheck(port);
    logger.info(`[OpenCodeClient] 伺服器已啟動於端口 ${port}`);
  }

  /**
   * 停止 OpenCode HTTP 伺服器
   * @param port 連接埠號
   */
  async stopServer(port: number): Promise<void> {
    // 外部模式：不需要停止本地進程
    if (this.isExternal()) {
      logger.info(`[OpenCodeClient] 外部模式：跳過停止伺服器`);
      return;
    }

    const process = this.serverProcesses.get(port);

    if (!process) {
      logger.warn(`[OpenCodeClient:${port}] 嘗試停止不存在的伺服器程序`);
      return;
    }

    logger.info(`[OpenCodeClient] 停止端口 ${port} 的伺服器...`);

    return new Promise((resolve, reject) => {
      let timeout: NodeJS.Timeout;
      let isResolved = false;

      // 監聽進程結束事件
      const onClose = (code: number | null) => {
        if (isResolved) return;
        isResolved = true;
        
        clearTimeout(timeout);
        this.serverProcesses.delete(port);
        
        logger.info(`[OpenCodeClient] 伺服器已停止於端口 ${port} (代碼: ${code})`);
        resolve();
      };

      const onError = (error: Error) => {
        if (isResolved) return;
        isResolved = true;
        
        clearTimeout(timeout);
        logger.error(`[OpenCodeClient:${port}] 停止伺服器時發生錯誤:`, error);
        reject(error);
      };

      // 設定超時
      timeout = setTimeout(() => {
        if (isResolved) return;
        
        if (!process.killed) {
          logger.warn(`[OpenCodeClient:${port}] 強制終止伺服器`);
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
      }, 5000);

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
  async isServerRunning(port: number): Promise<boolean> {
    try {
      const response = await fetch(`${this.getBaseUrl(port)}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 創建 Session
   * @param port 連接埠號
   * @param options Session 創建選項
   * @returns Session 資訊
   * @throws {OpenCodeError} 伺服器未運行或 API 錯誤
   */
  async createSession(port: number, options: CreateSessionOptions): Promise<SessionInfo> {
    // 檢查伺服器是否運行
    if (!(await this.isServerRunning(port))) {
      throw new OpenCodeError(
        `伺服器未運行於端口 ${port}`,
        'SERVER_NOT_RUNNING',
        { port }
      );
    }

    const url = `${this.getBaseUrl(port)}/sessions`;
    logger.debug(`[OpenCodeClient:${port}] 創建 Session: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify({
          model: options.model,
          agent: options.agent,
          projectPath: options.projectPath,
          initialPrompt: options.initialPrompt,
        }),
        signal: AbortSignal.timeout(TIMEOUTS.HTTP),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new OpenCodeError(
          `API 錯誤: ${response.status} ${response.statusText} - ${errorText}`,
          'API_ERROR',
          { port, statusCode: response.status }
        );
      }

      const sessionInfo = (await response.json()) as SessionInfo;
      logger.info(`[OpenCodeClient:${port}] Session 創建成功: ${sessionInfo.id}`);
      return sessionInfo;
    } catch (error) {
      if (error instanceof OpenCodeError) {
        throw error;
      }
      throw new OpenCodeError(
        `網路錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`,
        'NETWORK_ERROR',
        { port }
      );
    }
  }

  /**
   * 發送提示到 Session
   * @param port 連接埠號
   * @param sessionId Session ID
   * @param prompt 提示內容
   * @throws {OpenCodeError} 伺服器未運行或 API 錯誤
   */
  async sendPrompt(port: number, sessionId: string, prompt: string): Promise<void> {
    // 檢查伺服器是否運行
    if (!(await this.isServerRunning(port))) {
      throw new OpenCodeError(
        `伺服器未運行於端口 ${port}`,
        'SERVER_NOT_RUNNING',
        { port }
      );
    }

    const url = `${this.getBaseUrl(port)}/sessions/${sessionId}/prompt`;
    logger.debug(`[OpenCodeClient:${port}] 發送提示到 Session ${sessionId}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify({ prompt }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new OpenCodeError(
          `API 錯誤: ${response.status} ${response.statusText} - ${errorText}`,
          'API_ERROR',
          { port, statusCode: response.status }
        );
      }

      logger.info(`[OpenCodeClient:${port}] 提示已發送到 Session ${sessionId}`);
    } catch (error) {
      if (error instanceof OpenCodeError) {
        throw error;
      }
      throw new OpenCodeError(
        `網路錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`,
        'NETWORK_ERROR',
        { port }
      );
    }
  }

  /**
   * 發送工具審批結果
   * @param port 連接埠號
   * @param sessionId OpenCode Session ID
   * @param requestId 請求 ID (Discord message ID)
   * @param approved 是否批准
   * @throws {OpenCodeError} 伺服器未運行或 API 錯誤
   */
  async sendToolApproval(
    port: number,
    sessionId: string,
    requestId: string,
    approved: boolean
  ): Promise<void> {
    // 檢查伺服器是否運行
    if (!(await this.isServerRunning(port))) {
      throw new OpenCodeError(
        `伺服器未運行於端口 ${port}`,
        'SERVER_NOT_RUNNING',
        { port }
      );
    }

    const url = `${this.getBaseUrl(port)}/sessions/${sessionId}/approvals/${requestId}`;
    logger.info(`[OpenCodeClient:${port}] 發送審批結果: ${approved} to Session ${sessionId}, request ${requestId}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify({ approved }),
        signal: AbortSignal.timeout(TIMEOUTS.HTTP),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new OpenCodeError(
          `發送審批結果失敗: ${response.status} ${response.statusText} - ${errorText}`,
          'API_ERROR',
          { port, statusCode: response.status }
        );
      }

      logger.info(`[OpenCodeClient:${port}] 審批結果已發送到 Session ${sessionId}`);
    } catch (error) {
      if (error instanceof OpenCodeError) {
        throw error;
      }
      throw new OpenCodeError(
        `網路錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`,
        'NETWORK_ERROR',
        { port }
      );
    }
  }

  /**
   * 等待健康檢查通過
   * @param port 連接埠號
   * @throws {OpenCodeError} 健康檢查超時
   */
  private async waitForHealthCheck(port: number): Promise<void> {
    for (let attempt = 1; attempt <= HEALTH_CHECK_MAX_RETRIES; attempt++) {
      logger.debug(`[OpenCodeClient:${port}] 健康檢查嘗試 ${attempt}/${HEALTH_CHECK_MAX_RETRIES}`);

      // 等待間隔
      if (attempt > 1) {
        await new Promise((resolve) => setTimeout(resolve, HEALTH_CHECK_RETRY_INTERVAL));
      }

      if (await this.isServerRunning(port)) {
        logger.debug(`[OpenCodeClient:${port}] 健康檢查通過`);
        return;
      }
    }

    throw new OpenCodeError(
      `健康檢查超時（${HEALTH_CHECK_MAX_RETRIES} 次嘗試）`,
      'TIMEOUT',
      { port }
    );
  }

  /**
   * 獲取所有運行的伺服器端口
   * @returns 端口列表
   */
  getActiveServers(): number[] {
    return Array.from(this.serverProcesses.keys());
  }

  /**
   * 清理所有伺服器
   */
  async cleanupAll(): Promise<void> {
    // 停止垃圾回收機制
    this.stopGarbageCollection();
    
    const ports = this.getActiveServers();
    logger.info(`[OpenCodeClient] 清理 ${ports.length} 個活躍伺服器...`);
    
    // 使用 Promise.allSettled 確保所有都嘗試關閉
    const results = await Promise.allSettled(
      ports.map((port) => this.stopServer(port))
    );
    
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      logger.error(`[OpenCodeClient] ${failed.length} 個伺服器關閉失敗`);
    }
    
    logger.info('[OpenCodeClient] 清理完成');
  }

  /**
   * 銷毀客戶端實例
   * @description 清理所有資源，包括停止 GC
   */
  async destroy(): Promise<void> {
    await this.cleanupAll();
  }

  /**
   * 設定 Provider 認證
   * @description 向 OpenCode 伺服器設定特定 Provider 的 API Key
   * @param port 連接埠號
   * @param providerId Provider ID (如: opencode-go, anthropic, openai 等)
   * @param apiKey API Key
   */
  async setProviderAuth(port: number, providerId: string, apiKey: string): Promise<void> {
    // 檢查伺服器是否運行
    if (!(await this.isServerRunning(port))) {
      throw new OpenCodeError(
        `伺服器未運行於端口 ${port}`,
        'SERVER_NOT_RUNNING',
        { port }
      );
    }

    const url = `${this.getBaseUrl(port)}/api/auth/${providerId}`;
    logger.info(`[OpenCodeClient:${port}] 設定 Provider 認證: ${providerId}`);

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify({ apiKey }),
        signal: AbortSignal.timeout(TIMEOUTS.HTTP),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`[OpenCodeClient:${port}] 設定 Provider 認證失敗: ${response.status} ${response.statusText} - ${errorText}`);
        // 不拋出錯誤，只是記錄警告
        return;
      }

      logger.info(`[OpenCodeClient:${port}] Provider 認證已設定: ${providerId}`);
    } catch (error) {
      if (error instanceof OpenCodeError) {
        throw error;
      }
      logger.warn(`[OpenCodeClient:${port}] 設定 Provider 認證時發生錯誤:`, error instanceof Error ? error.message : '未知錯誤');
      // 不拋出錯誤，只是記錄警告
    }
  }
}

// ============== 單例實例 ==============

let openCodeClientInstance: OpenCodeClient | null = null;

/**
 * 獲取 OpenCodeClient 單例實例
 */
export function getOpenCodeClient(): OpenCodeClient {
  if (!openCodeClientInstance) {
    openCodeClientInstance = new OpenCodeClient();
  }
  return openCodeClientInstance;
}

/**
 * 初始化 OpenCodeClient
 */
export function initializeOpenCodeClient(): OpenCodeClient {
  openCodeClientInstance = new OpenCodeClient();
  return openCodeClientInstance;
}

// ============== 導出 ==============

export default {
  OpenCodeClient,
  OpenCodeError,
  getOpenCodeClient,
  initializeOpenCodeClient,
};