/**
 * Session Action Row Builder - Session 操作按鈕建構工具
 * @description 提供 Session 相關的按鈕和 Action Row 構建
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import type { SessionStatus } from '../database/models/Session.js';

// ============== 按鈕 Custom ID 常量 ==============

/** 按鈕 Custom ID 前綴 */
export const SessionButtonIds = {
  // 主要操作
  START: 'session:start',
  STOP: 'session:stop',
  RESUME: 'session:resume',
  PAUSE: 'session:pause',
  RESTART: 'session:restart',

  // 狀態相關
  STATUS: 'session:status',
  LIST: 'session:list',

  // 專案相關
  PROJECT_SELECT: 'session:project:select',
  PROJECT_SETTINGS: 'session:project:settings',

  // 模型相關
  MODEL_SELECT: 'session:model:select',

  // Passthrough 模式
  PASSTHROUGH_TOGGLE: 'session:passthrough:toggle',

  // 會話相關
  FORK: 'session:fork',
  SHARE: 'session:share',
  DELETE: 'session:delete',
} as const;

/** 按鈕 Custom ID 類型 */
export type SessionButtonId =
  | typeof SessionButtonIds.START
  | typeof SessionButtonIds.STOP
  | typeof SessionButtonIds.RESUME
  | typeof SessionButtonIds.PAUSE
  | typeof SessionButtonIds.RESTART
  | typeof SessionButtonIds.STATUS
  | typeof SessionButtonIds.LIST
  | typeof SessionButtonIds.PROJECT_SELECT
  | typeof SessionButtonIds.PROJECT_SETTINGS
  | typeof SessionButtonIds.MODEL_SELECT
  | typeof SessionButtonIds.PASSTHROUGH_TOGGLE
  | typeof SessionButtonIds.FORK
  | typeof SessionButtonIds.SHARE
  | typeof SessionButtonIds.DELETE;

// ============== 按鈕構建器 ==============

/**
 * Session 按鈕工廠
 */
export class SessionButtonFactory {
  /**
   * 創建開始 Session 按鈕
   */
  static createStartButton(customId?: string): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(customId || SessionButtonIds.START)
      .setLabel('開始新 Session')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('▶️');
  }

  /**
   * 創建停止 Session 按鈕
   */
  static createStopButton(customId?: string): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(customId || SessionButtonIds.STOP)
      .setLabel('停止')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⏹️');
  }

  /**
   * 創建恢復 Session 按鈕
   */
  static createResumeButton(customId?: string): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(customId || SessionButtonIds.RESUME)
      .setLabel('繼續')
      .setStyle(ButtonStyle.Success)
      .setEmoji('▶️');
  }

  /**
   * 創建暫停 Session 按鈕
   */
  static createPauseButton(customId?: string): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(customId || SessionButtonIds.PAUSE)
      .setLabel('暫停')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⏸️');
  }

  /**
   * 創建重啟 Session 按鈕
   */
  static createRestartButton(customId?: string): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(customId || SessionButtonIds.RESTART)
      .setLabel('重新開始')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔄');
  }

  /**
   * 創建查看狀態按鈕
   */
  static createStatusButton(customId?: string): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(customId || SessionButtonIds.STATUS)
      .setLabel('查看狀態')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📊');
  }

  /**
   * 創建選擇模型按鈕
   */
  static createModelSelectButton(customId?: string): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(customId || SessionButtonIds.MODEL_SELECT)
      .setLabel('選擇模型')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🤖');
  }

  /**
   * 創建 Passthrough 切換按鈕
   */
  static createPassthroughToggleButton(
    enabled: boolean,
    customId?: string
  ): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(customId || SessionButtonIds.PASSTHROUGH_TOGGLE)
      .setLabel(enabled ? '關閉 Passthrough' : '開啟 Passthrough')
      .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Primary)
      .setEmoji(enabled ? '🔴' : '🟢');
  }

  /**
   * 創建 Fork Session 按鈕
   */
  static createForkButton(customId?: string): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(customId || SessionButtonIds.FORK)
      .setLabel('Fork')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🍴');
  }

  /**
   * 創建分享 Session 按鈕
   */
  static createShareButton(customId?: string): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(customId || SessionButtonIds.SHARE)
      .setLabel('分享')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📤');
  }
}

// ============== Action Row 模板 ==============

/**
 * 創建 Session 操作按鈕行（根據狀態）
 */
export function createSessionActionRow(
  sessionId: string,
  status: SessionStatus,
  options?: {
    /** 是否顯示 Fork/Share 按鈕 */
    showExtras?: boolean;
    /** 是否顯示 Passthrough 切換 */
    showPassthrough?: boolean;
    /** Passthrough 狀態 */
    passthroughEnabled?: boolean;
  }
): ActionRowBuilder<ButtonBuilder> {
  const { showExtras = false, showPassthrough = false, passthroughEnabled = false } = options || {};

  const row = new ActionRowBuilder<ButtonBuilder>();

  // 根據狀態添加相應的按鈕
  switch (status) {
    case 'running':
    case 'starting':
      // 運行中：顯示停止和暫停按鈕
      row.addComponents(SessionButtonFactory.createStopButton(`session:stop:${sessionId}`));
      row.addComponents(SessionButtonFactory.createPauseButton(`session:pause:${sessionId}`));
      break;

    case 'waiting':
      // 等待輸入：顯示繼續按鈕
      row.addComponents(SessionButtonFactory.createResumeButton(`session:resume:${sessionId}`));
      row.addComponents(SessionButtonFactory.createStopButton(`session:stop:${sessionId}`));
      break;

    case 'paused':
      // 暫停：顯示繼續和停止按鈕
      row.addComponents(SessionButtonFactory.createResumeButton(`session:resume:${sessionId}`));
      row.addComponents(SessionButtonFactory.createStopButton(`session:stop:${sessionId}`));
      break;

    case 'completed':
    case 'failed':
    case 'aborted':
      // 已結束：顯示重新開始按鈕
      row.addComponents(SessionButtonFactory.createRestartButton(`session:restart:${sessionId}`));
      break;

    case 'pending':
    default:
      // 初始狀態：顯示開始按鈕
      row.addComponents(SessionButtonFactory.createStartButton(`session:start:${sessionId}`));
      break;
  }

  // 添加額外按鈕
  if (showExtras) {
    row.addComponents(SessionButtonFactory.createForkButton(`session:fork:${sessionId}`));
    row.addComponents(SessionButtonFactory.createShareButton(`session:share:${sessionId}`));
  }

  // 添加 Passthrough 切換
  if (showPassthrough) {
    row.addComponents(
      SessionButtonFactory.createPassthroughToggleButton(
        passthroughEnabled,
        `session:passthrough:toggle:${sessionId}`
      )
    );
  }

  return row;
}

/**
 * 創建 Session 控制按鈕行（停止/繼續）
 */
export function createSessionControlRow(sessionId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    SessionButtonFactory.createStopButton(`session:stop:${sessionId}`),
    SessionButtonFactory.createResumeButton(`session:resume:${sessionId}`)
  );
}

/**
 * 創建 Session 主按鈕行（開始/查看狀態）
 */
export function createSessionMainRow(sessionId?: string): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  row.addComponents(SessionButtonFactory.createStartButton(`session:start:${sessionId || ''}`));
  row.addComponents(SessionButtonFactory.createStatusButton('session:status'));
  return row;
}

/**
 * 創建 Session 設定按鈕行（模型選擇/專案設定）
 */
export function createSessionSettingsRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    SessionButtonFactory.createModelSelectButton(SessionButtonIds.MODEL_SELECT),
    SessionButtonFactory.createStatusButton(SessionButtonIds.STATUS)
  );
}

// ============== 預設導出 ==============

export default {
  SessionButtonIds,
  SessionButtonFactory,
  createSessionActionRow,
  createSessionControlRow,
  createSessionMainRow,
  createSessionSettingsRow,
};
