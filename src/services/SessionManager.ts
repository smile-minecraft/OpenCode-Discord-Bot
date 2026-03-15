/**
 * Session 管理服務
 * @description 管理 OpenCode Session 生命週期，透過 child_process 呼叫 OpenCode CLI
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { Session, SessionStatus } from '../database/models/Session.js';
import { v4 as uuidv4 } from 'uuid';

// ============== 類型定義 ==============

/**
 * Session 創建選項
 */
export interface CreateSessionOptions {
  /** Discord 頻道 ID */
  channelId: string;
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

/**
 * OpenCode CLI 執行選項
 */
export interface OpenCodeExecutionOptions {
  /** OpenCode CLI 路徑 */
  cliPath?: string;
  /** 工作目錄 */
  workingDirectory?: string;
  /** 、環境變數 */
  env?: NodeJS.ProcessEnv;
  /** 輸出回調 */
  onOutput?: (data: string) => void;
  /** 錯誤回調 */
  onError?: (data: string) => void;
}

// ============== Session 管理器 ==============

/**
 * Session 管理器類
 * @description 負責管理 OpenCode Session 的生命週期
 */
export class SessionManager {
  /** 活跃的 Session 映射 */
  private activeSessions: Map<string, Session> = new Map();
  /** Session 程序映射 */
  private sessionProcesses: Map<string, ChildProcess> = new Map();
  /** OpenCode CLI 路徑 */
  private readonly cliPath: string;
  /** 預設模型 */
  private readonly defaultModel = 'anthropic/claude-sonnet-4-20250514';
  /** 預設 Agent */
  private readonly defaultAgent = 'general';

  /**
   * 創建 Session 管理器實例
   */
  constructor(options: { cliPath?: string } = {}) {
    this.cliPath = options.cliPath || 'opencode';
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

    // 異步啟動 OpenCode 進程
    this.startOpenCodeProcess(session).catch((error) => {
      console.error(`[SessionManager] 啟動 Session ${sessionId} 失敗:`, error);
      session.fail(error instanceof Error ? error.message : '未知錯誤');
    });

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
    session.resume();
    this.startOpenCodeProcess(session).catch((error) => {
      console.error(`[SessionManager] 恢復 Session ${sessionId} 失敗:`, error);
      session.fail(error instanceof Error ? error.message : '未知錯誤');
    });

    return session;
  }

  /**
   * 終止 Session
   */
  async abortSession(sessionId?: string): Promise<Session | null> {
    // 如果沒有指定 sessionId，嘗試獲取當前頻道的活跃 Session
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

    // 終止 OpenCode 進程
    await this.terminateSessionProcess(sessionId);

    // 更新 Session 狀態
    session.abort();

    // 從活動列表移除
    this.activeSessions.delete(sessionId);

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
   * 獲取 Session 實例
   */
  getSession(sessionId: string): Session | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * 獲取頻道的活跃 Session
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
   * 檢查頻道是否有活跃 Session
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
    // 根據 Discord 頻道 ID 生成專案路徑
    // 實際實現應該從數據庫或配置中獲取
    return path.join(process.cwd(), 'projects', channelId);
  }

  /**
   * 啟動 OpenCode 進程
   */
  private async startOpenCodeProcess(session: Session): Promise<void> {
    const args = [
      '--yes', // 自動確認
      '--model',
      session.model,
    ];

    if (session.prompt) {
      args.push(session.prompt);
    }

    console.log(`[SessionManager] 啟動 OpenCode: ${this.cliPath} ${args.join(' ')}`);

    const proc = spawn(this.cliPath, args, {
      cwd: session.projectPath || process.cwd(),
      shell: true,
      env: {
        ...process.env,
        OPENCODE_SESSION_ID: session.sessionId,
        DISCORD_CHANNEL_ID: session.channelId,
      },
    });

    // 註冊進程
    this.sessionProcesses.set(session.sessionId, proc);

    // 處理輸出
    proc.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      console.log(`[Session ${session.sessionId}] ${output}`);
      session.updateActivity();
    });

    // 處理錯誤
    proc.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      console.error(`[Session ${session.sessionId}] ERROR: ${output}`);
    });

    // 處理進程結束
    proc.on('close', (code) => {
      console.log(`[SessionManager] Session ${session.sessionId} 進程結束，代碼: ${code}`);

      // 移除進程引用
      this.sessionProcesses.delete(session.sessionId);

      // 更新 Session 狀態
      if (code === 0) {
        session.complete();
      } else if (session.status !== 'aborted') {
        session.fail(`進程以錯誤碼 ${code} 結束`);
      }
    });

    // 處理進程錯誤
    proc.on('error', (error) => {
      console.error(`[SessionManager] Session ${session.sessionId} 進程錯誤:`, error);
      session.fail(error.message);
    });

    // 標記為運行中
    session.markRunning();
  }

  /**
   * 終止 Session 進程
   */
  private async terminateSessionProcess(sessionId: string): Promise<void> {
    const proc = this.sessionProcesses.get(sessionId);

    if (proc) {
      // 發送終止信號
      proc.kill('SIGTERM');

      // 等待一段時間後強制終止
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);

      this.sessionProcesses.delete(sessionId);
    }
  }

  /**
   * 從持久化存儲加載 Session
   */
  private async loadSession(_sessionId: string): Promise<Session | null> {
    // TODO: 從數據庫或文件系統加載 Session
    // 這裡需要與 Kimaki 的數據庫整合
    return null;
  }

  /**
   * 保存 Session 到持久化存儲
   */
  private async saveSession(_session: Session): Promise<void> {
    // TODO: 保存 Session 到數據庫或文件系統
    // 這裡需要與 Kimaki 的數據庫整合
  }

  /**
   * 清理已結束的 Session
   */
  cleanupEndedSessions(): void {
    for (const [sessionId, session] of this.activeSessions) {
      if (session.isEnded()) {
        this.saveSession(session);
        this.activeSessions.delete(sessionId);
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
export function initializeSessionManager(options?: { cliPath?: string }): SessionManager {
  sessionManagerInstance = new SessionManager(options);
  return sessionManagerInstance;
}

// ============== 導出 ==============

export default {
  SessionManager,
  getSessionManager,
  initializeSessionManager,
};
