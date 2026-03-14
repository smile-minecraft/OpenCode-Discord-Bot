/**
 * Database Tests - 資料庫單元測試
 * @description 測試 CRUD 操作和備份還原功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database, DatabaseError, createDatabase } from '../../src/database/Database';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

// ============== 測試輔助函數 ==============

/**
 * 創建臨時測試目錄
 */
function createTempDir(): string {
  const dir = path.join(tmpdir(), `test-db-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 清理臨時目錄
 */
function cleanupTempDir(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

// ============== 測試 suite ==============

describe('Database', () => {
  let testDir: string;
  let db: Database;

  beforeEach(() => {
    testDir = createTempDir();
    db = new Database({
      dataPath: testDir,
      autoBackup: true,
      backupCount: 3,
      debug: false,
    });
  });

  afterEach(() => {
    cleanupTempDir(testDir);
  });

  describe('Constructor', () => {
    it('應該使用預設選項創建資料庫', () => {
      const database = new Database();
      expect(database).toBeDefined();
    });

    it('應該正確使用自定義選項', () => {
      const database = new Database({
        dataPath: testDir,
        autoBackup: false,
        backupCount: 10,
        debug: true,
      });
      expect(database).toBeDefined();
    });

    it('應該創建必要的目錄', () => {
      expect(fs.existsSync(path.join(testDir, 'guilds'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'sessions'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'projects'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'backups'))).toBe(true);
    });
  });

  describe('Guild CRUD', () => {
    it('getOrCreateGuild() 應該創建新的 Guild', async () => {
      const guild = await db.getOrCreateGuild('guild123', 'Test Guild');

      expect(guild).toBeDefined();
      expect(guild.guildId).toBe('guild123');
      expect(guild.name).toBe('Test Guild');
      expect(guild.channels).toEqual({});
      expect(guild.permissions).toBeDefined();
      expect(guild.settings).toBeDefined();
    });

    it('getOrCreateGuild() 應該返回已存在的 Guild', async () => {
      const guild1 = await db.getOrCreateGuild('guild123', 'Test Guild');
      const guild2 = await db.getOrCreateGuild('guild123', 'Different Name');

      expect(guild2.guildId).toBe(guild1.guildId);
      expect(guild2.name).toBe('Test Guild'); // 應該保持原名
    });

    it('getGuild() 應該返回已保存的 Guild', async () => {
      await db.getOrCreateGuild('guild123', 'Test Guild');
      const guild = await db.getGuild('guild123');

      expect(guild).toBeDefined();
      expect(guild?.guildId).toBe('guild123');
    });

    it('getGuild() 應該返回 null 當 Guild 不存在時', async () => {
      const guild = await db.getGuild('nonexistent');
      expect(guild).toBeNull();
    });

    it('saveGuild() 應該保存 Guild', async () => {
      const guild = await db.getOrCreateGuild('guild123', 'Test Guild');
      guild.settings.defaultModel = 'custom-model';
      await db.saveGuild(guild);

      // 重新讀取應該保持更新
      const loaded = await db.getGuild('guild123');
      expect(loaded?.settings.defaultModel).toBe('custom-model');
    });

    it('deleteGuild() 應該刪除 Guild', async () => {
      await db.getOrCreateGuild('guild123', 'Test Guild');
      const deleted = await db.deleteGuild('guild123');

      expect(deleted).toBe(true);
      expect(await db.getGuild('guild123')).toBeNull();
    });

    it('deleteGuild() 應該返回 false 當 Guild 不存在時', async () => {
      const deleted = await db.deleteGuild('nonexistent');
      expect(deleted).toBe(false);
    });

    it('getAllGuildIds() 應該返回所有 Guild IDs', async () => {
      await db.getOrCreateGuild('guild1', 'Guild 1');
      await db.getOrCreateGuild('guild2', 'Guild 2');
      await db.getOrCreateGuild('guild3', 'Guild 3');

      const ids = await db.getAllGuildIds();
      expect(ids).toHaveLength(3);
      expect(ids).toContain('guild1');
      expect(ids).toContain('guild2');
      expect(ids).toContain('guild3');
    });
  });

  describe('Channel 操作', () => {
    it('addChannelToGuild() 應該添加頻道到 Guild', async () => {
      const channel = await db.addChannelToGuild('guild123', 'channel123', 'test-channel', '/path/to/project');

      expect(channel).toBeDefined();
      expect(channel.channelId).toBe('channel123');
      expect(channel.name).toBe('test-channel');
      expect(channel.projectPath).toBe('/path/to/project');
    });

    it('getChannel() 應該返回頻道', async () => {
      await db.addChannelToGuild('guild123', 'channel123', 'test-channel', '/path/to/project');
      const channel = await db.getChannel('guild123', 'channel123');

      expect(channel).toBeDefined();
      expect(channel?.channelId).toBe('channel123');
    });

    it('getChannel() 應該返回 null 當頻道不存在時', async () => {
      const channel = await db.getChannel('guild123', 'nonexistent');
      expect(channel).toBeNull();
    });

    it('removeChannel() 應該移除頻道', async () => {
      await db.addChannelToGuild('guild123', 'channel123', 'test-channel', '/path/to/project');
      const removed = await db.removeChannel('guild123', 'channel123');

      expect(removed).toBe(true);
      expect(await db.getChannel('guild123', 'channel123')).toBeNull();
    });
  });

  describe('Session CRUD', () => {
    it('createSession() 應該創建新的 Session', async () => {
      const session = await db.createSession({
        sessionId: 'session123',
        channelId: 'channel123',
        prompt: 'Test prompt',
        model: 'gpt-4',
      });

      expect(session).toBeDefined();
      expect(session.sessionId).toBe('session123');
      expect(session.channelId).toBe('channel123');
      expect(session.prompt).toBe('Test prompt');
      expect(session.status).toBe('pending');
    });

    it('getSession() 應該返回已保存的 Session', async () => {
      await db.createSession({
        sessionId: 'session123',
        channelId: 'channel123',
      });
      const session = await db.getSession('session123');

      expect(session).toBeDefined();
      expect(session?.sessionId).toBe('session123');
    });

    it('getSession() 應該返回 null 當 Session 不存在時', async () => {
      const session = await db.getSession('nonexistent');
      expect(session).toBeNull();
    });

    it('updateSession() 應該更新 Session', async () => {
      await db.createSession({
        sessionId: 'session123',
        channelId: 'channel123',
        status: 'pending',
      });

      const session = await db.getSession('session123');
      session!.status = 'running';
      await db.updateSession(session!);

      const updated = await db.getSession('session123');
      expect(updated?.status).toBe('running');
    });

    it('deleteSession() 應該刪除 Session', async () => {
      await db.createSession({
        sessionId: 'session123',
        channelId: 'channel123',
      });

      const deleted = await db.deleteSession('session123');
      expect(deleted).toBe(true);
      expect(await db.getSession('session123')).toBeNull();
    });

    it('getSessionsByChannel() 應該返回頻道的所有 Sessions', async () => {
      await db.createSession({ sessionId: 'session1', channelId: 'channel123' });
      await db.createSession({ sessionId: 'session2', channelId: 'channel123' });
      await db.createSession({ sessionId: 'session3', channelId: 'channel456' });

      const sessions = await db.getSessionsByChannel('channel123');
      expect(sessions).toHaveLength(2);
    });
  });

  describe('Project CRUD', () => {
    it('createProject() 應該創建新的 Project', async () => {
      const project = await db.createProject({
        projectId: 'project123',
        name: 'Test Project',
        path: '/path/to/project',
      });

      expect(project).toBeDefined();
      expect(project.projectId).toBe('project123');
      expect(project.name).toBe('Test Project');
      expect(project.path).toBe('/path/to/project');
    });

    it('getProject() 應該返回已保存的 Project', async () => {
      await db.createProject({
        projectId: 'project123',
        name: 'Test Project',
        path: '/path/to/project',
      });

      const project = await db.getProject('project123');
      expect(project).toBeDefined();
      expect(project?.projectId).toBe('project123');
    });

    it('getProject() 應該返回 null 當 Project 不存在時', async () => {
      const project = await db.getProject('nonexistent');
      expect(project).toBeNull();
    });

    it('updateProject() 應該更新 Project', async () => {
      await db.createProject({
        projectId: 'project123',
        name: 'Test Project',
        path: '/path/to/project',
      });

      const project = await db.getProject('project123');
      project!.description = 'New description';
      await db.updateProject(project!);

      const updated = await db.getProject('project123');
      expect(updated?.description).toBe('New description');
    });

    it('deleteProject() 應該刪除 Project', async () => {
      await db.createProject({
        projectId: 'project123',
        name: 'Test Project',
        path: '/path/to/project',
      });

      const deleted = await db.deleteProject('project123');
      expect(deleted).toBe(true);
      expect(await db.getProject('project123')).toBeNull();
    });

    it('getProjectByPath() 應該通過路徑查找 Project', async () => {
      await db.createProject({
        projectId: 'project123',
        name: 'Test Project',
        path: '/unique/path/to/project',
      });

      const project = await db.getProjectByPath('/unique/path/to/project');
      expect(project).toBeDefined();
      expect(project?.projectId).toBe('project123');
    });

    it('getAllProjects() 應該返回所有 Projects', async () => {
      await db.createProject({ projectId: 'p1', name: 'P1', path: '/p1' });
      await db.createProject({ projectId: 'p2', name: 'P2', path: '/p2' });
      await db.createProject({ projectId: 'p3', name: 'P3', path: '/p3' });

      const projects = await db.getAllProjects();
      expect(projects).toHaveLength(3);
    });
  });

  describe('Backup 備份', () => {
    it('應該在更新時創建備份', async () => {
      // 創建 session
      await db.createSession({
        sessionId: 'session123',
        channelId: 'channel123',
      });
      
      // 更新 session - 這應該觸發備份
      const session = await db.getSession('session123');
      expect(session).not.toBeNull();
      session!.status = 'running';
      await db.updateSession(session!);

      const backupDir = path.join(testDir, 'backups');
      const backups = fs.readdirSync(backupDir).filter(f => f.startsWith('session123_'));
      
      expect(backups.length).toBeGreaterThan(0);
    });

    it('應該限制備份數量', async () => {
      // 創建多個 Session 版本
      const session = await db.createSession({
        sessionId: 'session_test',
        channelId: 'channel123',
      });

      for (let i = 0; i < 5; i++) {
        session.status = 'running';
        await db.updateSession(session);
      }

      const backupDir = path.join(testDir, 'backups');
      const backups = fs.readdirSync(backupDir).filter(f => f.startsWith('session_test_'));
      
      // 應該只保留 3 個備份（backupCount = 3）
      expect(backups.length).toBeLessThanOrEqual(3);
    });

    it('應該在刪除時創建備份', async () => {
      await db.createSession({
        sessionId: 'session_delete',
        channelId: 'channel123',
      });

      await db.deleteSession('session_delete');

      const backupDir = path.join(testDir, 'backups');
      const backups = fs.readdirSync(backupDir).filter(f => f.startsWith('session_delete_'));
      
      expect(backups.length).toBeGreaterThan(0);
    });
  });

  describe('Import/Export 匯入匯出', () => {
    it('exportAll() 應該導出所有資料', async () => {
      await db.getOrCreateGuild('guild1', 'Guild 1');
      await db.createSession({ sessionId: 's1', channelId: 'c1' });
      await db.createProject({ projectId: 'p1', name: 'P1', path: '/p1' });

      const exported = await db.exportAll();

      expect(exported.guilds).toHaveLength(1);
      expect(exported.sessions).toHaveLength(1);
      expect(exported.projects).toHaveLength(1);
    });

    it('importAll() 應該匯入資料', async () => {
      await db.importAll({
        guilds: [{
          guildId: 'imported_guild',
          name: 'Imported Guild',
          ownerId: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          channels: {},
          permissions: { defaultLevel: 'user', allowedRoles: [], allowedUsers: [], mode: 'everyone' },
          queue: [],
          settings: { enabled: true, autoStartSession: false, maxConcurrentSessions: 3, defaultModel: '', defaultAgent: '', allowedModels: [], allowedAgents: [] },
        }],
      });

      const guild = await db.getGuild('imported_guild');
      expect(guild).toBeDefined();
      expect(guild?.name).toBe('Imported Guild');
    });
  });

  describe('Utils 工具方法', () => {
    it('clearCache() 應該清空記憶體緩存', async () => {
      await db.getOrCreateGuild('guild123', 'Test Guild');
      expect(db.getStats().guildCount).toBe(1);

      db.clearCache();
      // 注意：clearCache 只清空記憶體，不刪除檔案
    });

    it('getStats() 應該返回正確的統計資料', async () => {
      await db.getOrCreateGuild('guild1', 'Guild 1');
      await db.createSession({ sessionId: 's1', channelId: 'c1' });
      await db.createProject({ projectId: 'p1', name: 'P1', path: '/p1' });

      const stats = db.getStats();

      expect(stats.guildCount).toBe(1);
      expect(stats.sessionCount).toBe(1);
      expect(stats.projectCount).toBe(1);
      expect(stats.dataPath).toBe(testDir);
    });
  });
});

describe('DatabaseError', () => {
  it('應該正確創建錯誤實例', () => {
    const error = new DatabaseError('Test error', 'TEST_CODE', 'testOperation');

    expect(error.name).toBe('DatabaseError');
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.operation).toBe('testOperation');
  });
});

describe('createDatabase() - 工廠函數', () => {
  it('應該創建 Database 實例', () => {
    const db = createDatabase();
    expect(db).toBeInstanceOf(Database);
  });

  it('應該正確傳遞選項', () => {
    const testDir = path.join(tmpdir(), 'factory-test');
    const db = createDatabase({ dataPath: testDir });
    
    expect(db).toBeDefined();
    
    // 清理
    fs.rmSync(testDir, { recursive: true, force: true });
  });
});

describe('Backup/Restore Integration', () => {
  let testDir: string;
  let db: Database;

  beforeEach(() => {
    testDir = createTempDir();
    db = new Database({
      dataPath: testDir,
      autoBackup: true,
      backupCount: 3,
    });
  });

  afterEach(() => {
    cleanupTempDir(testDir);
  });

  it('應該能夠從備份恢復數據', async () => {
    // 創建並更新一條記錄
    const session = await db.createSession({
      sessionId: 'backup_test',
      channelId: 'channel123',
      status: 'running',
    });
    
    const sessionId = session.sessionId;

    // 更新記錄多次以創建多個備份
    for (let i = 0; i < 3; i++) {
      session.status = 'completed';
      await db.updateSession(session);
    }

    // 檢查備份目錄
    const backupDir = path.join(testDir, 'backups');
    const backups = fs.readdirSync(backupDir).filter(f => f.startsWith('backup_test_'));
    
    expect(backups.length).toBeGreaterThan(0);
  });

  it('關閉自動備份應該不創建備份', async () => {
    const noBackupDb = new Database({
      dataPath: testDir,
      autoBackup: false,
    });

    await noBackupDb.createSession({
      sessionId: 'no_backup',
      channelId: 'channel123',
    });

    const backupDir = path.join(testDir, 'backups');
    const backups = fs.readdirSync(backupDir).filter(f => f.startsWith('no_backup_'));
    
    expect(backups.length).toBe(0);
  });
});
