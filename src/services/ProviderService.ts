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

// 加密鹽值 - 使用環境變數或生成隨機鹽
const ENCRYPTION_SALT = (() => {
  const envSalt = process.env.API_KEY_ENCRYPTION_SALT;
  if (envSalt) {
    return envSalt;
  }
  // 生成隨機 16 字節鹽值並轉為 hex
  return crypto.randomBytes(16).toString('hex');
})();

const ALGORITHM = 'aes-256-gcm';

/**
 * 加密字串
 * @param text - 要加密的文字
 * @returns 加密後的文字 (base64)
 */
function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, ENCRYPTION_SALT, 32);
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
 * @throws 如果解密失敗
 */
function decrypt(encryptedText: string): string {
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const [ivHex, authTagHex, encrypted] = parts;
    
    if (!ivHex || !authTagHex || !encrypted) {
      throw new Error('Invalid encrypted data components');
    }
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = crypto.scryptSync(ENCRYPTION_KEY, ENCRYPTION_SALT, 32);
    
    if (iv.length !== 16) {
      throw new Error('Invalid IV length');
    }
    
    if (authTag.length !== 16) {
      throw new Error('Invalid auth tag length');
    }
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
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
  models?: string[];          // 儲存的模型列表（用於 OpenCode 等不支持 /models API 的提供商）
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
   * 提供商環境變數映射
   */
  private readonly providerEnvMap: Record<string, string> = {
    'opencode-zen': 'OPENCODE_ZEN_API_KEY',
    'opencode-go': 'OPENCODE_GO_API_KEY',
    'anthropic': 'ANTHROPIC_API_KEY',
    'openai': 'OPENAI_API_KEY',
  };

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
      // OpenCode providers (opencode-zen, opencode-go) skip API validation
      // because /models endpoint returns 404 and chat completion returns "Model not supported"
      const isOpenCodeProvider = providerId === 'opencode-zen' || providerId === 'opencode-go';
      
      if (isOpenCodeProvider) {
        // Basic format check: minimum length validation for API key
        const minKeyLength = 10;
        if (!apiKey || apiKey.trim().length < minKeyLength) {
          const error = `API key must be at least ${minKeyLength} characters`;
          logger.error(`[ProviderService] Invalid API key format for provider ${providerId}`, {
            guildId,
            providerId,
          });
          
          await this.setProvider(guildId, providerId, {
            connected: false,
            connectedAt: new Date().toISOString(),
            validationError: error,
          });
          
          return { valid: false, error };
        }
        
        // Get default models based on provider
        const defaultModels = this.getOpenCodeDefaultModels(providerId);
        
        // Encrypt and save API key with connected: true
        const encryptedApiKey = encrypt(apiKey);
        
        await this.setProvider(guildId, providerId, {
          apiKey: encryptedApiKey,
          connected: true,
          connectedAt: new Date().toISOString(),
          lastValidated: new Date().toISOString(),
          models: defaultModels,
        });
        
        logger.info(`[ProviderService] Successfully added OpenCode provider ${providerId} for guild ${guildId} (validation skipped)`);
        
        return {
          valid: true,
          models: defaultModels,
        };
      }
      
      // For other providers (anthropic, openai), use existing validation logic
      // 建立客戶端進行驗證
      const client = createOpenCodeCloudClient(apiKey, providerId);
      
      // 驗證 API Key
      const validationResult = await client.validateApiKey();
      
      if (!validationResult.valid) {
        // 記錄驗證失敗
        logger.error(`[ProviderService] Failed to validate provider ${providerId}`, {
          guildId,
          providerId,
          error: validationResult.error,
        });
        
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
        models: validationResult.models,
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
   * 取得 OpenCode 提供商的預設模型列表
   * @param providerId - Provider ID
   * @returns 預設模型 ID 數組
   */
  private getOpenCodeDefaultModels(providerId: OpenCodeProviderType): string[] {
    switch (providerId) {
      case 'opencode-zen':
        // OpenCode Zen: GPT-5, Claude Opus, etc.
        return [
          'opencode/gpt-5.2-codex',
          'opencode/gpt-5-sierra',
          'opencode/claude-opus-4-20250514',
          'opencode/claude-sonnet-4-20250514',
        ];
      case 'opencode-go':
        // OpenCode Go: GLM-5, Kimi K2.5, MiniMax M2.5
        return [
          'opencode-go/glm-5',
          'opencode-go/kimi-k2.5',
          'opencode-go/minimax-m2.5',
          'opencode-go/minimax-m2.5-free',
        ];
      default:
        return [];
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
      let apiKey: string;
      try {
        apiKey = decrypt(connection.apiKey);
      } catch (decryptError) {
        const errorMsg = decryptError instanceof Error ? decryptError.message : 'Decryption failed';
        logger.error('[ProviderService] Failed to decrypt API key during validation', {
          guildId,
          providerId,
          error: errorMsg,
        });
        
        const envKey = this.getProviderEnvKey(providerId);
        
        // 更新為無效狀態
        await this.setProvider(guildId, providerId, {
          ...connection,
          connected: false,
          lastValidated: new Date().toISOString(),
          validationError: `API key decryption failed. Please set ${envKey} environment variable`,
        });
        
        return {
          valid: false,
          error: `API key decryption failed. Please set ${envKey} environment variable`,
        };
      }
      
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // 檢測是否是金鑰不匹配問題（常見於環境變數更改後）
      if (errorMessage.includes('Unsupported state') || errorMessage.includes('authentication')) {
        const envKey = this.getProviderEnvKey(providerId);
        logger.error(`[ProviderService] API key decryption failed - encryption key may have changed. Please set ${envKey} environment variable`, {
          guildId,
          providerId,
          envKey,
          error: errorMessage,
        });
      } else {
        logger.error('[ProviderService] Failed to decrypt API key', {
          error: errorMessage,
          guildId,
          providerId,
        });
      }
      
      return null;
    }
  }

  /**
   * 從環境變數獲取 API Key
   * @param providerId - Provider ID
   * @returns API Key（如果環境變數已設定）
   */
  getApiKeyFromEnv(providerId: string): string | null {
    const envKey = this.providerEnvMap[providerId];
    if (!envKey) {
      logger.warn(`[ProviderService] Unknown provider: ${providerId}`);
      return null;
    }
    
    const apiKey = process.env[envKey];
    if (!apiKey) {
      logger.debug(`[ProviderService] Environment variable not set: ${envKey}`);
    }
    
    return apiKey || null;
  }

  /**
   * 獲取提供商環境變數名稱
   * @param providerId - Provider ID
   * @returns 環境變數名稱
   */
  getProviderEnvKey(providerId: string): string | null {
    return this.providerEnvMap[providerId] || null;
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

  /**
   * 獲取提供商已儲存的模型列表
   * @param guildId - Guild ID
   * @param providerId - Provider ID
   * @returns 儲存的模型 ID 數組（如果存在）
   */
  async getStoredModels(guildId: string, providerId: string): Promise<string[] | null> {
    const connection = await this.getProvider(guildId, providerId);
    if (!connection || !connection.connected) {
      return null;
    }
    return connection.models || null;
  }

  /**
   * 清除所有無法解密的提供商配置
   * @param guildId - Guild ID
   * @returns 被清除的提供商數量
   */
  async clearInvalidProviders(guildId: string): Promise<number> {
    const providers = await this.getProviders(guildId);
    let clearedCount = 0;

    for (const [providerId, connection] of Object.entries(providers)) {
      if (connection.apiKey) {
        try {
          // 嘗試解密
          decrypt(connection.apiKey);
        } catch (error) {
          // 解密失敗，清除這個 provider
          logger.warn('[ProviderService] Clearing invalid provider configuration', {
            guildId,
            providerId,
            error: error instanceof Error ? error.message : String(error),
          });
          
          await this.removeProvider(guildId, providerId as OpenCodeProviderType);
          clearedCount++;
        }
      }
    }

    return clearedCount;
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
