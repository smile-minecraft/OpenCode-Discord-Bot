/**
 * Project 模型定義
 * @description 專案資料結構
 */

import { randomUUID } from 'crypto';

export interface ProjectData {
  /** 專案 ID */
  projectId: string;
  /** 專案名稱 */
  name: string;
  /** 專案路徑 */
  path: string;
  /** Git 遠端 URL */
  gitRemoteUrl: string | null;
  /** Git 分支 */
  gitBranch: string;
  /** 描述 */
  description: string;
  /** 標籤 */
  tags: string[];
  /** 關聯的 Discord 頻道 ID */
  channelId: string | null;
  /** 使用的模型 */
  defaultModel: string;
  /** 使用的 Agent */
  defaultAgent: string;
  /** 專案設定 */
  settings: ProjectSettings;
  /** 統計資料 */
  stats: ProjectStats;
  /** 建立時間 */
  createdAt: string;
  /** 最後更新時間 */
  updatedAt: string;
}

/**
 * 專案設定
 */
export interface ProjectSettings {
  /** 是否啟用 */
  enabled: boolean;
  /** 是否自動保存 */
  autoSave: boolean;
  /** 自動保存間隔（秒） */
  autoSaveInterval: number;
  /** 最大並發工具調用數 */
  maxConcurrentTools: number;
  /** 允許的工具清單 */
  allowedTools: string[];
  /** 禁止的工具清單 */
  blockedTools: string[];
  /** 自定義環境變數 */
  envVariables: Record<string, string>;
  /** 是否啟用 git worktree */
  useGitWorktree: boolean;
  /** 預設工作目錄 */
  defaultCwd: string | null;
}

/**
 * 專案統計
 */
export interface ProjectStats {
  /** 總 Session 數 */
  totalSessions: number;
  /** 完成的 Session 數 */
  completedSessions: number;
  /** 總訊息數 */
  totalMessages: number;
  /** 總 tokens 使用量 */
  totalTokensUsed: number;
  /** 總工具調用次數 */
  totalToolCalls: number;
  /** 最後一次使用時間 */
  lastUsedAt: string | null;
  /** 最後一次活躍時間 */
  lastActiveAt: string | null;
}

/**
 * Project 模型類別
 */
export class Project implements ProjectData {
  projectId: string;
  name: string;
  path: string;
  gitRemoteUrl: string | null;
  gitBranch: string;
  description: string;
  tags: string[];
  channelId: string | null;
  defaultModel: string;
  defaultAgent: string;
  settings: ProjectSettings;
  stats: ProjectStats;
  createdAt: string;
  updatedAt: string;

  constructor(data: Partial<ProjectData> & { projectId: string; name: string; path: string }) {
    this.projectId = data.projectId;
    this.name = data.name;
    this.path = data.path;
    this.gitRemoteUrl = data.gitRemoteUrl || null;
    this.gitBranch = data.gitBranch || 'main';
    this.description = data.description || '';
    this.tags = data.tags || [];
    this.channelId = data.channelId || null;
    this.defaultModel = data.defaultModel || 'anthropic/claude-sonnet-4';
    this.defaultAgent = data.defaultAgent || 'general';
    this.settings = data.settings || this.defaultSettings();
    this.stats = data.stats || this.defaultStats();
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  /**
   * 預設專案設定
   */
  private defaultSettings(): ProjectSettings {
    return {
      enabled: true,
      autoSave: true,
      autoSaveInterval: 300,
      maxConcurrentTools: 5,
      allowedTools: [],
      blockedTools: [],
      envVariables: {},
      useGitWorktree: false,
      defaultCwd: null,
    };
  }

  /**
   * 預設統計資料
   */
  private defaultStats(): ProjectStats {
    return {
      totalSessions: 0,
      completedSessions: 0,
      totalMessages: 0,
      totalTokensUsed: 0,
      totalToolCalls: 0,
      lastUsedAt: null,
      lastActiveAt: null,
    };
  }

  /**
   * 綁定 Discord 頻道
   */
  bindChannel(channelId: string): void {
    this.channelId = channelId;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 解除綁定頻道
   */
  unbindChannel(): void {
    this.channelId = null;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 設定預設模型
   */
  setDefaultModel(model: string): void {
    this.defaultModel = model;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 設定預設 Agent
   */
  setDefaultAgent(agent: string): void {
    this.defaultAgent = agent;
    this.updatedAt = new Date().toISOString();
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
   * 更新統計資料
   */
  updateStats(sessionCompleted: boolean = false, messages: number = 0, tokens: number = 0, toolCalls: number = 0): void {
    if (sessionCompleted) {
      this.stats.totalSessions++;
      this.stats.completedSessions++;
    }
    this.stats.totalMessages += messages;
    this.stats.totalTokensUsed += tokens;
    this.stats.totalToolCalls += toolCalls;
    this.stats.lastUsedAt = new Date().toISOString();
    this.stats.lastActiveAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 記錄使用
   */
  recordUsage(): void {
    this.stats.totalSessions++;
    this.stats.lastUsedAt = new Date().toISOString();
    this.stats.lastActiveAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 設定環境變數
   */
  setEnvVariable(key: string, value: string): void {
    this.settings.envVariables[key] = value;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 移除環境變數
   */
  removeEnvVariable(key: string): void {
    delete this.settings.envVariables[key];
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 啟用工具
   */
  enableTool(toolName: string): void {
    const blockedIndex = this.settings.blockedTools.indexOf(toolName);
    if (blockedIndex > -1) {
      this.settings.blockedTools.splice(blockedIndex, 1);
    }
    if (!this.settings.allowedTools.includes(toolName)) {
      this.settings.allowedTools.push(toolName);
    }
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 禁用工具
   */
  disableTool(toolName: string): void {
    const allowedIndex = this.settings.allowedTools.indexOf(toolName);
    if (allowedIndex > -1) {
      this.settings.allowedTools.splice(allowedIndex, 1);
    }
    if (!this.settings.blockedTools.includes(toolName)) {
      this.settings.blockedTools.push(toolName);
    }
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 啟用 Git Worktree
   */
  enableGitWorktree(): void {
    this.settings.useGitWorktree = true;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 停用 Git Worktree
   */
  disableGitWorktree(): void {
    this.settings.useGitWorktree = false;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * 是否已綁定頻道
   */
  isBoundToChannel(): boolean {
    return this.channelId !== null;
  }

  /**
   * 取得完成率
   */
  getCompletionRate(): number {
    if (this.stats.totalSessions === 0) return 0;
    return (this.stats.completedSessions / this.stats.totalSessions) * 100;
  }

  /**
   * 轉換為純物件
   */
  toJSON(): ProjectData {
    return {
      projectId: this.projectId,
      name: this.name,
      path: this.path,
      gitRemoteUrl: this.gitRemoteUrl,
      gitBranch: this.gitBranch,
      description: this.description,
      tags: this.tags,
      channelId: this.channelId,
      defaultModel: this.defaultModel,
      defaultAgent: this.defaultAgent,
      settings: this.settings,
      stats: this.stats,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * 從 JSON 建立實例
   */
  static fromJSON(data: ProjectData): Project {
    return new Project(data);
  }

  /**
   * 從路徑建立專案
   */
  static fromPath(projectPath: string): Project {
    const pathParts = projectPath.split('/');
    const name = pathParts[pathParts.length - 1] || 'Untitled';
    const projectId = `project_${Date.now()}_${randomUUID().substring(0, 8)}`;
    
    return new Project({
      projectId,
      name,
      path: projectPath,
    });
  }
}
