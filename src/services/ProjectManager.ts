/**
 * ProjectManager - 專案管理服務
 * @description 負責專案資料的管理、路徑驗證和別名管理
 */

import { Project, ProjectData } from '../database/models/Project.js';
import * as fs from 'fs';
import * as path from 'path';

export interface ProjectManagerConfig {
  /** 專案資料存儲路徑 */
  dataPath?: string;
  /** 最大專案數量 */
  maxProjects?: number;
  /** 是否啟用路徑驗證 */
  validatePaths?: boolean;
}

export interface ProjectAlias {
  /** 別名名稱 */
  alias: string;
  /** 專案 ID */
  projectId: string;
  /** 建立時間 */
  createdAt: string;
}

export interface ChannelBinding {
  /** 頻道 ID */
  channelId: string;
  /** 專案 ID */
  projectId: string;
  /** 綁定時間 */
  boundAt: string;
}

/**
 * 專案管理器
 * @description 提供專案的 CRUD 操作、路徑驗證和別名管理
 */
export class ProjectManager {
  private projects: Map<string, Project> = new Map();
  private aliases: Map<string, ProjectAlias> = new Map();
  private channelBindings: Map<string, ChannelBinding> = new Map();
  private config: Required<ProjectManagerConfig>;
  private saveCallback?: (data: ProjectExportData) => Promise<void>;
  private loadCallback?: () => Promise<ProjectExportData | null>;

  constructor(config: ProjectManagerConfig = {}) {
    this.config = {
      dataPath: config.dataPath || './data/projects.json',
      maxProjects: config.maxProjects || 50,
      validatePaths: config.validatePaths ?? true,
    };
  }

  // ============== 生命週期方法 ==============

  /**
   * 設置資料持久化回調
   */
  setSaveCallback(callback: (data: ProjectExportData) => Promise<void>): void {
    this.saveCallback = callback;
  }

  setLoadCallback(callback: () => Promise<ProjectExportData | null>): void {
    this.loadCallback = callback;
  }

  /**
   * 初始化管理器
   */
  async initialize(): Promise<void> {
    if (this.loadCallback) {
      const data = await this.loadCallback();
      if (data) {
        this.importData(data);
      }
    }
  }

  /**
   * 保存資料
   */
  async save(): Promise<void> {
    if (this.saveCallback) {
      await this.saveCallback(this.exportData());
    }
  }

  // ============== 專案 CRUD 操作 ==============

  /**
   * 創建新專案
   */
  async createProject(options: {
    name: string;
    path: string;
    alias?: string;
    description?: string;
    gitRemoteUrl?: string;
    gitBranch?: string;
  }): Promise<Project> {
    // 驗證路徑
    if (this.config.validatePaths) {
      const pathValidation = this.validatePath(options.path);
      if (!pathValidation.valid) {
        throw new Error(pathValidation.error || '路徑驗證失敗');
      }
    }

    // 檢查是否已達最大數量
    if (this.projects.size >= this.config.maxProjects) {
      throw new Error(`已達最大專案數量限制 (${this.config.maxProjects})`);
    }

    // 檢查路徑是否已存在
    const existingByPath = this.getProjectByPath(options.path);
    if (existingByPath) {
      throw new Error('此路徑已存在於專案列表中');
    }

    // 檢查名稱是否重複
    const existingByName = this.getProjectByName(options.name);
    if (existingByName) {
      throw new Error('專案名稱已存在');
    }

    // 生成專案 ID
    const projectId = this.generateProjectId();

    // 創建專案
    const project = new Project({
      projectId,
      name: options.name,
      path: options.path,
      description: options.description || '',
      gitRemoteUrl: options.gitRemoteUrl || null,
      gitBranch: options.gitBranch || 'main',
    });

    // 存儲專案
    this.projects.set(projectId, project);

    // 處理別名
    if (options.alias) {
      this.setAlias(options.alias, projectId);
    }

    // 自動保存
    await this.save();

    return project;
  }

  /**
   * 獲取專案
   */
  getProject(projectId: string): Project | null {
    return this.projects.get(projectId) || null;
  }

  /**
   * 根據名稱獲取專案
   */
  getProjectByName(name: string): Project | null {
    for (const project of this.projects.values()) {
      if (project.name === name) {
        return project;
      }
    }
    return null;
  }

  /**
   * 根據路徑獲取專案
   */
  getProjectByPath(projectPath: string): Project | null {
    for (const project of this.projects.values()) {
      if (project.path === projectPath) {
        return project;
      }
    }
    return null;
  }

  /**
   * 獲取所有專案
   */
  getAllProjects(): Project[] {
    return Array.from(this.projects.values());
  }

  /**
   * 獲取專案數量
   */
  getProjectCount(): number {
    return this.projects.size;
  }

  /**
   * 更新專案
   */
  async updateProject(
    projectId: string,
    updates: Partial<{
      name: string;
      path: string;
      description: string;
      gitRemoteUrl: string | null;
      gitBranch: string;
      defaultModel: string;
      defaultAgent: string;
    }>
  ): Promise<Project | null> {
    const project = this.projects.get(projectId);
    if (!project) {
      return null;
    }

    // 如果更新路徑，驗證新路徑
    if (updates.path && updates.path !== project.path) {
      if (this.config.validatePaths) {
        const pathValidation = this.validatePath(updates.path);
        if (!pathValidation.valid) {
          throw new Error(pathValidation.error || '路徑驗證失敗');
        }
      }

      // 檢查新路徑是否已存在
      const existingByPath = this.getProjectByPath(updates.path);
      if (existingByPath && existingByPath.projectId !== projectId) {
        throw new Error('此路徑已存在於專案列表中');
      }
    }

    // 如果更新名稱，檢查是否重複
    if (updates.name && updates.name !== project.name) {
      const existingByName = this.getProjectByName(updates.name);
      if (existingByName && existingByName.projectId !== projectId) {
        throw new Error('專案名稱已存在');
      }
    }

    // 應用更新
    if (updates.name) project.name = updates.name;
    if (updates.path) project.path = updates.path;
    if (updates.description !== undefined) project.description = updates.description;
    if (updates.gitRemoteUrl !== undefined) project.gitRemoteUrl = updates.gitRemoteUrl;
    if (updates.gitBranch) project.gitBranch = updates.gitBranch;
    if (updates.defaultModel) project.defaultModel = updates.defaultModel;
    if (updates.defaultAgent) project.defaultAgent = updates.defaultAgent;

    project.updatedAt = new Date().toISOString();

    await this.save();

    return project;
  }

  /**
   * 刪除專案
   */
  async deleteProject(projectId: string): Promise<boolean> {
    const project = this.projects.get(projectId);
    if (!project) {
      return false;
    }

    // 移除別名
    this.removeAliasByProjectId(projectId);

    // 解除頻道綁定
    this.unbindChannelByProjectId(projectId);

    // 移除專案
    this.projects.delete(projectId);

    await this.save();

    return true;
  }

  // ============== 路徑驗證 ==============

  /**
   * 驗證路徑
   */
  validatePath(projectPath: string): { valid: boolean; error?: string; exists?: boolean } {
    // 檢查路徑是否為空
    if (!projectPath || projectPath.trim() === '') {
      return { valid: false, error: '路徑不能為空' };
    }

    // 檢查路徑格式（支援絕對路徑和相對路徑）
    const normalizedPath = path.normalize(projectPath);

    // 檢查路徑是否存在
    try {
      const exists = fs.existsSync(normalizedPath);
      if (!exists) {
        return { valid: true, error: '路徑不存在', exists: false };
      }

      // 檢查是否為目錄
      const stats = fs.statSync(normalizedPath);
      if (!stats.isDirectory()) {
        return { valid: false, error: '路徑不是有效的目錄' };
      }

      return { valid: true, exists: true };
    } catch (error) {
      return { valid: false, error: `無法訪問路徑: ${(error as Error).message}` };
    }
  }

  // ============== 別名管理 ==============

  /**
   * 設置別名
   */
  setAlias(alias: string, projectId: string): void {
    // 驗證別名格式
    const aliasValidation = this.validateAlias(alias);
    if (!aliasValidation.valid) {
      throw new Error(aliasValidation.error || '別名格式無效');
    }

    // 檢查專案是否存在
    if (!this.projects.has(projectId)) {
      throw new Error('專案不存在');
    }

    // 檢查別名是否已被使用
    const existingAlias = this.aliases.get(alias);
    if (existingAlias && existingAlias.projectId !== projectId) {
      throw new Error('此別名已被其他專案使用');
    }

    // 設置別名
    this.aliases.set(alias, {
      alias,
      projectId,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * 獲取別名對應的專案
   */
  getProjectByAlias(alias: string): Project | null {
    const aliasData = this.aliases.get(alias);
    if (!aliasData) {
      return null;
    }
    return this.projects.get(aliasData.projectId) || null;
  }

  /**
   * 移除別名
   */
  removeAlias(alias: string): boolean {
    return this.aliases.delete(alias);
  }

  /**
   * 根據專案 ID 移除別名
   */
  removeAliasByProjectId(projectId: string): void {
    for (const [alias, data] of this.aliases) {
      if (data.projectId === projectId) {
        this.aliases.delete(alias);
      }
    }
  }

  /**
   * 獲取專案的所有別名
   */
  getAliasesForProject(projectId: string): string[] {
    const result: string[] = [];
    for (const [alias, data] of this.aliases) {
      if (data.projectId === projectId) {
        result.push(alias);
      }
    }
    return result;
  }

  /**
   * 驗證別名
   */
  validateAlias(alias: string): { valid: boolean; error?: string } {
    if (!alias || alias.trim() === '') {
      return { valid: false, error: '別名不能為空' };
    }

    // 別名格式：字母、數字、連字符、下劃線，2-20 個字符
    const aliasRegex = /^[a-zA-Z0-9_-]{2,20}$/;
    if (!aliasRegex.test(alias)) {
      return { valid: false, error: '別名格式無效（僅支援字母、數字、連字符和下劃線，2-20個字符）' };
    }

    // 檢查是否為保留字
    const reserved = ['list', 'add', 'use', 'remove', 'help', 'new', 'delete'];
    if (reserved.includes(alias.toLowerCase())) {
      return { valid: false, error: '此別名為保留字' };
    }

    return { valid: true };
  }

  // ============== 頻道綁定 ==============

  /**
   * 綁定專案到頻道
   */
  bindProjectToChannel(projectId: string, channelId: string): void {
    // 檢查專案是否存在
    if (!this.projects.has(projectId)) {
      throw new Error('專案不存在');
    }

    const project = this.projects.get(projectId)!;
    project.bindChannel(channelId);

    // 設置頻道綁定
    this.channelBindings.set(channelId, {
      channelId,
      projectId,
      boundAt: new Date().toISOString(),
    });
  }

  /**
   * 解除頻道綁定
   */
  unbindChannel(channelId: string): boolean {
    const binding = this.channelBindings.get(channelId);
    if (!binding) {
      return false;
    }

    const project = this.projects.get(binding.projectId);
    if (project) {
      project.unbindChannel();
    }

    this.channelBindings.delete(channelId);
    return true;
  }

  /**
   * 根據專案 ID 解除綁定
   */
  unbindChannelByProjectId(projectId: string): void {
    for (const [channelId, binding] of this.channelBindings) {
      if (binding.projectId === projectId) {
        this.channelBindings.delete(channelId);
      }
    }
  }

  /**
   * 獲取頻道綁定的專案
   */
  getProjectByChannel(channelId: string): Project | null {
    const binding = this.channelBindings.get(channelId);
    if (!binding) {
      return null;
    }
    return this.projects.get(binding.projectId) || null;
  }

  /**
   * 獲取頻道綁定資訊
   */
  getChannelBinding(channelId: string): ChannelBinding | null {
    return this.channelBindings.get(channelId) || null;
  }

  /**
   * 獲取所有頻道綁定
   */
  getAllChannelBindings(): ChannelBinding[] {
    return Array.from(this.channelBindings.values());
  }

  // ============== 數據導入導出 ==============

  /**
   * 導出資料
   */
  exportData(): ProjectExportData {
    const projects: ProjectData[] = [];
    for (const project of this.projects.values()) {
      projects.push(project.toJSON());
    }

    const aliases: ProjectAlias[] = [];
    for (const alias of this.aliases.values()) {
      aliases.push(alias);
    }

    const bindings: ChannelBinding[] = [];
    for (const binding of this.channelBindings.values()) {
      bindings.push(binding);
    }

    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      projects,
      aliases,
      bindings,
    };
  }

  /**
   * 導入資料
   */
  importData(data: ProjectExportData): void {
    // 清除現有資料
    this.projects.clear();
    this.aliases.clear();
    this.channelBindings.clear();

    // 導入專案
    for (const projectData of data.projects) {
      const project = Project.fromJSON(projectData);
      this.projects.set(project.projectId, project);
    }

    // 導入別名
    for (const alias of data.aliases) {
      this.aliases.set(alias.alias, alias);
    }

    // 導入頻道綁定
    for (const binding of data.bindings) {
      this.channelBindings.set(binding.channelId, binding);
    }
  }

  // ============== 工具方法 ==============

  /**
   * 生成專案 ID
   */
  private generateProjectId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `proj_${timestamp}_${random}`;
  }

  /**
   * 搜尋專案
   */
  searchProjects(query: string): Project[] {
    const lowerQuery = query.toLowerCase();
    const results: Project[] = [];

    for (const project of this.projects.values()) {
      // 匹配名稱
      if (project.name.toLowerCase().includes(lowerQuery)) {
        results.push(project);
        continue;
      }

      // 匹配路徑
      if (project.path.toLowerCase().includes(lowerQuery)) {
        results.push(project);
        continue;
      }

      // 匹配別名
      const aliases = this.getAliasesForProject(project.projectId);
      if (aliases.some((a) => a.toLowerCase().includes(lowerQuery))) {
        results.push(project);
      }
    }

    return results;
  }
}

/**
 * 導出資料格式
 */
export interface ProjectExportData {
  /** 版本 */
  version: string;
  /** 導出時間 */
  exportedAt: string;
  /** 專案列表 */
  projects: ProjectData[];
  /** 別名列表 */
  aliases: ProjectAlias[];
  /** 頻道綁定列表 */
  bindings: ChannelBinding[];
}

/**
 * 創建專案管理器實例
 */
export function createProjectManager(config?: ProjectManagerConfig): ProjectManager {
  return new ProjectManager(config);
}

export default ProjectManager;
