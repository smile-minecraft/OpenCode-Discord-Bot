/**
 * Provider Service
 * @description 管理 AI 提供商連接和 API Key 加密儲存
 */

import crypto from 'crypto';
import { log as logger } from '../utils/logger.js';
import { Database } from '../database/Database.js';
import type { GuildSettings } from '../database/models/Guild.js';
import type { OpenCodeProviderType } from './OpenCodeCloudClient.js';
import { createOpenCodeCloudClient, ValidationResult } from './OpenCodeCloudClient.js';

// ============== 加密配置 ==============

// 用於加密 API Key 的密鑰（從環境變數獲取）
// 生產環境必須設置 API_KEY_ENCRYPTION_KEY 環境變數
const ENCRYPTION_KEY = (() => {
  const key = process.env.API_KEY_ENCRYPTION_KEY;
  
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'FATAL: API_KEY_ENCRYPTION_KEY environment variable is required in production. ' +
        'Generate a secure key with: openssl rand -hex 32'
      );
    }
    
    console.warn(
      '⚠️ WARNING: Using development encryption key. ' +
      'Set API_KEY_ENCRYPTION_KEY environment variable for production.'
    );
    return 'dev-key-not-for-production-use-32bytes!!';
  }
  
  // 驗證密鑰長度 (AES-256 需要 32 bytes)
  if (Buffer.byteLength(key, 'utf8') < 32) {
    throw new Error(
      'FATAL: API_KEY_ENCRYPTION_KEY must be at least 32 bytes. ' +
      'Generate with: openssl rand -hex 32'
    );
  }
  
  return key;
})();

const ALGORITHM = 'aes-256-gcm';

/**
 * 加密字串
 * @param text - 要加密的文字
 * @returns 加密後的文字 (base64)
 */
function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // 返回 IV + AuthTag + Encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * 解密字串
 * @param encryptedText - 加密的文字
 * @returns 解密後的文字
 */
function decrypt(encryptedText: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// ============== 類型定義 ==============

/**
 * Provider 連接狀態（與 GuildSettings.providers 格式一致）
 */
export type ProviderConnection = {
  apiKey?: string;           // 加密儲存
  connected: boolean;
  connectedAt?: string;
  lastValidated?: string;
  validationError?: string;
};

// ============== Provider Service ==============

/**
 * Provider Service 類別
 * @description 管理 Discord Guild 的 AI 提供商連接
 */
export class ProviderService {
  private static instance: ProviderService;
  private db: Database;

  /**
   * 私有構造函數（單例模式）
   */
  private constructor() {
    this.db = Database.getInstance();
  }

  /**
   * 獲取單例實例
   */
  static getInstance(): ProviderService {
    if (!ProviderService.instance) {
      ProviderService.instance = new ProviderService();
    }
    return ProviderService.instance;
  }

  /**
   * 獲取 Guild 的設置
   */
  private async getGuildSettings(guildId: string): Promise<GuildSettings> {
    const guild = await this.db.getGuild(guildId);
    if (!guild) {
      // 建立新 guild
      const newGuild = await this.db.getOrCreateGuild(guildId, 'Unknown');
      return newGuild.settings;
    }
    return guild.settings;
  }

  /**
   * 保存 Guild 設置
   */
  private async saveGuildSettings(guildId: string, settings: GuildSettings): Promise<void> {
    const guild = await this.db.getOrCreateGuild(guildId, 'Unknown');
    guild.settings = settings;
    await this.db.saveGuild(guild);
  }

  /**
   * 獲取 Guild 的所有提供商連接
   * @param guildId - Guild ID
   * @returns 提供商連接 Map
   */
  async getProviders(guildId: string): Promise<Record<string, ProviderConnection>> {
    const settings = await this.getGuildSettings(guildId);
    return settings.providers || {};
  }

  /**
   * 獲取單個提供商連接
   * @param guildId - Guild ID
   * @param providerId - Provider ID
   * @returns 提供商連接（如果存在）
   */
  async getProvider(guildId: string, providerId: string): Promise<ProviderConnection | null> {
    const providers = await this.getProviders(guildId);
    return providers[providerId] || null;
  }

  /**
   * 添加/更新提供商連接
   * @param guildId - Guild ID
   * @param providerId - Provider ID
   * @param connection - 提供商連接
   */
  async setProvider(guildId: string, providerId: string, connection: ProviderConnection): Promise<void> {
    const settings = await this.getGuildSettings(guildId);
    
    if (!settings.providers) {
      settings.providers = {};
    }
    
    settings.providers[providerId] = connection;
    await this.saveGuildSettings(guildId, settings);
    
    logger.info(`[ProviderService] Updated provider ${providerId} for guild ${guildId}`);
  }

  /**
   * 移除提供商連接
   * @param guildId - Guild ID
   * @param providerId - Provider ID
   * @returns 是否成功移除
   */
  async removeProvider(guildId: string, providerId: string): Promise<boolean> {
    const settings = await this.getGuildSettings(guildId);
    
    if (settings.providers && settings.providers[providerId]) {
      delete settings.providers[providerId];
      await this.saveGuildSettings(guildId, settings);
      
      logger.info(`[ProviderService] Removed provider ${providerId} from guild ${guildId}`);
      return true;
    }
    
    return false;
  }

  /**
   * 驗證並添加 API Key
   * @param guildId - Guild ID
   * @param providerId - Provider ID
   * @param apiKey - API Key（明文）
   * @returns 驗證結果
   */
  async addProvider(guildId: string, providerId: OpenCodeProviderType, apiKey: string): Promise<ValidationResult> {
    try {
      // 建立客戶端進行驗證
      const client = createOpenCodeCloudClient(apiKey, providerId);
      
      // 驗證 API Key
      const validationResult = await client.validateApiKey();
      
      if (!validationResult.valid) {
        // 保存連接但標記為未連接
        await this.setProvider(guildId, providerId, {
          connected: false,
          connectedAt: new Date().toISOString(),
          validationError: validationResult.error,
        });
        
        return validationResult;
      }

      // 加密並儲存 API Key
      const encryptedApiKey = encrypt(apiKey);
      
      await this.setProvider(guildId, providerId, {
        apiKey: encryptedApiKey,
        connected: true,
        connectedAt: new Date().toISOString(),
        lastValidated: new Date().toISOString(),
      });

      logger.info(`[ProviderService] Successfully added provider ${providerId} for guild ${guildId}`);

      return {
        valid: true,
        models: validationResult.models,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // 保存連接但標記為未連接
      await this.setProvider(guildId, providerId, {
        connected: false,
        connectedAt: new Date().toISOString(),
        validationError: errorMessage,
      });

      return {
        valid: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 重新驗證提供商連接
   * @param guildId - Guild ID
   * @param providerId - Provider ID
   * @returns 驗證結果
   */
  async validateProvider(guildId: string, providerId: OpenCodeProviderType): Promise<ValidationResult> {
    const connection = await this.getProvider(guildId, providerId);
    
    if (!connection || !connection.apiKey) {
      return {
        valid: false,
        error: 'Provider not configured',
      };
    }

    try {
      // 解密 API Key
      const apiKey = decrypt(connection.apiKey);
      
      // 建立客戶端進行驗證
      const client = createOpenCodeCloudClient(apiKey, providerId);
      const validationResult = await client.validateApiKey();

      // 更新連接狀態
      await this.setProvider(guildId, providerId, {
        ...connection,
        connected: validationResult.valid,
        lastValidated: new Date().toISOString(),
        validationError: validationResult.error,
      });

      return validationResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // 更新連接狀態為失敗
      await this.setProvider(guildId, providerId, {
        ...connection,
        connected: false,
        lastValidated: new Date().toISOString(),
        validationError: errorMessage,
      });

      return {
        valid: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 獲取已解密 的 API Key
   * @param guildId - Guild ID
   * @param providerId - Provider ID
   * @returns 解密後的 API Key（如果存在）
   */
  async getDecryptedApiKey(guildId: string, providerId: string): Promise<string | null> {
    const connection = await this.getProvider(guildId, providerId);
    
    if (!connection || !connection.apiKey) {
      return null;
    }

    try {
      return decrypt(connection.apiKey);
    } catch (error) {
      logger.error('[ProviderService] Failed to decrypt API key', {
        error: error instanceof Error ? error.message : String(error),
        guildId,
        providerId,
      });
      return null;
    }
  }

  /**
   * 列出所有已連接的提供商
   * @param guildId - Guild ID
   * @returns 已連接的提供商列表
   */
  async listConnectedProviders(guildId: string): Promise<ProviderConnection[]> {
    const providers = await this.getProviders(guildId);
    return Object.values(providers).filter((p) => p.connected);
  }

  /**
   * 檢查是否有可用的提供商
   * @param guildId - Guild ID
   * @returns 是否有已連接的提供商
   */
  async hasConnectedProvider(guildId: string): Promise<boolean> {
    const connected = await this.listConnectedProviders(guildId);
    return connected.length > 0;
  }
}

/**
 * 獲取 Provider Service 單例
 */
export function getProviderService(): ProviderService {
  return ProviderService.getInstance();
}

export default {
  ProviderService,
  getProviderService,
};
