/**
 * Voice 命令模組
 * @description 提供語音轉錄管理的 Slash Commands
 * 
 * 指令列表：
 * - /voice status - 顯示語音轉錄服務狀態
 * - /voice set - 設定 API Key
 */

import {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { getVoiceService } from '../services/VoiceService.js';

// ============== 指令構建 ==============

/**
 * 創建 Voice 命令
 */
export function createVoiceCommand(): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName('voice')
    .setDescription('管理語音轉錄服務')
    .addSubcommand(createStatusSubcommand())
    .addSubcommand(createSetSubcommand()) as SlashCommandBuilder;
}

/**
 * 創建 status 子命令
 */
function createStatusSubcommand(): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName('status')
    .setDescription('顯示語音轉錄服務狀態');
}

/**
 * 創建 set 子命令
 */
function createSetSubcommand(): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName('set')
    .setDescription('設定 API Key')
    .addStringOption((option) =>
      option
        .setName('api_key')
        .setDescription('Gemini API Key')
        .setRequired(true)
    );
}

// ============== 指令處理 ==============

/**
 * 處理 Voice 命令
 */
export async function handleVoiceCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'status':
      await handleStatusCommand(interaction);
      break;
    case 'set':
      await handleSetCommand(interaction);
      break;
    default:
      await interaction.reply({
        content: '未知的子命令',
        flags: [MessageFlags.Ephemeral],
      });
  }
}

/**
 * 處理 status 子命令
 */
async function handleStatusCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const voiceService = getVoiceService();
  const status = voiceService.getStatus();

  const embed = new EmbedBuilder()
    .setTitle('🎙️ 語音轉錄服務狀態')
    .setColor(status.apiKeySet ? 0x00ff00 : 0xff0000)
    .addFields(
      {
        name: '服務狀態',
        value: status.configured ? '✅ 已設定' : '❌ 未設定',
        inline: true,
      },
      {
        name: 'API Key',
        value: status.apiKeySet ? '✅ 已設定' : '❌ 未設定',
        inline: true,
      },
      {
        name: '環境變數',
        value: process.env.GEMINI_API_KEY ? '✅ GEMINI_API_KEY 已存在' : '⚠️ 請設定 GEMINI_API_KEY',
        inline: false,
      }
    )
    .setFooter({ text: '使用 /voice set <api_key> 設定 API Key' })
    .setTimestamp();

  await interaction.editReply({
    embeds: [embed],
  });
}

/**
 * 處理 set 子命令
 */
async function handleSetCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const apiKey = interaction.options.getString('api_key', true);
  const voiceService = getVoiceService();

  // 設定 API Key
  voiceService.setApiKey(apiKey);

  const embed = new EmbedBuilder()
    .setTitle('✅ API Key 已設定')
    .setDescription('Gemini API Key 設定成功！')
    .setColor(0x00ff00)
    .addFields(
      {
        name: '提示',
        value: '現在可以在 Passthrough 模式下自動轉錄語音訊息了',
        inline: false,
      }
    )
    .setTimestamp();

  await interaction.editReply({
    embeds: [embed],
  });
}

// ============== 導出 ==============

export default {
  createVoiceCommand,
  handleVoiceCommand,
};
