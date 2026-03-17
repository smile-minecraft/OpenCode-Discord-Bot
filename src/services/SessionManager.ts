/**
 * Session 管理服務
 * @description 管理 OpenCode Session 生命週期，使用 OpenCode SDK
 * 
 * 使用新版 OpenCodeSDKAdapter (基於 @opencode-ai/sdk)
 */

import path from 'path';
import os from 'os';
import { Session, SessionStatus, SessionMetadata } from '../database/models/Session.js';
import { v4 as uuidv4 } from 'uuid';
import { SQLiteDatabase } from '../database/SQLiteDatabase.js';
import logger from '../utils/logger.js';
import { MODEL_CONFIG } from '../config/constants.js';
import { getOpenCodeServerManager, OpenCodeServerManager } from './OpenCodeServerManager.js';
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
   * @description 負責管理 OpenCode Session 的生命週期，使用 OpenCode SDK
   */
  export class SessionManager {
    /** 活躍的 Session 映射 */
    private activeSessions: Map<string, Session> = new Map();
    /** 頻道 ID 到 Session ID 集合的映射（用於快速查詢） */
    private channelSessions: Map<string, Set<string>> = new Map();
    /** SQLite 資料庫實例 */
    private sqliteDb: SQLiteDatabase;
    /** 清理定時器 */
    private cleanupInterval: NodeJS.Timeout | null = null;
    
    /** SDK Adapter */
    private sdkAdapter: OpenCodeSDKAdapter;
    /** 預設模型 */
    private readonly defaultModel = MODEL_CONFIG.DEFAULT;
    /** 預設 Agent */
    private readonly defaultAgent = 'general';
    /** OpenCode 伺服器管理器 */
    private readonly serverManager: OpenCodeServerManager;

    /**
     * 創建 Session 管理器實例
     */
    constructor() {
      this.sqliteDb = SQLiteDatabase.getInstance();
      this.serverManager = getOpenCodeServerManager();
      this.sdkAdapter = getOpenCodeSDKAdapter();
      
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

    // 注意：不要在此處立即註冊到 activeSessions
    // 應該在 SDK 創建成功後才註冊，避免 Race Condition

    const port = this.getPort();

    try {
      // 1. 確保 OpenCode 伺服器正在運行
      if (!this.serverManager.getIsRunning()) {
        try {
          await this.serverManager.start(session.projectPath);
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

      // 6. 更新頻道索引
      const channelSessionSet = this.channelSessions.get(options.channelId) || new Set();
      channelSessionSet.add(sessionId);
      this.channelSessions.set(options.channelId, channelSessionSet);

      logger.info(`[SessionManager] Session ${sessionId} 啟動成功，OpenCode Session ID: ${openCodeSession.id}, Port: ${port}`);
    } catch (error) {
      logger.error(`[SessionManager] 啟動 Session ${sessionId} 失敗:`, error);

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
        await this.serverManager.start(session.projectPath);
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

    // 注意：在單一伺服器架構下，我們不會停止伺服器
    // 因為其他 Session 可能仍在使用
    // 伺服器會在應用關閉時統一停止

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

    if (!opencodeSessionId) {
      throw new Error('Session 資訊不完整');
    }

    try {
      await this.sdkAdapter.sendPrompt({
        sessionId: opencodeSessionId,
        prompt,
      });
      session.updateActivity();
    } catch (error) {
      throw error;
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
