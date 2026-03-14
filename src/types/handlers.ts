/**
 * Handler 相關型別定義
 * @description 提供按鈕、選單等交互組件的類型定義
 */

import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  RoleSelectMenuInteraction,
  UserSelectMenuInteraction,
  MentionableSelectMenuInteraction,
  ModalSubmitInteraction,
  AnySelectMenuInteraction,
  UserContextMenuCommandInteraction,
  MessageContextMenuCommandInteraction,
} from 'discord.js';

// Re-export discord.js types that are used by handlers
export type {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  RoleSelectMenuInteraction,
  UserSelectMenuInteraction,
  MentionableSelectMenuInteraction,
  ModalSubmitInteraction,
  AnySelectMenuInteraction,
  UserContextMenuCommandInteraction,
  MessageContextMenuCommandInteraction,
};

/**
 * 按鈕處理器回調函數
 */
export type ButtonHandlerCallback = (
  interaction: ButtonInteraction
) => Promise<void> | void;

/**
 * 選單處理器回調函數 - String Select
 */
export type SelectMenuHandlerCallback = (
  interaction: StringSelectMenuInteraction
) => Promise<void> | void;

/**
 * 選單處理器回調函數 - Channel Select
 */
export type ChannelSelectMenuHandlerCallback = (
  interaction: ChannelSelectMenuInteraction
) => Promise<void> | void;

/**
 * 選單處理器回調函數 - Role Select
 */
export type RoleSelectMenuHandlerCallback = (
  interaction: RoleSelectMenuInteraction
) => Promise<void> | void;

/**
 * 選單處理器回調函數 - User Select
 */
export type UserSelectMenuHandlerCallback = (
  interaction: UserSelectMenuInteraction
) => Promise<void> | void;

/**
 * 選單處理器回調函數 - Mentionable (User/Role) Select
 */
export type MentionableSelectMenuHandlerCallback = (
  interaction: MentionableSelectMenuInteraction
) => Promise<void> | void;

/**
 * 任意選單處理器回調函數
 */
export type AnySelectMenuHandlerCallback = (
  interaction: AnySelectMenuInteraction
) => Promise<void> | void;

/**
 * Modal 提交處理器回調函數
 */
export type ModalHandlerCallback = (
  interaction: ModalSubmitInteraction
) => Promise<void> | void;

/**
 * 按鈕處理器註冊配置
 */
export interface ButtonHandlerConfig {
  /** 自定義 ID（支援前綴匹配，如 "session:" 匹配 "session:123"） */
  customId: string;
  /** 處理器回調函數 */
  callback: ButtonHandlerCallback;
  /** 處理器描述（可選，用於日誌） */
  description?: string;
}

/**
 * 選單處理器註冊配置 - String Select
 */
export interface SelectMenuHandlerConfig {
  /** 自定義 ID */
  customId: string;
  /** 處理器回調函數 */
  callback: SelectMenuHandlerCallback;
  /** 處理器描述（可選） */
  description?: string;
}

/**
 * 選單處理器註冊配置 - Channel Select
 */
export interface ChannelSelectMenuHandlerConfig {
  /** 自定義 ID */
  customId: string;
  /** 處理器回調函數 */
  callback: ChannelSelectMenuHandlerCallback;
  /** 處理器描述（可選） */
  description?: string;
}

/**
 * 選單處理器註冊配置 - Role Select
 */
export interface RoleSelectMenuHandlerConfig {
  /** 自定義 ID */
  customId: string;
  /** 處理器回調函數 */
  callback: RoleSelectMenuHandlerCallback;
  /** 處理器描述（可選） */
  description?: string;
}

/**
 * 選單處理器註冊配置 - User Select
 */
export interface UserSelectMenuHandlerConfig {
  /** 自定義 ID */
  customId: string;
  /** 處理器回調函數 */
  callback: UserSelectMenuHandlerCallback;
  /** 處理器描述（可選） */
  description?: string;
}

/**
 * 選單處理器註冊配置 - Mentionable Select
 */
export interface MentionableSelectMenuHandlerConfig {
  /** 自定義 ID */
  customId: string;
  /** 處理器回調函數 */
  callback: MentionableSelectMenuHandlerCallback;
  /** 處理器描述（可選） */
  description?: string;
}

/**
 * 任意選單處理器註冊配置
 */
export interface AnySelectMenuHandlerConfig {
  /** 自定義 ID */
  customId: string;
  /** 處理器回調函數 */
  callback: AnySelectMenuHandlerCallback;
  /** 處理器描述（可選） */
  description?: string;
}

/**
 * Modal 處理器註冊配置
 */
export interface ModalHandlerConfig {
  /** 自定義 ID */
  customId: string;
  /** 處理器回調函數 */
  callback: ModalHandlerCallback;
  /** 處理器描述（可選） */
  description?: string;
}

/**
 * Handler 錯誤選項
 */
export interface HandlerErrorOptions {
  /** 是否向用戶顯示錯誤訊息 */
  showToUser?: boolean;
  /** 錯誤日誌級別 */
  logLevel?: 'error' | 'warn' | 'info';
  /** 自定義錯誤訊息 */
  customMessage?: string;
}

/**
 * Handler 註冊器介面
 * @description 所有 handler 應實現此介面
 */
export interface IHandlerRegistry {
  /**
   * 註冊處理器
   */
  register(): void;

  /**
   * 獲取所有已註冊的處理器資訊
   */
  getRegisteredHandlers(): RegisteredHandlerInfo[];
}

/**
 * 已註冊的處理器資訊
 */
export interface RegisteredHandlerInfo {
  /** 處理器類型 */
  type: 'button' | 'selectMenu' | 'modal' | 'contextMenu';
  /** 自定義 ID 模式 */
  pattern: string;
  /** 描述 */
  description?: string;
}

/**
 * 按鈕 ID 解析結果
 */
export interface ButtonId解析結果 {
  /** 完整 ID */
  fullId: string;
  /** 前綴（如 "session"） */
  prefix?: string;
  /** 參數陣列 */
  params: string[];
}

/**
 * 統一處理結果
 */
export interface HandlerResult {
  /** 是否成功 */
  success: boolean;
  /** 錯誤訊息（如果失敗） */
  error?: string;
  /** 處理資料 */
  data?: unknown;
}

/**
 * 所有選單處理器配置的聯合類型
 */
export type AnySelectMenuConfig =
  | SelectMenuHandlerConfig
  | ChannelSelectMenuHandlerConfig
  | RoleSelectMenuHandlerConfig
  | UserSelectMenuHandlerConfig
  | MentionableSelectMenuHandlerConfig
  | AnySelectMenuHandlerConfig;

/**
 * 選單類型
 */
export type SelectMenuType =
  | 'stringSelect'
  | 'channelSelect'
  | 'roleSelect'
  | 'userSelect'
  | 'mentionableSelect';

/**
 * 選單值解析結果
 */
export interface SelectMenuValues {
  /** 自定義 ID */
  customId: string;
  /** 選中的值 */
  values: string[];
  /** 選單類型 */
  type: SelectMenuType;
  /** 觸發互動的用戶 ID */
  userId: string;
  /** 發生互動的頻道 ID */
  channelId: string | null;
  /** 包含選單的消息 ID */
  messageId: string | null;
  /** 伺服器 ID（如果在伺服器中） */
  guildId: string | null;
}

// ==================== Modal 擴展類型 ====================

/**
 * Modal 欄位值
 */
export interface ModalFieldValue {
  /** 欄位自定義 ID */
  customId: string;
  /** 欄位值 */
  value: string;
}

/**
 * Modal 提交資料
 */
export interface ModalSubmitData {
  /** Modal 自定義 ID */
  modalId: string;
  /** 提交者 ID */
  userId: string;
  /** 伺服器 ID（如果是伺服器內的互動） */
  guildId?: string;
  /** 頻道 ID */
  channelId: string;
  /** 所有欄位值 */
  fields: ModalFieldValue[];
}

/**
 * 多步驟表單狀態
 */
export interface MultiStepFormState {
  /** 表單步驟 ID */
  stepId: string;
  /** 用戶 ID */
  userId: string;
  /** 當前步驟 */
  currentStep: number;
  /** 總步驟數 */
  totalSteps: number;
  /** 表單資料（鍵值對） */
  data: Record<string, string>;
  /** 創建時間 */
  createdAt: Date;
  /** 過期時間 */
  expiresAt: Date;
}

/**
 * Modal 處理器錯誤選項
 */
export interface ModalHandlerErrorOptions extends HandlerErrorOptions {
  /** 是否包含欄位資訊 */
  includeFields?: boolean;
}

/**
 * 已註冊的 Modal 資訊
 */
export interface RegisteredModalInfo {
  /** Modal 自定義 ID（支援前綴匹配） */
  customId: string;
  /** 描述 */
  description?: string;
  /** 註冊時間 */
  registeredAt: Date;
}

/**
 * IModalHandler 介面
 */
export interface IModalHandler {
  /**
   * 註冊 Modal 處理器
   */
  register(config: ModalHandlerConfig): void;
  /**
   * 處理 Modal 提交
   */
  handle(interaction: ModalSubmitInteraction): Promise<void>;
  /**
   * 從 Modal 提取欄位值
   */
  extractFields(interaction: ModalSubmitInteraction): ModalFieldValue[];
  /**
   * 解析為結構化資料
   */
  parseModalData(interaction: ModalSubmitInteraction): ModalSubmitData;
  /**
   * 獲取所有已註冊的 Modal 處理器
   */
  getRegisteredModals(): RegisteredModalInfo[];
  /**
   * 清除特定 Modal 處理器
   */
  clear(customId?: string): void;
}

// ==================== Context Menu 類型 ====================

/**
 * Context Menu 類型
 */
export type ContextMenuType = 'user' | 'message';

/**
 * User Context Menu 處理器回調函數
 */
export type UserContextMenuHandlerCallback = (
  interaction: UserContextMenuCommandInteraction
) => Promise<void> | void;

/**
 * Message Context Menu 處理器回調函數
 */
export type MessageContextMenuHandlerCallback = (
  interaction: MessageContextMenuCommandInteraction
) => Promise<void> | void;

/**
 * User Context Menu 處理器註冊配置
 */
export interface UserContextMenuHandlerConfig {
  /** Context Menu 名稱 */
  name: string;
  /** 處理器回調函數 */
  callback: UserContextMenuHandlerCallback;
  /** 處理器描述（可選，用於日誌） */
  description?: string;
}

/**
 * Message Context Menu 處理器註冊配置
 */
export interface MessageContextMenuHandlerConfig {
  /** Context Menu 名稱 */
  name: string;
  /** 處理器回調函數 */
  callback: MessageContextMenuHandlerCallback;
  /** 處理器描述（可選，用於日誌） */
  description?: string;
}

/**
 * Context Menu 處理器錯誤選項
 */
export interface ContextMenuHandlerErrorOptions extends HandlerErrorOptions {
  /** Context Menu 類型 */
  menuType?: ContextMenuType;
  /** Context Menu 名稱 */
  menuName?: string;
}

/**
 * Context Menu 處理結果
 */
export interface ContextMenuHandlerResult extends HandlerResult {
  /** 處理的 Context Menu 類型 */
  menuType?: ContextMenuType;
  /** Context Menu 名稱 */
  menuName?: string;
}

/**
 * 已註冊的 Context Menu 資訊
 */
export interface RegisteredContextMenuInfo {
  /** Context Menu 類型 */
  type: ContextMenuType;
  /** Context Menu 名稱 */
  name: string;
  /** 描述 */
  description?: string;
  /** 註冊時間 */
  registeredAt: Date;
}

/**
 * IContextMenuHandler 介面
 */
export interface IContextMenuHandler {
  /**
   * 註冊 User Context Menu 處理器
   */
  registerUser(config: UserContextMenuHandlerConfig): void;
  /**
   * 註冊 Message Context Menu 處理器
   */
  registerMessage(config: MessageContextMenuHandlerConfig): void;
  /**
   * 處理 Context Menu 互動
   */
  handle(interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction): Promise<void>;
  /**
   * 獲取所有已註冊的 Context Menu 處理器
   */
  getRegisteredMenus(): RegisteredContextMenuInfo[];
  /**
   * 清除特定 Context Menu 處理器
   */
  clear(name?: string, type?: ContextMenuType): void;
}