/**
 * Thread 管理服務
 * @description 管理 Discord Thread 與 Session 的雙向映射關係
 * 
 * 功能：
 * - 從訊息創建 Discord Thread
 * - 維護 threadId <-> sessionId 的雙向映射
 * - 提供快速查詢功能
 * - 持久化到 SQLite 資料庫
 * - 自動清理機制
 */

import { Client, TextChannel, NewsChannel, Message, ThreadChannel } from 'discord.js';
import { SQLiteDatabase } from '../database/SQLiteDatabase.js';
import logger from '../utils/logger.js';
import { ThreadMappingError } from '../utils/errorHandler.js';

// ============== 類型定義 ==============

/**
 * Thread 創建選項
 */
export interface CreateThreadOptions {
  /** Discord 頻道（用於創建 thread，應為 TextChannel 或 NewsChannel） */
  channel: TextChannel | NewsChannel;
  /** Session ID */
  sessionId: string;
  /** Guild ID */
  guildId: string;
  /** OpenCode Session ID（可選） */
  opencodeSessionId?: string;
  /** Thread 名稱 */
  name?: string;
  /** 自動 Archive 時長（分鐘），預設 1440 分鐘 (24小時) */
  autoArchiveDuration?: 60 | 1440 | 4320 | 10080;
}

/**
 * Thread 資訊
 */
export interface ThreadInfo {
  /** Discord Thread ID */
  threadId: string;
  /** 關聯的 Session ID */
  sessionId: string;
  /** OpenCode Session ID */
  opencodeSessionId?: string;
  /** Discord Channel ID */
  channelId?: string;
  /** Guild ID */
  guildId?: string;
  /** Thread 創建時間 */
  createdAt: Date;
  /** Archive 時間 */
  archivedAt?: Date | null;
  /** 是否已 Archive */
  archived: boolean;
}

/**
 * Thread 持久化映射（資料庫行格式）
 */
interface ThreadMappingRow {
  /** Discord Thread ID */
  thread_id: string;
  /** Session ID */
  session_id: string;
  /** OpenCode Session ID */
  opencode_session_id: string | null;
  /** Discord Channel ID */
  channel_id: string;
  /** Guild ID */
  guild_id: string;
  /** 創建時間（Unix timestamp） */
  created_at: number;
  /** Archive 時間（Unix timestamp） */
  archived_at: number | null;
}

// ============== Thread 管理器 ==============

/**
 * Thread 管理器類
 * @description 負責管理 Discord Thread 與 Session 的映射關係
 */
export class ThreadManager {
  /** Discord Client 實例 */
  private discordClient: Client | null = null;
  /** SQLite 資料庫實例 */
  private sqliteDb: SQLiteDatabase | null = null;
  /** threadId -> sessionId 映射 */
  private threadToSession: Map<string, string> = new Map();
  /** sessionId -> threadId 映射 */
  private sessionToThread: Map<string, string> = new Map();
  /** sessionId -> opencodeSessionId 映射 */
  private sessionToOpencodeSession: Map<string, string> = new Map();
  /** Thread 資訊快取 */
  private threadInfo: Map<string, ThreadInfo> = new Map();
  /** 是否已初始化 */
  private isInitialized = false;
  /** 手動清理標記 */
  private manualCleanupPending: Map<string, string> = new Map();

  /** 重試次數配置 */
  private static readonly MAX_INIT_RETRIES = 3;
  /** 重試延遲（毫秒） */
  private static readonly RETRY_DELAY_MS = 1000;

  /**
   * 初始化 Thread 管理器
   * @param sqliteDb SQLite 資料庫實例
   */
  async initialize(sqliteDb: SQLiteDatabase): Promise<void> {
    this.sqliteDb = sqliteDb;

    let success = false;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= ThreadManager.MAX_INIT_RETRIES; attempt++) {
      try {
        logger.info(`[ThreadManager] 初始化嘗試 ${attempt}/${ThreadManager.MAX_INIT_RETRIES}...`);

        // 檢查資料庫是否就緒
        if (!this.sqliteDb?.isReady()) {
          throw new Error('資料庫未就緒');
        }

        // 嘗試恢復映射（支援 Discord thread 驗證）
        await this.restoreMappings();

        // 只有在 restoreMappings 成功後才設定初始化完成
        this.isInitialized = true;
        success = true;

        const stats = this.getStats();
        logger.info(`[ThreadManager] 初始化成功，已恢復 ${stats.activeThreads} 個活躍映射`);
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(`[ThreadManager] 初始化嘗試 ${attempt} 失敗: ${lastError.message}`);

        if (attempt < ThreadManager.MAX_INIT_RETRIES) {
          logger.info(`[ThreadManager] 等待 ${ThreadManager.RETRY_DELAY_MS}ms 後重試...`);
          await this.delay(ThreadManager.RETRY_DELAY_MS);
        }
      }
    }

    if (!success) {
      logger.error('[ThreadManager] 初始化失敗，已達到最大重試次數', lastError);
      throw lastError || new Error('ThreadManager 初始化失敗');
    }
  }

  /**
   * 延遲 Helper
   * @param ms 延遲時間（毫秒）
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 設定 Discord Client
   * @param client Discord Client 實例
   */
  setDiscordClient(client: Client): void {
    this.discordClient = client;
    logger.info('[ThreadManager] Discord Client 已設定');
  }

  /**
   * 從資料庫恢復映射（支援 Discord Thread 驗證）
   */
  async restoreMappings(): Promise<void> {
    if (!this.sqliteDb?.isReady()) {
      throw new ThreadMappingError('資料庫未就緒，無法恢復映射');
    }

    try {
      const rows = this.sqliteDb.prepare(`
        SELECT thread_id, session_id, opencode_session_id, channel_id, guild_id, created_at, archived_at
        FROM thread_mappings
        WHERE archived_at IS NULL
      `).all() as ThreadMappingRow[];

      let restoredCount = 0;
      let skippedCount = 0;

      for (const row of rows) {
        // 如果 Discord Client 可用，驗證 thread 是否仍存在於 Discord
        if (this.discordClient) {
          const threadExists = await this.verifyThreadExists(row.thread_id);

          if (!threadExists) {
            // Thread 不存在於 Discord，刪除資料庫映射並跳過
            logger.info(`[ThreadManager] Thread ${row.thread_id} 不存在於 Discord，刪除映射`);
            this.deleteThreadMappingFromDB(row.thread_id);
            skippedCount++;
            continue;
          }
        }

        // 恢復記憶體映射
        this.threadToSession.set(row.thread_id, row.session_id);
        this.sessionToThread.set(row.session_id, row.thread_id);

        if (row.opencode_session_id) {
          this.sessionToOpencodeSession.set(row.session_id, row.opencode_session_id);
        }

        // 恢復 Thread 資訊
        this.threadInfo.set(row.thread_id, {
          threadId: row.thread_id,
          sessionId: row.session_id,
          opencodeSessionId: row.opencode_session_id || undefined,
          channelId: row.channel_id,
          guildId: row.guild_id,
          createdAt: new Date(row.created_at),
          archivedAt: row.archived_at ? new Date(row.archived_at) : null,
          archived: row.archived_at !== null,
        });

        restoredCount++;
      }

      if (skippedCount > 0) {
        logger.info(`[ThreadManager] 從資料庫恢復了 ${restoredCount} 個活躍映射，跳過了 ${skippedCount} 個已刪除的 threads`);
      } else {
        logger.info(`[ThreadManager] 從資料庫恢復了 ${restoredCount} 個活躍映射`);
      }
    } catch (error) {
      logger.error('[ThreadManager] 從資料庫恢復映射失敗:', error);
      throw error;
    }
  }

  /**
   * 驗證 Thread 是否存在於 Discord
   * @param threadId Discord Thread ID
   * @returns 是否存在
   */
  private async verifyThreadExists(threadId: string): Promise<boolean> {
    try {
      const thread = await this.fetchThreadChannel(threadId);
      return thread !== null;
    } catch {
      return false;
    }
  }

  /**
   * 創建 Thread（原子操作）
   * @description 使用事務確保 Discord Thread 創建、記憶體映射和資料庫持久化的原子性
   * 
   * 如果任何步驟失敗：
   * - 記憶體映射會被回滾
   * - 如果資料庫持久化失敗，已創建的 Discord Thread 會被刪除
   * 
   * @param options 創建選項
   * @returns Thread ID
   * @throws 如果創建過程中發生錯誤
   */
  async createThread(options: CreateThreadOptions): Promise<string> {
    const { channel, sessionId, guildId, opencodeSessionId, name, autoArchiveDuration } = options;

    // 創建 Discord thread（此操作不可回滾）
    const thread = await channel.threads.create({
      name: name || `session-${sessionId.slice(0, 8)}`,
      autoArchiveDuration: autoArchiveDuration || 1440,
    });

    const now = Date.now();
    const threadId = thread.id;
    let memoryUpdateSucceeded = false;

    try {
      // 如果資料庫就緒，使用事務原子性地更新記憶體和資料庫
      if (this.sqliteDb?.isReady()) {
        this.sqliteDb.transaction(() => {
          // 更新記憶體映射
          this.threadToSession.set(threadId, sessionId);
          this.sessionToThread.set(sessionId, threadId);
          
          if (opencodeSessionId) {
            this.sessionToOpencodeSession.set(sessionId, opencodeSessionId);
          }

          // 儲存 Thread 資訊
          this.threadInfo.set(threadId, {
            threadId,
            sessionId,
            opencodeSessionId,
            channelId: channel.id,
            guildId,
            createdAt: new Date(now),
            archived: false,
          });

          // 持久化到資料庫
          this.persistThreadMapping({
            thread_id: threadId,
            session_id: sessionId,
            opencode_session_id: opencodeSessionId || null,
            channel_id: channel.id,
            guild_id: guildId,
            created_at: now,
            archived_at: null,
          });
        });
      } else {
        // 資料庫未就緒，只更新記憶體
        this.threadToSession.set(threadId, sessionId);
        this.sessionToThread.set(sessionId, threadId);
        
        if (opencodeSessionId) {
          this.sessionToOpencodeSession.set(sessionId, opencodeSessionId);
        }

        this.threadInfo.set(threadId, {
          threadId,
          sessionId,
          opencodeSessionId,
          channelId: channel.id,
          guildId,
          createdAt: new Date(now),
          archived: false,
        });

        logger.warn('[ThreadManager] 資料庫未就緒，僅更新記憶體映射');
      }

      memoryUpdateSucceeded = true;
      logger.info(`[ThreadManager] Created thread ${threadId} for session ${sessionId}`);

      return threadId;
    } catch (error) {
      // 回滾記憶體映射
      if (!memoryUpdateSucceeded) {
        this.threadToSession.delete(threadId);
        this.sessionToThread.delete(sessionId);
        this.sessionToOpencodeSession.delete(sessionId);
        this.threadInfo.delete(threadId);
      }

      // 如果 Discord thread 已創建但資料庫持久化失敗，嘗試刪除 Discord thread
      try {
        await thread.delete();
        logger.info(`[ThreadManager] 回滾成功：已刪除 Discord thread ${threadId}`);
      } catch (deleteError) {
        logger.error(`[ThreadManager] 回滾失敗：無法刪除 Discord thread ${threadId}:`, deleteError);
      }

      logger.error(`[ThreadManager] Failed to create thread for session ${sessionId}:`, error);
      throw new ThreadMappingError(
        error instanceof Error ? error.message : String(error),
        threadId,
        sessionId
      );
    }
  }

  /**
   * 持久化 Thread 映射到資料庫
   * @param mapping 要持久化的映射
   * @throws 如果資料庫未就緒或操作失敗
   */
  private persistThreadMapping(mapping: ThreadMappingRow): void {
    if (!this.sqliteDb?.isReady()) {
      throw new ThreadMappingError('資料庫未就緒，無法持久化 Thread 映射', mapping.thread_id, mapping.session_id);
    }

    this.sqliteDb.prepare(`
      INSERT INTO thread_mappings (thread_id, session_id, opencode_session_id, channel_id, guild_id, created_at, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        session_id = excluded.session_id,
        opencode_session_id = excluded.opencode_session_id,
        channel_id = excluded.channel_id,
        guild_id = excluded.guild_id,
        archived_at = excluded.archived_at
    `).run(
      mapping.thread_id,
      mapping.session_id,
      mapping.opencode_session_id,
      mapping.channel_id,
      mapping.guild_id,
      mapping.created_at,
      mapping.archived_at
    );
  }

  /**
   * 從既有訊息創建 Thread（原子操作）
   * @description 使用事務確保 Discord Thread 創建、記憶體映射和資料庫持久化的原子性
   * 
   * 如果任何步驟失敗：
   * - 記憶體映射會被回滾
   * - 如果資料庫持久化失敗，已創建的 Discord Thread 會被刪除
   * 
   * @param options 創建選項
   * @returns Thread ID
   * @throws 如果創建過程中發生錯誤
   */
  async createThreadFromMessage(options: Omit<CreateThreadOptions, 'channel'> & { 
    message: Message;
    guildId: string;
  }): Promise<string> {
    const { message, sessionId, guildId, opencodeSessionId, name, autoArchiveDuration } = options;

    // 從訊息創建 thread（預設為 public thread）
    const thread = await message.startThread({
      name: name || `session-${sessionId.slice(0, 8)}`,
      autoArchiveDuration: autoArchiveDuration || 1440,
    });

    const now = Date.now();
    const threadId = thread.id;
    let memoryUpdateSucceeded = false;

    try {
      // 如果資料庫就緒，使用事務原子性地更新記憶體和資料庫
      if (this.sqliteDb?.isReady()) {
        this.sqliteDb.transaction(() => {
          // 建立雙向映射（記憶體）
          this.threadToSession.set(threadId, sessionId);
          this.sessionToThread.set(sessionId, threadId);
          
          if (opencodeSessionId) {
            this.sessionToOpencodeSession.set(sessionId, opencodeSessionId);
          }

          // 儲存 Thread 資訊
          this.threadInfo.set(threadId, {
            threadId,
            sessionId,
            opencodeSessionId,
            channelId: message.channelId,
            guildId,
            createdAt: new Date(now),
            archived: false,
          });

          // 持久化到資料庫
          this.persistThreadMapping({
            thread_id: threadId,
            session_id: sessionId,
            opencode_session_id: opencodeSessionId || null,
            channel_id: message.channelId,
            guild_id: guildId,
            created_at: now,
            archived_at: null,
          });
        });
      } else {
        // 資料庫未就緒，只更新記憶體
        this.threadToSession.set(threadId, sessionId);
        this.sessionToThread.set(sessionId, threadId);
        
        if (opencodeSessionId) {
          this.sessionToOpencodeSession.set(sessionId, opencodeSessionId);
        }

        this.threadInfo.set(threadId, {
          threadId,
          sessionId,
          opencodeSessionId,
          channelId: message.channelId,
          guildId,
          createdAt: new Date(now),
          archived: false,
        });

        logger.warn('[ThreadManager] 資料庫未就緒，僅更新記憶體映射');
      }

      memoryUpdateSucceeded = true;
      logger.info(`[ThreadManager] Created thread ${threadId} from message for session ${sessionId}`);

      return threadId;
    } catch (error) {
      // 回滾記憶體映射
      if (!memoryUpdateSucceeded) {
        this.threadToSession.delete(threadId);
        this.sessionToThread.delete(sessionId);
        this.sessionToOpencodeSession.delete(sessionId);
        this.threadInfo.delete(threadId);
      }

      // 如果 Discord thread 已創建但資料庫持久化失敗，嘗試刪除 Discord thread
      try {
        await thread.delete();
        logger.info(`[ThreadManager] 回滾成功：已刪除 Discord thread ${threadId}`);
      } catch (deleteError) {
        logger.error(`[ThreadManager] 回滾失敗：無法刪除 Discord thread ${threadId}:`, deleteError);
      }

      logger.error(`[ThreadManager] Failed to create thread from message for session ${sessionId}:`, error);
      throw new ThreadMappingError(
        error instanceof Error ? error.message : String(error),
        threadId,
        sessionId
      );
    }
  }

  /**
   * 通過 threadId 獲取 sessionId
   * @param threadId Discord Thread ID
   * @returns Session ID 或 undefined
   */
  getSessionIdByThreadId(threadId: string): string | undefined {
    if (!this.isInitialized) {
      logger.warn('[ThreadManager] ThreadManager 未初始化');
      return undefined;
    }
    return this.threadToSession.get(threadId);
  }

  /**
   * 通過 sessionId 獲取 threadId
   * @param sessionId Session ID
   * @returns Thread ID 或 undefined
   */
  getThreadIdBySessionId(sessionId: string): string | undefined {
    if (!this.isInitialized) {
      logger.warn('[ThreadManager] ThreadManager 未初始化');
      return undefined;
    }
    return this.sessionToThread.get(sessionId);
  }

  /**
   * 獲取 OpenCode Session ID
   * @param sessionId Session ID
   * @returns OpenCode Session ID 或 undefined
   */
  getOpencodeSessionId(sessionId: string): string | undefined {
    if (!this.isInitialized) {
      logger.warn('[ThreadManager] ThreadManager 未初始化');
      return undefined;
    }
    return this.sessionToOpencodeSession.get(sessionId);
  }

  /**
   * 檢查是否為有效的 Session Thread
   * @param threadId Discord Thread ID
   * @returns 是否為有效的 Session Thread
   */
  isSessionThread(threadId: string): boolean {
    if (!this.isInitialized) {
      logger.warn('[ThreadManager] ThreadManager 未初始化');
      return false;
    }
    return this.threadToSession.has(threadId);
  }

  /**
   * 獲取 Thread 資訊
   * @param threadId Discord Thread ID
   * @returns Thread 資訊或 undefined
   */
  getThreadInfo(threadId: string): ThreadInfo | undefined {
    if (!this.isInitialized) {
      logger.warn('[ThreadManager] ThreadManager 未初始化');
      return undefined;
    }
    return this.threadInfo.get(threadId);
  }

  /**
   * 刪除 Thread 映射
   * @param threadIdOrSessionId Discord Thread ID 或 Session ID
   */
  deleteThread(threadIdOrSessionId: string): void {
    // 嘗試作為 threadId 處理
    const sessionId = this.threadToSession.get(threadIdOrSessionId);
    
    if (sessionId) {
      // 這是 threadId
      this.threadToSession.delete(threadIdOrSessionId);
      this.sessionToThread.delete(sessionId);
      this.sessionToOpencodeSession.delete(sessionId);
      this.threadInfo.delete(threadIdOrSessionId);
      
      // 從資料庫刪除
      this.deleteThreadMappingFromDB(threadIdOrSessionId);
      
      logger.info(`[ThreadManager] Deleted thread mapping for thread ${threadIdOrSessionId} (session: ${sessionId})`);
    } else {
      // 嘗試作為 sessionId 處理
      const threadId = this.sessionToThread.get(threadIdOrSessionId);
      if (threadId) {
        this.sessionToThread.delete(threadIdOrSessionId);
        this.sessionToOpencodeSession.delete(threadIdOrSessionId);
        this.threadToSession.delete(threadId);
        this.threadInfo.delete(threadId);
        
        // 從資料庫刪除
        this.deleteThreadMappingFromDB(threadId);
        
        logger.info(`[ThreadManager] Deleted thread mapping for session ${threadIdOrSessionId} (thread: ${threadId})`);
      }
    }
  }

  /**
   * 從資料庫刪除 Thread 映射
   */
  private deleteThreadMappingFromDB(threadId: string): void {
    if (!this.sqliteDb?.isReady()) {
      return;
    }

    try {
      this.sqliteDb.prepare('DELETE FROM thread_mappings WHERE thread_id = ?').run(threadId);
    } catch (error) {
      logger.error(`[ThreadManager] 從資料庫刪除映射失敗: ${threadId}`, error);
    }
  }

  /**
   * Archive Thread
   * @param threadId Discord Thread ID
   */
  async archiveThread(threadId: string): Promise<void> {
    const info = this.threadInfo.get(threadId);
    const now = Date.now();
    
    if (info) {
      info.archived = true;
      info.archivedAt = new Date(now);
      
      // 更新資料庫
      if (this.sqliteDb?.isReady()) {
        try {
          this.sqliteDb.prepare(`
            UPDATE thread_mappings SET archived_at = ? WHERE thread_id = ?
          `).run(now, threadId);
        } catch (error) {
          logger.error(`[ThreadManager] 更新資料庫 archive 狀態失敗: ${threadId}`, error);
        }
      }
      
      logger.info(`[ThreadManager] Archived thread ${threadId} for session ${info.sessionId}`);
    }
  }

  /**
   * Archive Discord Thread（實際歸檔 Discord 頻道）
   * @param threadId Discord Thread ID
   * @throws ThreadMappingError 如果歸檔失敗
   */
  async archiveDiscordThread(threadId: string): Promise<void> {
    try {
      // 嘗試獲取 Thread 頻道
      const thread = await this.fetchThreadChannel(threadId);
      
      if (thread) {
        // 設定自動歸檔
        await thread.setAutoArchiveDuration(60); // 1 分鐘後歸檔
        await thread.setArchived(true);
        
        // 更新本地狀態
        await this.archiveThread(threadId);
        
        logger.info(`[ThreadManager] Discord thread ${threadId} 已歸檔`);
      } else {
        logger.warn(`[ThreadManager] 無法找到 Discord thread ${threadId}`);
      }
    } catch (error) {
      logger.error(`[ThreadManager] 歸檔 Discord thread ${threadId} 失敗:`, error);
      throw new ThreadMappingError(
        error instanceof Error ? error.message : String(error),
        threadId
      );
    }
  }

  /**
   * 獲取 ThreadChannel
   * @param threadId Discord Thread ID
   * @returns ThreadChannel 或 null（如果未找到或非 Thread 類型）
   * @throws ThreadMappingError 如果獲取失敗
   */
  private async fetchThreadChannel(threadId: string): Promise<ThreadChannel | null> {
    if (!this.discordClient) {
      logger.warn(`[ThreadManager] Discord Client 未設定，無法獲取 thread ${threadId}`);
      return null;
    }

    try {
      const channel = await this.discordClient.channels.fetch(threadId);
      
      if (channel instanceof ThreadChannel) {
        return channel;
      }
      
      logger.warn(`[ThreadManager] Channel ${threadId} 不是 ThreadChannel 類型`);
      return null;
    } catch (error) {
      logger.error(`[ThreadManager] 獲取 thread ${threadId} 失敗:`, error);
      throw new ThreadMappingError(
        error instanceof Error ? error.message : String(error),
        threadId
      );
    }
  }

  /**
   * 清理 Session（Session 結束時調用）
   * @param sessionId Session ID
   */
  async cleanupSession(sessionId: string): Promise<void> {
    const threadId = this.sessionToThread.get(sessionId);
    
    if (threadId) {
      // 嘗試歸檔 Discord thread
      try {
        await this.archiveDiscordThread(threadId);
        logger.info(`[ThreadManager] Session ${sessionId} 的 thread ${threadId} 已歸檔`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`[ThreadManager] Session ${sessionId} 的 thread ${threadId} 歸檔失敗:`, error);
        
        // 標記為需要手動清理
        this.markForManualCleanup(threadId, errorMessage);
        
        // 拋出 ThreadMappingError 以便上層處理
        throw new ThreadMappingError(
          `Session ${sessionId} cleanup failed: ${errorMessage}`,
          threadId,
          sessionId
        );
      }
      
      // 清除記憶體映射
      this.threadToSession.delete(threadId);
      this.sessionToThread.delete(sessionId);
      this.sessionToOpencodeSession.delete(sessionId);
      this.threadInfo.delete(threadId);
      
      logger.info(`[ThreadManager] Session ${sessionId} 清理完成，thread ${threadId} 已從記憶體移除`);
    } else {
      logger.warn(`[ThreadManager] Session ${sessionId} 沒有關聯的 thread`);
    }
  }

  /**
   * 標記為手動清理（出現錯誤時）
   * @param threadId Discord Thread ID
   * @param error 錯誤訊息
   */
  markForManualCleanup(threadId: string, error: string): void {
    this.manualCleanupPending.set(threadId, error);
    logger.warn(`[ThreadManager] Thread ${threadId} 標記為需要手動清理: ${error}`);
  }

  /**
   * 獲取待手動清理的列表
   */
  getPendingManualCleanup(): Array<{ threadId: string; error: string }> {
    return Array.from(this.manualCleanupPending.entries()).map(([threadId, error]) => ({
      threadId,
      error,
    }));
  }

  /**
   * 清除手動清理標記
   */
  clearManualCleanup(threadId: string): void {
    this.manualCleanupPending.delete(threadId);
  }

  /**
   * 獲取所有活躍的 Session Threads
   * @returns Thread 資訊陣列
   */
  getActiveThreads(): ThreadInfo[] {
    return Array.from(this.threadInfo.values()).filter(info => !info.archived);
  }

  /**
   * 獲取所有 Thread 資訊（包括已歸檔）
   * @returns Thread 資訊陣列
   */
  getAllThreads(): ThreadInfo[] {
    return Array.from(this.threadInfo.values());
  }

  /**
   * 獲取統計資訊
   */
  getStats(): {
    totalThreads: number;
    activeThreads: number;
    pendingCleanup: number;
  } {
    const activeThreads = this.getActiveThreads().length;
    return {
      totalThreads: this.threadInfo.size,
      activeThreads,
      pendingCleanup: this.manualCleanupPending.size,
    };
  }

  /**
   * 清空所有映射（用於測試或重置）
   */
  clear(): void {
    this.threadToSession.clear();
    this.sessionToThread.clear();
    this.sessionToOpencodeSession.clear();
    this.threadInfo.clear();
    this.manualCleanupPending.clear();
    logger.info('[ThreadManager] All thread mappings cleared');
  }

  /**
   * 檢查是否已初始化
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}

// ============== 單例實例 ==============

let threadManagerInstance: ThreadManager | null = null;

/**
 * 獲取 Thread 管理器單例實例
 */
export function getThreadManager(): ThreadManager {
  if (!threadManagerInstance) {
    threadManagerInstance = new ThreadManager();
  }
  return threadManagerInstance;
}

/**
 * 初始化 Thread 管理器（異步版本）
 * @param sqliteDb SQLite 資料庫實例
 * @returns Promise<ThreadManager>
 */
export async function initializeThreadManager(sqliteDb?: SQLiteDatabase): Promise<ThreadManager> {
  threadManagerInstance = new ThreadManager();
  
  if (sqliteDb) {
    await threadManagerInstance.initialize(sqliteDb);
  }
  
  return threadManagerInstance;
}

/**
 * 重置 Thread 管理器（主要用於測試）
 */
export function resetThreadManager(): void {
  if (threadManagerInstance) {
    threadManagerInstance.clear();
  }
  threadManagerInstance = null;
}

// ============== 導出 ==============

export default {
  ThreadManager,
  getThreadManager,
  initializeThreadManager,
  resetThreadManager,
};
