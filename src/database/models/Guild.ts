/**
 * Guild 模型定義
 * @description Discord 伺服器資料結構
 */

import { randomUUID } from 'crypto';

export interface GuildData {
  /** 伺服器 ID */
  guildId: string;
  /** 伺服器名稱 */
  name: string;
  /** 擁有者 ID */
  ownerId: string;
  /** 創建時間 */
  createdAt: string;
  /** 最後更新時間 */
  updatedAt: string;
  /** 頻道配置 */
  channels: Record<string, ChannelData>;
  /** 權限配置 */
  permissions: PermissionData;
  /** 佇列 */
  queue: QueueItem[];
  /** 機器人設定 */
  settings: GuildSettings;
}

/**
 * 頻道資料
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
  /** 創建時間 */
  createdAt: string;
  /** 最後更新時間 */
  updatedAt: string;
}

/**
 * 權限資料
 */
export interface PermissionData {
  /** 預設權限等級 */
  defaultLevel: PermissionLevel;
  /** 允許的角色 ID 清單 */
  allowedRoles: string[];
  /** 允許的使用者 ID 清單 */
  allowedUsers: string[];
  /** 權限模式 */
  mode: 'role' | 'user' | 'everyone';
}

/**
 * 權限等級
 */
export type PermissionLevel = 'admin' | 'moderator' | 'user' | 'none';

/**
 * 佇列項目
 */
export interface QueueItem {
  /** 佇列 ID */
  id: string;
  /** 提示詞 */
  prompt: string;
  /** 狀態 */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** 建立時間 */
  createdAt: string;
  /** 開始時間 */
  startedAt: string | null;
  /** 完成時間 */
  completedAt: string | null;
  /** 關聯的頻道 ID */
  channelId: string;
}

/**
 * 伺服器設定
 */
export interface GuildSettings {
  /** 是否啟用機器人 */
  enabled: boolean;
  /** 是否自動建立 Session */
  autoStartSession: boolean;
  /** 最大並發 Session 數 */
  maxConcurrentSessions: number;
  /** 預設模型 */
  defaultModel: string;
  /** 預設 Agent */
  defaultAgent: string;
  /** 允許的模型清單 */
  allowedModels: string[];
  /** 允許的 Agent 清單 */
  allowedAgents: string[];
  /** OpenCode CLI 路徑 */
  opencodePath?: string;
}

/**
 * Guild 模型類別
 */
export class Guild implements GuildData {
  guildId: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  channels: Record<string, ChannelData>;
  permissions: PermissionData;
  queue: QueueItem[];
  settings: GuildSettings;

  constructor(data: Partial<GuildData> & { guildId: string; name: string }) {
    this.guildId = data.guildId;
    this.name = data.name;
    this.ownerId = data.ownerId || '';
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.channels = data.channels || {};
    this.permissions = data.permissions || this.defaultPermissions();
    this.queue = data.queue || [];
    this.settings = data.settings || this.defaultSettings();
  }

  /**
   * 預設權限設定
   */
  private defaultPermissions(): PermissionData {
    return {
      defaultLevel: 'user',
      allowedRoles: [],
      allowedUsers: [],
      mode: 'everyone',
    };
  }

  /**
   * 預設伺服器設定
   */
  private defaultSettings(): GuildSettings {
    return {
      enabled: true,
      autoStartSession: false,
      maxConcurrentSessions: 3,
      defaultModel: 'anthropic/claude-sonnet-4',
      defaultAgent: 'general',
      allowedModels: [],
      allowedAgents: [],
    };
  }

  /**
   * 新增頻道
   */
  addChannel(channelId: string, name: string, projectPath: string): ChannelData {
    const channel: ChannelData = {
      channelId,
      name,
      projectPath,
      currentModel: this.settings.defaultModel,
      currentAgent: this.settings.defaultAgent,
      passthroughMode: false,
      activeSessionId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.channels[channelId] = channel;
    this.updatedAt = new Date().toISOString();
    return channel;
  }

  /**
   * 移除頻道
   */
  removeChannel(channelId: string): boolean {
    if (this.channels[channelId]) {
      delete this.channels[channelId];
      this.updatedAt = new Date().toISOString();
      return true;
    }
    return false;
  }

  /**
   * 取得頻道
   */
  getChannel(channelId: string): ChannelData | undefined {
    return this.channels[channelId];
  }

  /**
   * 新增項目到佇列
   */
  addToQueue(item: Omit<QueueItem, 'id' | 'createdAt' | 'status'>): QueueItem {
    const queueItem: QueueItem = {
      ...item,
      id: `queue_${Date.now()}_${randomUUID().substring(0, 8)}`,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.queue.push(queueItem);
    this.updatedAt = new Date().toISOString();
    return queueItem;
  }

  /**
   * 轉換為純物件
   */
  toJSON(): GuildData {
    return {
      guildId: this.guildId,
      name: this.name,
      ownerId: this.ownerId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      channels: this.channels,
      permissions: this.permissions,
      queue: this.queue,
      settings: this.settings,
    };
  }
}
