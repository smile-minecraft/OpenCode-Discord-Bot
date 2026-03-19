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
 * Provider 认证参数
 */
export interface SetProviderAuthParams {
  /** Provider ID */
  providerId: string;
  /** API Key */
  apiKey: string;
  /** 认证类型 */
  type?: 'apiKey' | 'http';
  /** 认证方式 */
  scheme?: 'basic' | 'bearer';
  /** 认证位置 */
  in?: 'header' | 'query' | 'cookie';
}

/**
 * Provider 模型信息（来自 SDK）
 */
export interface SDKModelInfo {
  id: string;
  cost: {
    input: number;
    output: number;
  };
}

/**
 * Provider 信息（来自 SDK）
 */
export interface SDKProviderInfo {
  id: string;
  models: SDKModelInfo[];
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
  /** 健康檢查定時器 */
  private healthCheckInterval: NodeJS.Timeout | null = null;
  /** 健康檢查間隔（毫秒） */
  private readonly HEALTH_CHECK_INTERVAL = 30000;

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
      this.port = options.port ?? 4096;
      
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
      
      // 啟動健康檢查
      this.startHealthCheck();
      
      return this.port;
    }

    // 本地模式：啟動伺服器
    // 使用固定端口 4096
    this.port = options.port ?? 4096;
    
    // 啟動伺服器
    await this.processManager.startServer(
      options.projectPath,
      this.port
    );

    // 初始化 SDK 客戶端
    this.client = createOpencodeClient({
      baseUrl: this.processManager.getBaseUrl(this.port),
    });

    // 啟動健康檢查
    this.startHealthCheck();
    
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
   * 檢查適配器是否已初始化
   */
  public isInitialized(): boolean {
    return this.client !== null && this.port !== null;
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
   * 啟動健康檢查
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval) return;
    this.healthCheckInterval = setInterval(async () => {
      const isHealthy = await this.checkHealth();
      if (!isHealthy) {
        logger.warn('[OpenCodeSDKAdapter] 健康檢查失敗');
      }
    }, this.HEALTH_CHECK_INTERVAL);
    this.healthCheckInterval.unref();
    logger.info('[OpenCodeSDKAdapter] 健康檢查已啟動');
  }

  /**
   * 停止健康檢查
   */
  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
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
      // SDK 返回 Promise<ServerSentEventsResult>，AsyncGenerator 在 result.stream 中
      const result = await client.event.subscribe();
      
      // 啟動 Adapter - 使用 as unknown as 進行類型轉換（SDK 類型複雜）
      adapter.start(result.stream as unknown as AsyncIterable<SDKEvent>, sessionId);
      
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
    // 停止健康檢查
    this.stopHealthCheck();
    
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
      
      // 檢查 SDK 返回的錯誤
      if (result.error) {
        throw this.mapSDKError(result.error, '創建 Session 失敗');
      }
      
      // Cast to any first to access id, then return properly typed
      const session = result.data as unknown as { id: string };
      logger.info(`[OpenCodeSDKAdapter] Session 創建成功: ${session.id}`);
      return session as Session;
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
   * 發送問題答案
   * @param params 問題答案參數
   * @throws {SDKAdapterError} 發送失敗
   */
  public async sendQuestionAnswer(params: { sessionId: string; questionId: string; answers: string[] }): Promise<void> {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      throw new SDKAdapterError('伺服器未運行', 'SERVER_NOT_RUNNING');
    }

    try {
      // 根據 SDK v2 的結構，API 路徑應該是 /question/{requestID}/reply
      // 這裡我們直接使用 fetch 調用 REST API
      const response = await fetch(`${baseUrl}/question/${params.questionId}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          answers: params.answers.map(value => ({ label: value, value }))
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      logger.info(`[OpenCodeSDKAdapter] 答案已發送到問題 ${params.questionId}`);
    } catch (error) {
      logger.error('[OpenCodeSDKAdapter] 發送問題答案失敗:', error);
      throw this.mapSDKError(error, '發送問題答案失敗');
    }
  }

  /**
   * 获取可用 Provider 和模型列表
   * @returns Provider 数组
   * @throws {SDKAdapterError} 获取失败
   */
  public async getProviders(): Promise<SDKProviderInfo[]> {
    const client = this.getClient();
    
    try {
      const response = await client.config.providers();

      const rawProviders = (response as any).data?.providers;
      const providers = this.normalizeProviderResponse(rawProviders);
      logger.info(`[OpenCodeSDKAdapter] Providers loaded: ${providers.length}`);

      return providers;
    } catch (error) {
      logger.error('[OpenCodeSDKAdapter] 获取 providers 失败:', error);
      throw this.mapSDKError(error, '获取 Provider 列表失败');
    }
  }

  /**
   * 正規化 providers 響應結構（兼容 array/object）
   */
  private normalizeProviderResponse(rawProviders: unknown): SDKProviderInfo[] {
    if (!rawProviders) {
      return [];
    }

    const providers: SDKProviderInfo[] = [];

    // 結構 1: providers 是陣列
    if (Array.isArray(rawProviders)) {
      for (const providerData of rawProviders) {
        if (!providerData || typeof providerData !== 'object') continue;
        const providerRecord = providerData as Record<string, unknown>;
        const providerId = String(
          providerRecord.id
          ?? providerRecord.providerID
          ?? providerRecord.name
          ?? 'opencode'
        );
        const models = this.normalizeProviderModels(providerRecord.models);
        providers.push({ id: providerId, models });
      }
      return providers;
    }

    // 結構 2: providers 是物件（key 為 provider id）
    if (typeof rawProviders === 'object') {
      for (const [providerKey, providerData] of Object.entries(rawProviders as Record<string, unknown>)) {
        const providerRecord = providerData && typeof providerData === 'object'
          ? (providerData as Record<string, unknown>)
          : {};
        const providerId = String(providerRecord.id ?? providerRecord.providerID ?? providerKey);
        const models = this.normalizeProviderModels(providerRecord.models);
        providers.push({ id: providerId, models });
      }
    }

    return providers;
  }

  /**
   * 正規化 provider models（兼容 array/object）
   */
  private normalizeProviderModels(rawModels: unknown): SDKModelInfo[] {
    if (!rawModels) {
      return [];
    }

    // models 為陣列
    if (Array.isArray(rawModels)) {
      return rawModels
        .map((model) => {
          if (!model || typeof model !== 'object') return null;
          const record = model as Record<string, unknown>;
          const modelId = record.id ?? record.modelID ?? record.name;
          if (typeof modelId !== 'string' || modelId.trim() === '') return null;
          const cost = record.cost && typeof record.cost === 'object'
            ? (record.cost as Record<string, unknown>)
            : {};
          return {
            id: modelId,
            cost: {
              input: typeof cost.input === 'number' ? cost.input : 0,
              output: typeof cost.output === 'number' ? cost.output : 0,
            },
          };
        })
        .filter((model): model is SDKModelInfo => model !== null);
    }

    // models 為物件
    if (typeof rawModels === 'object') {
      return Object.entries(rawModels as Record<string, unknown>).map(([modelId, modelInfo]) => {
        const info = modelInfo && typeof modelInfo === 'object'
          ? (modelInfo as Record<string, unknown>)
          : {};
        const cost = info.cost && typeof info.cost === 'object'
          ? (info.cost as Record<string, unknown>)
          : {};
        return {
          id: modelId,
          cost: {
            input: typeof cost.input === 'number' ? cost.input : 0,
            output: typeof cost.output === 'number' ? cost.output : 0,
          },
        };
      });
    }

    return [];
  }

  /**
   * 映射 SDK 錯誤到適配器錯誤
   * @param error SDK 錯誤
   * @param fallbackMessage 預設錯誤訊息
   * @returns SDKAdapterError
   */
  private mapSDKError(error: unknown, fallbackMessage: string): SDKAdapterError {
    // 首先檢查 SDK 的結構化錯誤類型
    if (error && typeof error === 'object') {
      // 檢查 statusCode 屬性（SDK 的 ApiError）
      if ('statusCode' in error || 'status' in error) {
        const statusCode = (error as { statusCode?: number; status?: number }).statusCode 
          || (error as { statusCode?: number; status?: number }).status;
        
        switch (statusCode) {
          case 404:
            return new SDKAdapterError(`${fallbackMessage}: 資源不存在`, 'NOT_FOUND');
          case 401:
          case 403:
            return new SDKAdapterError(`${fallbackMessage}: 認證失敗`, 'UNAUTHORIZED');
          case 429:
            return new SDKAdapterError(`${fallbackMessage}: 請求過於頻繁`, 'RATE_LIMIT');
          case 408:
            return new SDKAdapterError(`${fallbackMessage}: 請求逾時`, 'TIMEOUT');
          case 500:
          case 502:
          case 503:
          case 504:
            return new SDKAdapterError(`${fallbackMessage}: 伺服器錯誤`, 'CONNECTION_ERROR');
        }
      }
    }
    
    // 回退到字串匹配用於非結構化錯誤
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

/**
 * 获取已初始化的 SDK 适配器实例
 * @throws {SDKAdapterError} 适配器未初始化
 */
export function getInitializedSDKAdapter(): OpenCodeSDKAdapter {
  const instance = sdkAdapterInstance;
  if (!instance || !instance.isInitialized()) {
    throw new SDKAdapterError(
      'SDK 适配器未初始化，请先调用 initializeOpenCodeSDKAdapter()',
      'NOT_INITIALIZED'
    );
  }
  return instance;
}

// ============== 導出 =============

export default {
  OpenCodeSDKAdapter,
  SDKAdapterError,
  getOpenCodeSDKAdapter,
  initializeOpenCodeSDKAdapter,
};
