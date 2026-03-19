/**
 * Session 命令模組
 * @description 提供 Session 管理的 Slash Commands
 * 
 * 指令列表：
 * - /session start - 開始新 Session
 * - /session list - 列出所有 Sessions
 * - /session resume - 恢復 Session
 * - /session abort - 終止 Session
 */

import {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  MessageFlags,
  TextChannel,
  NewsChannel,
} from 'discord.js';
import { SessionManager } from '../services/SessionManager.js';
import { getThreadManager } from '../services/ThreadManager.js';
import { getSessionEventManager } from '../services/SessionEventManager.js';
import { getStreamingMessageManager, type SSEEventEmitterAdapter } from '../services/StreamingMessageManager.js';
import { getOpenCodeSDKAdapter } from '../services/OpenCodeSDKAdapter.js';
import { SessionStatusEmbedBuilder } from '../builders/SessionEmbedBuilder.js';
import { getAvailableModels } from '../services/ModelService.js';
import type { ModelDefinition } from '../models/ModelData.js';
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
    .addSubcommand(createAbortSubcommand()) as SlashCommandBuilder;
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
    
    const choices = limitedModels.map((model: ModelDefinition) => ({
      name: `${model.name} (${model.provider})`,
      value: model.id,
    }));
    
    await interaction.respond(choices);
  } catch (error) {
    console.error('[Session Autocomplete] Error:', error);
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
      status: session.status,
      projectPath: session.projectPath,
      duration: session.getDuration(),
    });

    // 構建操作按鈕
    const { createSessionActionRow } = await import('../builders/SessionActionRowBuilder.js');
    const components = createSessionActionRow(session.sessionId, session.status);

    // 發送到 Thread 而不是直接回覆互動
    const thread = channel.threads.cache.get(threadId) || await channel.threads.fetch(threadId);
    if (thread && 'send' in thread) {
      await thread.send({
        embeds: [embed],
        components: [components],
      });

      // ===== Phase 7: 啟動 Streaming (使用 Typing Indicator) =====
      // 獲取 SDK 適配器端口
      const sdkAdapter = getOpenCodeSDKAdapter();
      const port = sdkAdapter.getPort();
      
      if (port) {
        // 訂閱 Session 事件
        const sessionEventManager = getSessionEventManager();
        const adapter = await sessionEventManager.subscribe(session.sessionId) as SSEEventEmitterAdapter;
        
        // 啟動 Streaming（傳入 threadId 而非初始訊息）
        const streamingManager = getStreamingMessageManager();
        streamingManager.startStreaming(session, threadId, port, adapter);
        
        logger.info(`[SessionCommand] Streaming started for session ${session.sessionId}`);
      }
    }

    // 回覆互動，提供 Thread 連結
    await interaction.editReply({
      content: `✅ Session 已啟動！請在 Thread 中繼續對話：${thread?.toString() || ''}`,
    });
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
    const { createSessionActionRow } = await import('../builders/SessionActionRowBuilder.js');
    const components = createSessionActionRow(session.sessionId, session.status);

    await interaction.editReply({
      embeds: [embed],
      components: [components],
    });
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

// ============== 導出 ==============

export default {
  createSessionCommand,
  handleSessionCommand,
  handleSessionModelAutocomplete,
};
