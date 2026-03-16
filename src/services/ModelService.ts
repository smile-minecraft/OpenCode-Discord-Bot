/**
 * Model Service
 * @description 從連接的 Provider 動態獲取模型列表的服務
 */

import { MODELS, DEFAULT_MODEL, getModelById, type ModelDefinition, type ModelProvider } from '../models/ModelData.js';
import { log as logger } from '../utils/logger.js';
import { ProviderService } from './ProviderService.js';
import { createOpenCodeCloudClient, type OpenCodeProviderType } from './OpenCodeCloudClient.js';

// 緩存配置
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// 模型緩存（按 guildId 緩存）
const modelCacheByGuild: Map<string, CacheEntry<ModelDefinition[]>> = new Map();

// 緩存配置
const DEFAULT_CACHE_TTL = 5 * 60 * 1000; // 5 分鐘

/**
 * 清除模型列表緩存
 * @param guildId - Guild ID（可選，不提供則清除所有緩存）
 */
export function clearModelCache(guildId?: string): void {
  if (guildId) {
    modelCacheByGuild.delete(guildId);
  } else {
    modelCacheByGuild.clear();
  }
}

/**
 * 將模型 ID 轉換為簡化的 ModelDefinition
 * @param modelId - 模型 ID (如: google/gemini-1.5-flash)
 * @returns 簡化的模型定義
 */
function convertToModelDefinition(modelId: string): ModelDefinition {
  const [provider, ...nameParts] = modelId.split('/');
  const name = nameParts.join('/');
  
  // 嘗試從靜態數據中獲取完整信息
  const existingModel = getModelById(modelId);
  
  if (existingModel) {
    return existingModel;
  }
  
  // 如果靜態數據中沒有，創建簡化版本
  const providerMap: Record<string, ModelProvider> = {
    opencode: 'anthropic',
    'opencode-go': 'anthropic',
    'github-copilot': 'anthropic',
    google: 'google',
    openai: 'openai',
    xai: 'xai',
    cohere: 'cohere',
    mistral: 'mistral',
  };
  
  const mappedProvider = providerMap[provider] || provider as ModelProvider;
  
  // 根據名稱推斷類別
  let category: 'fast' | 'balanced' | 'powerful' = 'balanced';
  const lowerName = name.toLowerCase();
  if (lowerName.includes('mini') || lowerName.includes('fast') || lowerName.includes('haiku') || lowerName.includes('nano') || lowerName.includes('lite')) {
    category = 'fast';
  } else if (lowerName.includes('pro') || lowerName.includes('opus') || lowerName.includes('large') || lowerName.includes('powerful')) {
    category = 'powerful';
  }
  
  return {
    id: modelId,
    provider: mappedProvider,
    name: name.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' '),
    description: `${name} 模型`,
    category,
    pricing: { input: 0, output: 0 }, // 動態獲取的模型沒有定價信息
    limits: { maxTokens: 8192, contextWindow: 128000 },
    features: [],
  };
}

/**
 * 從 Provider 獲取模型列表
 * @param providerId - Provider ID
 * @param apiKey - API Key
 * @returns 模型 ID 數組
 */
async function fetchModelsFromProvider(providerId: OpenCodeProviderType, apiKey: string): Promise<string[]> {
  try {
    const client = createOpenCodeCloudClient(apiKey, providerId);
    const models = await client.getModels();
    logger.info(`[ModelService] Fetched ${models.length} models from provider ${providerId}`);
    return models;
  } catch (error) {
    logger.error(`[ModelService] Failed to fetch models from provider ${providerId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * 獲取可用的模型列表（從 connected providers 獲取或使用 fallback）
 * @param guildId - Discord Guild ID
 * @param useCache - 是否使用緩存（默認 true）
 * @returns 模型定義數組
 */
export async function getAvailableModels(guildId?: string, useCache: boolean = true): Promise<ModelDefinition[]> {
  const cacheKey = guildId || 'global';
  
  // 檢查緩存
  if (useCache) {
    const cached = modelCacheByGuild.get(cacheKey);
    if (cached) {
      const now = Date.now();
      if (now - cached.timestamp < DEFAULT_CACHE_TTL) {
        logger.debug('[ModelService] Using cached model list', { 
          guildId,
          count: cached.data.length,
          age: now - cached.timestamp 
        });
        return cached.data;
      } else {
        logger.debug('[ModelService] Cache expired, refetching models');
      }
    }
  }

  // 如果提供了 guildId，嘗試從 connected providers 獲取模型
  if (guildId) {
    try {
      const providerService = ProviderService.getInstance();
      const providers = await providerService.getProviders(guildId);
      
      const allModels: ModelDefinition[] = [];
      
      // 遍歷所有 connected providers
      for (const [providerId, connection] of Object.entries(providers)) {
        if (connection.connected && connection.apiKey) {
          // 解密 API Key
          const apiKey = await providerService.getDecryptedApiKey(guildId, providerId);
          if (apiKey) {
            const modelIds = await fetchModelsFromProvider(providerId as OpenCodeProviderType, apiKey);
            const models = modelIds.map(convertToModelDefinition);
            allModels.push(...models);
          }
        }
      }
      
      // 如果有從 providers 獲取的模型
      if (allModels.length > 0) {
        // 更新緩存
        modelCacheByGuild.set(cacheKey, {
          data: allModels,
          timestamp: Date.now(),
        });
        
        logger.info('[ModelService] Successfully fetched models from connected providers', { 
          guildId,
          count: allModels.length,
        });
        
        return allModels;
      }
      
      logger.info('[ModelService] No connected providers, using static fallback', { guildId });
    } catch (error) {
      logger.error('[ModelService] Error fetching models from providers', {
        error: error instanceof Error ? error.message : String(error),
        guildId,
      });
    }
  }
  
  // 如果沒有 guildId 或無法從 providers 獲取，使用靜態 fallback
  const fallbackModels = MODELS;
  
  // 更新緩存
  modelCacheByGuild.set(cacheKey, {
    data: fallbackModels,
    timestamp: Date.now(),
  });
  
  logger.info('[ModelService] Using static model list as fallback', { 
    guildId,
    count: fallbackModels.length 
  });
  
  return fallbackModels;
}

/**
 * 獲取動態模型列表（從 providers，不使用 fallback）
 * @param guildId - Discord Guild ID
 * @returns 模型 ID 數組
 */
export async function getDynamicModelList(guildId?: string): Promise<string[]> {
  if (!guildId) {
    return [];
  }
  
  try {
    const providerService = ProviderService.getInstance();
    const providers = await providerService.getProviders(guildId);
    
    const allModels: string[] = [];
    
    for (const [providerId, connection] of Object.entries(providers)) {
      if (connection.connected && connection.apiKey) {
        const apiKey = await providerService.getDecryptedApiKey(guildId, providerId);
        if (apiKey) {
          const modelIds = await fetchModelsFromProvider(providerId as OpenCodeProviderType, apiKey);
          allModels.push(...modelIds);
        }
      }
    }
    
    return allModels;
  } catch (error) {
    logger.error('[ModelService] getDynamicModelList failed', { 
      error: error instanceof Error ? error.message : String(error),
      guildId,
    });
    return [];
  }
}

/**
 * 根據提供商篩選模型
 * @param provider - 提供商
 * @param guildId - Discord Guild ID（可選）
 * @returns 篩選後的模型數組
 */
export async function getModelsByProvider(provider: ModelProvider, guildId?: string): Promise<ModelDefinition[]> {
  const models = await getAvailableModels(guildId);
  return models.filter(m => m.provider === provider);
}

/**
 * 根據類別篩選模型
 * @param category - 模型類別
 * @param guildId - Discord Guild ID（可選）
 * @returns 篩選後的模型數組
 */
export async function getModelsByCategory(category: 'fast' | 'balanced' | 'powerful', guildId?: string): Promise<ModelDefinition[]> {
  const models = await getAvailableModels(guildId);
  return models.filter(m => m.category === category);
}

/**
 * 獲取所有提供商列表（從 connected providers 或靜態數據提取）
 * @param guildId - Discord Guild ID（可選）
 * @returns 排序後的提供商名稱數組
 */
export async function getProviders(guildId?: string): Promise<string[]> {
  // 如果有 guildId，嘗試從 connected providers 獲取
  if (guildId) {
    try {
      const providerService = ProviderService.getInstance();
      const providers = await providerService.getProviders(guildId);
      
      const connectedProviders = Object.entries(providers)
        .filter(([, conn]) => conn.connected)
        .map(([id]) => id);
      
      if (connectedProviders.length > 0) {
        return connectedProviders.sort();
      }
    } catch (error) {
      logger.error('[ModelService] Error fetching providers', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  // 回退到靜態數據
  const models = await getAvailableModels(guildId);
  const providers = new Set(models.map(m => m.provider));
  return Array.from(providers).sort();
}

/**
 * 根據提供商篩選模型（支持動態 provider 名稱）
 * @param provider - 提供商名稱
 * @param guildId - Discord Guild ID（可選）
 * @returns 該提供商的模型數組
 */
export async function getModelsByProviderDynamic(provider: string, guildId?: string): Promise<ModelDefinition[]> {
  const models = await getAvailableModels(guildId);
  return models.filter(m => m.provider === provider);
}

/**
 * 根據 ID 獲取模型
 * @param id - 模型 ID
 * @param guildId - Discord Guild ID（可選）
 * @returns 模型定義或 undefined
 */
export async function getModelByIdAsync(id: string, guildId?: string): Promise<ModelDefinition | undefined> {
  const models = await getAvailableModels(guildId);
  return models.find(m => m.id === id);
}

/**
 * 獲取默認模型
 * @returns 默認模型 ID
 */
export function getDefaultModel(): string {
  return DEFAULT_MODEL;
}

// 導出用於測試的內部函數
export const __test__ = {
  convertToModelDefinition,
  clearModelCache: () => { modelCacheByGuild.clear(); },
};
