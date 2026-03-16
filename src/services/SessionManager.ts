/**
 * Session 管理服務
 * @description 管理 OpenCode Session 生命週期，使用本地 OpenCode 伺服器
 * 
 * 支援兩種適配器:
 * - 舊版 OpenCodeClient (預設)
 * - 新版 OpenCodeSDKAdapter (當 FEATURE_FLAGS.USE_SDK_ADAPTER=true 時使用)
 */

import path from 'path';
import os from 'os';
import { Session, SessionStatus, SessionMetadata } from '../database/models/Session.js';
import { v4 as uuidv4 } from 'uuid';
import { SQLiteDatabase } from '../database/SQLiteDatabase.js';
import logger from '../utils/logger.js';
import { ProviderService } from './ProviderService.js';
import { PROVIDERS, type OpenCodeProviderType } from './OpenCodeCloudClient.js';
import { MODEL_CONFIG, OPENCODE_SERVER, FEATURE_FLAGS } from '../config/constants.js';

// 導入舊版和新版適配器
import { OpenCodeClient as LegacyOpenCodeClient, getOpenCodeClient as getLegacyOpenCodeClient } from './deprecated/OpenCodeClient.js';
import { getOpenCodeSDKAdapter, OpenCodeSDKAdapter } from './OpenCodeSDKAdapter.js';

// ============== 類型定義 ==============

/**
 * Session 創建選項
 */
export interface CreateSessionOptions {
  /** Discord 頻道 ID */
  channelId: string;
  /** Discord Guild ID */
  guildId: string;
  /** 用戶 ID */
  userId: string;
  /** 初始提示詞 */
  prompt: string;
  /** 使用的模型 */
  model?: string;
  /** 使用的 Agent */
  agent?: string;
  /** 專案路徑 */
  projectPath?: string;
}

/**
 * Session 執行結果
 */
export interface SessionExecutionResult {
  /** 是否成功 */
  success: boolean;
  /** Session 實例 */
  session: Session;
  /** 錯誤訊息（如有） */
  error?: string;
}

// ============== Session 管理器 ==============

/**
 * Session 管理器類
 * @description 負責管理 OpenCode Session 的生命週期，使用本地 OpenCode 伺服器
 */
export class SessionManager {
  /** 活躍的 Session 映射 */
  private activeSessions: Map<string, Session> = new Map();
  /** 頻道 ID 到 Session ID 集合的映射（用於快速查詢） */
  private channelSessions: Map<string, Set<string>> = new Map();
  /** Provider Service 實例 */
  private providerService: ProviderService;
  /** SQLite 資料庫實例 */
  private sqliteDb: SQLiteDatabase;
  
  // 根據 Feature Flag 選擇適配器
  /** 舊版 OpenCode Client（當 USE_SDK_ADAPTER=false 時使用） */
  private legacyClient!: LegacyOpenCodeClient;
  /** 新版 SDK Adapter（當 USE_SDK_ADAPTER=true 時使用） */
  private sdkAdapter!: OpenCodeSDKAdapter;
  /** 當前是否使用 SDK Adapter */
  private readonly useSDKAdapter: boolean;
  /** 預設模型 */
  private readonly defaultModel = MODEL_CONFIG.DEFAULT;
  /** 預設 Agent */
  private readonly defaultAgent = 'general';
  /** 預設端口範圍開始 */
  private readonly portRangeStart = OPENCODE_SERVER.PORT_RANGE_START;
  /** 預設端口範圍結束 */
  private readonly portRangeEnd = OPENCODE_SERVER.PORT_RANGE_END;
  /** 當前分配的端口 */
  private allocatedPorts: Set<number> = new Set();
  /** 頻道 ID 到端口的映射 */
  private channelPortMap: Map<string, number> = new Map();
  /** 端口分配鎖（用於防止 Race Condition） */
  private portAllocationLock: Map<string, Promise<number>> = new Map();

  /**
   * 創建 Session 管理器實例
   */
  constructor() {
    this.providerService = ProviderService.getInstance();
    this.sqliteDb = SQLiteDatabase.getInstance();
    
    // 根據 Feature Flag 選擇適配器
    this.useSDKAdapter = FEATURE_FLAGS.USE_SDK_ADAPTER;
    
    if (this.useSDKAdapter) {
      this.sdkAdapter = getOpenCodeSDKAdapter();
      logger.info('[SessionManager] 使用 SDK Adapter (USE_SDK_ADAPTER=true)');
    } else {
      this.legacyClient = getLegacyOpenCodeClient();
      logger.info('[SessionManager] 使用舊版 Client (USE_SDK_ADAPTER=false)');
    }

    // 注意：SQLite 資料庫應該在應用啟動時由 bot/index.ts 初始化
    // 這裡只檢查狀態，不負責初始化
    if (!this.sqliteDb.isReady()) {
      logger.warn('[SessionManager] SQLite 資料庫尚未初始化，某些功能可能無法正常工作');
    }
  }

  /**
   * 分配可用端口
   * @param channelId - Discord 頻道 ID
   * @returns 分配的端口號
   */
  async allocatePort(channelId: string): Promise<number> {
    // 檢查是否已經為此頻道分配了端口
    const existingPort = this.channelPortMap.get(channelId);
    if (existingPort && !this.allocatedPorts.has(existingPort)) {
      // 端口可能被釋放了，重新分配
      this.channelPortMap.delete(channelId);
    } else if (existingPort) {
      logger.debug(`[SessionManager] 重用現有端口: ${existingPort} for channel: ${channelId}`);
      return existingPort;
    }

    // 使用全域鎖防止 Race Condition - 確保所有頻道的端口分配串行化
    const lockKey = 'global:portAllocation';
    const existingLock = this.portAllocationLock.get(lockKey);
    if (existingLock) {
      logger.debug(`[SessionManager] 等待現有端口分配完成 for channel: ${channelId}`);
      return existingLock.then(() => {
        // 等待完成後，重新檢查是否有可用的端口
        return this.allocatePort(channelId);
      });
    }

    // 創建分配Promise並設置全域鎖
    const allocationPromise = this.doAllocatePort(channelId);
    this.portAllocationLock.set(lockKey, allocationPromise);

    try {
      const port = await allocationPromise;
      return port;
    } finally {
      this.portAllocationLock.delete(lockKey);
    }
  }

  /**
   * 執行實際的端口分配
   * @param channelId - Discord 頻道 ID
   * @returns 分配的端口號
   */
  private async doAllocatePort(channelId: string): Promise<number> {
    // 查找可用端口
    for (let port = this.portRangeStart; port <= this.portRangeEnd; port++) {
      if (!this.allocatedPorts.has(port)) {
        // 檢查端口是否已被佔用
        try {
          const isRunning = await this.checkServerRunning(port);
          if (isRunning) {
            continue; // 端口已被佔用
          }
        } catch {
          // 如果檢查失敗，假設端口可用
        }

        this.allocatedPorts.add(port);
        this.channelPortMap.set(channelId, port);
        logger.debug(`[SessionManager] 分配端口: ${port} for channel: ${channelId}`);
        return port;
      }
    }
    throw new Error('沒有可用的埠號');
  }

  /**
   * 釋放端口
   * @param port - 要釋放的端口號
   * @param channelId - 可選的頻道 ID，用於清除映射
   */
  private releasePort(port: number, channelId?: string): void {
    this.allocatedPorts.delete(port);
    // 如果提供了 channelId，則清除映射
    if (channelId) {
      this.channelPortMap.delete(channelId);
    } else {
      // 否則遍歷找到對應的 channelId
      for (const [ch, p] of this.channelPortMap.entries()) {
        if (p === port) {
          this.channelPortMap.delete(ch);
          break;
        }
      }
    }
    logger.debug(`[SessionManager] 釋放端口: ${port}`);
  }

  /**
   * 創建新 Session
   */
  async createSession(options: CreateSessionOptions): Promise<Session> {
    const sessionId = this.generateSessionId();
    const guildId = options.guildId;

    // 創建 Session 實例
    const session = new Session({
      sessionId,
      channelId: options.channelId,
      userId: options.userId,
      status: 'pending',
      prompt: options.prompt,
      model: options.model || this.defaultModel,
      agent: options.agent || this.defaultAgent,
      projectPath: options.projectPath || this.getDefaultProjectPath(options.channelId),
    });

    // 標記為啟動中
    session.start(sessionId, session.model, session.agent);

    // 註冊到活動列表
    this.activeSessions.set(sessionId, session);

    // 更新頻道索引
    const channelSessionSet = this.channelSessions.get(options.channelId) || new Set();
    channelSessionSet.add(sessionId);
    this.channelSessions.set(options.channelId, channelSessionSet);

    let port: number | undefined;

    try {
      // 1. 分配端口
      port = await this.allocatePort(options.channelId);

      // 2. 啟動 OpenCode 伺服器
      await this.doStartServer(session.projectPath, port);
      logger.info(`[SessionManager] OpenCode 伺服器已啟動於端口 ${port}`);

      // 3. 檢查並獲取 Provider API Key（如有）
      const model = options.model || this.defaultModel;
      const providerInfo = await this.findProviderForModel(guildId, model);

      // 4. 如果有 Provider API Key，設定認證
      if (providerInfo) {
        try {
          await this.doSetProviderAuth(port, providerInfo.providerId, providerInfo.apiKey);
          logger.info(`[SessionManager] 已設定 Provider 認證: ${providerInfo.providerId}`);
        } catch (error) {
          logger.warn(`[SessionManager] 設定 Provider 認證失敗:`, error);
          // 繼續執行，認證失敗不影響 Session 創建
        }
      }

      // 5. 創建 Session
      const openCodeSessionInfo = await this.doCreateSession(port, {
        model: session.model,
        agent: session.agent,
        projectPath: session.projectPath,
        initialPrompt: session.prompt,
      });

      // 6. 更新 Session 資訊
      session.opencodeSessionId = openCodeSessionInfo.id;
      (session.metadata as SessionMetadata & { opencodeSessionId?: string }).opencodeSessionId = openCodeSessionInfo.id;
      (session.metadata as SessionMetadata & { providerId?: string }).providerId = providerInfo?.providerId;
      (session.metadata as SessionMetadata & { port?: number }).port = port;
      session.markRunning();

      // 7. 保存到資料庫
      await this.saveSession(session);

      logger.info(`[SessionManager] Session ${sessionId} 啟動成功，OpenCode Session ID: ${openCodeSessionInfo.id}, Port: ${port}`);
    } catch (error) {
      logger.error(`[SessionManager] 啟動 Session ${sessionId} 失敗:`, error);
      
      // 清理：停止伺服器並釋放端口
      if (port) {
        try {
          await this.doStopServer(port);
        } catch {
          // 忽略停止錯誤
        }
        this.releasePort(port, options.channelId);
      }
      
      session.fail(error instanceof Error ? error.message : '未知錯誤');
    }

    return session;
  }

  /**
   * 恢復既有 Session
   */
  async resumeSession(sessionId: string): Promise<Session | null> {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      // 嘗試從持久化存儲加載
      const loadedSession = await this.loadSession(sessionId);
      if (!loadedSession) {
        return null;
      }

      // 檢查 Session 狀態
      if (loadedSession.isEnded()) {
        throw new Error(`Session ${sessionId} 已經結束，無法恢復`);
      }

      // 重新註冊到活動列表
      this.activeSessions.set(sessionId, loadedSession);
      return loadedSession;
    }

    // 檢查是否已經在運行
    if (session.isRunning()) {
      throw new Error(`Session ${sessionId} 已經在運行中`);
    }

    // 恢復 Session
    const port = (session.metadata as SessionMetadata & { port?: number })?.port;
    
    if (!port) {
      throw new Error(`Session ${sessionId} 缺少端口資訊，無法恢復`);
    }

    try {
      // 檢查伺服器是否仍在運行
      if (!(await this.checkServerRunning(port))) {
        // 嘗試重新啟動伺服器
        await this.doStartServer(session.projectPath, port);
        
        // 重新設定 Provider 認證（如有）
        const providerId = (session.metadata as SessionMetadata & { providerId?: string })?.providerId;
        if (providerId) {
          const apiKey = await this.providerService.getDecryptedApiKey(session.channelId, providerId);
          if (apiKey) {
            await this.doSetProviderAuth(port, providerId, apiKey);
          }
        }
      }

      session.resume();
      logger.info(`[SessionManager] Session ${sessionId} 恢復成功`);
    } catch (error) {
      logger.error(`[SessionManager] 恢復 Session ${sessionId} 失敗:`, error);
      session.fail(error instanceof Error ? error.message : '未知錯誤');
    }

    return session;
  }

  /**
   * 終止 Session
   */
  async abortSession(sessionId?: string): Promise<Session | null> {
    // 如果沒有指定 sessionId，嘗試獲取當前頻道的活躍 Session
    if (!sessionId) {
      const activeSession = this.getActiveSessionByChannel(sessionId || '');
      if (!activeSession) {
        return null;
      }
      sessionId = activeSession.sessionId;
    }

    const session = this.activeSessions.get(sessionId);

    if (!session) {
      return null;
    }

    // 嘗試停止 OpenCode 伺服器
    const port = (session.metadata as SessionMetadata & { port?: number })?.port;
    
    if (port) {
      try {
        await this.doStopServer(port);
        this.releasePort(port, session.channelId);
        logger.info(`[SessionManager] OpenCode 伺服器已停止於端口 ${port}`);
      } catch (error) {
        logger.warn(`[SessionManager] 停止 OpenCode 伺服器失敗:`, error);
      }
    }

    // 更新 Session 狀態
    session.abort();

    // 保存最終狀態
    await this.saveSession(session);

    // 從活動列表移除
    this.activeSessions.delete(sessionId);

    // 從頻道索引移除
    const channelSessionSet = this.channelSessions.get(session.channelId);
    if (channelSessionSet) {
      channelSessionSet.delete(sessionId);
      if (channelSessionSet.size === 0) {
        this.channelSessions.delete(session.channelId);
      }
    }

    return session;
  }

  /**
   * 列出 Sessions
   */
  async listSessions(
    channelId: string,
    status: 'all' | 'running' | 'completed' | 'aborted' | 'failed' = 'all'
  ): Promise<Session[]> {
    const sessions: Session[] = [];

    // 從活動列表過濾
    for (const [, session] of this.activeSessions) {
      if (session.channelId !== channelId) {
        continue;
      }

      if (status === 'all') {
        sessions.push(session);
      } else if (status === 'running' && session.isRunning()) {
        sessions.push(session);
      } else if (session.status === status) {
        sessions.push(session);
      }
    }

    // 按開始時間排序（最新的在前）
    sessions.sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );

    return sessions;
  }

  /**
   * 通過頻道 ID 獲取所有關聯的 Session（使用索引優化）
   */
  getSessionsByChannel(channelId: string): Session[] {
    const sessionIds = this.channelSessions.get(channelId);
    if (!sessionIds) {
      return [];
    }

    return Array.from(sessionIds)
      .map(id => this.activeSessions.get(id))
      .filter((s): s is Session => !!s);
  }

  /**
   * 獲取 Session 實例
   */
  getSession(sessionId: string): Session | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * 獲取頻道的活躍 Session
   */
  getActiveSessionByChannel(channelId: string): Session | undefined {
    for (const [, session] of this.activeSessions) {
      if (session.channelId === channelId && session.isRunning()) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * 檢查頻道是否有活躍 Session
   */
  hasActiveSession(channelId: string): boolean {
    return this.getActiveSessionByChannel(channelId) !== undefined;
  }

  /**
   * 更新 Session 狀態
   */
  updateSessionStatus(sessionId: string, status: SessionStatus): void {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      switch (status) {
        case 'running':
          session.markRunning();
          break;
        case 'waiting':
          session.markWaiting();
          break;
        case 'paused':
          session.pause();
          break;
        case 'completed':
          session.complete();
          break;
        case 'aborted':
          session.abort();
          break;
      }
    }
  }

  // ============== 私有方法 ==============

  /**
   * 生成 Session ID
   */
  private generateSessionId(): string {
    return `sess_${uuidv4().slice(0, 8)}`;
  }

  /**
   * 獲取預設專案路徑
   */
  private getDefaultProjectPath(channelId: string): string {
    // 使用可配置的專案根目錄，優先順序：環境變數 PROJECTS_ROOT > 使用者 home 目錄下的 opencode-projects
    const projectsRoot = process.env.PROJECTS_ROOT || path.join(os.homedir(), 'opencode-projects');
    return path.join(projectsRoot, channelId);
  }

  /**
   * 查找適合模型的 Provider
   * @param guildId - Guild ID
   * @param model - 模型 ID
   * @returns Provider ID 和 API Key
   */
  private async findProviderForModel(guildId: string, model: string): Promise<{ providerId: string; apiKey: string } | null> {
    const providers = await this.providerService.getProviders(guildId);
    
    // 遍歷所有 connected providers
    for (const [providerId, connection] of Object.entries(providers)) {
      if (connection.connected && connection.apiKey) {
        // 解密 API Key
        const apiKey = await this.providerService.getDecryptedApiKey(guildId, providerId);
        if (apiKey) {
          // 檢查這個 provider 是否支持這個模型
          // 簡單檢查：模型 ID 以 provider 的 modelPrefix 開頭
          const providerDef = await this.getProviderDefinition(providerId as OpenCodeProviderType);
          if (providerDef && model.startsWith(providerDef.modelPrefix.replace('/', ''))) {
            return { providerId, apiKey };
          }
          
          // 或者檢查 provider 是否在模型 ID 中
          // 例如: opencode-go/kimi-k2.5 包含 opencode-go
          if (model.includes(providerId)) {
            return { providerId, apiKey };
          }
        }
      }
    }
    
    // 如果沒有找到特定的 provider，返回第一個可用的 connected provider
    for (const [providerId, connection] of Object.entries(providers)) {
      if (connection.connected && connection.apiKey) {
        const apiKey = await this.providerService.getDecryptedApiKey(guildId, providerId);
        if (apiKey) {
          logger.info(`[SessionManager] Using provider ${providerId} as fallback for model ${model}`);
          return { providerId, apiKey };
        }
      }
    }
    
    return null;
  }

  /**
   * 獲取 Provider 定義
   */
  private async getProviderDefinition(providerId: OpenCodeProviderType): Promise<{ modelPrefix: string } | null> {
    return PROVIDERS[providerId] || null;
  }

  // ============== SDK Adapter 橋接方法 ==============

  /**
   * 檢查伺服器是否運行
   * @param port 端口號
   * @returns 是否運行中
   */
  private async checkServerRunning(port: number): Promise<boolean> {
    if (this.useSDKAdapter) {
      return this.sdkAdapter.checkHealth(port);
    } else {
      return this.legacyClient.isServerRunning(port);
    }
  }

  /**
   * 啟動 OpenCode 伺服器（內部方法）
   * @param projectPath 專案路徑
   * @param port 端口號
   */
  private async doStartServer(projectPath: string, port: number): Promise<void> {
    if (this.useSDKAdapter) {
      await this.sdkAdapter.initialize({ projectPath, port });
    } else {
      await this.legacyClient.startServer(projectPath, port);
    }
  }

  /**
   * 停止 OpenCode 伺服器（內部方法）
   * @param port 端口號
   */
  private async doStopServer(port: number): Promise<void> {
    if (this.useSDKAdapter) {
      // SDK adapter cleanup is handled differently - it cleans up its own process
      await this.sdkAdapter.cleanup();
    } else {
      await this.legacyClient.stopServer(port);
    }
  }

  /**
   * 創建 Session（內部方法）
   * @param port 端口號
   * @param options Session 創建選項
   * @returns Session 資訊
   */
  private async doCreateSession(
    port: number,
    options: {
      model: string;
      agent: string;
      projectPath: string;
      initialPrompt?: string;
    }
  ): Promise<{ id: string }> {
    if (this.useSDKAdapter) {
      const session = await this.sdkAdapter.createSession({
        directory: options.projectPath,
        title: options.initialPrompt ? options.initialPrompt.substring(0, 50) : undefined,
      });
      return { id: session.id };
    } else {
      return this.legacyClient.createSession(port, options);
    }
  }

  /**
   * 發送提示到 Session（內部方法）
   * @param port 端口號
   * @param sessionId Session ID
   * @param prompt 提示內容
   */
  private async doSendPrompt(port: number, sessionId: string, prompt: string): Promise<void> {
    if (this.useSDKAdapter) {
      await this.sdkAdapter.sendPrompt({
        sessionId,
        prompt,
      });
    } else {
      await this.legacyClient.sendPrompt(port, sessionId, prompt);
    }
  }

  /**
   * 設定 Provider 認證（內部方法）
   * @param port 端口號
   * @param providerId Provider ID
   * @param apiKey API Key
   */
  private async doSetProviderAuth(port: number, providerId: string, apiKey: string): Promise<void> {
    if (this.useSDKAdapter) {
      await this.sdkAdapter.setProviderAuth({
        providerId,
        apiKey,
      });
    } else {
      await this.legacyClient.setProviderAuth(port, providerId, apiKey);
    }
  }

  /**
   * 發送提示到 Session
   * @param sessionId Session ID
   * @param prompt 提示內容
   */
  async sendPrompt(sessionId: string, prompt: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} 不存在`);
    }
    if (!session.isRunning()) {
      throw new Error(`Session ${sessionId} 未運行`);
    }

    const opencodeSessionId = session.opencodeSessionId;
    const port = (session.metadata as SessionMetadata & { port?: number })?.port;

    if (!opencodeSessionId || !port) {
      throw new Error('Session 資訊不完整');
    }

    try {
      await this.doSendPrompt(port, opencodeSessionId, prompt);
      session.updateActivity();
    } catch (error) {
      throw error;
    }
  }

  /**
   * 從持久化存儲加載 Session
   */
  private async loadSession(sessionId: string): Promise<Session | null> {
    try {
      if (!this.sqliteDb.isReady()) {
        logger.warn('[SessionManager] SQLite 資料庫未就緒');
        return null;
      }

      const session = this.sqliteDb.loadSession(sessionId);
      if (session) {
        logger.info(`[SessionManager] Session ${sessionId} 已從資料庫載入`);
      }
      return session;
    } catch (error) {
      logger.error('[SessionManager] 載入 Session 失敗:', error);
      return null;
    }
  }

  /**
   * 保存 Session 到持久化存儲
   */
  private async saveSession(session: Session): Promise<void> {
    try {
      if (!this.sqliteDb.isReady()) {
        logger.warn('[SessionManager] SQLite 資料庫未就緒，無法保存 Session');
        return;
      }

      this.sqliteDb.saveSession(session);
      logger.debug(`[SessionManager] Session ${session.sessionId} 已保存`);
    } catch (error) {
      logger.error('[SessionManager] 保存 Session 失敗:', error);
    }
  }

  /**
   * 清理已結束的 Session
   */
  cleanupEndedSessions(): void {
    for (const [sessionId, session] of this.activeSessions) {
      if (session.isEnded()) {
        this.saveSession(session);
        this.activeSessions.delete(sessionId);

        // 從頻道索引移除
        const channelSessionSet = this.channelSessions.get(session.channelId);
        if (channelSessionSet) {
          channelSessionSet.delete(sessionId);
          if (channelSessionSet.size === 0) {
            this.channelSessions.delete(session.channelId);
          }
        }
      }
    }
  }

  /**
   * 恢復所有活躍的 Session（Bot 重啟後呼叫）
   */
  async restoreActiveSessions(): Promise<void> {
    try {
      if (!this.sqliteDb.isReady()) {
        logger.warn('[SessionManager] SQLite 資料庫未就緒，無法恢復 Session');
        return;
      }

      const sessions = this.sqliteDb.loadActiveSessions();
      logger.info(`[SessionManager] 發現 ${sessions.length} 個活躍 Session 需要恢復`);

      for (const session of sessions) {
        // 檢查 Session 是否過期（例如超過 24 小時）
        const lastActive = session.lastActiveAt ? new Date(session.lastActiveAt).getTime() : 0;
        const now = Date.now();
        const hoursSinceLastActive = (now - lastActive) / (1000 * 60 * 60);

        if (hoursSinceLastActive > 24) {
          logger.info(`[SessionManager] Session ${session.sessionId} 已過期，標記為完成`);
          session.complete();
          await this.saveSession(session);
          continue;
        }

        // 重新註冊到活躍列表
        this.activeSessions.set(session.sessionId, session);
        
        logger.info(`[SessionManager] Session ${session.sessionId} 已恢復`);
      }
    } catch (error) {
      logger.error('[SessionManager] 恢復 Session 失敗:', error);
    }
  }

  /**
   * 獲取管理器統計資訊
   */
  getStats(): {
    activeCount: number;
    runningCount: number;
    waitingCount: number;
    pausedCount: number;
  } {
    let runningCount = 0;
    let waitingCount = 0;
    let pausedCount = 0;

    for (const [, session] of this.activeSessions) {
      if (session.status === 'running' || session.status === 'starting') {
        runningCount++;
      } else if (session.status === 'waiting') {
        waitingCount++;
      } else if (session.status === 'paused') {
        pausedCount++;
      }
    }

    return {
      activeCount: this.activeSessions.size,
      runningCount,
      waitingCount,
      pausedCount,
    };
  }
}

// ============== 單例實例 ==============

let sessionManagerInstance: SessionManager | null = null;

/**
 * 獲取 Session 管理器單例實例
 */
export function getSessionManager(): SessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager();
  }
  return sessionManagerInstance;
}

/**
 * 初始化 Session 管理器
 */
export function initializeSessionManager(): SessionManager {
  sessionManagerInstance = new SessionManager();
  return sessionManagerInstance;
}

// ============== 導出 ==============

export default {
  SessionManager,
  getSessionManager,
  initializeSessionManager,
};
