/**
 * Help Command
 * @description 顯示機器人指令幫助
 */

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

const command = new SlashCommandBuilder()
  .setName('help')
  .setDescription('顯示機器人指令幫助')
  .addStringOption((option) =>
    option
      .setName('command')
      .setDescription('查看特定指令的說明')
      .setRequired(false)
      .addChoices(
        { name: 'session', value: 'session' },
        { name: 'project', value: 'project' },
        { name: 'model', value: 'model' },
        { name: 'agent', value: 'agent' },
        { name: 'queue', value: 'queue' },
        { name: 'code', value: 'code' },
        { name: 'worktree', value: 'worktree' },
        { name: 'voice', value: 'voice' },
        { name: 'permission', value: 'permission' },
      )
  );

async function execute(interaction: {
  options: { getString: (name: string) => string | null };
  reply: (options: { embeds: EmbedBuilder[]; ephemeral: boolean }) => Promise<void>;
}): Promise<void> {
  const selectedCommand = interaction.options.getString('command');

  if (selectedCommand) {
    // 顯示特定指令的幫助
    const embed = getCommandHelp(selectedCommand);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  } else {
    // 顯示所有指令的幫助
    const embed = getAllCommandsHelp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

function getAllCommandsHelp(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('📖 OpenCode Bot 指令說明')
    .setDescription('以下是所有可用的指令：')
    .setColor(0x8B5CF6)
    .addFields(
      {
        name: '/session',
        value: '管理 OpenCode AI 對話 session\n子指令：start, list, resume, abort',
        inline: false,
      },
      {
        name: '/project',
        value: '管理專案和頻道綁定\n子指令：add, list, use, remove',
        inline: false,
      },
      {
        name: '/model',
        value: '選擇和管理 AI 模型\n子指令：list, set, info',
        inline: false,
      },
      {
        name: '/agent',
        value: '選擇和管理 Agent 類型\n子指令：list, set, info',
        inline: false,
      },
      {
        name: '/queue',
        value: '管理任務隊列\n子指令：list, clear, pause, resume, settings',
        inline: false,
      },
      {
        name: '/code',
        value: 'Passthrough 直接輸入模式\n子指令：toggle, status',
        inline: false,
      },
      {
        name: '/worktree',
        value: '管理 Git Worktree\n子指令：create, list, delete, pr',
        inline: false,
      },
      {
        name: '/voice',
        value: '語音訊息轉錄設定\n子指令：status, set',
        inline: false,
      },
      {
        name: '/permission',
        value: '管理權限\n子指令：check, grant, revoke',
        inline: false,
      },
      {
        name: '/help',
        value: '顯示這個幫助訊息',
        inline: false,
      }
    )
    .setFooter({ text: '使用 /help [指令名稱] 查看特定指令的詳細說明' });
}

function getCommandHelp(commandName: string): EmbedBuilder {
  const commands: Record<string, { title: string; description: string; fields: { name: string; value: string }[] }> = {
    session: {
      title: '💬 /session - Session 管理',
      description: '管理 OpenCode AI 對話 session',
      fields: [
        { name: '/session start', value: '開始新的 OpenCode 對話' },
        { name: '/session list', value: '列出所有 session' },
        { name: '/session resume', value: '恢復指定的 session' },
        { name: '/session abort', value: '終止當前 session' },
      ],
    },
    project: {
      title: '📁 /project - 專案管理',
      description: '管理專案和頻道綁定',
      fields: [
        { name: '/project add', value: '新增專案' },
        { name: '/project list', value: '列出所有專案' },
        { name: '/project use', value: '切換使用的專案' },
        { name: '/project remove', value: '移除專案' },
      ],
    },
    model: {
      title: '🤖 /model - 模型選擇',
      description: '選擇和管理 AI 模型',
      fields: [
        { name: '/model list', value: '列出所有可用模型' },
        { name: '/model set', value: '設定預設模型' },
        { name: '/model info', value: '查看模型詳細資訊' },
      ],
    },
    agent: {
      title: '🦸 /agent - Agent 選擇',
      description: '選擇和管理 Agent 類型',
      fields: [
        { name: '/agent list', value: '列出所有可用 Agent' },
        { name: '/agent set', value: '設定預設 Agent' },
        { name: '/agent info', value: '查看 Agent 詳細資訊' },
      ],
    },
    queue: {
      title: '📋 /queue - 任務隊列',
      description: '管理任務隊列',
      fields: [
        { name: '/queue list', value: '查看隊列狀態' },
        { name: '/queue clear', value: '清空隊列' },
        { name: '/queue pause', value: '暫停隊列' },
        { name: '/queue resume', value: '恢復隊列' },
        { name: '/queue settings', value: '查看/設定隊列選項' },
      ],
    },
    code: {
      title: '⌨️ /code - 直接輸入模式',
      description: 'Passthrough 直接輸入模式',
      fields: [
        { name: '/code toggle', value: '切換模式開關' },
        { name: '/code status', value: '查看當前狀態' },
      ],
    },
    worktree: {
      title: '🌳 /worktree - Git Worktree',
      description: '管理 Git Worktree',
      fields: [
        { name: '/worktree create', value: '建立新的 worktree' },
        { name: '/worktree list', value: '列出所有 worktree' },
        { name: '/worktree delete', value: '刪除 worktree' },
        { name: '/worktree pr', value: '建立 Pull Request' },
      ],
    },
    voice: {
      title: '🎤 /voice - 語音轉錄',
      description: '語音訊息轉錄設定',
      fields: [
        { name: '/voice status', value: '查看轉錄狀態' },
        { name: '/voice set', value: '設定 Gemini API Key' },
      ],
    },
    permission: {
      title: '🔐 /permission - 權限管理',
      description: '管理用戶權限',
      fields: [
        { name: '/permission check', value: '檢查權限' },
        { name: '/permission grant', value: '授予權限' },
        { name: '/permission revoke', value: '撤銷權限' },
      ],
    },
  };

  const cmd = commands[commandName];
  if (!cmd) {
    return new EmbedBuilder()
      .setTitle('❌ 未知指令')
      .setDescription(`沒有找到指令: ${commandName}`)
      .setColor(0xF87171);
  }

  return new EmbedBuilder()
    .setTitle(cmd.title)
    .setDescription(cmd.description)
    .setColor(0x8B5CF6)
    .addFields(cmd.fields);
}

export { command, execute };
export default { command, execute };
