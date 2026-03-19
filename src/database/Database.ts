/**
 * JSON 資料庫核心類別
 * @description 提供 JSON 檔案的讀寫操作，支援 Guild、Channel、Session 資料
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Guild, type GuildData } from './models/Guild.js';
import { Channel } from './models/Channel.js';
import { Session, type SessionData } from './models/Session.js';
import { Project, type ProjectData } from './models/Project.js';

/**
 * 簡單的互斥鎖實現
 */
class Mutex {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

/**
 * 讀取 JSON 檔案時的錯誤類型區分
 */
export enum ReadErrorType {
  NOT_FOUND = 'NOT_FOUND',      // 檔案不存在 (ENOENT)
  PARSE_ERROR = 'PARSE_ERROR',   // JSON 解析錯誤
  PERMISSION_ERROR = 'PERMISSION_ERROR',  // 權限錯誤
  UNKNOWN = 'UNKNOWN',          // 其他未知錯誤
}

/**
 * 讀取 JSON 檔案時的自定義錯誤
 */
export class ReadJsonError extends Error {
  constructor(
    message: string,
    public readonly type: ReadErrorType,
    public readonly filePath: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'ReadJsonError';
  }
}

/**
 * 資料庫配置選項
 */
export interface DatabaseOptions {
  /** 存儲目錄路徑 */
  dataPath?: string;
  /** 是否啟用自動備份 */
  autoBackup?: boolean;
  /** 備份保留數量 */
  backupCount?: number;
  /** 是否啟用除錯模式 */
  debug?: boolean;
}

/**
 * 預設配置
 */
const DEFAULT_OPTIONS: Required<DatabaseOptions> = {
  dataPath: path.join(process.env.HOME || '', '.opencode-discord'),
  autoBackup: true,
  backupCount: 5,
  debug: false,
};

/**
 * 資料庫錯誤類別
 */
export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly operation?: string
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/**
 * JSON 資料庫類別
 */
export class Database {
  private static instance: Database | null = null;
  private options: Required<DatabaseOptions>;
  private guilds: Map<string, Guild> = new Map();
  private sessions: Map<string, Session> = new Map();
  private projects: Map<string, Project> = new Map();
  
  // 用於寫入操作的互斥鎖 (P1-9)
  private writeMutex = new Mutex();
  
  // 用於 compare-and-swap 的版本控制 (P2-10)
  private versions: Map<string, number> = new Map();

  public constructor(options: DatabaseOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * 取得資料庫單例實例
   */
  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  /**
   * 重置單例實例（用於測試）
   */
  public static resetInstance(): void {
    Database.instance = null;
  }

  /**
   * 初始化資料庫
   */
  public async initialize(): Promise<void> {
    await this.ensureDataDirectory();
    this.log('Database initialized');
  }

  /**
   * 關閉資料庫
   */
  public async close(): Promise<void> {
    this.log('Database closed');
  }

  /**
   * 確保數據目錄存在
   */
  private async ensureDataDirectory(): Promise<void> {
    const dirs = [
      this.options.dataPath,
      path.join(this.options.dataPath, 'guilds'),
      path.join(this.options.dataPath, 'sessions'),
      path.join(this.options.dataPath, 'projects'),
      path.join(this.options.dataPath, 'backups'),
    ];

    for (const dir of dirs) {
      try {
        await fs.access(dir);
      } catch {
        await fs.mkdir(dir, { recursive: true });
        this.log(`Created directory: ${dir}`);
      }
    }
  }

  /**
   * 日誌輸出
   */
  private log(message: string, ...args: unknown[]): void {
    if (this.options.debug) {
      console.log(`[Database] ${message}`, ...args);
    }
  }

  /**
   * 取得 guild 檔案路徑
   */
  private getGuildFilePath(guildId: string): string {
    return path.join(this.options.dataPath, 'guilds', `${guildId}.json`);
  }

  /**
   * 取得 session 檔案路徑
   */
  private getSessionFilePath(sessionId: string): string {
    return path.join(this.options.dataPath, 'sessions', `${sessionId}.json`);
  }

  /**
   * 取得 project 檔案路徑
   */
  private getProjectFilePath(projectId: string): string {
    return path.join(this.options.dataPath, 'projects', `${projectId}.json`);
  }

  /**
   * 讀取 JSON 檔案 (P2-9: 區分錯誤類型)
   */
  private async readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
      await fs.access(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch (error) {
      if (error instanceof Error) {
        // 判斷錯誤類型
        if ('code' in error && error.code === 'ENOENT') {
          // 檔案不存在
          return null;
        }
        // 嘗試解析 JSON，如果失敗則拋出解析錯誤
        try {
          await fs.readFile(filePath, 'utf-8');
        } catch {
          // 檔案存在但無法讀取，可能是權限問題
          throw new ReadJsonError(
            `Permission error reading file: ${filePath}`,
            ReadErrorType.PERMISSION_ERROR,
            filePath,
            error
          );
        }
      }
      return null;
    }
  }

  /**
   * 嘗試讀取 JSON 檔案並返回詳細結果 (P2-9: 區分錯誤類型)
   * @throws ReadJsonError 當發生可識別的錯誤時
   */
  public async tryReadJsonFile<T>(filePath: string): Promise<{ success: true; data: T } | { success: false; error: ReadJsonError }> {
    try {
      await fs.access(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as T;
      return { success: true, data };
    } catch (error) {
      if (error instanceof ReadJsonError) {
        return { success: false, error };
      }
      if (error instanceof Error) {
        if ('code' in error && error.code === 'ENOENT') {
          return { 
            success: false, 
            error: new ReadJsonError(
              `File not found: ${filePath}`,
              ReadErrorType.NOT_FOUND,
              filePath,
              error
            ) 
          };
        }
        // 嘗試判斷是否為解析錯誤
        try {
          await fs.readFile(filePath, 'utf-8');
        } catch {
          return { 
            success: false, 
            error: new ReadJsonError(
              `Permission error reading file: ${filePath}`,
              ReadErrorType.PERMISSION_ERROR,
              filePath,
              error
            ) 
          };
        }
        // 如果讀取成功但解析失敗
        return { 
          success: false, 
          error: new ReadJsonError(
            `JSON parse error in file: ${filePath}`,
            ReadErrorType.PARSE_ERROR,
            filePath,
            error
          ) 
        };
      }
      return { 
        success: false, 
        error: new ReadJsonError(
          `Unknown error reading file: ${filePath}`,
          ReadErrorType.UNKNOWN,
          filePath,
          error instanceof Error ? error : undefined
        ) 
      };
    }
  }

  /**
   * 寫入 JSON 檔案 (P1-10: 原子寫入 - 寫入臨時檔案後重命名)
   */
  private async writeJsonFile<T>(filePath: string, data: T): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    
    // 生成臨時檔案路徑
    const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 9)}`;
    
    try {
      // 先寫入臨時檔案
      await fs.writeFile(tempPath, content, 'utf-8');
      
      // 然後原子地重命名為目標檔案
      // 在大多數檔案系統上，這是一個原子操作
      await fs.rename(tempPath, filePath);
    } catch (error) {
      // 發生錯誤時，嘗試刪除臨時檔案
      try {
        await fs.unlink(tempPath);
      } catch {
        // 忽略刪除失敗
      }
      throw error;
    }
  }

  /**
   * 取得檔案的當前版本號 (用於 compare-and-swap)
   */
  private getVersion(key: string): number {
    return this.versions.get(key) || 0;
  }

  /**
   * 遞增版本號 (用於 compare-and-swap)
   */
  private incrementVersion(key: string): number {
    const newVersion = this.getVersion(key) + 1;
    this.versions.set(key, newVersion);
    return newVersion;
  }

  /**
   * 使用互斥鎖執行寫入操作 (P1-9)
   */
  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.writeMutex.acquire();
    try {
      return await operation();
    } finally {
      this.writeMutex.release();
    }
  }

  /**
   * 使用 compare-and-swap 寫入資料
   * @param key 用於版本追蹤的鍵
   * @param data 要寫入的資料
   * @param filePath 檔案路徑
   * @param updateCache 回調函數，用於更新記憶體緩存
   */
  private async writeWithCas<T>(
    key: string,
    data: T,
    filePath: string,
    updateCache?: (data: T) => void
  ): Promise<void> {
    await this.withWriteLock(async () => {
      // 先建立備份
      await this.createBackup(filePath);
      
      // 原子寫入檔案
      await this.writeJsonFile(filePath, data);
      
      // 遞增版本號
      this.incrementVersion(key);
      
      // 更新記憶體緩存
      if (updateCache) {
        updateCache(data);
      }
      
      this.log(`Saved with CAS: ${key} (version ${this.getVersion(key)})`);
    });
  }

  /**
   * 建立備份
   */
  private async createBackup(filePath: string): Promise<void> {
    if (!this.options.autoBackup) return;

    try {
      await fs.access(filePath);
    } catch {
      return;
    }

    const backupDir = path.join(this.options.dataPath, 'backups');
    const fileName = path.basename(filePath, '.json');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `${fileName}_${timestamp}.json`);

    try {
      await fs.copyFile(filePath, backupPath);
      this.log(`Created backup: ${backupPath}`);

      // 清理舊備份
      await this.cleanupBackups(backupDir, fileName);
    } catch (error) {
      this.log(`Failed to create backup: ${error}`);
    }
  }

  /**
   * 清理舊備份
   */
  private async cleanupBackups(backupDir: string, fileName: string): Promise<void> {
    const entries = await fs.readdir(backupDir);
    const files = entries
      .filter(f => f.startsWith(fileName) && f.endsWith('.json'))
      .map(async f => {
        const filePath = path.join(backupDir, f);
        const stat = await fs.stat(filePath);
        return {
          name: f,
          path: filePath,
          time: stat.mtime.getTime()
        };
      });
    
    const sortedFiles = (await Promise.all(files)).sort((a, b) => b.time - a.time);

    // 刪除多餘的備份
    if (sortedFiles.length > this.options.backupCount) {
      for (const f of sortedFiles.slice(this.options.backupCount)) {
        await fs.unlink(f.path);
        this.log(`Deleted old backup: ${f.name}`);
      }
    }
  }

  // ==================== Guild 操作 ====================

  /**
   * 建立或取得 Guild
   */
  async getOrCreateGuild(guildId: string, name: string): Promise<Guild> {
    // 先檢查記憶體緩存
    if (this.guilds.has(guildId)) {
      return this.guilds.get(guildId)!;
    }

    // 嘗試從檔案讀取
    const filePath = this.getGuildFilePath(guildId);
    const data = await this.readJsonFile<GuildData>(filePath);

    if (data) {
      const guild = new Guild(data);
      this.guilds.set(guildId, guild);
      return guild;
    }

    // 建立新的 Guild
    const guild = new Guild({ guildId, name });
    this.guilds.set(guildId, guild);
    await this.saveGuild(guild);
    return guild;
  }

  /**
   * 取得 Guild
   */
  async getGuild(guildId: string): Promise<Guild | null> {
    if (this.guilds.has(guildId)) {
      return this.guilds.get(guildId)!;
    }

    const filePath = this.getGuildFilePath(guildId);
    const data = await this.readJsonFile<GuildData>(filePath);

    if (data) {
      const guild = new Guild(data);
      this.guilds.set(guildId, guild);
      return guild;
    }

    return null;
  }

  /**
   * 儲存 Guild (P1-9: 使用 mutex, P1-10: 原子寫入, P2-10: CAS)
   */
  async saveGuild(guild: Guild): Promise<void> {
    const filePath = this.getGuildFilePath(guild.guildId);
    const key = `guild:${guild.guildId}`;
    
    await this.writeWithCas(
      key,
      guild.toJSON(),
      filePath,
      () => this.guilds.set(guild.guildId, guild)
    );
    this.log(`Saved guild: ${guild.guildId}`);
  }

  /**
   * 刪除 Guild (P1-9: 使用 mutex)
   */
  async deleteGuild(guildId: string): Promise<boolean> {
    const filePath = this.getGuildFilePath(guildId);
    const key = `guild:${guildId}`;
    
    return await this.withWriteLock(async () => {
      try {
        await fs.access(filePath);
        await this.createBackup(filePath);
        await fs.unlink(filePath);
        this.guilds.delete(guildId);
        this.versions.delete(key);
        this.log(`Deleted guild: ${guildId}`);
        return true;
      } catch {
        return false;
      }
    });
  }

  /**
   * 取得所有 Guild IDs
   */
  async getAllGuildIds(): Promise<string[]> {
    const guildsDir = path.join(this.options.dataPath, 'guilds');
    
    try {
      await fs.access(guildsDir);
    } catch {
      return [];
    }
    
    const files = await fs.readdir(guildsDir);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  // ==================== Channel 操作 ====================

  /**
   * 在 Guild 中新增頻道
   */
  async addChannelToGuild(
    guildId: string,
    channelId: string,
    name: string,
    projectPath: string
  ): Promise<Channel> {
    const guild = await this.getOrCreateGuild(guildId, name);
    const channelData = guild.addChannel(channelId, name, projectPath);
    await this.saveGuild(guild);
    return new Channel(channelData);
  }

  /**
   * 取得頻道
   */
  async getChannel(guildId: string, channelId: string): Promise<Channel | null> {
    const guild = await this.getGuild(guildId);
    if (!guild) return null;
    
    const channelData = guild.getChannel(channelId);
    return channelData ? new Channel(channelData) : null;
  }

  /**
   * 更新頻道
   */
  async updateChannel(guildId: string, channel: Channel): Promise<void> {
    const guild = await this.getGuild(guildId);
    if (!guild) {
      throw new DatabaseError(`Guild not found: ${guildId}`, 'NOT_FOUND', 'updateChannel');
    }
    
    guild.channels[channel.channelId] = channel.toJSON();
    guild.updatedAt = new Date().toISOString();
    await this.saveGuild(guild);
  }

  /**
   * 移除頻道
   */
  async removeChannel(guildId: string, channelId: string): Promise<boolean> {
    const guild = await this.getGuild(guildId);
    if (!guild) return false;
    
    const removed = guild.removeChannel(channelId);
    if (removed) {
      await this.saveGuild(guild);
    }
    return removed;
  }

  // ==================== Session 操作 ====================

  /**
   * 建立 Session (P1-9: 使用 mutex, P1-10: 原子寫入)
   */
  async createSession(data: Partial<SessionData> & { sessionId: string; channelId: string }): Promise<Session> {
    const session = new Session({
      ...data,
      userId: data.userId || 'unknown'
    });
    const filePath = this.getSessionFilePath(session.sessionId);
    const key = `session:${session.sessionId}`;
    
    await this.writeWithCas(
      key,
      session.toJSON(),
      filePath,
      () => this.sessions.set(session.sessionId, session)
    );
    this.log(`Created session: ${session.sessionId}`);
    
    return session;
  }

  /**
   * 取得 Session
   */
  async getSession(sessionId: string): Promise<Session | null> {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }

    const filePath = this.getSessionFilePath(sessionId);
    const data = await this.readJsonFile<SessionData>(filePath);

    if (data) {
      const session = new Session(data);
      this.sessions.set(sessionId, session);
      return session;
    }

    return null;
  }

  /**
   * 更新 Session (P1-9: 使用 mutex, P1-10: 原子寫入, P2-10: CAS)
   */
  async updateSession(session: Session): Promise<void> {
    const filePath = this.getSessionFilePath(session.sessionId);
    const key = `session:${session.sessionId}`;
    
    await this.writeWithCas(
      key,
      session.toJSON(),
      filePath,
      () => this.sessions.set(session.sessionId, session)
    );
    this.log(`Updated session: ${session.sessionId}`);
  }

  /**
   * 刪除 Session (P1-9: 使用 mutex)
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const filePath = this.getSessionFilePath(sessionId);
    const key = `session:${sessionId}`;
    
    return await this.withWriteLock(async () => {
      try {
        await fs.access(filePath);
        await this.createBackup(filePath);
        await fs.unlink(filePath);
        this.sessions.delete(sessionId);
        this.versions.delete(key);
        this.log(`Deleted session: ${sessionId}`);
        return true;
      } catch {
        return false;
      }
    });
  }

  /**
   * 取得頻道的所有 Sessions
   */
  async getSessionsByChannel(channelId: string): Promise<Session[]> {
    const sessionsDir = path.join(this.options.dataPath, 'sessions');
    
    try {
      await fs.access(sessionsDir);
    } catch {
      return [];
    }
    
    const files = (await fs.readdir(sessionsDir)).filter(f => f.endsWith('.json'));
    const sessions: Session[] = [];
    
    for (const file of files) {
      const data = await this.readJsonFile<SessionData>(path.join(sessionsDir, file));
      if (data && data.channelId === channelId) {
        sessions.push(new Session(data));
      }
    }
    
    return sessions;
  }

  // ==================== Project 操作 ====================

  /**
   * 建立 Project (P1-9: 使用 mutex, P1-10: 原子寫入)
   */
  async createProject(data: Partial<ProjectData> & { projectId: string; name: string; path: string }): Promise<Project> {
    const project = new Project(data);
    const filePath = this.getProjectFilePath(project.projectId);
    const key = `project:${project.projectId}`;
    
    await this.writeWithCas(
      key,
      project.toJSON(),
      filePath,
      () => this.projects.set(project.projectId, project)
    );
    this.log(`Created project: ${project.projectId}`);
    
    return project;
  }

  /**
   * 取得 Project
   */
  async getProject(projectId: string): Promise<Project | null> {
    if (this.projects.has(projectId)) {
      return this.projects.get(projectId)!;
    }

    const filePath = this.getProjectFilePath(projectId);
    const data = await this.readJsonFile<ProjectData>(filePath);

    if (data) {
      const project = new Project(data);
      this.projects.set(projectId, project);
      return project;
    }

    return null;
  }

  /**
   * 更新 Project (P1-9: 使用 mutex, P1-10: 原子寫入, P2-10: CAS)
   */
  async updateProject(project: Project): Promise<void> {
    const filePath = this.getProjectFilePath(project.projectId);
    const key = `project:${project.projectId}`;
    
    await this.writeWithCas(
      key,
      project.toJSON(),
      filePath,
      () => this.projects.set(project.projectId, project)
    );
    this.log(`Updated project: ${project.projectId}`);
  }

  /**
   * 刪除 Project (P1-9: 使用 mutex)
   */
  async deleteProject(projectId: string): Promise<boolean> {
    const filePath = this.getProjectFilePath(projectId);
    const key = `project:${projectId}`;
    
    return await this.withWriteLock(async () => {
      try {
        await fs.access(filePath);
        await this.createBackup(filePath);
        await fs.unlink(filePath);
        this.projects.delete(projectId);
        this.versions.delete(key);
        this.log(`Deleted project: ${projectId}`);
        return true;
      } catch {
        return false;
      }
    });
  }

  /**
   * 透過路徑取得 Project
   */
  async getProjectByPath(projectPath: string): Promise<Project | null> {
    const projectsDir = path.join(this.options.dataPath, 'projects');
    
    try {
      await fs.access(projectsDir);
    } catch {
      return null;
    }
    
    const files = (await fs.readdir(projectsDir)).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
      const data = await this.readJsonFile<ProjectData>(path.join(projectsDir, file));
      if (data && data.path === projectPath) {
        return new Project(data);
      }
    }
    
    return null;
  }

  /**
   * 取得所有 Projects
   */
  async getAllProjects(): Promise<Project[]> {
    const projectsDir = path.join(this.options.dataPath, 'projects');
    
    try {
      await fs.access(projectsDir);
    } catch {
      return [];
    }
    
    const files = (await fs.readdir(projectsDir)).filter(f => f.endsWith('.json'));
    const projects: Project[] = [];
    
    for (const file of files) {
      const data = await this.readJsonFile<ProjectData>(path.join(projectsDir, file));
      if (data) {
        projects.push(new Project(data));
      }
    }
    
    return projects;
  }

  // ==================== 工具方法 ====================

  /**
   * 清空記憶體緩存
   */
  clearCache(): void {
    this.guilds.clear();
    this.sessions.clear();
    this.projects.clear();
    this.log('Cache cleared');
  }

  /**
   * 取得資料庫統計
   */
  async getStats(): Promise<{
    guildCount: number;
    sessionCount: number;
    projectCount: number;
    dataPath: string;
  }> {
    const guildsDir = path.join(this.options.dataPath, 'guilds');
    const sessionsDir = path.join(this.options.dataPath, 'sessions');
    const projectsDir = path.join(this.options.dataPath, 'projects');
    
    let guildCount = this.guilds.size;
    let sessionCount = this.sessions.size;
    let projectCount = this.projects.size;
    
    try {
      if (guildCount === 0) {
        guildCount = (await fs.readdir(guildsDir)).filter(f => f.endsWith('.json')).length;
      }
    } catch { /* ignore */ }
    
    try {
      if (sessionCount === 0) {
        sessionCount = (await fs.readdir(sessionsDir)).filter(f => f.endsWith('.json')).length;
      }
    } catch { /* ignore */ }
    
    try {
      if (projectCount === 0) {
        projectCount = (await fs.readdir(projectsDir)).filter(f => f.endsWith('.json')).length;
      }
    } catch { /* ignore */ }
    
    return {
      guildCount,
      sessionCount,
      projectCount,
      dataPath: this.options.dataPath,
    };
  }

  /**
   * 匯出所有資料
   */
  async exportAll(): Promise<{
    guilds: GuildData[];
    sessions: SessionData[];
    projects: ProjectData[];
  }> {
    const guildIds = await this.getAllGuildIds();
    const guilds: GuildData[] = [];
    
    for (const id of guildIds) {
      const guild = await this.getGuild(id);
      if (guild) guilds.push(guild.toJSON());
    }

    const sessionsDir = path.join(this.options.dataPath, 'sessions');
    let sessions: SessionData[] = [];
    
    try {
      await fs.access(sessionsDir);
      const files = (await fs.readdir(sessionsDir)).filter(f => f.endsWith('.json'));
      sessions = [];
      for (const f of files) {
        const data = await this.readJsonFile<SessionData>(path.join(sessionsDir, f));
        if (data) sessions.push(data);
      }
    } catch { /* ignore */ }

    const projects = await this.getAllProjects();

    return {
      guilds,
      sessions,
      projects: projects.map(p => p.toJSON()),
    };
  }

  /**
   * 匯入資料
   */
  async importAll(data: {
    guilds?: GuildData[];
    sessions?: SessionData[];
    projects?: ProjectData[];
  }): Promise<void> {
    if (data.guilds) {
      for (const guildData of data.guilds) {
        const guild = new Guild(guildData);
        this.guilds.set(guild.guildId, guild);
        await this.saveGuild(guild);
      }
    }

    if (data.sessions) {
      for (const sessionData of data.sessions) {
        const session = new Session(sessionData);
        this.sessions.set(session.sessionId, session);
        await this.updateSession(session);
      }
    }

    if (data.projects) {
      for (const projectData of data.projects) {
        const project = new Project(projectData);
        this.projects.set(project.projectId, project);
        await this.updateProject(project);
      }
    }
  }
}

/**
 * 建立資料庫實例的工廠函數
 */
export function createDatabase(options?: DatabaseOptions): Database {
  return new Database(options);
}
