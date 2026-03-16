/**
 * Config - 設定檔載入與驗證
 * @description 環境變數載入、驗證與型別定義
 */

import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

// 獲取目前檔案路徑
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 載入環境變數
dotenv.config({
  path: path.resolve(__dirname, '../../.env'),
});

/**
 * Discord 設定
 */
export const discordConfigSchema = z.object({
  /** Discord Bot Token */
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  /** Discord Application Client ID */
  CLIENT_ID: z.string().optional(),
  /** 測試伺服器 ID (Development Guild) */
  GUILD_ID: z.string().optional(),
});

/**
 * 資料庫設定
 */
export const databaseConfigSchema = z.object({
  /** 資料庫連線 URL */
  DATABASE_URL: z.string().optional(),
});

/**
 * 環境設定
 */
export const envConfigSchema = z.object({
  /** 環境模式 */
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  /** 日誌級別 */
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'])
    .default('info'),
});

/**
 * OpenCode 工具審批設定
 */

// 工具審批常量 - 自動批准的工具
export const AUTO_ALLOW_TOOLS = ['read_file', 'read_multiple_files', 'search_files', 'list_directory', 'grep'] as const;

// 工具審批常量 - 需要審批的工具
export const REQUIRED_APPROVAL_TOOLS = ['write_file', 'edit_file', 'delete_file', 'bash', 'execute_command', 'install_package', 'git_command'] as const;

export const opencodeToolApprovalConfigSchema = z.object({
  /** 是否啟用工具審批攔截 */
  TOOL_APPROVAL_ENABLED: z
    .boolean()
    .default(true),
  /** 審批超時時間（秒） */
  TOOL_APPROVAL_TIMEOUT: z
    .number()
    .default(300),
  /** 審批頻道 ID */
  TOOL_APPROVAL_CHANNEL_ID: z
    .string()
    .optional(),
  /** 自動批准的工具（逗號分隔） */
  TOOL_APPROVAL_AUTO_ALLOW: z
    .string()
    .default(AUTO_ALLOW_TOOLS.join(',')),
  /** 需要審批的工具（逗號分隔） */
  TOOL_APPROVAL_REQUIRE_APPROVAL: z
    .string()
    .default(REQUIRED_APPROVAL_TOOLS.join(',')),
});

/**
 * 完整設定 schema
 */
const fullConfigSchema = z.object({
  ...discordConfigSchema.shape,
  ...databaseConfigSchema.shape,
  ...envConfigSchema.shape,
  ...opencodeToolApprovalConfigSchema.shape,
});

/**
 * 解析後的環境變數型別
 */
export type Config = z.infer<typeof fullConfigSchema>;

/**
 * 設定檔錯誤類
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * 載入並驗證設定
 * @returns 驗證後的設定物件
 * @throws {ConfigError} 當必要環境變數缺失時
 */
export function loadConfig(): Config {
  // 從 process.env 提取環境變數
  const env = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    TOOL_APPROVAL_ENABLED: process.env.TOOL_APPROVAL_ENABLED === 'true',
    TOOL_APPROVAL_TIMEOUT: parseInt(process.env.TOOL_APPROVAL_TIMEOUT || '300', 10),
    TOOL_APPROVAL_CHANNEL_ID: process.env.TOOL_APPROVAL_CHANNEL_ID,
    TOOL_APPROVAL_AUTO_ALLOW: process.env.TOOL_APPROVAL_AUTO_ALLOW,
    TOOL_APPROVAL_REQUIRE_APPROVAL: process.env.TOOL_APPROVAL_REQUIRE_APPROVAL,
  };

  // 驗證並解析
  const result = fullConfigSchema.safeParse(env);

  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new ConfigError(`Environment configuration error: ${errors}`);
  }

  return result.data;
}

/**
 * 檢查必要環境變數是否存在
 * @param requiredVars 必要變數名稱陣列
 * @returns 缺失的變數名稱陣列
 */
export function checkRequiredEnvVars(requiredVars: string[]): string[] {
  return requiredVars.filter((varName) => !process.env[varName]);
}

/**
 * 取得環境資訊
 */
export function getEnvInfo(): {
  isDevelopment: boolean;
  isProduction: boolean;
  isTest: boolean;
  nodeEnv: string;
} {
  const nodeEnv = process.env.NODE_ENV || 'development';

  return {
    isDevelopment: nodeEnv === 'development',
    isProduction: nodeEnv === 'production',
    isTest: nodeEnv === 'test',
    nodeEnv,
  };
}

// 預設匯出已載入的設定
let cachedConfig: Config | null = null;

/**
 * 取得已快取的設定（單例模式）
 * @returns 設定物件
 */
export function getConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

/**
 * 重新載入設定
 * @returns 新的設定物件
 */
export function reloadConfig(): Config {
  cachedConfig = loadConfig();
  return cachedConfig;
}

export default {
  loadConfig,
  getConfig,
  reloadConfig,
  checkRequiredEnvVars,
  getEnvInfo,
  ConfigError,
};
