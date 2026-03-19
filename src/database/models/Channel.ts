/**
 * Channel 模型定義
 * @description Discord 頻道資料結構
 */

export interface ChannelData {
  /** 頻道 ID */
  channelId: string;
  /** 頻道名稱 */
  name: string;
  /** 專案路徑 */
  projectPath: string;
  /** 當前模型 */
  currentModel: string;
  /** 當前 Agent */
  currentAgent: string;
  /** Passthrough 模式 */
  passthroughMode: boolean;
  /** 作用中 Session ID */
  activeSessionId: string | null;
  /** 論壇頻道標籤 */
  tags: string[];
  /** 主題 */
  topic: string;
  /** 創建時間 */
  createdAt: string;
  /** 最後更新時間 */
  updatedAt: string;
  /** 頻道設定 */
  settings: ChannelSettings;
}

/**
 * 頻道設定
 */
export interface ChannelSettings {
  /** 是否啟用此頻道 */
  enabled: boolean;
  /** 是否自動回應 */
  autoRespond: boolean;
  /** 回應延遲（毫秒） */
  responseDelay: number;
  /** 最大歷史訊息數 */
  maxHistoryMessages: number;
  /** 是否記住對話歷史 */
  rememberHistory: boolean;
  /** 允許的指令清單 */
  allowedCommands: string[];
}

/**
 * Channel 模型類別
 */
export class Channel implements ChannelData {
  channelId: string;
  name: string;
  projectPath: string;
  currentModel: string;
  currentAgent: string;
  passthroughMode: boolean;
  activeSessionId: string | null;
  tags: string[];
  topic: string;
  createdAt: string;
  updatedAt: string;
  settings: ChannelSettings;

  constructor(data: Partial<ChannelData> & { channelId: string }) {
    this.channelId = data.channelId;
    this.name = data.name || '';
    this.projectPath = data.projectPath || '';
    this.currentModel = data.currentModel || 'anthropic/claude-sonnet-4';
    this.currentAgent = data.currentAgent || 'general';
    this.passthroughMode = data.passthroughMode || false;
    this.activeSessionId = data.activeSessionId || null;
    this.tags = data.tags || [];
    this.topic = data.topic || '';
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.settings = data.settings || this.defaultSettings();
  }

  /**
   * 預設頻道設定
   */
  private defaultSettings(): ChannelSettings {
    return {
      enabled: true,
      autoRespond: true,
      responseDelay: 0,
      maxHistoryMessages: 100,
      rememberHistory: true,
      allowedCommands: [],
    };
  }

  /**
   * 設定模型
   */
  setModel(model: string): void {
    this.currentModel = model;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 設定 Agent
   */
  setAgent(agent: string): void {
    this.currentAgent = agent;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 切換 Passthrough 模式
   */
  togglePassthrough(): boolean {
    this.passthroughMode = !this.passthroughMode;
    this.updatedAt = new Date().toISOString();
    return this.passthroughMode;
  }

  /**
   * 設定作用中 Session
   */
  setActiveSession(sessionId: string | null): void {
    this.activeSessionId = sessionId;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 是否有作用中的 Session
   */
  hasActiveSession(): boolean {
    return this.activeSessionId !== null;
  }

  /**
   * 新增標籤
   */
  addTag(tag: string): void {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
      this.updatedAt = new Date().toISOString();
    }
  }

  /**
   * 移除標籤
   */
  removeTag(tag: string): void {
    const index = this.tags.indexOf(tag);
    if (index > -1) {
      this.tags.splice(index, 1);
      this.updatedAt = new Date().toISOString();
    }
  }

  /**
   * 轉換為純物件
   */
  toJSON(): ChannelData {
    return {
      channelId: this.channelId,
      name: this.name,
      projectPath: this.projectPath,
      currentModel: this.currentModel,
      currentAgent: this.currentAgent,
      passthroughMode: this.passthroughMode,
      activeSessionId: this.activeSessionId,
      tags: this.tags,
      topic: this.topic,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      settings: this.settings,
    };
  }

  /**
   * 從 JSON 建立實例
   */
  static fromJSON(data: ChannelData): Channel {
    return new Channel(data);
  }
}
