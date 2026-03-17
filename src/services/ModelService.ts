/**
 * Model Service
 * @description 從環境變數獲取模型列表的服務
 */

import { LRUCache } from 'lru-cache';
import { MODELS, DEFAULT_MODEL, getModelById, type ModelDefinition, type ModelProvider } from '../models/ModelData.js';
import { log as logger } from '../utils/logger.js';

// 預設模型列表
const DEFAULT_MODELS = MODELS;

/**
 * 從環境變數獲取 API Key
 * @returns API Key 或 null
 */
function getApiKeyFromEnv(): string | null {
  return process.env.OPENCODE_API_KEY || null;
}

/**
 * 從環境變數獲取可用模型列表
 * @returns 模型 ID 數組
 */
function getModelsFromEnv(): string[] {
  const models = process.env.OPENCODE_MODELS;
  if (models) {
    return models.split(',').map(m => m.trim());
  }
  // 回傳預設模型列表
  return DEFAULT_MODELS.map(m => m.id);
}

// 模型緩存（按 guildId 緩存）- 使用 LRUCache 自動管理過期和容量
const modelCacheByGuild = new LRUCache<string, ModelDefinition[]>({
  max: 1000,              // 最大緩存數
  ttl: 5 * 60 * 1000,     // 5 分鐘 TTL
  updateAgeOnGet: true,   // 訪問時更新過期時間
  updateAgeOnHas: false,
});

/**
 * 生成精確的緩存鍵
 * P2-14: 使用更精確的緩存鍵，包含環境配置哈希
 * @param guildId - Guild ID
 * @returns 緩存鍵
 */
function generateCacheKey(guildId?: string): string {
  // 包含配置信息在緩存鍵中，確保不同配置使用不同緩存
  const apiKey = getApiKeyFromEnv();
  const envModelsStr = process.env.OPENCODE_MODELS || '';
  const configHash = `${apiKey ? 'hasKey' : 'noKey'}:${envModelsStr}`;
  
  // 如果有 guildId，結合配置哈希
  if (guildId) {
    return `${guildId}:${configHash}`;
  }
  // 否則使用全局鍵
  return `global:${configHash}`;
}

/**
 * 檢查 Model Service 是否已配置
 * @returns 是否已配置（API Key 或明確的模型列表）
 */
export function isModelServiceConfigured(): boolean {
  const apiKey = getApiKeyFromEnv();
  const envModelsStr = process.env.OPENCODE_MODELS;
  const hasExplicitModels = !!envModelsStr;
  return !!apiKey || hasExplicitModels;
}

/**
 * 清除模型列表緩存
 * P2-14: 使用更精確的緩存鍵清除
 * @param guildId - Guild ID（可選，不提供則清除所有緩存）
 */
export function clearModelCache(guildId?: string): void {
  if (guildId) {
    // 清除特定 guildId 的緩存（包含所有配置變體）
    // 由於我們無法預知所有配置變體，直接清除該前綴的所有鍵
    modelCacheByGuild.clear();
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
  
  // 有效的提供商映射（保持原始名稱以匹配 getProviders 返回的 ID）
  const validProviders: Record<string, ModelProvider> = {
    anthropic: 'anthropic',
    openai: 'openai',
    google: 'google',
    xai: 'xai',
    cohere: 'cohere',
    mistral: 'mistral',
    // 動態提供商 - 保留原始名稱
    opencode: 'opencode',
    'opencode-go': 'opencode-go',
    'opencode-zen': 'opencode-zen',
    'github-copilot': 'github-copilot',
  };
  
  // P2-15: 使用類型守衛而不是類型斷言
  // 檢查提供商是否為有效的 ModelProvider
  function isValidModelProvider(p: string): p is ModelProvider {
    return Object.values(validProviders).includes(p as ModelProvider) || 
           validProviders.hasOwnProperty(p);
  }
  
  // 使用類型守衛驗證提供商
  const mappedProvider: ModelProvider = isValidModelProvider(provider) 
    ? provider 
    : 'opencode'; // 默認為 opencode 作為 fallback
  
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
 * 獲取可用的模型列表（從環境變數獲取或使用 fallback）
 * @param guildId - Discord Guild ID
 * @param useCache - 是否使用緩存（默認 true）
 * @param allowFallback - 是否允許使用靜態 fallback（默認 false）
 * @returns 模型定義數組
 */
export async function getAvailableModels(guildId?: string, useCache: boolean = true, allowFallback: boolean = false): Promise<ModelDefinition[]> {
  // P2-14: 使用更精確的緩存鍵
  const cacheKey = generateCacheKey(guildId);
  
  // 檢查緩存
  if (useCache) {
    const cached = modelCacheByGuild.get(cacheKey);
    if (cached) {
      logger.debug('[ModelService] Using cached model list', { 
        guildId,
        count: cached.length,
      });
      return cached;
    }
  }

  // 檢查環境變數是否配置
  const apiKey = getApiKeyFromEnv();
  const envModelsStr = process.env.OPENCODE_MODELS;
  const envModels = envModelsStr ? envModelsStr.split(',').map(m => m.trim()) : [];
  
  // P1-8: 使用 isModelServiceConfigured() 檢查是否已配置
  const isConfigured = isModelServiceConfigured();
  
  // 如果有配置，轉換為模型定義
  if (isConfigured) {
    const modelsToUse = envModels.length > 0 ? envModels : DEFAULT_MODELS.map(m => m.id);
    const modelDefs = modelsToUse.map(convertToModelDefinition);
    
    // 更新緩存
    modelCacheByGuild.set(cacheKey, modelDefs);
    
    logger.info('[ModelService] Using models from environment configuration', { 
      guildId,
      count: modelDefs.length,
      hasApiKey: !!apiKey,
    });
    
    return modelDefs;
  }
  
  // 如果沒有環境變數且不允許 fallback，拋出錯誤
  if (!allowFallback) {
    throw new Error('No API key configured. Please set OPENCODE_API_KEY in your .env file.');
  }
  
  // 只有在允許的情況下才使用靜態 fallback
  if (allowFallback) {
    const fallbackModels = MODELS;
    
    // 更新緩存
    modelCacheByGuild.set(cacheKey, fallbackModels);
    
    logger.info('[ModelService] Using static model list as fallback', { 
      guildId,
      count: fallbackModels.length 
    });
    
    return fallbackModels;
  }
  
  // 如果到達這裡，表示不允許 fallback 且無法獲取
  throw new Error('No available models. Please set OPENCODE_API_KEY and OPENCODE_MODELS in your .env file.');
}

/**
 * 獲取動態模型列表（從環境變數）
 * @param guildId - Discord Guild ID
 * @returns 模型 ID 數組
 */
export async function getDynamicModelList(_guildId?: string): Promise<string[]> {
  // 從環境變數獲取模型
  return getModelsFromEnv();
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
 * 獲取所有提供商列表（從環境變數配置）
 * @param guildId - Discord Guild ID（可選）
 * @returns 排序後的提供商名稱數組
 * @throws Error 當無法獲取 providers 時
 */
export async function getProviders(_guildId?: string): Promise<string[]> {
  // P1-8: 使用 isModelServiceConfigured() 檢查是否已配置
  if (!isModelServiceConfigured()) {
    throw new Error('No API key configured. Please set OPENCODE_API_KEY in your .env file.');
  }
  
  // 從模型列表中提取提供商
  const models = await getAvailableModels(_guildId);
  const providersSet = new Set<string>();
  
  for (const model of models) {
    providersSet.add(model.provider);
  }
  
  if (providersSet.size === 0) {
    throw new Error('No providers available. Please configure OPENCODE_MODELS in your .env file.');
  }
  
  return Array.from(providersSet).sort();
}

/**
 * 根據提供商篩選模型（支持動態 provider 名稱）
 * @param provider - 提供商名稱
 * @param guildId - Discord Guild ID（可選）
 * @returns 該提供商的模型數組
 */
export async function getModelsByProviderDynamic(provider: string, guildId?: string): Promise<ModelDefinition[]> {
  const models = await getAvailableModels(guildId);
  
  // 靈活匹配：支持精確匹配和 provider ID 別名映射
  // 例如：用戶選擇 "opencode-go" 時，應該匹配 provider 為 "opencode-go" 的模型
  const providerAliases: Record<string, string[]> = {
    'opencode-go': ['opencode-go'],
    'opencode': ['opencode'],
    'opencode-zen': ['opencode-zen'],
    'github-copilot': ['github-copilot'],
  };
  
  const aliases = providerAliases[provider] || [provider];
  
  return models.filter(m => aliases.includes(m.provider));
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
