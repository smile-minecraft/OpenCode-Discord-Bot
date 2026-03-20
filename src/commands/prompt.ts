/**
 * Prompt Command
 * @description 向当前活跃会话发送消息
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { getSessionManager } from '../services/SessionManager.js';
import { Colors } from '../builders/EmbedBuilder.js';
import { captureCommandError } from '../utils/sentryHelper.js';

const command = new SlashCommandBuilder()
  .setName('prompt')
  .setDescription('向當前活躍會話發送消息')
  .addStringOption((option) =>
    option
      .setName('message')
      .setDescription('要發送的訊息內容')
      .setRequired(true)
  );

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const message = interaction.options.getString('message', true);
  const channelId = interaction.channelId;
  
  if (!channelId) {
    await interaction.reply({
      content: '❌ 此命令只能在頻道中使用',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const sessionManager = getSessionManager();
    
    // 获取当前频道的活跃会话
    const activeSession = sessionManager.getActiveSessionByChannel(channelId);
    
    if (!activeSession) {
      await interaction.editReply({
        content: '❌ 此頻道沒有運行中的 Session，請先使用 `/session start` 開始一個會話',
      });
      return;
    }

    // 发送消息到会话
    await sessionManager.sendPrompt(activeSession.sessionId, message);

    const embed = new EmbedBuilder()
      .setColor(Colors.PRIMARY)
      .setDescription('✅ 訊息已發送')
      .setFooter({ text: `Session: ${activeSession.sessionId}` })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
    });
  } catch (error) {
    // 捕獲錯誤到 Sentry
    if (error instanceof Error) {
      captureCommandError(
        error,
        interaction.commandName,
        { message },
        interaction.user,
        interaction.guild ?? undefined
      );
    }
    
    const errorMessage = error instanceof Error ? error.message : '未知錯誤';
    await interaction.editReply({
      content: `❌ 發送訊息失敗: ${errorMessage}`,
    });
  }
}

export { command, execute };
export default { command, execute };
