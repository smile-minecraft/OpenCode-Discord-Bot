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
} from 'discord.js';
import { SessionManager } from '../services/SessionManager.js';
import { SessionStatusEmbedBuilder } from '../builders/SessionEmbedBuilder.js';

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
        .addChoices(
          { name: 'Claude Sonnet 4', value: 'anthropic/claude-sonnet-4-20250514' },
          { name: 'Claude Opus 4', value: 'anthropic/claude-opus-4-20250514' },
          { name: 'GPT-4o', value: 'openai/gpt-4o' },
          { name: 'Gemini 2.5 Pro', value: 'google/gemini-2.5-pro-preview-05-20' }
        )
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

// ============== 指令處理 ==============

/**
 * 處理 Session 命令
 */
export async function handleSessionCommand(
  interaction: ChatInputCommandInteraction,
  sessionManager: SessionManager
): Promise<void> {
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
        ephemeral: true,
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
  const model = interaction.options.getString('model') || 'anthropic/claude-sonnet-4-20250514';
  const channelId = interaction.channelId;
  const userId = interaction.user.id;

  try {
    // 創建新 Session
    const session = await sessionManager.createSession({
      channelId,
      userId,
      prompt,
      model,
    });

    // 構建回覆 Embed
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
};
