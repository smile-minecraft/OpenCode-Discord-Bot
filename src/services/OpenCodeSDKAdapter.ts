/**
 * OpenCode SDK Adapter - SDK 客戶端適配器
 * @description 封裝 @opencode-ai/sdk 的 OpencodeClient 客戶端，提供統一的健康檢查和連接管理
 */

import { createOpencodeClient, OpencodeClient, Session } from '@opencode-ai/sdk';
import logger from '../utils/logger.js';
import { getProcessManager, ProcessManager } from './ProcessManager.js';
import { TIMEOUTS } from '../config/constants.js';
import { SSEEventEmitterAdapter, SDKEvent } from './SSEEventEmitterAdapter.js';

// ============== 類型定義 ==============

/**
 * SDK 適配器配置選項
 */
export interface SDKAdapterOptions {
  /** 專案路徑 */
  projectPath: string;
  /** 端口號（可選，不提供則自動分配） */
  port?: number;
  /** API Key（可選） */
  apiKey?: string;
}

/**
 * 適配器錯誤
 */
export class SDKAdapterError extends Error {
  code: 'NOT_INITIALIZED' | 'SERVER_NOT_RUNNING' | 'SDK_ERROR' | 'TIMEOUT' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'RATE_LIMIT' | 'CONNECTION_ERROR';

  constructor(message: string, code: SDKAdapterError['code']) {
    super(message);
    this.name = 'SDKAdapterError';
    this.code = code;
  }
}

/**
 * Session 創建參數
 */
export interface CreateSessionParams {
  /** 目錄路徑 */
  directory?: string;
  /** 父 Session ID（用於分叉） */
  parentID?: string;
  /** Session 標題 */
  title?: string;
}

/**
 * Session 訊息參數
 */
export interface SendPromptParams {
  /** Session ID */
  sessionId: string;
  /** 訊息內容 */
  prompt: string;
  /** 模型 ID */
  model?: {
    providerID: string;
    modelID: string;
  };
  /** Agent 名稱 */
  agent?: string;
  /** 系統訊息 */
  system?: string;
  /** 工具配置 */
  tools?: Record<string, boolean>;
}

/**
 * Tool 審批參數
 */
export interface SendToolApprovalParams {
  /** Session ID */
  sessionId: string;
  /** 請求 ID */
  requestId: string;
  /** 審批回應 */
  approved: boolean;
  /** 是否永久批准 */
  always?: boolean;
}

/**
 * Provider 認證參數
 */
export interface SetProviderAuthParams {
  /** Provider ID */
  providerId: string;
  /** API Key */
  apiKey: string;
  /** 認證類型 */
  type?: 'apiKey' | 'http';
  /** 認證方式 */
  scheme?: 'basic' | 'bearer';
  /** 認證位置 */
  in?: 'header' | 'query' | 'cookie';
}

// ============== OpenCodeSDKAdapter 類別 =============

/**
 * OpenCode SDK 適配器
 * @description 單例服務，封裝 @opencode-ai/sdk 提供更高層次的抽象
 */
export class OpenCodeSDKAdapter {
  /** SDK 客戶端實例 */
  private client: OpencodeClient | null = null;
  /** 當前使用的端口 */
  private port: number | null = null;
  /** 外部服務 URL */
  private externalUrl: string | null = null;
  /** ProcessManager 實例 */
  private processManager: ProcessManager;

  /**
   * 創建 OpenCodeSDKAdapter 實例
   */
  constructor() {
    this.processManager = getProcessManager();
    
    // 檢查是否配置了外部服務
    this.externalUrl = process.env.OPENCODE_API_URL || null;
    
    logger.info('[OpenCodeSDKAdapter] 初始化完成');
  }

  /**
   * 初始化 SDK 適配器
   * @param options 配置選項
   */
  public async initialize(options: SDKAdapterOptions): Promise<number> {
    // 如果使用外部服務
    if (this.externalUrl) {
      logger.info(`[OpenCodeSDKAdapter] 使用外部 OpenCode 服務: ${this.externalUrl}`);
      this.port = options.port ?? 3000;
      
      // 檢查外部服務是否可用
      const isRunning = await this.checkHealth(this.port);
      if (!isRunning) {
        throw new SDKAdapterError(
          `外部服務 ${this.externalUrl} 不可用`,
          'SERVER_NOT_RUNNING'
        );
      }
      
      // 使用外部 URL 初始化 SDK
      this.client = createOpencodeClient({
        baseUrl: this.externalUrl,
      });
      
      return this.port;
    }

    // 本地模式：啟動伺服器
    this.port = await this.processManager.startServer(
      options.projectPath,
      options.port
    );

    // 初始化 SDK 客戶端
    this.client = createOpencodeClient({
      baseUrl: this.processManager.getBaseUrl(this.port),
    });

    logger.info(`[OpenCodeSDKAdapter] SDK 適配器已初始化，端口: ${this.port}`);
    return this.port;
  }

  /**
   * 獲取 SDK 客戶端實例
   * @throws {SDKAdapterError} 適配器未初始化
   */
  public getClient(): OpencodeClient {
    if (!this.client) {
      throw new SDKAdapterError(
        'SDK 適配器未初始化，請先調用 initialize()',
        'NOT_INITIALIZED'
      );
    }
    return this.client;
  }

  /**
   * 檢查伺服器健康狀態
   * @param port 端口號（可選，使用當前端口）
   * @returns 是否健康
   */
  public async checkHealth(port?: number): Promise<boolean> {
    const targetPort = port ?? this.port;
    
    if (!targetPort) {
      return false;
    }
    
    return this.processManager.isServerRunning(targetPort);
  }

  /**
   * 等待伺服器就緒
   * @param port 端口號（可選）
   * @throws {SDKAdapterError} 健康檢查超時
   */
  public async waitForReady(port?: number): Promise<void> {
    const targetPort = port ?? this.port;
    
    if (!targetPort) {
      throw new SDKAdapterError('未指定端口', 'SERVER_NOT_RUNNING');
    }

    const maxAttempts = 10;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      logger.debug(`[OpenCodeSDKAdapter:${targetPort}] 健康檢查嘗試 ${attempt}/${maxAttempts}`);
      
      if (await this.checkHealth(targetPort)) {
        logger.debug(`[OpenCodeSDKAdapter:${targetPort}] 伺服器已就緒`);
        return;
      }
      
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.HEALTH_CHECK));
      }
    }

    throw new SDKAdapterError(
      `健康檢查超時（${maxAttempts} 次嘗試）於端口 ${targetPort}`,
      'TIMEOUT'
    );
  }

  /**
   * 獲取當前端口
   */
  public getPort(): number | null {
    return this.port;
  }

  /**
   * 獲取基礎 URL
   */
  public getBaseUrl(): string | null {
    if (!this.port) {
      return null;
    }
    return this.processManager.getBaseUrl(this.port);
  }

  /**
   * 檢查是否使用外部服務
   */
  public isExternal(): boolean {
    return this.externalUrl !== null;
  }

  /**
   * 訂閱 Session 事件
   * @param sessionId Session ID
   * @returns SSEEventEmitterAdapter 實例
   * @throws {SDKAdapterError} 適配器未初始化
   */
  public async subscribeToEvents(sessionId: string): Promise<SSEEventEmitterAdapter> {
    const client = this.getClient();
    
    // 創建新的 Adapter 實例
    const adapter = new SSEEventEmitterAdapter();
    
    try {
      // 調用 SDK 的 event.subscribe() 方法
      // SDK 返回 Promise<ServerSentEventsResult>，需要 await
      const eventStream = await client.event.subscribe();
      
      // 啟動 Adapter
      adapter.start(eventStream as unknown as AsyncIterable<SDKEvent>, sessionId);
      
      logger.info(`[OpenCodeSDKAdapter] 已訂閱事件, sessionId: ${sessionId}`);
      
      return adapter;
    } catch (error) {
      logger.error('[OpenCodeSDKAdapter] 訂閱事件失敗:', error);
      adapter.dispose();
      throw new SDKAdapterError(
        `訂閱事件失敗: ${error instanceof Error ? error.message : '未知錯誤'}`,
        'SDK_ERROR'
      );
    }
  }

  /**
   * 清理資源
   */
  public async cleanup(): Promise<void> {
    if (this.port && !this.isExternal()) {
      await this.processManager.stopServer(this.port);
    }
    
    this.client = null;
    this.port = null;
    
    logger.info('[OpenCodeSDKAdapter] 資源已清理');
  }

  /**
   * 銷毀適配器
   */
  public async destroy(): Promise<void> {
    await this.cleanup();
  }

  /**
   * 創建 Session
   * @param params Session 創建參數
   * @returns 創建的 Session 資訊
   * @throws {SDKAdapterError} 創建失敗
   */
  public async createSession(params: CreateSessionParams): Promise<Session> {
    const client = this.getClient();
    
    try {
      const result = await client.session.create({
        body: {
          parentID: params.parentID,
          title: params.title,
        },
        query: {
          directory: params.directory,
        },
      });
      
      logger.info(`[OpenCodeSDKAdapter] Session 創建成功: ${result.data?.id}`);
      return result.data as Session;
    } catch (error) {
      throw this.mapSDKError(error, '創建 Session 失敗');
    }
  }

  /**
   * 發送提示到 Session
   * @param params 發送提示參數
   * @throws {SDKAdapterError} 發送失敗
   */
  public async sendPrompt(params: SendPromptParams): Promise<void> {
    const client = this.getClient();
    
    try {
      await client.session.prompt({
        path: {
          id: params.sessionId,
        },
        body: {
          parts: [
            {
              type: 'text',
              text: params.prompt,
            },
          ],
          model: params.model,
          agent: params.agent,
          system: params.system,
          tools: params.tools,
        },
      });
      
      logger.info(`[OpenCodeSDKAdapter] 提示已發送到 Session ${params.sessionId}`);
    } catch (error) {
      throw this.mapSDKError(error, '發送提示失敗');
    }
  }

  /**
   * 發送工具審批結果
   * @param params 工具審批參數
   * @throws {SDKAdapterError} 發送失敗
   */
  public async sendToolApproval(params: SendToolApprovalParams): Promise<void> {
    const client = this.getClient();
    
    try {
      const response = params.approved 
        ? (params.always ? 'always' : 'once')
        : 'reject';
      
      await client.postSessionIdPermissionsPermissionId({
        path: {
          id: params.sessionId,
          permissionID: params.requestId,
        },
        body: {
          response: response as 'once' | 'always' | 'reject',
        },
      });
      
      logger.info(`[OpenCodeSDKAdapter] 審批結果已發送到 Session ${params.sessionId}`);
    } catch (error) {
      throw this.mapSDKError(error, '發送工具審批失敗');
    }
  }

  /**
   * 設置 Provider 認證
   * @param params Provider 認證參數
   * @throws {SDKAdapterError} 設置失敗
   */
  public async setProviderAuth(params: SetProviderAuthParams): Promise<void> {
    const client = this.getClient();
    
    try {
      await client.auth.set({
        path: {
          id: params.providerId,
        },
        body: {
          type: 'api',
          key: params.apiKey,
        },
      });
      
      logger.info(`[OpenCodeSDKAdapter] Provider 認證已設置: ${params.providerId}`);
    } catch (error) {
      throw this.mapSDKError(error, '設置 Provider 認證失敗');
    }
  }

  /**
   * 映射 SDK 錯誤到適配器錯誤
   * @param error SDK 錯誤
   * @param fallbackMessage 預設錯誤訊息
   * @returns SDKAdapterError
   */
  private mapSDKError(error: unknown, fallbackMessage: string): SDKAdapterError {
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      
      // 404 Not Found
      if (errorMessage.includes('404') || errorMessage.includes('not found')) {
        return new SDKAdapterError(
          `${fallbackMessage}: 資源不存在`,
          'NOT_FOUND'
        );
      }
      
      // 401 Unauthorized
      if (errorMessage.includes('401') || errorMessage.includes('unauthorized') || errorMessage.includes('authentication')) {
        return new SDKAdapterError(
          `${fallbackMessage}: 認證失敗`,
          'UNAUTHORIZED'
        );
      }
      
      // 429 Rate Limit
      if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
        return new SDKAdapterError(
          `${fallbackMessage}: 請求過於頻繁`,
          'RATE_LIMIT'
        );
      }
      
      // Timeout
      if (errorMessage.includes('timeout') || errorMessage.includes('etimedout')) {
        return new SDKAdapterError(
          `${fallbackMessage}: 請求逾時`,
          'TIMEOUT'
        );
      }
      
      // Connection Error
      if (errorMessage.includes('connection') || errorMessage.includes('econnrefused') || errorMessage.includes('enotfound')) {
        return new SDKAdapterError(
          `${fallbackMessage}: 連線失敗`,
          'CONNECTION_ERROR'
        );
      }
      
      return new SDKAdapterError(
        `${fallbackMessage}: ${error.message}`,
        'SDK_ERROR'
      );
    }
    
    return new SDKAdapterError(fallbackMessage, 'SDK_ERROR');
  }
}

// ============== 單例實例 =============

let sdkAdapterInstance: OpenCodeSDKAdapter | null = null;

/**
 * 獲取 OpenCodeSDKAdapter 單例實例
 */
export function getOpenCodeSDKAdapter(): OpenCodeSDKAdapter {
  if (!sdkAdapterInstance) {
    sdkAdapterInstance = new OpenCodeSDKAdapter();
  }
  return sdkAdapterInstance;
}

/**
 * 初始化 OpenCodeSDKAdapter
 */
export function initializeOpenCodeSDKAdapter(): OpenCodeSDKAdapter {
  sdkAdapterInstance = new OpenCodeSDKAdapter();
  return sdkAdapterInstance;
}

// ============== 導出 =============

export default {
  OpenCodeSDKAdapter,
  SDKAdapterError,
  getOpenCodeSDKAdapter,
  initializeOpenCodeSDKAdapter,
};
