/**
 * Agent Service
 * @description 從 OpenCode SDK 動態獲取 Agent 列表，並提供靜態 fallback
 */

import { AGENTS } from '../models/AgentData.js';
import {
  getInitializedSDKAdapter,
  SDKAdapterError,
  type SDKAgentInfo,
} from './OpenCodeSDKAdapter.js';
import logger from '../utils/logger.js';

export interface RuntimeAgentDefinition {
  id: string;
  name: string;
  description: string;
  mode?: string;
  builtIn?: boolean;
  defaultModel?: string;
  source: 'sdk' | 'static';
}

/** 主代理 ID 清單（固定保留） */
const PRIMARY_AGENT_IDS = new Set(['arch', 'build', 'review', 'ultra', 'general']);

/**
 * 檢查是否為主代理
 * 規則：
 * 1. 若 agent.mode 存在，優先依 mode 判定（只有 `primary` 為 true）
 *    - mode='primary' → 是主代理
 *    - mode='subagent' → 不是主代理
 *    - mode='all' → 不是主代理
 * 2. 若 mode 缺失，fallback 到現有機制：
 *    - id 為 arch/build/review/ultra/general（白名單，大小寫不敏感）
 *    - description 或 name 含「主代理」關鍵字（精確匹配）
 * 
 * 注意：「primary」單獨出現不作數，因為太寬鬆會誤判「primary color」等無關描述
 */
export function isPrimaryAgent(agent: RuntimeAgentDefinition): boolean {
  // 排除 built-in 內建代理，不出現在使用者可選的 UI 列表中
  if (agent.builtIn === true) {
    return false;
  }

  // 優先：SDK mode 判定（若有 mode 欄位且為 primary，則為主代理）
  if (agent.mode !== undefined) {
    return agent.mode.toLowerCase() === 'primary';
  }

  // Fallback：優先保留 ID 白名單中的主代理（大小寫不敏感）
  if (PRIMARY_AGENT_IDS.has(agent.id.toLowerCase())) {
    return true;
  }

  // Fallback：檢查 description 或 name 是否含「主代理」關鍵字
  // 採用精確關鍵字匹配，避免「primary」等寬鬆關鍵字造成誤判
  const descLower = agent.description.toLowerCase();
  const nameLower = agent.name.toLowerCase();
  return descLower.includes('主代理') || nameLower.includes('主代理');
}

/**
 * 過濾主代理列表
 * - 若過濾後為空，fallback 至 'general'
 */
export function filterPrimaryAgents(agents: RuntimeAgentDefinition[]): RuntimeAgentDefinition[] {
  const filtered = agents.filter(isPrimaryAgent);

  // Fallback: 若過濾後為空，回傳 'general' 單一代理
  if (filtered.length === 0) {
    const generalAgent = agents.find((a) => a.id === 'general' && a.builtIn !== true);
    if (generalAgent) {
      return [generalAgent];
    }
    // 完全找不到，回傳空陣列讓調用端處理
    return [];
  }

  return filtered;
}

interface AgentCacheEntry {
  data: RuntimeAgentDefinition[];
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, AgentCacheEntry>();

function getCacheKey(projectPath?: string): string {
  return projectPath && projectPath.trim() !== '' ? projectPath : 'default';
}

function getStaticFallbackAgents(): RuntimeAgentDefinition[] {
  return AGENTS.map((agent) => ({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    defaultModel: agent.defaultModel,
    source: 'static' as const,
  }));
}

function normalizeSDKAgents(agents: SDKAgentInfo[]): RuntimeAgentDefinition[] {
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    description: agent.description || 'OpenCode Agent',
    mode: agent.mode,
    builtIn: agent.builtIn,
    defaultModel: agent.defaultModel,
    source: 'sdk' as const,
  }));
}

/**
 * 取得可用 Agent 列表（SDK 優先，靜態 fallback）
 */
export async function getAvailableAgents(
  options: {
    projectPath?: string;
    useCache?: boolean;
    allowFallback?: boolean;
  } = {}
): Promise<RuntimeAgentDefinition[]> {
  const {
    projectPath,
    useCache = true,
    allowFallback = true,
  } = options;

  const cacheKey = getCacheKey(projectPath);
  const now = Date.now();

  if (useCache) {
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }
  }

  try {
    const adapter = getInitializedSDKAdapter();
    const sdkAgents = await adapter.getAgents(projectPath);
    const normalized = normalizeSDKAgents(sdkAgents);

    if (normalized.length > 0) {
      cache.set(cacheKey, { data: normalized, expiresAt: now + CACHE_TTL_MS });
      return normalized;
    }
  } catch (error) {
    if (error instanceof SDKAdapterError && error.code === 'NOT_INITIALIZED') {
      logger.debug('[AgentService] SDK 未初始化，使用靜態 Agent fallback');
    } else {
      logger.warn('[AgentService] 從 SDK 取得 Agent 失敗，使用 fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!allowFallback) {
    return [];
  }

  const fallback = getStaticFallbackAgents();
  cache.set(cacheKey, { data: fallback, expiresAt: now + CACHE_TTL_MS });
  return fallback;
}

/**
 * 依 ID 查找 Agent（SDK 優先）
 */
export async function getAgentById(id: string, projectPath?: string): Promise<RuntimeAgentDefinition | undefined> {
  const agents = await getAvailableAgents({ projectPath, useCache: true, allowFallback: true });
  return agents.find((agent) => agent.id === id);
}

/**
 * 清除 Agent 快取
 */
export function clearAgentCache(projectPath?: string): void {
  if (projectPath && projectPath.trim() !== '') {
    cache.delete(getCacheKey(projectPath));
    return;
  }
  cache.clear();
}

