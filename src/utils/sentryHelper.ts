/**
 * Sentry 輔助函數 - Discord Bot 專用
 * @description 提供 Discord 相關錯誤追蹤和上下文設置功能
 */

import * as Sentry from '@sentry/node';
import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  SelectMenuInteraction,
  ModalSubmitInteraction,
  User,
  Guild,
} from 'discord.js';
import { PermissionError, ValidationError, SessionError, BotError } from './errorHandler.js';

/**
 * Discord 交互類型
 */
type DiscordInteraction = 
  | ChatInputCommandInteraction 
  | ButtonInteraction 
  | SelectMenuInteraction 
  | ModalSubmitInteraction;

/**
 * 錯誤上下文
 */
interface ErrorContext {
  guildId?: string;
  guildName?: string;
  channelId?: string;
  userId?: string;
  userName?: string;
  commandName?: string;
  customId?: string;
  [key: string]: string | undefined;
}

/**
 * 判斷是否應該上報錯誤
 * @param error - 要檢查的錯誤
 * @returns 是否應該上報到 Sentry
 */
export function shouldCaptureError(error: Error): boolean {
  // PermissionError - 業務錯誤，不需要上報
  if (error instanceof PermissionError) {
    return false;
  }

  // ValidationError - 業務錯誤，不需要上報
  if (error instanceof ValidationError) {
    return false;
  }

  // SessionError - 業務錯誤，不需要上報
  if (error instanceof SessionError) {
    return false;
  }

  // BotError - 檢查是否為 operational
  if (error instanceof BotError) {
    return error.isOperational === false;
  }

  // 其他錯誤 - 需要上報
  return true;
}

/**
 * 添加 Discord 相關上下文
 * @param interaction - Discord 交互對象
 */
export function addDiscordContext(interaction: DiscordInteraction): void {
  if (!process.env.SENTRY_DSN) {
    return; // Sentry 未初始化，跳過
  }

  const context: ErrorContext = {};

  // 用戶信息
  if (interaction.user) {
    context.userId = interaction.user.id;
    context.userName = interaction.user.username;
  }

  // 伺服器信息
  if (interaction.guild) {
    context.guildId = interaction.guild.id;
    context.guildName = interaction.guild.name;
  }

  // 頻道信息
  if (interaction.channelId) {
    context.channelId = interaction.channelId;
  }

  // 命令信息
  if (interaction.isCommand()) {
    context.commandName = interaction.commandName;
  }

  // 自定義 ID (按鈕、選擇菜單等)
  if (interaction.isButton() || interaction.isSelectMenu() || interaction.isModalSubmit()) {
    context.customId = interaction.customId;
  }

  // 設置到 Sentry
  Sentry.setContext('discord', context);
}

/**
 * 添加用戶上下文
 * @param user - Discord 用戶
 * @param guild - 可選的 Discord 伺服器
 */
export function setUserContext(user: User, guild?: Guild): void {
  if (!process.env.SENTRY_DSN) {
    return; // Sentry 未初始化，跳過
  }

  const userContext: Sentry.User = {
    id: user.id,
    username: user.username,
    discriminator: user.discriminator,
  };

  if (guild) {
    userContext.ip_address = 'remote'; // Discord 不提供 IP
  }

  Sentry.setUser(userContext);

  // 額外的伺服器上下文
  if (guild) {
    Sentry.setContext('guild', {
      id: guild.id,
      name: guild.name,
      memberCount: guild.memberCount,
    });
  }
}

/**
 * 設置伺服器上下文
 * @param guild - Discord 伺服器
 */
export function setGuildContext(guild: Guild): void {
  if (!process.env.SENTRY_DSN) {
    return; // Sentry 未初始化，跳過
  }

  Sentry.setContext('guild', {
    id: guild.id,
    name: guild.name,
    memberCount: guild.memberCount,
    ownerId: guild.ownerId,
  });
}

/**
 * 捕獲 Discord 交互錯誤
 * @param error - 錯誤對象
 * @param interaction - Discord 交互對象
 * @returns 是否成功上報
 */
export function captureInteractionError(
  error: Error,
  interaction: DiscordInteraction
): boolean {
  if (!process.env.SENTRY_DSN) {
    return false; // Sentry 未初始化，跳過
  }

  // 檢查是否應該上報
  if (!shouldCaptureError(error)) {
    return false;
  }

  // 添加 Discord 上下文
  addDiscordContext(interaction);

  // 上報錯誤
  Sentry.captureException(error);

  return true;
}

/**
 * 捕獲命令執行錯誤
 * @param error - 錯誤對象
 * @param commandName - 命令名稱
 * @param options - 命令選項
 * @param user - 用戶對象
 * @param guild - 可選的伺服器對象
 */
export function captureCommandError(
  error: Error,
  commandName: string,
  options?: Record<string, unknown>,
  user?: User,
  guild?: Guild
): boolean {
  if (!process.env.SENTRY_DSN) {
    return false; // Sentry 未初始化，跳過
  }

  // 檢查是否應該上報
  if (!shouldCaptureError(error)) {
    return false;
  }

  // 添加用戶上下文
  if (user) {
    setUserContext(user, guild);
  }

  // 添加命令上下文
  Sentry.setContext('command', {
    name: commandName,
    options: options ? sanitizeOptions(options) : undefined,
  });

  // 上報錯誤
  Sentry.captureException(error);

  return true;
}

/**
 * 捕獲會話相關錯誤
 * @param error - 錯誤對象
 * @param sessionId - 會話 ID
 * @param guildId - 伺服器 ID
 * @param additionalContext - 額外上下文
 */
export function captureSessionError(
  error: Error,
  sessionId: string,
  guildId?: string,
  additionalContext?: Record<string, unknown>
): boolean {
  if (!process.env.SENTRY_DSN) {
    return false; // Sentry 未初始化，跳過
  }

  // 檢查是否應該上報
  if (!shouldCaptureError(error)) {
    return false;
  }

  // 添加會話上下文
  const context: Record<string, unknown> = {
    sessionId,
  };

  if (guildId) {
    context.guildId = guildId;
  }

  if (additionalContext) {
    Object.assign(context, additionalContext);
  }

  Sentry.setContext('session', context);

  // 上報錯誤
  Sentry.captureException(error);

  return true;
}

/**
 * 帶上下文的錯誤上報
 * @param error - 錯誤對象
 * @param contextName - 上下文名稱
 * @param contextData - 上下文數據
 * @returns 是否成功上報
 */
export function captureExceptionWithContext(
  error: Error,
  contextName: string,
  contextData: Record<string, unknown>
): boolean {
  if (!process.env.SENTRY_DSN) {
    return false; // Sentry 未初始化，跳過
  }

  // 檢查是否應該上報
  if (!shouldCaptureError(error)) {
    return false;
  }

  // 添加上下文
  Sentry.setContext(contextName, contextData);

  // 上報錯誤
  Sentry.captureException(error);

  return true;
}

/**
 * 清理選項中的敏感資訊
 * @param options - 選項對象
 * @returns 清理後的選項
 */
function sanitizeOptions(options: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const sensitiveKeys = ['token', 'key', 'secret', 'password', 'api_key'];

  for (const [key, value] of Object.entries(options)) {
    const isSensitive = sensitiveKeys.some(sk => key.toLowerCase().includes(sk));
    sanitized[key] = isSensitive ? '[REDACTED]' : value;
  }

  return sanitized;
}

/**
 * 捕獲訊息錯誤
 * @param error - 錯誤對象
 * @param messageId - 訊息 ID
 * @param channelId - 頻道 ID
 * @param userId - 用戶 ID
 */
export function captureMessageError(
  error: Error,
  messageId: string,
  channelId?: string,
  userId?: string
): boolean {
  if (!process.env.SENTRY_DSN) {
    return false; // Sentry 未初始化，跳過
  }

  if (!shouldCaptureError(error)) {
    return false;
  }

  Sentry.setContext('message', {
    messageId,
    channelId,
    userId,
  });

  Sentry.captureException(error);
  return true;
}

/**
 * 設置 Discord API 上下文
 * @param apiCall - API 調用描述
 * @param details - 調用詳情
 */
export function setDiscordApiContext(
  apiCall: string,
  details: Record<string, unknown>
): void {
  if (!process.env.SENTRY_DSN) {
    return; // Sentry 未初始化，跳過
  }

  Sentry.setContext('discord_api', {
    call: apiCall,
    ...sanitizeOptions(details),
  });
}

// 導出預設配置
export default {
  shouldCaptureError,
  addDiscordContext,
  setUserContext,
  setGuildContext,
  captureInteractionError,
  captureCommandError,
  captureSessionError,
  captureExceptionWithContext,
  captureMessageError,
  setDiscordApiContext,
};
