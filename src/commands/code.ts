/**
 * Code Command - Passthrough 模式指令
 * @description /code 指令用於切換 Passthrough 模式
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { getPassthroughService } from '../services/PassthroughService.js';
import { Colors } from '../builders/EmbedBuilder.js';
import { captureCommandError } from '../utils/sentryHelper.js';

// ============== Command Builder ==============

/**
 * 建立 /code 指令
 */
export const codeCommand = new SlashCommandBuilder()
  .setName('code')
  .setDescription('切換 Passthrough 模式')
  .setDMPermission(true)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('toggle')
      .setDescription('切換 Passthrough 模式的開關狀態')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('status')
      .setDescription('顯示當前 Passthrough 模式狀態')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('enable')
      .setDescription('啟用 Passthrough 模式')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('disable')
      .setDescription('停用 Passthrough 模式')
  );

// ============== Command Handler ==============

/**
 * 處理 /code 指令
 */
export async function handleCodeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const channelId = interaction.channelId;

  // 獲取 Passthrough 服務
  const passthroughService = getPassthroughService();

  try {
    switch (subcommand) {
      case 'toggle':
        await handleToggle(interaction, passthroughService, channelId);
        break;
      case 'status':
        await handleStatus(interaction, passthroughService, channelId);
        break;
      case 'enable':
        await handleEnable(interaction, passthroughService, channelId);
        break;
      case 'disable':
        await handleDisable(interaction, passthroughService, channelId);
        break;
      default:
        await interaction.reply({
          content: '❌ 未知的子指令',
          flags: [MessageFlags.Ephemeral],
        });
    }
  } catch (error) {
    // 捕獲錯誤到 Sentry
    if (error instanceof Error) {
      captureCommandError(
        error,
        `code ${subcommand}`,
        { subcommand, channelId },
        interaction.user,
        interaction.guild ?? undefined
      );
    }
    const errorMessage = error instanceof Error ? error.message : '未知錯誤';
    await interaction.reply({
      content: `❌ 執行指令失敗: ${errorMessage}`,
      flags: [MessageFlags.Ephemeral],
    });
  }
}

// ============== Subcommand Handlers ==============

/**
 * 處理 toggle 子指令
 */
async function handleToggle(
  interaction: ChatInputCommandInteraction,
  passthroughService: ReturnType<typeof getPassthroughService>,
  channelId: string
): Promise<void> {
  const state = passthroughService.toggle(channelId);
  await sendStatusMessage(interaction, passthroughService, channelId, state.enabled);
}

/**
 * 處理 status 子指令
 */
async function handleStatus(
  interaction: ChatInputCommandInteraction,
  passthroughService: ReturnType<typeof getPassthroughService>,
  channelId: string
): Promise<void> {
  const state = passthroughService.getState(channelId);
  await sendStatusMessage(interaction, passthroughService, channelId, state.enabled);
}

/**
 * 處理 enable 子指令
 */
async function handleEnable(
  interaction: ChatInputCommandInteraction,
  passthroughService: ReturnType<typeof getPassthroughService>,
  channelId: string
): Promise<void> {
  const state = passthroughService.enable(channelId);
  await sendStatusMessage(interaction, passthroughService, channelId, state.enabled);
}

/**
 * 處理 disable 子指令
 */
async function handleDisable(
  interaction: ChatInputCommandInteraction,
  passthroughService: ReturnType<typeof getPassthroughService>,
  channelId: string
): Promise<void> {
  const state = passthroughService.disable(channelId);
  await sendStatusMessage(interaction, passthroughService, channelId, state.enabled);
}

// ============== Helper Functions ==============

/**
 * 發送狀態訊息
 */
async function sendStatusMessage(
  interaction: ChatInputCommandInteraction,
  passthroughService: ReturnType<typeof getPassthroughService>,
  channelId: string,
  isEnabled: boolean
): Promise<void> {
  const state = passthroughService.getState(channelId);
  const stats = passthroughService.getStats();

  const embed = new EmbedBuilder()
    .setTitle(isEnabled ? '📡 Passthrough 模式已啟用' : '📡 Passthrough 模式已停用')
    .setColor(isEnabled ? Colors.SUCCESS : Colors.WARNING)
    .setTimestamp();

  // 狀態描述
  const statusText = isEnabled
    ? [
        '✅ **模式**: 直接輸入模式',
        '⬢ **狀態**: 啟用',
        '',
        '在此模式下，您可以直接輸入訊息，系統會自動將其傳送至 OpenCode Session，無需每次輸入指令。',
      ].join('\n')
    : [
        '❌ **模式**: 指令模式',
        '⬢ **狀態**: 停用',
        '',
        '在此模式下，您需要使用指令（如 /session）來啟動 OpenCode Session。',
      ].join('\n');

  embed.setDescription(statusText);

  // 啟用時間
  if (state.enabledAt) {
    embed.addFields({
      name: '🕐 啟用時間',
      value: `<t:${Math.floor(state.enabledAt.getTime() / 1000)}:F>`,
      inline: true,
    });
  }

  // 統計資訊
  embed.addFields(
    {
      name: '📊 全域統計',
      value: [
        `**啟用頻道**: ${stats.enabledChannels}`,
        `**處理中**: ${stats.processingChannels}`,
      ].join('\n'),
      inline: true,
    },
    {
      name: '⚙️ 設定',
      value: state.autoTranscribe ? '✅ 自動轉錄語音' : '❌ 關閉語音轉錄',
      inline: true,
    }
  );

  // 建立操作按鈕
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    isEnabled
      ? new ButtonBuilder()
          .setCustomId('passthrough:disable')
          .setLabel('⏹️ 關閉 Passthrough')
          .setStyle(ButtonStyle.Danger)
      : new ButtonBuilder()
          .setCustomId('passthrough:enable')
          .setLabel('▶️ 開啟 Passthrough')
          .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('passthrough:toggle')
      .setLabel('🔄 切換')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
  });
}

// ============== Passthrough Button Handler ==============

/**
 * 建立 Passthrough 狀態按鈕 ActionRow
 */
export function createPassthroughActionRow(isEnabled: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('passthrough:toggle')
      .setLabel(isEnabled ? '⏸️ Passthrough 模式' : '▶️ 開啟 Passthrough')
      .setStyle(isEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji(isEnabled ? '⏸️' : '▶️')
  );
}

// ============== 導出 ==============

export default {
  codeCommand,
  handleCodeCommand,
  createPassthroughActionRow,
};
