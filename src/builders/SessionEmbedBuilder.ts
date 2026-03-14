/**
 * Session Embed Builder - Session 狀態卡片建構工具
 * @description 提供各類型的 Session 狀態 Embed 卡片
 */

import { EmbedBuilder, ColorResolvable } from 'discord.js';
import { Colors } from './EmbedBuilder.js';
import type { Session, SessionStatus } from '../database/models/Session.js';

// ============== 狀態常量 ==============

/** Session 狀態映射 */
const StatusConfig: Record<
  SessionStatus,
  { emoji: string; text: string; color: ColorResolvable }
> = {
  pending: { emoji: '⏳', text: '等待中', color: Colors.WARNING },
  starting: { emoji: '🚀', text: '啟動中', color: Colors.INFO },
  running: { emoji: '⚡', text: '運行中', color: Colors.INFO },
  waiting: { emoji: '⏸️', text: '等待輸入', color: Colors.WARNING },
  paused: { emoji: '⏸️', text: '已暫停', color: Colors.SECONDARY },
  completed: { emoji: '✅', text: '已完成', color: Colors.SUCCESS },
  failed: { emoji: '❌', text: '失敗', color: Colors.ERROR },
  aborted: { emoji: '🛑', text: '已中止', color: Colors.ERROR },
};

// ============== Session 狀態卡片構建器 ==============

/**
 * Session 狀態卡片構建器
 */
export class SessionStatusEmbedBuilder {
  /**
   * 創建 Session 開始成功卡片
   */
  static createSessionStartedCard(options: {
    /** Session ID */
    sessionId: string;
    /** 提示詞 */
    prompt: string;
    /** 模型 */
    model: string;
    /** 狀態 */
    status: SessionStatus;
    /** 專案路徑 */
    projectPath?: string;
    /** 運行時長（毫秒） */
    duration?: number;
  }): EmbedBuilder {
    const { sessionId, prompt, model, status, projectPath, duration } = options;
    const statusConfig = StatusConfig[status];

    const embed = new EmbedBuilder()
      .setColor(statusConfig.color)
      .setTitle(`${statusConfig.emoji} Session 已啟動`)
      .setDescription(prompt || '新 Session 已開始')
      .setTimestamp()
      .addFields(
        { name: '🆔 Session ID', value: `\`${sessionId}\``, inline: true },
        { name: '🤖 模型', value: model, inline: true },
        { name: '📊 狀態', value: `${statusConfig.emoji} ${statusConfig.text}`, inline: true }
      );

    if (projectPath) {
      embed.addFields({
        name: '📁 專案路徑',
        value: `\`${projectPath}\``,
        inline: false,
      });
    }

    if (duration !== undefined) {
      const durationText = SessionStatusEmbedBuilder.formatDuration(duration);
      embed.addFields({
        name: '⏱️ 運行時長',
        value: durationText,
        inline: true,
      });
    }

    return embed;
  }

  /**
   * 創建 Session 恢復成功卡片
   */
  static createSessionResumedCard(options: {
    /** Session ID */
    sessionId: string;
    /** 狀態 */
    status: SessionStatus;
    /** 提示詞 */
    prompt?: string;
  }): EmbedBuilder {
    const { sessionId, status, prompt } = options;
    const statusConfig = StatusConfig[status];

    return new EmbedBuilder()
      .setColor(statusConfig.color)
      .setTitle(`🔄 Session 已恢復`)
      .setDescription(prompt || 'Session 已恢復運行')
      .setTimestamp()
      .addFields(
        { name: '🆔 Session ID', value: `\`${sessionId}\``, inline: true },
        { name: '📊 狀態', value: `${statusConfig.emoji} ${statusConfig.text}`, inline: true }
      );
  }

  /**
   * 創建 Session 中止卡片
   */
  static createSessionAbortedCard(options: {
    /** Session ID */
    sessionId: string;
    /** 運行時長（毫秒） */
    duration?: number;
    /** 錯誤訊息（如有） */
    errorMessage?: string;
  }): EmbedBuilder {
    const { sessionId, duration, errorMessage } = options;

    const embed = new EmbedBuilder()
      .setColor(Colors.ERROR)
      .setTitle(`🛑 Session 已中止`)
      .setTimestamp()
      .addFields({ name: '🆔 Session ID', value: `\`${sessionId}\``, inline: true });

    if (duration !== undefined) {
      const durationText = SessionStatusEmbedBuilder.formatDuration(duration);
      embed.addFields({
        name: '⏱️ 總時長',
        value: durationText,
        inline: true,
      });
    }

    if (errorMessage) {
      embed.addFields({
        name: '❌ 終止原因',
        value: errorMessage,
        inline: false,
      });
    }

    return embed;
  }

  /**
   * 創建 Session 列表卡片
   */
  static createSessionListCard(options: {
    /** Sessions 陣列 */
    sessions: Array<{
      sessionId: string;
      status: SessionStatus;
      prompt: string;
      model: string;
      startedAt: string;
      endedAt: string | null;
    }>;
    /** 標題（可選） */
    title?: string;
  }): EmbedBuilder {
    const { sessions, title = '📋 Session 列表' } = options;

    const embed = new EmbedBuilder()
      .setColor(Colors.INFO)
      .setTitle(title)
      .setDescription(`共 ${sessions.length} 個 Session`)
      .setTimestamp();

    // 添加每個 Session 的字段
    for (const session of sessions.slice(0, 10)) {
      // 最多顯示 10 個
      const statusConfig = StatusConfig[session.status];
      const startedDate = new Date(session.startedAt).toLocaleString('zh-TW');
      const duration = session.endedAt
        ? SessionStatusEmbedBuilder.formatDuration(
            new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()
          )
        : '進行中';

      embed.addFields({
        name: `${statusConfig.emoji} \`${session.sessionId}\``,
        value: [
          `📝 ${session.prompt.slice(0, 50)}${session.prompt.length > 50 ? '...' : ''}`,
          `🤖 ${session.model} | ⏱️ ${duration}`,
          `📅 ${startedDate}`,
        ].join('\n'),
        inline: false,
      });
    }

    if (sessions.length > 10) {
      embed.setFooter({ text: `還有 ${sessions.length - 10} 個 Session...` });
    }

    return embed;
  }

  /**
   * 創建 Session 詳細資訊卡片
   */
  static createSessionDetailCard(session: Session): EmbedBuilder {
    const statusConfig = StatusConfig[session.status];
    const duration = session.getDuration();

    const embed = new EmbedBuilder()
      .setColor(statusConfig.color)
      .setTitle(`${statusConfig.emoji} Session 詳細資訊`)
      .setTimestamp()
      .addFields(
        { name: '🆔 Session ID', value: `\`${session.sessionId}\``, inline: true },
        { name: '📊 狀態', value: `${statusConfig.emoji} ${statusConfig.text}`, inline: true },
        { name: '🤖 模型', value: session.model, inline: true },
        { name: '🔧 Agent', value: session.agent, inline: true }
      );

    if (session.prompt) {
      embed.addFields({
        name: '📝 提示詞',
        value: session.prompt,
        inline: false,
      });
    }

    if (session.projectPath) {
      embed.addFields({
        name: '📁 專案路徑',
        value: `\`${session.projectPath}\``,
        inline: false,
      });
    }

    // 添加時間資訊
    const startedDate = new Date(session.startedAt).toLocaleString('zh-TW');
    embed.addFields({
      name: '🕐 開始時間',
      value: startedDate,
      inline: true,
    });

    embed.addFields({
      name: '⏱️ 運行時長',
      value: SessionStatusEmbedBuilder.formatDuration(duration),
      inline: true,
    });

    // 添加統計資訊
    embed.addFields(
      { name: '💬 訊息數', value: `${session.messageCount}`, inline: true },
      { name: '🔧 工具調用', value: `${session.toolCallCount}`, inline: true }
    );

    // 添加錯誤訊息（如果有）
    if (session.errorMessage) {
      embed.addFields({
        name: '❌ 錯誤訊息',
        value: session.errorMessage,
        inline: false,
      });
    }

    return embed;
  }

  /**
   * 創建 Session 運行狀態實時卡片
   */
  static createSessionLiveStatusCard(session: Session): EmbedBuilder {
    const statusConfig = StatusConfig[session.status];
    const duration = session.getDuration();

    return new EmbedBuilder()
      .setColor(statusConfig.color)
      .setTitle(`${statusConfig.emoji} Session 狀態`)
      .setTimestamp()
      .addFields(
        { name: '🆔 Session ID', value: `\`${session.sessionId}\``, inline: true },
        { name: '📊 狀態', value: `${statusConfig.emoji} ${statusConfig.text}`, inline: true },
        { name: '⏱️ 運行時長', value: SessionStatusEmbedBuilder.formatDuration(duration), inline: true },
        { name: '🤖 模型', value: session.model, inline: true },
        { name: '💬 訊息', value: `${session.messageCount}`, inline: true },
        { name: '🔧 工具', value: `${session.toolCallCount}`, inline: true }
      );
  }

  /**
   * 創建無效 Session 卡片
   */
  static createInvalidSessionCard(sessionId: string): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(Colors.ERROR)
      .setTitle('❌ Session 不存在')
      .setDescription(`找不到 ID 為 \`${sessionId}\` 的 Session`)
      .setTimestamp();
  }

  /**
   * 創建 Session 衝突卡片（當已有活跃 Session 時）
   */
  static createSessionConflictCard(activeSessionId: string): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(Colors.WARNING)
      .setTitle('⚠️ Session 衝突')
      .setDescription(`此頻道已有運行中的 Session (\`${activeSessionId}\`)`)
      .addFields({
        name: '💡 解決方案',
        value: '請先中止當前 Session 或使用 /session resume 恢復現有 Session',
        inline: false,
      })
      .setTimestamp();
  }

  // ============== 私有輔助方法 ==============

  /**
   * 格式化時長
   */
  private static formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return `${hours}小時 ${remainingMinutes}分鐘`;
    } else if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      return `${minutes}分鐘 ${remainingSeconds}秒`;
    } else {
      return `${seconds}秒`;
    }
  }
}

// ============== 導出 ==============

export default {
  SessionStatusEmbedBuilder,
};
