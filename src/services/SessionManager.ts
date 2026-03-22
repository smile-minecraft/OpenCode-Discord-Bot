/**
 * Session 管理服務
 * @description 管理 OpenCode Session 生命週期，使用 OpenCode SDK
 * 
 * 使用新版 OpenCodeSDKAdapter (基於 @opencode-ai/sdk)
 */

import path from 'path';
import os from 'os';
import { Database } from '../database/index.js';
import { Session, SessionStatus, SessionMetadata } from '../database/models/Session.js';
import { v4 as uuidv4 } from 'uuid';
import { SQLiteDatabase } from '../database/SQLiteDatabase.js';
import logger from '../utils/logger.js';
import { MODEL_CONFIG } from '../config/constants.js';
import { getOpenCodeServerManager, OpenCodeServerManager } from './OpenCodeServerManager.js';
import { getOpenCodeSDKAdapter, OpenCodeSDKAdapter, type SendPromptParams } from './OpenCodeSDKAdapter.js';
import { getSessionEventManager, SessionEventManager } from './SessionEventManager.js';
import { getStreamingMessageManager } from './StreamingMessageManager.js';
import { captureSessionError } from '../utils/sentryHelper.js';
import { getProjectManager } from './ProjectManager.js';
import { getThreadManager } from './ThreadManager.js';
import { Client, ChannelType } from 'discord.js';

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

export interface ClearSessionsResult {
  totalSessions: number;
  deletedSessions: number;
  deletedThreads: number;
  deletedStatusMessages: number;
  failed: number;
}

// ============== Session 管理器 ==============

  /**
   * Session 管理器類
   * @description 負責管理 OpenCode Session 的生命週期，使用 OpenCode SDK
   */
  export class SessionManager {
    /** 活躍的 Session 映射 */
    private activeSessions: Map<string, Session> = new Map();
    /** 頻道 ID 到 Session ID 集合的映射（用於快速查詢） */
    private channelSessions: Map<string, Set<string>> = new Map();
  /** SQLite 資料庫實例 */
  private sqliteDb: SQLiteDatabase;
  /** Discord Client 實例（用於刪除主頻道狀態卡） */
  private discordClient: Client | null = null;
  /** 清理定時器 */
  private cleanupInterval: NodeJS.Timeout | null = null;
    
  /** SDK Adapter */
  private sdkAdapter: OpenCodeSDKAdapter;
  /** Session Event Manager */
  private sessionEventManager: SessionEventManager;
  /** 預設模型 */
  private readonly defaultModel = MODEL_CONFIG.DEFAULT;
    /** OpenCode 伺服器管理器 */
    private readonly serverManager: OpenCodeServerManager;

    /**
     * 創建 Session 管理器實例
     */
    constructor() {
      this.sqliteDb = SQLiteDatabase.getInstance();
      this.serverManager = getOpenCodeServerManager();
      this.sdkAdapter = getOpenCodeSDKAdapter();
      this.sessionEventManager = getSessionEventManager();
      
      logger.info('[SessionManager] 使用 SDK Adapter');

      // 注意：SQLite 資料庫應該在應用啟動時由 bot/index.ts 初始化
      // 這裡只檢查狀態，不負責初始化
      if (!this.sqliteDb.isReady()) {
        logger.warn('[SessionManager] SQLite 資料庫尚未初始化，某些功能可能無法正常工作');
      }

      // P1-6: 啟動定時清理機制，每 5 分鐘清理一次已結束的 Session
      this.cleanupInterval = setInterval(() => this.cleanupEndedSessions(), 5 * 60 * 1000);
      // 防止定時器阻止程序退出
      this.cleanupInterval.unref();
      logger.debug('[SessionManager] Session 清理定時器已啟動 (5 分鐘間隔)');
    }

  /**
   * 設定 Discord Client（用於刪除主頻道狀態卡等操作）
   * @param client Discord Client 實例
   */
  setDiscordClient(client: Client): void {
    this.discordClient = client;
  }

  /**
   * 解析 parent channel ID（如果是 thread，則回溯到 parent）
   * @description 當 input 是 thread channel 時，返回 parent channel ID；
   *              否則直接返回原 channel ID
   * @param channelId 頻道 ID
   * @returns parent channel ID（如果是 thread）或原 channel ID
   */
  resolveParentChannelId(channelId: string): string {
    // 如果有 Discord Client，嘗試獲取 channel 類型
    if (this.discordClient) {
      try {
        const channel = this.discordClient.channels.cache.get(channelId);
        if (channel) {
          // 檢查是否為 thread channel
          if (
            channel.type === ChannelType.PublicThread ||
            channel.type === ChannelType.PrivateThread ||
            channel.type === ChannelType.AnnouncementThread
          ) {
            // Thread channel - 回溯到 parent channel
            const parentId = channel.parentId;
            if (parentId) {
              logger.debug(`[SessionManager] Resolved thread ${channelId} to parent ${parentId}`);
              return parentId;
            }
          }
        }
      } catch (error) {
        logger.debug(`[SessionManager] Could not resolve parent for channel ${channelId}:`, error);
      }
    }
    // 非 thread 或無法解析，直接返回原 ID
    return channelId;
  }

  /**
   * 獲取伺服器端口
   * @returns 伺服器端口號
   */
  private getPort(): number {
    return this.serverManager.getPort();
  }

  /**
   * 創建新 Session
   */
  async createSession(options: CreateSessionOptions): Promise<Session> {
    const sessionId = this.generateSessionId();
    const resolvedAgent = options.agent?.trim() || await this.getDefaultAgentForGuild(options.guildId);

    // 解析 channel ID（如果是 thread，回溯到 parent channel）
    // 用於 project binding lookup 和 session 儲存
    const resolvedChannelId = this.resolveParentChannelId(options.channelId);

    // 創建 Session 實例
    const session = new Session({
      sessionId,
      channelId: resolvedChannelId,
      userId: options.userId,
      status: 'pending',
      prompt: options.prompt,
      model: options.model || this.defaultModel,
      agent: resolvedAgent,
      projectPath: options.projectPath || this.getDefaultProjectPath(resolvedChannelId),
    });

    // 標記為啟動中
    session.start(sessionId, session.model, session.agent);

    // 注意：不要在此處立即註冊到 activeSessions
    // 應該在 SDK 創建成功後才註冊，避免 Race Condition

    const port = this.getPort();

    try {
      // 1. 確保 OpenCode 伺服器正在運行
      if (!this.serverManager.getIsRunning()) {
        try {
          await this.serverManager.smartStart(session.projectPath);
          logger.info(`[SessionManager] OpenCode 伺服器已啟動於端口 ${port}`);
        } catch (error) {
          logger.error('[SessionManager] 伺服器啟動失敗', { error });
          session.fail('無法啟動 OpenCode 伺服器，請檢查配置');
          await this.saveSession(session);
          throw error;
        }
      }

      // 1.5 確保 SDK Adapter 已初始化
      if (!this.sdkAdapter.isInitialized()) {
        await this.sdkAdapter.initialize({
          projectPath: session.projectPath,
          port: port,
        });
        logger.info('[SessionManager] SDK Adapter 已初始化');
      }

      // 2. 創建 Session (使用 SDK Adapter)
      const openCodeSession = await this.sdkAdapter.createSession({
        directory: session.projectPath,
        title: session.prompt ? session.prompt.substring(0, 50) : undefined,
      });

      // 3. 更新 Session 資訊
      session.opencodeSessionId = openCodeSession.id;
      (session.metadata as SessionMetadata & { opencodeSessionId?: string }).opencodeSessionId = openCodeSession.id;
      (session.metadata as SessionMetadata & { port?: number }).port = port;
      session.markRunning();

      // 4. 保存到資料庫
      await this.saveSession(session);

      // 5. 只有在 SDK 創建成功後才註冊到活動列表 (避免 Race Condition)
      this.activeSessions.set(sessionId, session);

      // 6. 更新頻道索引（使用 resolved channel ID）
      const channelSessionSet = this.channelSessions.get(resolvedChannelId) || new Set();
      channelSessionSet.add(sessionId);
      this.channelSessions.set(resolvedChannelId, channelSessionSet);

      // Session 事件在真正發送 prompt 前才延遲訂閱，避免空 Session 產生多餘訂閱。

      logger.info(`[SessionManager] Session ${sessionId} 啟動成功，OpenCode Session ID: ${openCodeSession.id}, Port: ${port}`);
    } catch (error) {
      logger.error(`[SessionManager] 啟動 Session ${sessionId} 失敗:`, error);

      // Sentry 錯誤追蹤
      if (error instanceof Error) {
        captureSessionError(error, sessionId, options.guildId, {
          action: 'createSession',
          channelId: options.channelId,
          userId: options.userId,
          projectPath: session.projectPath,
        });
      }

      // 嘗試清理 SDK session 如果已創建
      if (session.opencodeSessionId) {
        try {
          logger.info(`[SessionManager] 嘗試清理 SDK Session: ${session.opencodeSessionId}`);
          // Note: SDK 可能沒有 delete 方法，但我們應該嘗試中止
          // await this.sdkAdapter.abortSession(session.opencodeSessionId);
        } catch (cleanupError) {
          logger.warn('[SessionManager] 清理 SDK Session 失敗:', cleanupError);
        }
      }

      // 保存失敗狀態
      session.fail(error instanceof Error ? error.message : '未知錯誤');
      await this.saveSession(session);
      throw error; // Re-throw so caller knows it failed
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
    try {
      // 檢查伺服器是否仍在運行
      if (!this.serverManager.getIsRunning()) {
        await this.serverManager.smartStart(session.projectPath);
      }

      session.resume();
      logger.info(`[SessionManager] Session ${sessionId} 恢復成功`);
    } catch (error) {
      logger.error(`[SessionManager] 恢復 Session ${sessionId} 失敗:`, error);

      // Sentry 錯誤追蹤
      if (error instanceof Error) {
        captureSessionError(error, sessionId, undefined, {
          action: 'resumeSession',
        });
      }

      session.fail(error instanceof Error ? error.message : '未知錯誤');
    }

    return session;
  }

  /**
   * 終止 Session
   * @param sessionId Session ID（可選）
   * @param channelId 頻道 ID（當 sessionId 未提供時使用）
   */
  async abortSession(sessionId?: string, channelId?: string): Promise<Session | null> {
    // 如果沒有指定 sessionId，嘗試從 channelId 獲取當前頻道的活躍 Session
    if (!sessionId && channelId) {
      const activeSession = this.getActiveSessionByChannel(channelId);
      if (!activeSession) {
        return null;
      }
      sessionId = activeSession.sessionId;
    }

    // 如果仍然沒有 sessionId，無法繼續
    if (!sessionId) {
      return null;
    }

    const session = this.activeSessions.get(sessionId);

    if (!session) {
      return null;
    }

    // 先嘗試通知 SDK 中止執行，避免遠端仍在運行
    if (session.opencodeSessionId) {
      try {
        await this.sdkAdapter.abortSession({ sessionId: session.opencodeSessionId });
      } catch (sdkError) {
        logger.warn(`[SessionManager] SDK abort failed for ${sessionId}:`, sdkError);
      }
    }

    // 注意：在單一伺服器架構下，我們不會停止伺服器
    // 因為其他 Session 可能仍在使用
    // 伺服器會在應用關閉時統一停止

    // 更新 Session 狀態
    session.abort();

    // 保存最終狀態
    await this.saveSession(session);

    // 先清理串流，避免 typing indicator 在 Session 結束後殘留。
    if (session.threadId) {
      try {
        const streamingManager = getStreamingMessageManager();
        streamingManager.removeStream(sessionId, session.threadId);
      } catch (streamingError) {
        logger.warn(`[SessionManager] Streaming cleanup failed for session ${sessionId}:`, streamingError);
      }
    }

    // Call ThreadManager cleanup
    try {
      const threadManager = getThreadManager();
      if (threadManager.isReady()) {
        await threadManager.cleanupSession(sessionId);
      }
    } catch (cleanupError) {
      logger.warn(`[SessionManager] Thread cleanup failed for session ${sessionId}:`, cleanupError);
    }

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

    // 取消 Session 事件訂閱 (Phase 2)
    try {
      this.sessionEventManager.unsubscribe(sessionId);
    } catch (unsubscribeError) {
      logger.warn(`[SessionManager] 取消 Session ${sessionId} 訂閱失敗:`, unsubscribeError);
    }

    return session;
  }

  /**
   * 中斷 Session（不刪除 Session，僅停止當前推理並標記 paused）
   * @param sessionId Session ID
   */
  async interruptSession(sessionId: string): Promise<Session | null> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return null;
    }

    if (session.opencodeSessionId) {
      await this.sdkAdapter.abortSession({ sessionId: session.opencodeSessionId });
    }

    session.pause();
    await this.saveSession(session);

    if (session.threadId) {
      try {
        const streamingManager = getStreamingMessageManager();
        streamingManager.removeStream(sessionId, session.threadId);
      } catch (streamingError) {
        logger.warn(`[SessionManager] Streaming cleanup failed for interrupted session ${sessionId}:`, streamingError);
      }
    }

    try {
      this.sessionEventManager.unsubscribe(sessionId);
    } catch (unsubscribeError) {
      logger.warn(`[SessionManager] 中斷 Session ${sessionId} 取消訂閱失敗:`, unsubscribeError);
    }

    return session;
  }

  /**
   * 終止並刪除 Session（含 SDK Session）
   * @param sessionId Session ID
   * @param options 刪除選項
   */
  async terminateAndDeleteSession(
    sessionId: string,
    options: {
      /** 是否同時刪除 Discord thread，預設 true */
      deleteThread?: boolean;
    } = {}
  ): Promise<Session | null> {
    const { deleteThread = true } = options;

    let session = this.activeSessions.get(sessionId) || null;
    if (!session) {
      session = await this.loadSession(sessionId);
    }
    if (!session) {
      return null;
    }

    if (session.opencodeSessionId) {
      try {
        await this.sdkAdapter.abortSession({ sessionId: session.opencodeSessionId });
      } catch (abortError) {
        logger.warn(`[SessionManager] SDK abort before delete failed for ${sessionId}:`, abortError);
      }

      try {
        await this.sdkAdapter.deleteSession({ sessionId: session.opencodeSessionId });
      } catch (deleteError) {
        logger.warn(`[SessionManager] SDK delete failed for ${sessionId}:`, deleteError);
      }
    }

    if (session.threadId) {
      try {
        const streamingManager = getStreamingMessageManager();
        streamingManager.removeStream(sessionId, session.threadId);
      } catch (streamingError) {
        logger.warn(`[SessionManager] Streaming cleanup failed for deleted session ${sessionId}:`, streamingError);
      }
    }

    try {
      this.sessionEventManager.unsubscribe(sessionId);
    } catch (unsubscribeError) {
      logger.warn(`[SessionManager] 刪除 Session ${sessionId} 取消訂閱失敗:`, unsubscribeError);
    }

    try {
      const threadManager = getThreadManager();
      if (threadManager.isReady()) {
        if (deleteThread) {
          const fallbackThreadId = session.threadId;
          if (fallbackThreadId) {
            try {
              await threadManager.deleteDiscordThread(fallbackThreadId);
            } finally {
              // 優先用 threadId/sessionId 雙路清理映射，避免映射缺失導致殘留
              threadManager.deleteThread(fallbackThreadId);
              threadManager.deleteThread(sessionId);
            }
          } else {
            await threadManager.deleteSessionThread(sessionId);
          }
          session.threadId = null;
        } else {
          await threadManager.cleanupSession(sessionId);
        }
      }
    } catch (threadError) {
      logger.warn(`[SessionManager] Session ${sessionId} thread delete/cleanup failed:`, threadError);
    }

    // Mark local state as aborted for in-memory consumers.
    // We intentionally skip persisting here because this method
    // immediately deletes the session record from database.
    session.abort();

    this.activeSessions.delete(sessionId);
    const channelSessionSet = this.channelSessions.get(session.channelId);
    if (channelSessionSet) {
      channelSessionSet.delete(sessionId);
      if (channelSessionSet.size === 0) {
        this.channelSessions.delete(session.channelId);
      }
    }

    if (this.sqliteDb.isReady()) {
      try {
        this.sqliteDb.deleteSession(sessionId);
      } catch (dbError) {
        logger.warn(`[SessionManager] Database delete failed for session ${sessionId}:`, dbError);
      }
    }

    // 刪除主頻道狀態卡（所有錯誤 swallow，不中斷流程）
    try {
      await this.deleteMainStatusMessage(session);
    } catch (statusError) {
      // 錯誤已由 deleteMainStatusMessage 內部 swallow，這裡只處理異常情況
      logger.warn(`[SessionManager] Main status message deletion threw unexpected error for session ${sessionId}:`, statusError);
    }

    return session;
  }

  /**
   * 清除所有 Session 與關聯討論串
   */
  async clearAllSessions(
    options: {
      deleteThreads?: boolean;
    } = {}
  ): Promise<ClearSessionsResult> {
    const { deleteThreads = true } = options;
    const targets = new Map<string, Session>();

    // 1) 記憶體中的 active sessions
    for (const [sessionId, session] of this.activeSessions.entries()) {
      targets.set(sessionId, session);
    }

    // 2) 資料庫中的 sessions（補齊非 active）
    if (this.sqliteDb.isReady()) {
      try {
        const persisted = this.sqliteDb.loadAllSessions();
        for (const session of persisted) {
          targets.set(session.sessionId, session);
        }
      } catch (error) {
        logger.warn('[SessionManager] clearAllSessions 載入資料庫 Session 失敗', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let deletedSessions = 0;
    let deletedStatusMessages = 0;
    let failed = 0;

    for (const sessionId of targets.keys()) {
      try {
        const deleted = await this.terminateAndDeleteSession(sessionId, {
          deleteThread: deleteThreads,
        });
        if (deleted) {
          deletedSessions++;
          // 統計有 statusMessageId 的 session（代表有主頻道狀態卡需清理）
          const statusMessageId = (deleted.metadata as Record<string, unknown>)?.statusMessageId as string | undefined;
          if (statusMessageId) {
            deletedStatusMessages++;
          }
        }
      } catch (error) {
        failed++;
        logger.warn(`[SessionManager] clearAllSessions 刪除 Session 失敗: ${sessionId}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let deletedThreads = 0;
    // 最後再做一次 thread 殘留清理（只在 deleteThreads=true）
    if (deleteThreads) {
      try {
        const threadManager = getThreadManager();
        if (threadManager.isReady()) {
          const threadResult = await threadManager.clearAllSessionThreads();
          deletedThreads = threadResult.deleted;
          failed += threadResult.failed;
        }
      } catch (error) {
        logger.warn('[SessionManager] clearAllSessions 清理殘留討論串失敗', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 清理索引（保險）
    this.channelSessions.clear();

    return {
      totalSessions: targets.size,
      deletedSessions,
      deletedThreads,
      deletedStatusMessages,
      failed,
    };
  }

  /**
   * 標記 Session 為失敗並清理活躍狀態
   * @param sessionId Session ID
   * @param errorMessage 錯誤訊息
   */
  async failSession(sessionId: string, errorMessage: string): Promise<Session | null> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return null;
    }

    session.fail(errorMessage);
    await this.saveSession(session);

    if (session.threadId) {
      try {
        const streamingManager = getStreamingMessageManager();
        streamingManager.removeStream(sessionId, session.threadId);
      } catch (streamingError) {
        logger.warn(`[SessionManager] Streaming cleanup failed for failed session ${sessionId}:`, streamingError);
      }
    }

    this.activeSessions.delete(sessionId);

    const channelSessionSet = this.channelSessions.get(session.channelId);
    if (channelSessionSet) {
      channelSessionSet.delete(sessionId);
      if (channelSessionSet.size === 0) {
        this.channelSessions.delete(session.channelId);
      }
    }

    try {
      this.sessionEventManager.unsubscribe(sessionId);
    } catch (unsubscribeError) {
      logger.warn(`[SessionManager] 取消失敗 Session ${sessionId} 訂閱失敗:`, unsubscribeError);
    }

    return session;
  }

  /**
   * 列出 Sessions
   * @description 自動 normalize thread -> parent channel
   */
  async listSessions(
    channelId: string,
    status: 'all' | 'running' | 'completed' | 'aborted' | 'failed' = 'all'
  ): Promise<Session[]> {
    const resolvedChannelId = this.resolveParentChannelId(channelId);
    const sessions: Session[] = [];

    // 從活動列表過濾
    for (const [, session] of this.activeSessions) {
      if (session.channelId !== resolvedChannelId) {
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
   * @description 自動 normalize thread -> parent channel
   */
  getSessionsByChannel(channelId: string): Session[] {
    const resolvedChannelId = this.resolveParentChannelId(channelId);
    const sessionIds = this.channelSessions.get(resolvedChannelId);
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
   * 查詢 Session（優先記憶體，找不到則嘗試資料庫）
   * @description 從 DB 載入的非結束 session 會重新註冊到 activeSessions 和 channelSessions
   * @param sessionId Session ID
   */
  async findSession(sessionId: string): Promise<Session | null> {
    const active = this.activeSessions.get(sessionId);
    if (active) {
      return active;
    }

    const loaded = await this.loadSession(sessionId);
    if (!loaded) {
      return null;
    }

    // 如果 session 未結束，重新註冊到記憶體索引
    if (!loaded.isEnded()) {
      this.activeSessions.set(sessionId, loaded);

      // 重建 channelSessions 索引（避免重複成員）
      const channelId = loaded.channelId;
      const existingSet = this.channelSessions.get(channelId);
      if (!existingSet) {
        this.channelSessions.set(channelId, new Set([sessionId]));
      } else if (!existingSet.has(sessionId)) {
        existingSet.add(sessionId);
      }

      logger.debug(`[SessionManager] findSession re-registered non-ended session ${sessionId} into activeSessions and channelSessions`);
    }

    return loaded;
  }

  /**
   * 獲取頻道的活躍 Session
   * @description 自動 normalize thread -> parent channel，避免 thread 內查詢失敗
   */
  getActiveSessionByChannel(channelId: string): Session | undefined {
    const resolvedChannelId = this.resolveParentChannelId(channelId);
    for (const [, session] of this.activeSessions) {
      if (session.channelId === resolvedChannelId && session.isRunning()) {
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

  /**
   * 更新 Session 資訊並保存到資料庫
   * @param session 要更新的 Session 實例
   */
  async updateSession(session: Session): Promise<void> {
    session.updatedAt = new Date().toISOString();
    await this.saveSession(session);
    logger.debug(`[SessionManager] Session ${session.sessionId} updated and saved`);
  }

  /**
   * 更新 Session 設定（模型/Agent）
   * @param sessionId Session ID
   * @param updates 可更新項目
   */
  async updateSessionSettings(
    sessionId: string,
    updates: {
      model?: string;
      agent?: string;
    }
  ): Promise<Session | null> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return null;
    }

    if (typeof updates.model === 'string' && updates.model.trim() !== '') {
      session.model = updates.model.trim();
    }

    if (typeof updates.agent === 'string' && updates.agent.trim() !== '') {
      session.agent = updates.agent.trim();
    }

    session.updateActivity();
    await this.updateSession(session);
    return session;
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
    const promptModel = this.resolvePromptModel(session.model);

    if (!opencodeSessionId) {
      throw new Error('Session 資訊不完整');
    }

    try {
      await this.sdkAdapter.sendPrompt({
        sessionId: opencodeSessionId,
        prompt,
        directory: session.projectPath,
        model: promptModel,
        agent: session.agent,
      });
      session.updateActivity();
    } catch (error) {
      // Sentry 錯誤追蹤
      if (error instanceof Error) {
        captureSessionError(error, sessionId, undefined, {
          action: 'sendPrompt',
          channelId: session.channelId,
          userId: session.userId,
          projectPath: session.projectPath,
        });
      }

      throw error;
    }
  }

  /**
   * 將內部模型 ID 轉換為 SDK 所需的 model 物件
   * @param modelId 模型 ID
   */
  private resolvePromptModel(modelId: string): SendPromptParams['model'] | undefined {
    const normalized = modelId.trim();
    if (!normalized) {
      return undefined;
    }

    if (normalized.includes('/')) {
      const [providerID, ...modelParts] = normalized.split('/');
      const modelID = modelParts.join('/');
      if (providerID && modelID) {
        return { providerID, modelID };
      }
      return undefined;
    }

    // 對於未帶 provider 的模型（例如 nemotron-3-super-free），預設走 opencode provider。
    return {
      providerID: 'opencode',
      modelID: normalized,
    };
  }

  // ============== 私有方法 ==============

  /**
   * 生成 Session ID
   */
  private generateSessionId(): string {
    return `sess_${uuidv4().slice(0, 8)}`;
  }

  /**
   * 刪除 Session 的主頻道狀態卡訊息
   * @description 從 session.metadata.statusMessageId 取得訊息 ID 並刪除
   *             所有錯誤都會被 swallow 並 warn，不中斷流程
   * @param session Session 實例
   * @returns true 如果有 statusMessageId 並嘗試刪除，false 否
   */
  private async deleteMainStatusMessage(session: Session): Promise<boolean> {
    const statusMessageId = (session.metadata as Record<string, unknown>)?.statusMessageId as string | undefined;
    const statusChannelId = (session.metadata as Record<string, unknown>)?.statusChannelId as string | undefined;

    if (!statusMessageId || !statusChannelId) {
      return false;
    }

    if (!this.discordClient) {
      logger.warn('[SessionManager] Discord client not set, cannot delete main status message', {
        sessionId: session.sessionId,
        statusMessageId,
      });
      return true; // 有 ID 但無法刪除，仍算「嘗試過」
    }

    try {
      const channel = await this.discordClient.channels.fetch(statusChannelId);
      if (!channel || !('messages' in channel)) {
        logger.warn('[SessionManager] Status channel not found or not text-based', {
          sessionId: session.sessionId,
          statusChannelId,
        });
        return true;
      }

      const message = await channel.messages.fetch(statusMessageId);
      if (!message) {
        logger.debug('[SessionManager] Status message already deleted', {
          sessionId: session.sessionId,
          statusMessageId,
        });
        return true;
      }

      await message.delete();
      logger.info('[SessionManager] Deleted main status message', {
        sessionId: session.sessionId,
        statusMessageId,
        statusChannelId,
      });
      return true;
    } catch (error) {
      // 所有錯誤都 swallow + warn，不中斷流程
      logger.warn('[SessionManager] Failed to delete main status message (ignored)', {
        sessionId: session.sessionId,
        statusMessageId,
        statusChannelId,
        error: error instanceof Error ? error.message : String(error),
      });
      return true; // 嘗試了但失敗，仍算「嘗試過」
    }
  }

  /**
   * 獲取預設專案路徑
   * @description 內部 normalize channelId 後再查詢 binding，避免 thread 綁定失效
   */
  private getDefaultProjectPath(channelId: string): string {
    // 內部 normalize（thread -> parent）後再查詢 binding
    const resolvedChannelId = this.resolveParentChannelId(channelId);

    // 優先檢查是否有綁定的專案
    try {
      const projectManager = getProjectManager();
      const channelBinding = projectManager.getChannelBinding(resolvedChannelId);
      
      if (channelBinding) {
        const project = projectManager.getProject(channelBinding.projectId);
        if (project) {
          logger.debug(`[SessionManager] Using bound project path: ${project.path} for channel: ${channelId} (resolved: ${resolvedChannelId})`);
          return project.path;
        }
      }
    } catch (error) {
      // ProjectManager 可能尚未初始化，使用 fallback
      logger.debug(`[SessionManager] ProjectManager not available, using default path`);
    }
    
    // Fallback: 使用可配置的專案根目錄
    // 優先順序：環境變數 PROJECTS_ROOT > 使用者 home 目錄下的 opencode-projects
    const projectsRoot = process.env.PROJECTS_ROOT || path.join(os.homedir(), 'opencode-projects');
    return path.join(projectsRoot, resolvedChannelId);
  }

  /**
   * 獲取伺服器預設 Agent
   * @description 優先使用 guild settings 的 defaultAgent，無法取得時才 fallback。
   */
  private async getDefaultAgentForGuild(guildId: string): Promise<string> {
    try {
      const db = Database.getInstance();
      const guild = await db.getGuild(guildId);
      const defaultAgent = guild?.settings?.defaultAgent?.trim();
      if (defaultAgent) {
        return defaultAgent;
      }
    } catch (error) {
      logger.warn('[SessionManager] 讀取 guild 預設 Agent 失敗，將使用 fallback', {
        guildId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 保底 fallback（僅在 guild 設定不存在或讀取失敗時使用）
    return 'general';
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

      // Sentry 錯誤追蹤
      if (error instanceof Error) {
        captureSessionError(error, sessionId, undefined, {
          action: 'loadSession',
        });
      }

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

      // Sentry 錯誤追蹤
      if (error instanceof Error) {
        captureSessionError(error, session.sessionId, undefined, {
          action: 'saveSession',
          channelId: session.channelId,
          userId: session.userId,
        });
      }
    }
  }

  /**
   * 清理已結束的 Session
   */
  cleanupEndedSessions(): void {
    for (const [sessionId, session] of this.activeSessions) {
      if (session.isEnded()) {
        this.saveSession(session);
        
        // Call ThreadManager cleanup
        try {
          if (session.threadId) {
            const streamingManager = getStreamingMessageManager();
            streamingManager.removeStream(sessionId, session.threadId);
          }
        } catch (streamingError) {
          logger.warn(`[SessionManager] Streaming cleanup failed for session ${sessionId}:`, streamingError);
        }

        try {
          const threadManager = getThreadManager();
          if (threadManager.isReady()) {
            threadManager.cleanupSession(sessionId);
          }
        } catch (cleanupError) {
          logger.warn(`[SessionManager] Thread cleanup failed for session ${sessionId}:`, cleanupError);
        }
        
        this.activeSessions.delete(sessionId);

        // 從頻道索引移除
        const channelSessionSet = this.channelSessions.get(session.channelId);
        if (channelSessionSet) {
          channelSessionSet.delete(sessionId);
          if (channelSessionSet.size === 0) {
            this.channelSessions.delete(session.channelId);
          }
        }

        // 取消 Session 事件訂閱 (Phase 2)
        try {
          this.sessionEventManager.unsubscribe(sessionId);
        } catch (unsubscribeError) {
          logger.warn(`[SessionManager] 清理時取消 Session ${sessionId} 訂閱失敗:`, unsubscribeError);
        }
      }
    }
  }

  /**
   * 清理 Session 相關資源（包括 Thread）
   * @param sessionId Session ID
   */
  async cleanupSession(sessionId: string): Promise<void> {
    try {
      const threadManager = getThreadManager();
      if (threadManager.isReady()) {
        await threadManager.cleanupSession(sessionId);
      }
    } catch (cleanupError) {
      logger.warn(`[SessionManager] Session ${sessionId} thread cleanup failed:`, cleanupError);
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

      // 清空並重建 channelSessions 索引
      this.channelSessions.clear();

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

        // 重建 channelSessions 索引（使用 session.channelId）
        // 注意：session.channelId 已經是 resolved parent channel ID
        const channelId = session.channelId;
        const channelSessionSet = this.channelSessions.get(channelId) || new Set();
        channelSessionSet.add(session.sessionId);
        this.channelSessions.set(channelId, channelSessionSet);

        logger.info(`[SessionManager] Session ${session.sessionId} 已恢復（頻道: ${channelId}）`);
      }

      // 恢復完成後，恢復 thread mappings
      const threadManager = getThreadManager();
      if (threadManager.isReady()) {
        threadManager.restoreMappings();
      }

      logger.info(`[SessionManager] channelSessions 索引已重建，共 ${this.channelSessions.size} 個頻道`);
    } catch (error) {
      logger.error('[SessionManager] 恢復 Session 失敗:', error);

      // Sentry 錯誤追蹤
      if (error instanceof Error) {
        captureSessionError(error, 'restore', undefined, {
          action: 'restoreActiveSessions',
        });
      }
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
