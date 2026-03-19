/**
 * Session 命令模組
 * @description 提供 Session 管理的 Slash Commands
 * 
 * 指令列表：
 * - /session start - 開始新 Session
 * - /session list - 列出所有 Sessions
 * - /session resume - 恢復 Session
 * - /session abort - 終止 Session
 * - /session settings - 更新 Session 模型/Agent
 * - /session clear - 清除所有 Session 與討論串
 */

import {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  MessageFlags,
  TextChannel,
  NewsChannel,
  Message,
} from 'discord.js';
import { SessionManager } from '../services/SessionManager.js';
import { getThreadManager } from '../services/ThreadManager.js';
import { getSessionEventManager } from '../services/SessionEventManager.js';
import { getStreamingMessageManager, type SSEEventEmitterAdapter } from '../services/StreamingMessageManager.js';
import { getOpenCodeSDKAdapter } from '../services/OpenCodeSDKAdapter.js';
import { SessionStatusEmbedBuilder } from '../builders/SessionEmbedBuilder.js';
import { createSessionActionRow, createSessionManagementRow } from '../builders/SessionActionRowBuilder.js';
import { getAvailableModels } from '../services/ModelService.js';
import type { ModelDefinition } from '../models/ModelData.js';
import { getAvailableAgents } from '../services/AgentService.js';
import type { Session } from '../database/models/Session.js';
import { MODEL_CONFIG } from '../config/constants.js';
import { captureCommandError } from '../utils/sentryHelper.js';
import logger from '../utils/logger.js';

// ============== 指令構建 ==============

/**
 * 創建 Session 命令
 */
export function createSessionCommand(): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName('session')
    .setDescription('管理 OpenCode Session')
    .addSubcommand(createStartSubcommand())
    .addSubcommand(createListSubcommand())
    .addSubcommand(createResumeSubcommand())
    .addSubcommand(createAbortSubcommand())
    .addSubcommand(createSettingsSubcommand())
    .addSubcommand(createClearSubcommand()) as SlashCommandBuilder;
}

/**
 * 創建 start 子命令
 */
function createStartSubcommand(): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName('start')
    .setDescription('開始新的 OpenCode Session')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Session 的初始提示詞')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('model')
        .setDescription('使用的 AI 模型')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName('agent')
        .setDescription('使用的主代理（不填則使用伺服器預設 Agent）')
        .setRequired(false)
        .setAutocomplete(true)
    );
}

/**
 * 創建 list 子命令
 */
function createListSubcommand(): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName('list')
    .setDescription('列出所有 Sessions')
    .addStringOption((option) =>
      option
        .setName('status')
        .setDescription('過濾 Session 狀態')
        .setRequired(false)
        .addChoices(
          { name: '全部', value: 'all' },
          { name: '運行中', value: 'running' },
          { name: '已完成', value: 'completed' },
          { name: '已中止', value: 'aborted' }
        )
    );
}

/**
 * 創建 resume 子命令
 */
function createResumeSubcommand(): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName('resume')
    .setDescription('恢復既有的 Session')
    .addStringOption((option) =>
      option
        .setName('session_id')
        .setDescription('要恢復的 Session ID')
        .setRequired(true)
    );
}

/**
 * 創建 abort 子命令
 */
function createAbortSubcommand(): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName('abort')
    .setDescription('終止當前運行中的 Session')
    .addStringOption((option) =>
      option
        .setName('session_id')
        .setDescription('要終止的 Session ID')
        .setRequired(false)
    );
}

/**
 * 創建 settings 子命令
 */
function createSettingsSubcommand(): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName('settings')
    .setDescription('更新 Session 的模型與 Agent 設定')
    .addStringOption((option) =>
      option
        .setName('session_id')
        .setDescription('要更新的 Session ID（不填則使用當前頻道活躍 Session）')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('model')
        .setDescription('設定模型')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName('agent')
        .setDescription('設定 Agent')
        .setRequired(false)
        .setAutocomplete(true)
    );
}

/**
 * 創建 clear 子命令
 */
function createClearSubcommand(): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName('clear')
    .setDescription('清除所有 Session 與關聯討論串（高風險操作）');
}

// ============== Autocomplete 處理 ==============

/**
 * 處理 session start 命令的 model 選項自動完成
 */
export async function handleSessionModelAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.respond([
      { name: '請在伺服器中使用此指令', value: '' }
    ]);
    return;
  }

  const focusedValue = interaction.options.getFocused();

  try {
    // 獲取可用的模型列表
    const models = await getAvailableModels(guildId, true);

    // 過濾匹配的模型
    const filteredModels = models.filter((model: ModelDefinition) =>
      model.id.toLowerCase().includes(focusedValue.toLowerCase()) ||
      model.name.toLowerCase().includes(focusedValue.toLowerCase())
    );

    // 限制返回數量（Discord 限制為 25 個）
    const limitedModels = filteredModels.slice(0, 25);

    const choices = limitedModels.map((model: ModelDefinition) => {
      const providerFromId = model.id.includes('/')
        ? model.id.split('/')[0]
        : model.provider;
      return {
        name: `${model.name} (${providerFromId})`,
        value: model.id,
      };
    });

    await interaction.respond(choices);
  } catch (error) {
    console.error('[Session Autocomplete] Error:', error);
    await interaction.respond([]);
  }
}

/**
 * 處理 session settings 命令的 agent 選項自動完成
 */
export async function handleSessionAgentAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const focusedValue = interaction.options.getFocused().toLowerCase();

  try {
    const agents = await getAvailableAgents({ useCache: true, allowFallback: true });
    const filtered = agents
      .filter((agent) =>
        agent.id.toLowerCase().includes(focusedValue)
        || agent.name.toLowerCase().includes(focusedValue)
        || agent.description.toLowerCase().includes(focusedValue)
      )
      .slice(0, 25);

    await interaction.respond(
      filtered.map((agent) => ({
        name: `${agent.name} (${agent.id})`.slice(0, 100),
        value: agent.id,
      }))
    );
  } catch (error) {
    logger.warn('[SessionCommand] Agent autocomplete 失敗', {
      error: error instanceof Error ? error.message : String(error),
    });
    await interaction.respond([]);
  }
}

// ============== 指令處理 ==============

/**
 * 處理 Session 命令
 */
export async function handleSessionCommand(
  interaction: ChatInputCommandInteraction,
  sessionManager: SessionManager
): Promise<void> {
  if (!interaction.memberPermissions?.has('ManageChannels')) {
    await interaction.reply({
      content: '❌ 您需要「管理頻道」權限才能使用此指令',
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'start':
      await handleStartCommand(interaction, sessionManager);
      break;
    case 'list':
      await handleListCommand(interaction, sessionManager);
      break;
    case 'resume':
      await handleResumeCommand(interaction, sessionManager);
      break;
    case 'abort':
      await handleAbortCommand(interaction, sessionManager);
      break;
    case 'settings':
      await handleSettingsCommand(interaction, sessionManager);
      break;
    case 'clear':
      await handleClearCommand(interaction, sessionManager);
      break;
    default:
      await interaction.reply({
        content: '未知的子命令',
        flags: [MessageFlags.Ephemeral],
      });
  }
}

/**
 * 處理 start 子命令
 */
async function handleStartCommand(
  interaction: ChatInputCommandInteraction,
  sessionManager: SessionManager
): Promise<void> {
  await interaction.deferReply();

  const prompt = interaction.options.getString('prompt') || '';
  const model = interaction.options.getString('model') || MODEL_CONFIG.DEFAULT;
  const agent = interaction.options.getString('agent') || undefined;
  const channelId = interaction.channelId;
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  // 檢查是否有 Guild ID
  if (!guildId) {
    await interaction.editReply({
      content: '❌ 此指令只能在伺服器中使用，無法在 DM 中使用。',
    });
    return;
  }

  // 檢查頻道是否為 TextChannel 或 NewsChannel
  const channel = interaction.channel;
  if (!channel || !(channel instanceof TextChannel || channel instanceof NewsChannel)) {
    await interaction.editReply({
      content: '❌ 無法在此類型頻道中創建 Session，請在文字頻道或公告頻道中使用。',
    });
    return;
  }

  try {
    // 創建新 Session（傳入 guildId）
    const session = await sessionManager.createSession({
      channelId,
      guildId,
      userId,
      prompt,
      model,
      agent,
    });

    // ===== Phase 1: 創建 Thread 並绑定到 Session =====
    // ThreadManager 已在啟動時初始化，這裡直接使用
    const threadManager = getThreadManager();

    // 使用頻道創建 Thread
    const threadId = await threadManager.createThread({
      channel: channel,
      sessionId: session.sessionId,
      guildId: guildId,
      opencodeSessionId: session.opencodeSessionId,
      name: `session-${session.sessionId.slice(0, 8)}`,
    });

    // 更新 Session 的 threadId
    session.threadId = threadId;

    // 保存更新後的 Session
    await sessionManager.updateSession(session);

    logger.info(`[SessionCommand] Created thread ${threadId} for session ${session.sessionId}`);

    // ===== 構建 Embed 並發送到 Thread =====
    const embed = SessionStatusEmbedBuilder.createSessionStartedCard({
      sessionId: session.sessionId,
      prompt: session.prompt,
      model: session.model,
      agent: session.agent,
      status: session.status,
      projectPath: session.projectPath,
      duration: session.getDuration(),
    });

    // 構建操作按鈕
    const components = createSessionActionRow(session.sessionId, session.status);

    // 發送到 Thread 而不是直接回覆互動
    const thread = channel.threads.cache.get(threadId) || await channel.threads.fetch(threadId);
    if (thread && 'send' in thread) {
      await thread.send({
        embeds: [embed],
        components: [components],
      });

      const initialPrompt = prompt.trim();
      if (initialPrompt) {
        const sdkAdapter = getOpenCodeSDKAdapter();
        const port = sdkAdapter.getPort();
        if (!port) {
          throw new Error('OpenCode 串流未就緒，無法發送初始提示詞');
        }

        const sessionEventManager = getSessionEventManager();
        let adapter = sessionEventManager.getSubscription(session.sessionId)?.adapter as SSEEventEmitterAdapter | undefined;
        if (!adapter) {
          adapter = await sessionEventManager.subscribe(session.sessionId) as SSEEventEmitterAdapter;
        }

        const streamingManager = getStreamingMessageManager();
        let streamingStarted = false;

        try {
          streamingManager.startStreaming(session, threadId, port, adapter);
          streamingStarted = true;
          logger.info(`[SessionCommand] Streaming started for session ${session.sessionId}`);

          await sessionManager.sendPrompt(session.sessionId, initialPrompt);
          logger.info(`[SessionCommand] Initial prompt sent for session ${session.sessionId}`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '未知錯誤';
          if (streamingStarted) {
            streamingManager.removeStream(session.sessionId, threadId);
          }
          await sessionManager.failSession(session.sessionId, `初始提示發送失敗: ${errorMessage}`);
          if (thread && 'send' in thread) {
            await thread.send({
              content: `❌ 初始提示發送失敗：${errorMessage}`,
            });
          }
          throw error;
        }
      } else {
        logger.debug(`[SessionCommand] Session ${session.sessionId} started without initial prompt`);
      }
    }

    // 回覆互動（主頻道狀態卡 + 管理按鈕）
    const statusEmbed = SessionStatusEmbedBuilder.createSessionChannelStatusCard(session, {
      threadId,
      note: 'Session 已啟動，請到討論串中持續對話',
    });
    const statusRow = createSessionManagementRow(session.sessionId);

    await interaction.editReply({
      content: `✅ Session 已啟動！請在 Thread 中繼續對話：${thread?.toString() || ''}`,
      embeds: [statusEmbed],
      components: [statusRow],
    });

    // 記錄主頻道狀態訊息 ID，供後續動態更新
    const reply = await interaction.fetchReply() as Message;
    (session.metadata as Record<string, unknown>).statusMessageId = reply.id;
    (session.metadata as Record<string, unknown>).statusChannelId = interaction.channelId;
    await sessionManager.updateSession(session);
  } catch (error) {
    // 捕獲錯誤到 Sentry
    if (error instanceof Error) {
      captureCommandError(
        error,
        'session start',
        { prompt, model, channelId, userId, guildId },
        interaction.user,
        interaction.guild ?? undefined
      );
    }
    const errorMessage = error instanceof Error ? error.message : '未知錯誤';
    await interaction.editReply({
      content: `❌ 啟動 Session 失敗: ${errorMessage}`,
    });
  }
}

/**
 * 處理 list 子命令
 */
async function handleListCommand(
  interaction: ChatInputCommandInteraction,
  sessionManager: SessionManager
): Promise<void> {
  await interaction.deferReply();

  const statusFilter = interaction.options.getString('status') as 'all' | 'running' | 'completed' | 'aborted' | null;
  const channelId = interaction.channelId;

  try {
    const sessions = await sessionManager.listSessions(channelId, statusFilter || 'all');

    if (sessions.length === 0) {
      await interaction.editReply({
        content: '此頻道目前沒有 Session 記錄',
      });
      return;
    }

    // 構建 Session 列表 Embed
    const embed = SessionStatusEmbedBuilder.createSessionListCard({
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        status: s.status,
        prompt: s.prompt,
        model: s.model,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
      })),
    });

    await interaction.editReply({
      embeds: [embed],
    });
  } catch (error) {
    // 捕獲錯誤到 Sentry
    if (error instanceof Error) {
      captureCommandError(
        error,
        'session list',
        { statusFilter, channelId },
        interaction.user,
        interaction.guild ?? undefined
      );
    }
    const errorMessage = error instanceof Error ? error.message : '未知錯誤';
    await interaction.editReply({
      content: `❌ 獲取 Session 列表失敗: ${errorMessage}`,
    });
  }
}

/**
 * 處理 resume 子命令
 */
async function handleResumeCommand(
  interaction: ChatInputCommandInteraction,
  sessionManager: SessionManager
): Promise<void> {
  await interaction.deferReply();

  const sessionId = interaction.options.getString('session_id', true);

  try {
    const session = await sessionManager.resumeSession(sessionId);

    if (!session) {
      await interaction.editReply({
        content: `找不到 ID 為 \`${sessionId}\` 的 Session`,
      });
      return;
    }

    const embed = SessionStatusEmbedBuilder.createSessionResumedCard({
      sessionId: session.sessionId,
      status: session.status,
      prompt: session.prompt,
    });

    // 構建操作按鈕
    const components = createSessionActionRow(session.sessionId, session.status);

    await interaction.editReply({
      embeds: [embed],
      components: [components],
    });

    await refreshSessionStatusMessage(interaction, session, 'Session 已恢復');
  } catch (error) {
    // 捕獲錯誤到 Sentry
    if (error instanceof Error) {
      captureCommandError(
        error,
        'session resume',
        { sessionId },
        interaction.user,
        interaction.guild ?? undefined
      );
    }
    const errorMessage = error instanceof Error ? error.message : '未知錯誤';
    await interaction.editReply({
      content: `❌ 恢復 Session 失敗: ${errorMessage}`,
    });
  }
}

/**
 * 處理 abort 子命令
 */
async function handleAbortCommand(
  interaction: ChatInputCommandInteraction,
  sessionManager: SessionManager
): Promise<void> {
  await interaction.deferReply();

  const sessionId = interaction.options.getString('session_id');

  try {
    const session = await sessionManager.abortSession(sessionId ?? undefined);

    if (!session) {
      await interaction.editReply({
        content: sessionId
          ? `找不到 ID 為 \`${sessionId}\` 的 Session`
          : '此頻道沒有運行中的 Session',
      });
      return;
    }

    const embed = SessionStatusEmbedBuilder.createSessionAbortedCard({
      sessionId: session.sessionId,
      duration: session.getDuration(),
    });

    await interaction.editReply({
      embeds: [embed],
      components: [], // 移除操作按鈕
    });

    await refreshSessionStatusMessage(interaction, session, 'Session 已終止');
  } catch (error) {
    // 捕獲錯誤到 Sentry
    if (error instanceof Error) {
      captureCommandError(
        error,
        'session abort',
        { sessionId },
        interaction.user,
        interaction.guild ?? undefined
      );
    }
    const errorMessage = error instanceof Error ? error.message : '未知錯誤';
    await interaction.editReply({
      content: `❌ 終止 Session 失敗: ${errorMessage}`,
    });
  }
}

/**
 * 處理 settings 子命令
 */
async function handleSettingsCommand(
  interaction: ChatInputCommandInteraction,
  sessionManager: SessionManager
): Promise<void> {
  await interaction.deferReply({
    flags: [MessageFlags.Ephemeral],
  });

  const inputSessionId = interaction.options.getString('session_id');
  const model = interaction.options.getString('model');
  const agent = interaction.options.getString('agent');

  if (!model && !agent) {
    await interaction.editReply({
      content: '⚠️ 請至少提供 `model` 或 `agent` 其中一個設定',
    });
    return;
  }

  const targetSessionId = inputSessionId || sessionManager.getActiveSessionByChannel(interaction.channelId)?.sessionId;
  if (!targetSessionId) {
    await interaction.editReply({
      content: '❌ 此頻道沒有可更新的活躍 Session，請先使用 `/session start`',
    });
    return;
  }

  try {
    const session = await sessionManager.updateSessionSettings(targetSessionId, {
      model: model || undefined,
      agent: agent || undefined,
    });

    if (!session) {
      await interaction.editReply({
        content: `❌ 找不到 Session：\`${targetSessionId}\``,
      });
      return;
    }

    await refreshSessionStatusMessage(interaction, session, 'Session 設定已更新');

    await interaction.editReply({
      content: `✅ Session 設定已更新\n模型：\`${session.model}\`\nAgent：\`${session.agent}\``,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知錯誤';
    await interaction.editReply({
      content: `❌ 更新 Session 設定失敗: ${errorMessage}`,
    });
  }
}

/**
 * 處理 clear 子命令
 */
async function handleClearCommand(
  interaction: ChatInputCommandInteraction,
  sessionManager: SessionManager
): Promise<void> {
  await interaction.deferReply({
    flags: [MessageFlags.Ephemeral],
  });

  // clear 屬於高風險操作，額外要求管理員權限
  if (!interaction.memberPermissions?.has('Administrator')) {
    await interaction.editReply({
      content: '❌ `/session clear` 需要伺服器管理員權限',
    });
    return;
  }

  try {
    const result = await sessionManager.clearAllSessions({
      deleteThreads: true,
    });

    await interaction.editReply({
      content: [
        '🧹 Session 全清完成',
        `已處理 Session：${result.totalSessions}`,
        `已刪除 Session：${result.deletedSessions}`,
        `已刪除討論串：${result.deletedThreads}`,
        `失敗數：${result.failed}`,
      ].join('\n'),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知錯誤';
    await interaction.editReply({
      content: `❌ 清除 Session 失敗: ${errorMessage}`,
    });
  }
}

/**
 * 更新主頻道 Session 狀態訊息
 */
async function refreshSessionStatusMessage(
  interaction: ChatInputCommandInteraction,
  session: Session,
  note?: string
): Promise<void> {
  try {
    const statusMessageId = (session.metadata as Record<string, unknown>)?.statusMessageId;
    if (!statusMessageId || typeof statusMessageId !== 'string') {
      return;
    }

    const statusChannel = await interaction.client.channels.fetch(session.channelId);
    if (!statusChannel || !('messages' in statusChannel)) {
      return;
    }

    const message = await statusChannel.messages.fetch(statusMessageId);
    if (!message) {
      return;
    }

    const embed = SessionStatusEmbedBuilder.createSessionChannelStatusCard(session, {
      threadId: session.threadId || null,
      note: note || 'Session 狀態已更新',
    });
    const row = createSessionManagementRow(session.sessionId);

    await message.edit({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    logger.warn('[SessionCommand] 更新主頻道狀態訊息失敗', {
      error: error instanceof Error ? error.message : String(error),
      sessionId: session.sessionId,
    });
  }
}

// ============== 導出 ==============

export default {
  createSessionCommand,
  handleSessionCommand,
  handleSessionModelAutocomplete,
  handleSessionAgentAutocomplete,
};
