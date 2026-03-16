/**
 * Session 按鈕處理器
 * @description 處理 Session 相關的按鈕交互
 * 
 * 支援的按鈕：
 * - session:start - 開始新 Session
 * - session:stop - 停止 Session
 * - session:resume - 恢復 Session
 * - session:pause - 暫停 Session
 * - session:restart - 重新開始 Session
 * - session:passthrough:toggle - 切換 Passthrough 模式
 */

import { ButtonInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import { ButtonHandlerConfig } from '../types/handlers.js';
import { SessionManager, getSessionManager } from '../services/SessionManager.js';
import { SessionStatusEmbedBuilder } from '../builders/SessionEmbedBuilder.js';
import {
  SessionButtonIds,
  createSessionActionRow,
} from '../builders/SessionActionRowBuilder.js';

/**
 * Session 按鈕處理器工廠
 */
export class SessionButtonHandler {
  private sessionManager: SessionManager;

  /**
   * 創建 Session 按鈕處理器
   */
  constructor(sessionManager?: SessionManager) {
    this.sessionManager = sessionManager || getSessionManager();
  }

  /**
   * 獲取所有按鈕處理器配置
   */
  getHandlerConfigs(): ButtonHandlerConfig[] {
    return [
      {
        customId: SessionButtonIds.START,
        callback: this.handleStart.bind(this),
        description: '開始新 Session',
      },
      {
        customId: 'session:start:', // 前綴匹配
        callback: this.handleStartWithId.bind(this),
        description: '開始新 Session（帶 Session ID）',
      },
      {
        customId: SessionButtonIds.STOP,
        callback: this.handleStop.bind(this),
        description: '停止 Session',
      },
      {
        customId: 'session:stop:', // 前綴匹配
        callback: this.handleStopWithId.bind(this),
        description: '停止 Session（帶 Session ID）',
      },
      {
        customId: SessionButtonIds.RESUME,
        callback: this.handleResume.bind(this),
        description: '恢復 Session',
      },
      {
        customId: 'session:resume:', // 前綴匹配
        callback: this.handleResumeWithId.bind(this),
        description: '恢復 Session（帶 Session ID）',
      },
      {
        customId: 'session:pause:', // 前綴匹配
        callback: this.handlePauseWithId.bind(this),
        description: '暫停 Session',
      },
      {
        customId: 'session:restart:', // 前綴匹配
        callback: this.handleRestartWithId.bind(this),
        description: '重新開始 Session',
      },
      {
        customId: 'session:status', // 精確匹配
        callback: this.handleStatus.bind(this),
        description: '查看 Session 狀態',
      },
      {
        customId: 'session:status:', // 前綴匹配
        callback: this.handleStatusWithId.bind(this),
        description: '查看 Session 狀態（帶 Session ID）',
      },
      {
        customId: SessionButtonIds.PASSTHROUGH_TOGGLE,
        callback: this.handlePassthroughToggle.bind(this),
        description: '切換 Passthrough 模式',
      },
      {
        customId: 'session:passthrough:toggle:', // 前綴匹配
        callback: this.handlePassthroughToggleWithId.bind(this),
        description: '切換 Passthrough 模式（帶 Session ID）',
      },
    ];
  }

  // ============== 按鈕處理方法 ==============

  /**
   * 處理開始按鈕
   */
  async handleStart(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply();

    const channelId = interaction.channelId;
    const userId = interaction.user.id;

    // 檢查是否已有活跃 Session
    if (this.sessionManager.hasActiveSession(channelId)) {
      const activeSession = this.sessionManager.getActiveSessionByChannel(channelId);
      if (activeSession) {
        await interaction.editReply({
          embeds: [SessionStatusEmbedBuilder.createSessionConflictCard(activeSession.sessionId)],
        });
        return;
      }
    }

    try {
      // 創建新 Session
      const session = await this.sessionManager.createSession({
        channelId,
        userId,
        prompt: '',
        guildId: interaction.guildId || '',
      });

      // 顯示成功訊息
      const embed = SessionStatusEmbedBuilder.createSessionStartedCard({
        sessionId: session.sessionId,
        prompt: session.prompt,
        model: session.model,
        status: session.status,
        projectPath: session.projectPath,
      });

      const components = createSessionActionRow(session.sessionId, session.status);

      await interaction.editReply({
        embeds: [embed],
        components: [components],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 啟動 Session 失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 處理開始按鈕（帶 Session ID）
   */
  async handleStartWithId(interaction: ButtonInteraction): Promise<void> {
    // 提取 sessionId（格式：session:start:{sessionId}）
    const customId = interaction.customId;
    const parts = customId.split(':');
    const sessionId = parts.length > 2 ? parts.slice(2).join(':') : '';

    if (sessionId) {
      // 這是一個恢復操作
      await this.handleResumeWithId(interaction);
    } else {
      // 沒有 sessionId，視為新建
      await this.handleStart(interaction);
    }
  }

  /**
   * 處理停止按鈕
   */
  async handleStop(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply();

    const channelId = interaction.channelId;

    try {
      // 嘗試獲取當前活跃 Session
      const session = this.sessionManager.getActiveSessionByChannel(channelId);

      if (!session) {
        await interaction.editReply({
          content: '此頻道沒有運行中的 Session',
        });
        return;
      }

      // 終止 Session
      await this.sessionManager.abortSession(session.sessionId);

      const embed = SessionStatusEmbedBuilder.createSessionAbortedCard({
        sessionId: session.sessionId,
        duration: session.getDuration(),
      });

      await interaction.editReply({
        embeds: [embed],
        components: [], // 移除操作按鈕
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 停止 Session 失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 處理停止按鈕（帶 Session ID）
   */
  async handleStopWithId(interaction: ButtonInteraction): Promise<void> {
    // 提取 sessionId
    const sessionId = this.extractSessionId(interaction.customId, 'stop');

    if (!sessionId) {
      // 沒有指定 ID，嘗試獲取當前的
      await this.handleStop(interaction);
      return;
    }

    // 先獲取 Session 進行權限驗證
    const session = this.sessionManager.getSession(sessionId);

    if (!session) {
      await interaction.reply({
        content: '❌ Session 不存在',
        ephemeral: true
      });
      return;
    }

    // 驗證用戶權限 - 必須是 Session 擁有者或管理員
    if ((session as any).userId !== interaction.user.id) {
      // 檢查是否為管理員
      const member = await interaction.guild?.members.fetch(interaction.user.id);
      if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: '❌ 您無權操作此 Session',
          ephemeral: true
        });
        return;
      }
    }

    await this.sessionManager.abortSession(sessionId);

    await interaction.reply({
      content: `✅ Session \`${sessionId}\` 已停止`,
      ephemeral: true
    });
  }

  /**
   * 處理恢復按鈕
   */
  async handleResume(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply();

    const channelId = interaction.channelId;

    try {
      // 獲取當前暂停的 Session
      const session = this.sessionManager.getActiveSessionByChannel(channelId);

      if (!session) {
        await interaction.editReply({
          content: '此頻道沒有暫停的 Session',
        });
        return;
      }

      // 恢復 Session
      const resumedSession = await this.sessionManager.resumeSession(session.sessionId);

      if (!resumedSession) {
        await interaction.editReply({
          content: '無法恢復 Session',
        });
        return;
      }

      const embed = SessionStatusEmbedBuilder.createSessionResumedCard({
        sessionId: resumedSession.sessionId,
        status: resumedSession.status,
        prompt: resumedSession.prompt,
      });

      const components = createSessionActionRow(resumedSession.sessionId, resumedSession.status);

      await interaction.editReply({
        embeds: [embed],
        components: [components],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 恢復 Session 失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 處理恢復按鈕（帶 Session ID）
   */
  async handleResumeWithId(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply();

    const sessionId = this.extractSessionId(interaction.customId, 'resume');

    if (!sessionId) {
      await interaction.editReply({
        content: '無法解析 Session ID',
      });
      return;
    }

    try {
      const session = await this.sessionManager.resumeSession(sessionId);

      if (!session) {
        await interaction.editReply({
          embeds: [SessionStatusEmbedBuilder.createInvalidSessionCard(sessionId)],
        });
        return;
      }

      const embed = SessionStatusEmbedBuilder.createSessionResumedCard({
        sessionId: session.sessionId,
        status: session.status,
        prompt: session.prompt,
      });

      const components = createSessionActionRow(session.sessionId, session.status);

      await interaction.editReply({
        embeds: [embed],
        components: [components],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 恢復 Session 失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 處理暫停按鈕（帶 Session ID）
   */
  async handlePauseWithId(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply();

    const sessionId = this.extractSessionId(interaction.customId, 'pause');

    if (!sessionId) {
      await interaction.editReply({
        content: '無法解析 Session ID',
      });
      return;
    }

    try {
      const session = this.sessionManager.getSession(sessionId);

      if (!session) {
        await interaction.editReply({
          embeds: [SessionStatusEmbedBuilder.createInvalidSessionCard(sessionId)],
        });
        return;
      }

      // 標記為暫停
      this.sessionManager.updateSessionStatus(sessionId, 'paused');
      session.pause();

      const embed = SessionStatusEmbedBuilder.createSessionLiveStatusCard(session);

      const components = createSessionActionRow(session.sessionId, session.status);

      await interaction.editReply({
        embeds: [embed],
        components: [components],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 暫停 Session 失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 處理重新開始按鈕（帶 Session ID）
   */
  async handleRestartWithId(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply();

    const sessionId = this.extractSessionId(interaction.customId, 'restart');

    if (!sessionId) {
      await interaction.editReply({
        content: '無法解析 Session ID',
      });
      return;
    }

    try {
      // 先終止舊 Session
      await this.sessionManager.abortSession(sessionId);

      // 創建新 Session
      const channelId = interaction.channelId;
      const userId = interaction.user.id;

      const newSession = await this.sessionManager.createSession({
        channelId,
        userId,
        prompt: '',
        guildId: interaction.guildId || '',
      });

      const embed = SessionStatusEmbedBuilder.createSessionStartedCard({
        sessionId: newSession.sessionId,
        prompt: newSession.prompt,
        model: newSession.model,
        status: newSession.status,
        projectPath: newSession.projectPath,
      });

      const components = createSessionActionRow(newSession.sessionId, newSession.status);

      await interaction.editReply({
        embeds: [embed],
        components: [components],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 重新開始 Session 失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 處理查看狀態按鈕
   */
  async handleStatus(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply();

    const channelId = interaction.channelId;

    try {
      const session = this.sessionManager.getActiveSessionByChannel(channelId);

      if (!session) {
        await interaction.editReply({
          content: '此頻道沒有運行中的 Session',
        });
        return;
      }

      const embed = SessionStatusEmbedBuilder.createSessionDetailCard(session);
      const components = createSessionActionRow(session.sessionId, session.status);

      await interaction.editReply({
        embeds: [embed],
        components: [components],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 獲取狀態失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 處理查看狀態按鈕（帶 Session ID）
   */
  async handleStatusWithId(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply();

    const sessionId = this.extractSessionId(interaction.customId, 'status');

    if (!sessionId) {
      await interaction.editReply({
        content: '無法解析 Session ID',
      });
      return;
    }

    try {
      const session = this.sessionManager.getSession(sessionId);

      if (!session) {
        await interaction.editReply({
          embeds: [SessionStatusEmbedBuilder.createInvalidSessionCard(sessionId)],
        });
        return;
      }

      const embed = SessionStatusEmbedBuilder.createSessionDetailCard(session);
      const components = createSessionActionRow(session.sessionId, session.status);

      await interaction.editReply({
        embeds: [embed],
        components: [components],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 獲取狀態失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 處理 Passthrough 切換按鈕
   */
  async handlePassthroughToggle(interaction: ButtonInteraction): Promise<void> {
    // 提取當前狀態（從 customId 或組件狀態）
    const customId = interaction.customId;
    const isEnabled = customId.includes('enable') || customId.includes('true');
    const newState = !isEnabled;

    // 更新按鈕狀態
    const embed = new (await import('discord.js')).EmbedBuilder()
      .setColor(newState ? 0x00ff00 : 0xff0000)
      .setTitle(newState ? '🟢 Passthrough 模式已開啟' : '🔴 Passthrough 模式已關閉')
      .setDescription(
        newState
          ? '現在您可以直接輸入訊息，系統會自動將其傳送至 OpenCode Session'
          : 'Passthrough 模式已關閉，請使用指令進行操作'
      )
      .setTimestamp();

    // 更新按鈕
    const newButton = new ButtonBuilder()
      .setCustomId(`session:passthrough:toggle:${newState}`)
      .setLabel(newState ? '關閉 Passthrough' : '開啟 Passthrough')
      .setStyle(newState ? ButtonStyle.Success : ButtonStyle.Primary)
      .setEmoji(newState ? '🔴' : '🟢');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(newButton);

    await interaction.update({
      embeds: [embed],
      components: [row],
    });
  }

  /**
   * 處理 Passthrough 切換按鈕（帶 Session ID）
   */
  async handlePassthroughToggleWithId(interaction: ButtonInteraction): Promise<void> {
    await this.handlePassthroughToggle(interaction);
  }

  // ============== 私有輔助方法 ==============

  /**
   * 從 customId 提取 Session ID
   */
  private extractSessionId(customId: string, action: string): string | null {
    const prefix = `session:${action}:`;
    if (customId.startsWith(prefix)) {
      return customId.substring(prefix.length);
    }
    return null;
  }
}

// ============== 便捷函數 ==============

/**
 * 創建並註冊 Session 按鈕處理器
 */
export function registerSessionButtonHandlers(
  buttonHandler: { registerMany: (configs: ButtonHandlerConfig[]) => void },
  sessionManager?: SessionManager
): void {
  const handler = new SessionButtonHandler(sessionManager);
  buttonHandler.registerMany(handler.getHandlerConfigs());
}

// ============== 導出 ==============

export default {
  SessionButtonHandler,
  registerSessionButtonHandlers,
};
