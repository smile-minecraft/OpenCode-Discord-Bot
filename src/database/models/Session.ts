/**
 * Session 模型定義
 * @description OpenCode Session 資料結構
 */

export interface SessionData {
  /** Session ID */
  sessionId: string;
  /** 關聯的 Discord 頻道 ID */
  channelId: string;
  /** 關聯的 Discord Thread ID（如有） */
  threadId: string | null;
  /** OpenCode 內部 Session ID */
  opencodeSessionId: string;
  /** 狀態 */
  status: SessionStatus;
  /** 提示詞 */
  prompt: string;
  /** 使用的模型 */
  model: string;
  /** 使用的 Agent */
  agent: string;
  /** 專案路徑 */
  projectPath: string;
  /** 開始時間 */
  startedAt: string;
  /** 最後活躍時間 */
  lastActiveAt: string;
  /** 結束時間 */
  endedAt: string | null;
  /** 花費的 tokens */
  tokensUsed: number;
  /** 訊息數量 */
  messageCount: number;
  /** 工具調用次數 */
  toolCallCount: number;
  /** 錯誤訊息（如有） */
  errorMessage: string | null;
  /** 元資料 */
  metadata: SessionMetadata;
  /** 建立時間 */
  createdAt: string;
  /** 最後更新時間 */
  updatedAt: string;
}

/**
 * Session 狀態
 */
export type SessionStatus = 
  | 'pending'      // 等待開始
  | 'starting'    // 正在啟動
  | 'running'     // 運行中
  | 'waiting'     // 等待用戶輸入
  | 'paused'      // 暫停
  | 'completed'   // 已完成
  | 'failed'      // 失敗
  | 'aborted';    // 已中止

/**
 * Session 元資料
 */
export interface SessionMetadata {
  /** Cloud Session ID（用於 OpenCode Cloud API） */
  cloudSessionId?: string;
  /** Provider ID（用於 OpenCode Cloud API） */
  providerId?: string;
  /** HTTP 伺服器埠號（已棄用，改用 cloudSessionId） */
  port?: number;
  /** OpenCode 內部 Session ID */
  opencodeSessionId?: string;
  /** 使用的模型資訊 */
  modelInfo?: {
    provider: string;
    name: string;
    version?: string;
  };
  /** Agent 資訊 */
  agentInfo?: {
    name: string;
    version?: string;
  };
  /** 檔案變更 */
  fileChanges?: FileChange[];
  /** 工具審批記錄 */
  toolApprovals?: ToolApproval[];
  /** 自訂標籤 */
  tags?: string[];
}

/**
 * 檔案變更
 */
export interface FileChange {
  /** 檔案路徑 */
  path: string;
  /** 變更類型 */
  type: 'created' | 'modified' | 'deleted';
  /** 行數變更 */
  linesAdded: number;
  /** 行數刪除 */
  linesRemoved: number;
  /** 時間戳記 */
  timestamp: string;
}

/**
 * 工具審批
 */
export interface ToolApproval {
  /** 工具名稱 */
  toolName: string;
  /** 審批狀態 */
  status: 'approved' | 'denied' | 'pending';
  /** 記住此選擇 */
  remember: boolean;
  /** 過期時間 */
  expiresAt: string | null;
  /** 審批時間 */
  approvedAt: string | null;
}

/**
 * Session 模型類別
 */
export class Session implements SessionData {
  sessionId: string;
  channelId: string;
  threadId: string | null;
  opencodeSessionId: string;
  status: SessionStatus;
  prompt: string;
  model: string;
  agent: string;
  projectPath: string;
  startedAt: string;
  lastActiveAt: string;
  endedAt: string | null;
  tokensUsed: number;
  messageCount: number;
  toolCallCount: number;
  errorMessage: string | null;
  metadata: SessionMetadata;
  createdAt: string;
  updatedAt: string;

  constructor(data: Partial<SessionData> & { sessionId: string; channelId: string }) {
    this.sessionId = data.sessionId;
    this.channelId = data.channelId;
    this.threadId = data.threadId || null;
    this.opencodeSessionId = data.opencodeSessionId || '';
    this.status = data.status || 'pending';
    this.prompt = data.prompt || '';
    this.model = data.model || 'anthropic/claude-sonnet-4';
    this.agent = data.agent || 'general';
    this.projectPath = data.projectPath || '';
    this.startedAt = data.startedAt || new Date().toISOString();
    this.lastActiveAt = data.lastActiveAt || new Date().toISOString();
    this.endedAt = data.endedAt || null;
    this.tokensUsed = data.tokensUsed || 0;
    this.messageCount = data.messageCount || 0;
    this.toolCallCount = data.toolCallCount || 0;
    this.errorMessage = data.errorMessage || null;
    this.metadata = data.metadata || {};
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  /**
   * 開始 Session
   */
  start(opencodeSessionId: string, model?: string, agent?: string): void {
    this.opencodeSessionId = opencodeSessionId;
    this.status = 'starting';
    if (model) this.model = model;
    if (agent) this.agent = agent;
    this.startedAt = new Date().toISOString();
    this.lastActiveAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 標記為運行中
   */
  markRunning(): void {
    this.status = 'running';
    this.lastActiveAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 標記為等待輸入
   */
  markWaiting(): void {
    this.status = 'waiting';
    this.lastActiveAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 暫停 Session
   */
  pause(): void {
    this.status = 'paused';
    this.lastActiveAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 恢復 Session
   */
  resume(): void {
    this.status = 'running';
    this.lastActiveAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 完成 Session
   */
  complete(): void {
    this.status = 'completed';
    this.endedAt = new Date().toISOString();
    this.lastActiveAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 中止 Session
   */
  abort(): void {
    this.status = 'aborted';
    this.endedAt = new Date().toISOString();
    this.lastActiveAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 失敗
   */
  fail(errorMessage: string): void {
    this.status = 'failed';
    this.errorMessage = errorMessage;
    this.endedAt = new Date().toISOString();
    this.lastActiveAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 更新活躍狀態
   */
  updateActivity(): void {
    this.lastActiveAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 增加訊息計數
   */
  incrementMessageCount(): void {
    this.messageCount++;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 增加工具調用次數
   */
  incrementToolCalls(count: number = 1): void {
    this.toolCallCount += count;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 新增檔案變更
   */
  addFileChange(change: FileChange): void {
    if (!this.metadata.fileChanges) {
      this.metadata.fileChanges = [];
    }
    this.metadata.fileChanges.push(change);
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 新增工具審批
   */
  addToolApproval(approval: ToolApproval): void {
    if (!this.metadata.toolApprovals) {
      this.metadata.toolApprovals = [];
    }
    this.metadata.toolApprovals.push(approval);
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 取得運行時長（毫秒）
   */
  getDuration(): number {
    const end = this.endedAt ? new Date(this.endedAt).getTime() : Date.now();
    return end - new Date(this.startedAt).getTime();
  }

  /**
   * 是否正在運行
   */
  isRunning(): boolean {
    return this.status === 'running' || this.status === 'starting';
  }

  /**
   * 是否已結束
   */
  isEnded(): boolean {
    return ['completed', 'failed', 'aborted'].includes(this.status);
  }

  /**
   * 轉換為純物件
   */
  toJSON(): SessionData {
    return {
      sessionId: this.sessionId,
      channelId: this.channelId,
      threadId: this.threadId,
      opencodeSessionId: this.opencodeSessionId,
      status: this.status,
      prompt: this.prompt,
      model: this.model,
      agent: this.agent,
      projectPath: this.projectPath,
      startedAt: this.startedAt,
      lastActiveAt: this.lastActiveAt,
      endedAt: this.endedAt,
      tokensUsed: this.tokensUsed,
      messageCount: this.messageCount,
      toolCallCount: this.toolCallCount,
      errorMessage: this.errorMessage,
      metadata: this.metadata,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * 從 JSON 建立實例
   */
  static fromJSON(data: SessionData): Session {
    return new Session(data);
  }
}
