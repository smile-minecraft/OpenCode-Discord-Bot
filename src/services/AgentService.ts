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

