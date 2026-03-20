/**
 * Constants - 配置常量載入器
 * @description 從 config.json 載入配置，失敗時使用預設值
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { DEFAULTS } from './defaults.js';

/**
 * 配置文件類型
 */
export interface ConfigFile {
  opencode: {
    api: {
      baseUrl: string;
      timeout: number;
    };
    server: {
      port: number;
      url: string;
    };
  };
  model: {
    default: string;
  };
  timeouts: {
    http: number;
    healthCheck: number;
    toolApproval: number;
    task: number;
    reconnect: number;
    voiceDownload: number;
  };
  discord: {
    streamUpdateInterval: number;
  };
}

/**
 * 獲取 resources 目錄路徑
 */
function getResourcesPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '../../resources');
}

/**
 * 載入配置文件
 * @returns 配置文件內容，如果失敗則返回 null
 */
function loadConfigFile(): ConfigFile | null {
  try {
    const configPath = path.join(getResourcesPath(), 'config.json');
    
    if (!existsSync(configPath)) {
      console.warn('[Config] config.json not found, using default values');
      return null;
    }
    
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as ConfigFile;
  } catch (error) {
    console.warn('[Config] Failed to load config.json, using default values:', error);
    return null;
  }
}

// 載入配置（單例模式）
const loadedConfig = loadConfigFile();

/**
 * OpenCode API 配置
 */
export const OPENCODE_API = {
  BASE_URL: loadedConfig?.opencode?.api?.baseUrl ?? DEFAULTS.OPENCODE_API.BASE_URL,
  TIMEOUT: loadedConfig?.opencode?.api?.timeout ?? DEFAULTS.OPENCODE_API.TIMEOUT,
};

/**
 * OpenCode 伺服器配置
 */
export const OPENCODE_SERVER = {
  PORT: loadedConfig?.opencode?.server?.port ?? DEFAULTS.OPENCODE_SERVER.PORT,
  URL: loadedConfig?.opencode?.server?.url ?? DEFAULTS.OPENCODE_SERVER.URL,
};

/**
 * 模型配置
 */
export const MODEL_CONFIG = {
  DEFAULT: loadedConfig?.model?.default ?? DEFAULTS.MODEL.DEFAULT,
};

/**
 * 超時配置
 */
export const TIMEOUTS = {
  HTTP: loadedConfig?.timeouts?.http ?? DEFAULTS.TIMEOUTS.HTTP,
  HEALTH_CHECK: loadedConfig?.timeouts?.healthCheck ?? DEFAULTS.TIMEOUTS.HEALTH_CHECK,
  TOOL_APPROVAL: loadedConfig?.timeouts?.toolApproval ?? DEFAULTS.TIMEOUTS.TOOL_APPROVAL,
  TASK: loadedConfig?.timeouts?.task ?? DEFAULTS.TIMEOUTS.TASK,
  RECONNECT: loadedConfig?.timeouts?.reconnect ?? DEFAULTS.TIMEOUTS.RECONNECT,
  VOICE_DOWNLOAD: loadedConfig?.timeouts?.voiceDownload ?? DEFAULTS.TIMEOUTS.VOICE_DOWNLOAD,
};

/**
 * Discord 配置
 */
export const DISCORD_CONFIG = {
  STREAM_UPDATE_INTERVAL: loadedConfig?.discord?.streamUpdateInterval ?? DEFAULTS.DISCORD.STREAM_UPDATE_INTERVAL,
};

/**
 * 功能開關配置
 * @deprecated 已統一使用 SDK 適配器，此配置保留向後相容
 */
export const FEATURE_FLAGS = {
  /** 使用 SDK 適配器（已強制啟用） */
  USE_SDK_ADAPTER: true,
};

export default {
  OPENCODE_API,
  OPENCODE_SERVER,
  MODEL_CONFIG,
  TIMEOUTS,
  DISCORD_CONFIG,
  FEATURE_FLAGS,
};
