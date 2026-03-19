/**
 * Session 按鈕處理器
 * @description 處理 Session 相關按鈕互動（暫停/恢復/狀態/設定/刪除）
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Message,
} from 'discord.js';
import { ButtonHandlerConfig } from '../types/handlers.js';
import { SessionManager, getSessionManager } from '../services/SessionManager.js';
import { Session } from '../database/models/Session.js';
import { SessionStatusEmbedBuilder } from '../builders/SessionEmbedBuilder.js';
import {
  SessionButtonIds,
  createSessionActionRow,
  createSessionManagementRow,
} from '../builders/SessionActionRowBuilder.js';
import { getAvailableModels } from '../services/ModelService.js';
import { getAvailableAgents } from '../services/AgentService.js';
import logger from '../utils/logger.js';

/**
 * Session 按鈕處理器工廠
 */
export class SessionButtonHandler {
  private sessionManager: SessionManager;

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
        description: '開始 Session（引導）',
      },
      {
        customId: 'session:start:',
        callback: this.handleStart.bind(this),
        description: '開始 Session（帶 ID，引導）',
      },
      {
        customId: 'session:stop:',
        callback: this.handleStopWithId.bind(this),
        description: '結束並刪除 Session（帶 Session ID）',
      },
      {
        customId: 'session:pause:',
        callback: this.handlePauseWithId.bind(this),
        description: '中斷 Session（帶 Session ID）',
      },
      {
        customId: SessionButtonIds.RESUME,
        callback: this.handleResume.bind(this),
        description: '恢復 Session',
      },
      {
        customId: 'session:resume:',
        callback: this.handleResumeWithId.bind(this),
        description: '恢復 Session（帶 Session ID）',
      },
      {
        customId: 'session:status',
        callback: this.handleStatus.bind(this),
        description: '查看 Session 狀態',
      },
      {
        customId: 'session:status:',
        callback: this.handleStatusWithId.bind(this),
        description: '查看 Session 狀態（帶 Session ID）',
      },
      {
        customId: 'session:settings:',
        callback: this.handleSettingsWithId.bind(this),
        description: '開啟 Session 設定面板（帶 Session ID）',
      },
      {
        customId: SessionButtonIds.PASSTHROUGH_TOGGLE,
        callback: this.handlePassthroughToggle.bind(this),
        description: '切換 Passthrough 模式',
      },
      {
        customId: 'session:passthrough:toggle:',
        callback: this.handlePassthroughToggle.bind(this),
        description: '切換 Passthrough 模式（帶 Session ID）',
      },
      {
        customId: 'session:restart:',
        callback: this.handleRestartWithId.bind(this),
        description: '重啟 Session（提示改用 /session start）',
      },
    ];
  }

  /**
   * 開始按鈕：引導使用者使用 slash command
   */
  async handleStart(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply();

    const channelId = interaction.channelId;
    const userId = interaction.user.id;

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
      const session = await this.sessionManager.createSession({
        channelId,
        userId,
        prompt: '',
        guildId: interaction.guildId || '',
      });

      await interaction.editReply({
        embeds: [SessionStatusEmbedBuilder.createSessionStartedCard({
          sessionId: session.sessionId,
          prompt: session.prompt,
          model: session.model,
          agent: session.agent,
          status: session.status,
          projectPath: session.projectPath,
        })],
        components: [createSessionActionRow(session.sessionId, session.status)],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 啟動 Session 失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 停止按鈕（舊入口，僅中止 session）
   */
  async handleStop(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply();

    const session = this.sessionManager.getActiveSessionByChannel(interaction.channelId);
    if (!session) {
      await interaction.editReply({
        content: '此頻道沒有運行中的 Session',
      });
      return;
    }

    try {
      const aborted = await this.sessionManager.abortSession(session.sessionId);
      if (!aborted) {
        await interaction.editReply({
          content: '此頻道沒有運行中的 Session',
        });
        return;
      }

      await interaction.editReply({
        embeds: [SessionStatusEmbedBuilder.createSessionAbortedCard({
          sessionId: aborted.sessionId,
          duration: aborted.getDuration(),
        })],
        components: [],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 停止 Session 失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 停止按鈕（兼容舊 customId）：等同刪除 Session
   */
  async handleStopWithId(interaction: ButtonInteraction): Promise<void> {
    await this.handleDeleteWithId(interaction);
  }

  /**
   * 刪除 Session（SDK 刪除 + Discord 討論串刪除）
   */
  async handleDeleteWithId(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const sessionId = this.extractSessionId(interaction.customId, 'delete')
      || this.extractSessionId(interaction.customId, 'stop');

    if (!sessionId) {
      await interaction.editReply({ content: '❌ 無法解析 Session ID' });
      return;
    }

    const session = await this.sessionManager.findSession(sessionId);
    if (!session) {
      await interaction.editReply({ content: `❌ Session 不存在：\`${sessionId}\`` });
      return;
    }

    const hasPermission = await this.checkSessionOwnership(session, interaction);
    if (!hasPermission) {
      return;
    }

    try {
      const deleted = await this.sessionManager.terminateAndDeleteSession(sessionId, {
        deleteThread: true,
      });

      if (!deleted) {
        await interaction.editReply({ content: `❌ Session 不存在：\`${sessionId}\`` });
        return;
      }

      await this.updateMainStatusMessage(interaction, deleted, {
        note: 'Session 已刪除',
        removeComponents: true,
      });

      await interaction.editReply({
        content: `✅ Session \`${sessionId}\` 已刪除（已同步刪除 OpenCode Session 與 Discord 討論串）`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 刪除 Session 失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 恢復按鈕（當前頻道 active session）
   */
  async handleResume(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const session = this.sessionManager.getActiveSessionByChannel(interaction.channelId);
    if (!session) {
      await interaction.editReply({ content: '此頻道沒有暫停的 Session' });
      return;
    }

    await this.handleResumeBySession(interaction, session.sessionId);
  }

  /**
   * 恢復按鈕（帶 Session ID）
   */
  async handleResumeWithId(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const sessionId = this.extractSessionId(interaction.customId, 'resume');
    if (!sessionId) {
      await interaction.editReply({ content: '❌ 無法解析 Session ID' });
      return;
    }

    await this.handleResumeBySession(interaction, sessionId);
  }

  /**
   * 內部：按 Session ID 恢復
   */
  private async handleResumeBySession(interaction: ButtonInteraction, sessionId: string): Promise<void> {
    const existingSession = await this.resolveSession(sessionId, interaction.channelId);
    if (!existingSession) {
      await interaction.editReply({ content: `❌ Session 不存在：\`${sessionId}\`` });
      return;
    }

    const hasPermission = await this.checkSessionOwnership(existingSession, interaction);
    if (!hasPermission) {
      return;
    }

    try {
      const resumed = await this.sessionManager.resumeSession(sessionId);
      if (!resumed) {
        await interaction.editReply({ content: `❌ 無法恢復 Session：\`${sessionId}\`` });
        return;
      }

      await this.updateControlMessage(interaction, resumed, {
        note: 'Session 已恢復',
      });
      await this.updateMainStatusMessage(interaction, resumed, {
        note: 'Session 已恢復',
      });

      await interaction.editReply({
        content: `✅ Session \`${sessionId}\` 已恢復`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({ content: `❌ 恢復 Session 失敗: ${errorMessage}` });
    }
  }

  /**
   * 中斷按鈕（停止當前推理，保留 Session）
   */
  async handlePauseWithId(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const sessionId = this.extractSessionId(interaction.customId, 'pause');
    if (!sessionId) {
      await interaction.editReply({ content: '❌ 無法解析 Session ID' });
      return;
    }

    const existingSession = await this.resolveSession(sessionId, interaction.channelId);
    if (!existingSession) {
      await interaction.editReply({ content: `❌ Session 不存在：\`${sessionId}\`` });
      return;
    }

    const hasPermission = await this.checkSessionOwnership(existingSession, interaction);
    if (!hasPermission) {
      return;
    }

    try {
      const interrupted = await this.sessionManager.interruptSession(sessionId);
      if (!interrupted) {
        await interaction.editReply({ content: `❌ 無法中斷 Session：\`${sessionId}\`` });
        return;
      }

      await this.updateControlMessage(interaction, interrupted, {
        note: 'Session 已中斷，點擊「繼續」可恢復',
      });
      await this.updateMainStatusMessage(interaction, interrupted, {
        note: 'Session 已中斷（paused）',
      });

      await interaction.editReply({
        content: `⏸️ Session \`${sessionId}\` 已中斷`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 中斷 Session 失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 查看狀態按鈕（頻道 active session）
   */
  async handleStatus(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const session = this.sessionManager.getActiveSessionByChannel(interaction.channelId);
    if (!session) {
      await interaction.editReply({ content: '此頻道沒有運行中的 Session' });
      return;
    }

    await interaction.editReply({
      embeds: [SessionStatusEmbedBuilder.createSessionDetailCard(session)],
    });
  }

  /**
   * 查看狀態按鈕（帶 Session ID）
   */
  async handleStatusWithId(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const sessionId = this.extractSessionId(interaction.customId, 'status');
    if (!sessionId) {
      await interaction.editReply({ content: '❌ 無法解析 Session ID' });
      return;
    }

    const session = await this.resolveSession(sessionId, interaction.channelId);
    if (!session) {
      await interaction.editReply({
        embeds: [SessionStatusEmbedBuilder.createInvalidSessionCard(sessionId)],
      });
      return;
    }

    const hasPermission = await this.checkSessionOwnership(session, interaction);
    if (!hasPermission) {
      return;
    }

    await interaction.editReply({
      embeds: [SessionStatusEmbedBuilder.createSessionDetailCard(session)],
    });
  }

  /**
   * 設定按鈕（開啟 model/agent 選擇面板）
   */
  async handleSettingsWithId(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const sessionId = this.extractSessionId(interaction.customId, 'settings');
    if (!sessionId) {
      await interaction.editReply({ content: '❌ 無法解析 Session ID' });
      return;
    }

    const session = await this.resolveSession(sessionId, interaction.channelId);
    if (!session) {
      await interaction.editReply({ content: `❌ Session 不存在：\`${sessionId}\`` });
      return;
    }

    const hasPermission = await this.checkSessionOwnership(session, interaction);
    if (!hasPermission) {
      return;
    }

    const modelOptions = await this.getModelOptions(interaction);
    const agentOptions = await this.getAgentOptions(session.projectPath, session.agent);

    const modelSelect = new StringSelectMenuBuilder()
      .setCustomId(`session:settings:model:${sessionId}`)
      .setPlaceholder(`目前模型：${session.model}`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(modelOptions);

    const agentSelect = new StringSelectMenuBuilder()
      .setCustomId(`session:settings:agent:${sessionId}`)
      .setPlaceholder(`目前 Agent：${session.agent}`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(agentOptions.slice(0, 25));

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('⚙️ Session 設定')
      .setDescription(`請選擇要更新的模型或 Agent\nSession: \`${sessionId}\``);

    await interaction.editReply({
      embeds: [embed],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modelSelect),
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(agentSelect),
      ],
    });
  }

  /**
   * 重新開始按鈕（目前給引導，避免誤操作）
   */
  async handleRestartWithId(interaction: ButtonInteraction): Promise<void> {
    await interaction.reply({
      content: '請使用 `/session start` 建立新的 Session。若要結束舊 Session，請使用「結束/刪除 Session」按鈕。',
      flags: [MessageFlags.Ephemeral],
    });
  }

  /**
   * 處理 Passthrough 切換按鈕（保留舊行為）
   */
  async handlePassthroughToggle(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;
    const isEnabled = customId.includes('enable') || customId.includes('true');
    const newState = !isEnabled;

    const embed = new EmbedBuilder()
      .setColor(newState ? 0x00ff00 : 0xff0000)
      .setTitle(newState ? '🟢 Passthrough 模式已開啟' : '🔴 Passthrough 模式已關閉')
      .setDescription(
        newState
          ? '現在您可以直接輸入訊息，系統會自動將其傳送至 OpenCode Session'
          : 'Passthrough 模式已關閉，請使用指令進行操作'
      )
      .setTimestamp();

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
   * 驗證用戶是否有權操作 Session（擁有者或管理員）
   */
  private async checkSessionOwnership(
    session: Session,
    interaction: ButtonInteraction
  ): Promise<boolean> {
    if (session.userId === interaction.user.id) {
      return true;
    }

    const member = await interaction.guild?.members.fetch(interaction.user.id);
    const isAdmin = member?.permissions.has(PermissionFlagsBits.Administrator) ?? false;
    if (isAdmin) {
      return true;
    }

    const message = '❌ 您無權操作此 Session，只有 Session 擁有者或管理員可以執行此操作';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message });
    } else {
      await interaction.reply({ content: message, flags: [MessageFlags.Ephemeral] });
    }
    return false;
  }

  /**
   * 從 customId 提取 Session ID
   */
  private extractSessionId(customId: string, action: string): string | null {
    const prefix = `session:${action}:`;
    if (customId.startsWith(prefix)) {
      return customId.slice(prefix.length);
    }
    return null;
  }

  /**
   * 解析 Session（兼容舊 mock：無 findSession 方法）
   */
  private async resolveSession(sessionId: string, channelId?: string): Promise<Session | null> {
    const manager = this.sessionManager as SessionManager & {
      findSession?: (id: string) => Promise<Session | null>;
      getSession?: (id: string) => Session | undefined;
      getActiveSessionByChannel?: (channelId: string) => Session | undefined;
    };

    if (typeof manager.findSession === 'function') {
      return manager.findSession(sessionId);
    }

    if (typeof manager.getSession === 'function') {
      return manager.getSession(sessionId) || null;
    }

    if (channelId && typeof manager.getActiveSessionByChannel === 'function') {
      const active = manager.getActiveSessionByChannel(channelId);
      if (active && active.sessionId === sessionId) {
        return active;
      }
    }

    return null;
  }

  /**
   * 更新點擊所在的控制訊息（通常在 thread 中）
   */
  private async updateControlMessage(
    interaction: ButtonInteraction,
    session: Session,
    options?: { note?: string }
  ): Promise<void> {
    try {
      const message = interaction.message as Message;
      const embed = SessionStatusEmbedBuilder.createSessionLiveStatusCard(session);
      if (options?.note) {
        embed.setDescription(options.note);
      }

      await message.edit({
        embeds: [embed],
        components: [createSessionActionRow(session.sessionId, session.status)],
      });
    } catch (error) {
      logger.debug('[SessionButtonHandler] 更新控制訊息失敗', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: session.sessionId,
      });
    }
  }

  /**
   * 更新主頻道 Session 狀態卡
   */
  private async updateMainStatusMessage(
    interaction: ButtonInteraction,
    session: Session,
    options?: { note?: string; removeComponents?: boolean }
  ): Promise<void> {
    const statusMessageId = (session.metadata as Record<string, unknown>)?.statusMessageId;
    if (!statusMessageId || typeof statusMessageId !== 'string') {
      return;
    }

    try {
      const channel = await interaction.client.channels.fetch(session.channelId);
      if (!channel || !('messages' in channel)) {
        return;
      }

      const message = await channel.messages.fetch(statusMessageId);
      if (!message) {
        return;
      }

      const embed = SessionStatusEmbedBuilder.createSessionChannelStatusCard(session, {
        threadId: session.threadId,
        note: options?.note,
      });

      await message.edit({
        embeds: [embed],
        components: options?.removeComponents ? [] : [createSessionManagementRow(session.sessionId)],
      });
    } catch (error) {
      logger.debug('[SessionButtonHandler] 更新主頻道狀態卡失敗', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: session.sessionId,
      });
    }
  }

  /**
   * 構建模型選項（最多 25 個）
   */
  private async getModelOptions(interaction: ButtonInteraction): Promise<StringSelectMenuOptionBuilder[]> {
    const guildId = interaction.guildId || undefined;
    const models = guildId ? await getAvailableModels(guildId, true) : [];

    if (models.length === 0) {
      return [
        new StringSelectMenuOptionBuilder()
          .setLabel('沒有可用模型')
          .setDescription('請檢查模型來源配置')
          .setValue('no-models'),
      ];
    }

    return models.slice(0, 25).map((model) => {
      const provider = model.id.includes('/') ? model.id.split('/')[0] : model.provider;
      return new StringSelectMenuOptionBuilder()
        .setLabel(model.name.substring(0, 100))
        .setValue(model.id)
        .setDescription(`${provider} • ${model.id}`.substring(0, 100));
    });
  }

  /**
   * 構建 Agent 選項（最多 25 個）
   */
  private async getAgentOptions(
    projectPath: string,
    currentAgentId: string
  ): Promise<StringSelectMenuOptionBuilder[]> {
    const agents = await getAvailableAgents({
      projectPath,
      useCache: true,
      allowFallback: true,
    });

    if (agents.length === 0) {
      return [
        new StringSelectMenuOptionBuilder()
          .setLabel('沒有可用 Agent')
          .setDescription('請檢查 OpenCode Agent 設定')
          .setValue('general')
          .setDefault(currentAgentId === 'general'),
      ];
    }

    return agents.slice(0, 25).map((agent) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(agent.name.substring(0, 100))
        .setValue(agent.id)
        .setDescription((agent.description || 'OpenCode Agent').substring(0, 100))
        .setDefault(agent.id === currentAgentId)
    );
  }
}

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

export default {
  SessionButtonHandler,
  registerSessionButtonHandlers,
};
