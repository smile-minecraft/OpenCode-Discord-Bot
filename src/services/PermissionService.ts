/**
 * Permission Service - 權限管理服務
 * @description 負責檢查和管理用戶權限
 */

import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  GuildMember,
} from 'discord.js';
import type { PermissionLevel, Guild as GuildModel } from '../database/models/Guild.js';
import { Database } from '../database/index.js';
import { log as logger } from '../utils/logger.js';

/**
 * 權限檢查結果
 */
export interface PermissionCheckResult {
  /** 是否有權限 */
  allowed: boolean;
  /** 權限等級 */
  level: PermissionLevel;
  /** 拒絕原因（如果拒絕） */
  reason?: string;
}

/**
 * 用戶權限資訊
 */
export interface UserPermissionInfo {
  userId: string;
  username: string;
  level: PermissionLevel;
  roles: string[];
  isOwner: boolean;
}

/**
 * 工具執行請求
 */
export interface ToolExecutionRequest {
  /** 請求唯一 ID */
  requestId: string;
  sessionId: string;
  channelId: string;
  userId: string;
  username: string;
  toolName: string;
  toolDescription: string;
  arguments: Record<string, unknown>;
  timestamp: string;
}

/**
 * 工具審批結果
 */
export type ApprovalAction = 'allow' | 'deny' | 'always_allow';

/**
 * 工具審批記錄
 */
export interface ToolApprovalRecord {
  id: string;
  sessionId: string;
  toolName: string;
  pattern: string;
  action: ApprovalAction;
  remember: boolean;
  userId: string;
  timestamp: string;
}

/**
 * Permission Service 類別
 * @description 提供權限檢查、管理和工具審批功能
 */
export class PermissionService {
  private static instance: PermissionService;
  private database: Database;
  private discordClient: Client | null = null;
  private approvalCallbacks: Map<string, (action: ApprovalAction) => void> = new Map();

  private constructor() {
    this.database = Database.getInstance();
  }

  /**
   * 取得單例實例
   */
  public static getInstance(): PermissionService {
    if (!PermissionService.instance) {
      PermissionService.instance = new PermissionService();
    }
    return PermissionService.instance;
  }

  /**
   * 設置 Discord Client
   * @param client Discord Client 實例
   */
  public setDiscordClient(client: Client): void {
    this.discordClient = client;
    logger.info('[PermissionService] Discord client has been set');
  }

  /**
   * 檢查用戶權限
   * @param userId 用戶 ID
   * @param guildId 伺服器 ID
   * @param requiredLevel 需要的權限等級
   */
  async checkPermission(
    userId: string,
    guildId: string,
    requiredLevel: PermissionLevel = 'user'
  ): Promise<PermissionCheckResult> {
    try {
      const guild = await this.database.getGuild(guildId);
      
      if (!guild) {
        // 如果伺服器不存在，預設給予 user 權限
        return { allowed: true, level: 'user' };
      }

      const member = await this.getMember(guild, userId);
      
      if (!member) {
        return { allowed: false, level: 'none', reason: '無法獲取成員資訊' };
      }

      // 檢查是否為伺服器擁有者
      if (guild.ownerId === userId) {
        return { allowed: true, level: 'admin' };
      }

      // 檢查權限模式
      const { permissions } = guild;
      
      switch (permissions.mode) {
        case 'user':
          if (permissions.allowedUsers.includes(userId)) {
            return { allowed: true, level: 'admin' };
          }
          break;
          
        case 'role':
          const memberRoles = member.roles.cache.map((r) => r.id);
          const hasAllowedRole = memberRoles.some((roleId) => 
            permissions.allowedRoles.includes(roleId)
          );
          if (hasAllowedRole) {
            return { allowed: true, level: 'moderator' };
          }
          break;
          
        case 'everyone':
          // everyone 模式下所有人都可以
          break;
      }

      // 檢查預設權限等級
      const defaultLevel = permissions.defaultLevel;
      const levelHierarchy: PermissionLevel[] = ['none', 'user', 'moderator', 'admin'];
      const userLevelIndex = levelHierarchy.indexOf(defaultLevel);
      const requiredLevelIndex = levelHierarchy.indexOf(requiredLevel);

      if (userLevelIndex >= requiredLevelIndex) {
        return { allowed: true, level: defaultLevel };
      }

      return {
        allowed: false,
        level: defaultLevel,
        reason: `需要 ${requiredLevel} 權限才能執行此操作`,
      };
    } catch (error) {
      logger.error('Error checking permission:', error as Error | Record<string, unknown>);
      return { allowed: false, level: 'none', reason: '權限檢查失敗' };
    }
  }

  /**
   * 授予權限
   * @param userId 用戶 ID
   * @param guildId 伺服器 ID
   * @param level 權限等級
   */
  async grantPermission(
    userId: string,
    guildId: string,
    level: PermissionLevel
  ): Promise<boolean> {
    try {
      const guild = await this.database.getGuild(guildId);
      
      if (!guild) {
        logger.warn(`Guild not found: ${guildId}`);
        return false;
      }

      // 根據等級添加到允許列表
      if (level === 'admin' || level === 'moderator') {
        if (!guild.permissions.allowedUsers.includes(userId)) {
          guild.permissions.allowedUsers.push(userId);
        }
      }

      await this.database.saveGuild(guild);
      logger.info(`Granted ${level} permission to user ${userId} in guild ${guildId}`);
      return true;
    } catch (error) {
      logger.error('Error granting permission:', error as Error | Record<string, unknown>);
      return false;
    }
  }

  /**
   * 撤銷權限
   * @param userId 用戶 ID
   * @param guildId 伺服器 ID
   */
  async revokePermission(userId: string, guildId: string): Promise<boolean> {
    try {
      const guild = await this.database.getGuild(guildId);
      
      if (!guild) {
        return false;
      }

      // 從允許列表中移除
      guild.permissions.allowedUsers = guild.permissions.allowedUsers.filter(
        (id) => id !== userId
      );

      await this.database.saveGuild(guild);
      logger.info(`Revoked permission from user ${userId} in guild ${guildId}`);
      return true;
    } catch (error) {
      logger.error('Error revoking permission:', error as Error | Record<string, unknown>);
      return false;
    }
  }

  /**
   * 檢查用戶 Discord 權限
   * @param interaction 交互对象
   * @param requiredPermissions 需要的權限陣列
   */
  async checkDiscordPermissions(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    requiredPermissions: string[]
  ): Promise<PermissionCheckResult> {
    const member = interaction.member;
    
    if (!member || !('permissions' in member)) {
      return { allowed: false, level: 'none', reason: '無法獲取成員權限' };
    }

    const permissions = member.permissions;
    const missingPermissions: string[] = [];

    for (const perm of requiredPermissions) {
      // Handle both string and PermissionsBitField types
      if (typeof permissions === 'string') {
        // If permissions is a string (deny list), check if the permission is in it
        if (permissions.split(' ').includes(perm)) {
          missingPermissions.push(perm);
        }
      } else {
        // If permissions is a PermissionsBitField, use the .has() method
        const perms = permissions as Readonly<import('discord.js').PermissionsBitField>;
        if (!perms.has(perm as import('discord.js').PermissionResolvable)) {
          missingPermissions.push(perm);
        }
      }
    }

    if (missingPermissions.length > 0) {
      return {
        allowed: false,
        level: 'none',
        reason: `缺少權限: ${missingPermissions.join(', ')}`,
      };
    }

    return { allowed: true, level: 'admin' };
  }

  /**
   * 獲取用戶權限資訊
   * @param userId 用戶 ID
   * @param guildId 伺服器 ID
   */
  async getUserPermissionInfo(
    userId: string,
    guildId: string
  ): Promise<UserPermissionInfo | null> {
    try {
      const guild = await this.database.getGuild(guildId);
      
      if (!guild) {
        return null;
      }

      const member = await this.getMember(guild, userId);
      
      if (!member) {
        return null;
      }

      const isOwner = guild.ownerId === userId;
      const level = isOwner ? 'admin' : guild.permissions.defaultLevel;

      return {
        userId,
        username: member.user.username,
        level,
        roles: member.roles.cache.map((r) => r.id),
        isOwner,
      };
    } catch (error) {
      logger.error('Error getting user permission info:', error as Error | Record<string, unknown>);
      return null;
    }
  }

  /**
   * 設置預設權限模式
   * @param guildId 伺服器 ID
   * @param mode 權限模式
   * @param defaultLevel 預設權限等級
   */
  async setPermissionMode(
    guildId: string,
    mode: 'role' | 'user' | 'everyone',
    defaultLevel: PermissionLevel = 'user'
  ): Promise<boolean> {
    try {
      const guild = await this.database.getGuild(guildId);
      
      if (!guild) {
        return false;
      }

      guild.permissions.mode = mode;
      guild.permissions.defaultLevel = defaultLevel;

      await this.database.saveGuild(guild);
      logger.info(`Set permission mode to ${mode} for guild ${guildId}`);
      return true;
    } catch (error) {
      logger.error('Error setting permission mode:', error as Error | Record<string, unknown>);
      return false;
    }
  }

  /**
   * 添加允許的角色
   * @param guildId 伺服器 ID
   * @param roleId 角色 ID
   */
  async addAllowedRole(guildId: string, roleId: string): Promise<boolean> {
    try {
      const guild = await this.database.getGuild(guildId);
      
      if (!guild) {
        return false;
      }

      if (!guild.permissions.allowedRoles.includes(roleId)) {
        guild.permissions.allowedRoles.push(roleId);
        await this.database.saveGuild(guild);
      }

      return true;
    } catch (error) {
      logger.error('Error adding allowed role:', error as Error | Record<string, unknown>);
      return false;
    }
  }

  /**
   * 移除允許的角色
   * @param guildId 伺服器 ID
   * @param roleId 角色 ID
   */
  async removeAllowedRole(guildId: string, roleId: string): Promise<boolean> {
    try {
      const guild = await this.database.getGuild(guildId);
      
      if (!guild) {
        return false;
      }

      guild.permissions.allowedRoles = guild.permissions.allowedRoles.filter(
        (id) => id !== roleId
      );

      await this.database.saveGuild(guild);
      return true;
    } catch (error) {
      logger.error('Error removing allowed role:', error as Error | Record<string, unknown>);
      return false;
    }
  }

  /**
   * 創建工具審批請求
   * @param request 工具執行請求
   * @param callback 審批回調函數
   * @returns 請求 ID
   */
  createApprovalRequest(
    _request: ToolExecutionRequest,
    callback: (action: ApprovalAction) => void
  ): string {
    const requestId = `approval_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.approvalCallbacks.set(requestId, callback);
    
    // 5 分鐘後自動清除
    setTimeout(() => {
      this.approvalCallbacks.delete(requestId);
    }, 5 * 60 * 1000);
    
    return requestId;
  }

  /**
   * 處理審批回應
   * @param requestId 請求 ID
   * @param action 審批操作
   */
  handleApprovalResponse(requestId: string, action: ApprovalAction): void {
    const callback = this.approvalCallbacks.get(requestId);
    if (callback) {
      callback(action);
      this.approvalCallbacks.delete(requestId);
    }
  }

  /**
   * 保存工具審批記錄
   * @param record 審批記錄
   */
  async saveApprovalRecord(record: ToolApprovalRecord): Promise<void> {
    try {
      const guild = await this.database.getGuild(record.sessionId);
      
      if (guild) {
        // 儲存審批記錄到伺服器配置中
        if (!guild.settings) {
          (guild as unknown as { settings: Record<string, unknown> }).settings = {};
        }
        
        const approvalRecords = (guild.settings as unknown as { approvalRecords?: ToolApprovalRecord[] }).approvalRecords || [];
        approvalRecords.push(record);
        (guild.settings as unknown as { approvalRecords: ToolApprovalRecord[] }).approvalRecords = approvalRecords;
        
        await this.database.saveGuild(guild);
      }
    } catch (error) {
      logger.error('Error saving approval record:', error as Error | Record<string, unknown>);
    }
  }

  /**
   * 檢查是否已記住允許
   * @param userId 用戶 ID
   * @param guildId 伺服器 ID
   * @param toolName 工具名稱
   */
  async checkRememberedAllowance(
    userId: string,
    guildId: string,
    toolName: string
  ): Promise<boolean> {
    try {
      const guild = await this.database.getGuild(guildId);
      
      if (!guild) {
        return false;
      }

      const approvalRecords = (guild.settings as unknown as { approvalRecords?: ToolApprovalRecord[] })?.approvalRecords || [];
      
      return approvalRecords.some(
        (record) =>
          record.userId === userId &&
          record.toolName === toolName &&
          record.action === 'always_allow'
      );
    } catch (error) {
      logger.error('Error checking remembered allowance:', error as Error | Record<string, unknown>);
      return false;
    }
  }

  /**
   * 獲取成員
   * @param guild 伺服器
   * @param userId 用戶 ID
   */
  private async getMember(guild: GuildModel, userId: string): Promise<GuildMember | null> {
    try {
      if (!this.discordClient) {
        logger.warn('[PermissionService] Discord client not set');
        return null;
      }

      const discordGuild = await this.discordClient.guilds.fetch(guild.guildId);
      if (!discordGuild) {
        logger.warn(`[PermissionService] Guild not found: ${guild.guildId}`);
        return null;
      }

      return await discordGuild.members.fetch(userId);
    } catch (error) {
      logger.error('[PermissionService] Failed to fetch member:', error as Error | Record<string, unknown>);
      return null;
    }
  }
}

/**
 * 建立 PermissionService 工廠函數
 */
export function createPermissionService(): PermissionService {
  return PermissionService.getInstance();
}

export default PermissionService;