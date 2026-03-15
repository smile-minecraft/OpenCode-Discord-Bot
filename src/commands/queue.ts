/**
 * Queue Commands - 隊列管理指令
 * @description 提供隊列管理的 Slash Commands
 */

import {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
} from 'discord.js';

import { getQueueManager, QueueManager, type QueueSettings } from '../services/QueueManager.js';
import { log } from '../utils/logger.js';

// ==================== Command Builder ====================

/**
 * 建立 /queue 指令
 */
export const queueCommand = new SlashCommandBuilder()
  .setName('queue')
  .setDescription('管理任務隊列')
  .setDMPermission(false)
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('list')
      .setDescription('顯示隊列中的任務')
      .addIntegerOption((option) =>
        option
          .setName('page')
          .setDescription('頁碼')
          .setMinValue(1)
          .setRequired(false)
      )
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('clear')
      .setDescription('清空隊列')
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('pause')
      .setDescription('暫停隊列')
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('resume')
      .setDescription('恢復隊列')
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('settings')
      .setDescription('設定隊列選項')
      .addStringOption((option) =>
        option
          .setName('continue_on_failure')
          .setDescription('失敗後是否繼續執行下一個任務')
          .addChoices(
            { name: '啟用', value: 'true' },
            { name: '停用', value: 'false' }
          )
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName('fresh_context')
          .setDescription('是否使用新的上下文')
          .addChoices(
            { name: '啟用', value: 'true' },
            { name: '停用', value: 'false' }
          )
          .setRequired(false)
      )
      .addIntegerOption((option) =>
        option
          .setName('task_timeout')
          .setDescription('任務超時時間（分鐘）')
          .setMinValue(1)
          .setMaxValue(60)
          .setRequired(false)
      )
      .addIntegerOption((option) =>
        option
          .setName('max_retries')
          .setDescription('最大重試次數')
          .setMinValue(0)
          .setMaxValue(10)
          .setRequired(false)
      )
  );

// ==================== Command Handler ====================

/**
 * 處理 /queue 指令
 */
export async function handleQueueCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const queueManager = getQueueManager();

  // 記錄命令使用
  log.command(`/queue ${subcommand}`, interaction.user.id, interaction.guildId ?? undefined);

  switch (subcommand) {
    case 'list':
      await handleQueueList(interaction, queueManager);
      break;
    case 'clear':
      await handleQueueClear(interaction, queueManager);
      break;
    case 'pause':
      await handleQueuePause(interaction, queueManager);
      break;
    case 'resume':
      await handleQueueResume(interaction, queueManager);
      break;
    case 'settings':
      await handleQueueSettings(interaction, queueManager);
      break;
    default:
      await interaction.reply({
        content: '未知的子指令',
        ephemeral: true,
      });
  }
}

// ==================== Subcommand Handlers ====================

/**
 * 處理 /queue list
 */
async function handleQueueList(
  interaction: ChatInputCommandInteraction,
  queueManager: QueueManager
): Promise<void> {
  const page = interaction.options.getInteger('page') || 1;
  const itemsPerPage = 10;

  const state = queueManager.getState();
  const allTasks = queueManager.getAllTasks();
  const pendingTasks = allTasks.filter((t) => t.status === 'pending');

  // 建立 Embed
  const embed = new EmbedBuilder()
    .setTitle('📋 任務隊列')
    .setColor(getQueueStatusColor(state))
    .setTimestamp();

  // 隊列狀態
  const statusText = [
    `**狀態**: ${state.isPaused ? '⏸️ 已暫停' : '▶️ 運行中'}`,
    `**待處理**: ${state.pendingCount} 個任務`,
    `**已完成**: ${state.completedCount} 個`,
    `**失敗**: ${state.failedCount} 個`,
  ];

  if (state.currentTask) {
    statusText.push(
      `\n**當前任務**: \`${state.currentTask.id}\``,
      `**類型**: ${state.currentTask.type}`,
      `**狀態**: ${getTaskStatusEmoji(state.currentTask.status)} ${state.currentTask.status}`
    );
  }

  embed.setDescription(statusText.join('\n'));

  // 設定 Embed 資訊
  embed.addFields({
    name: '📊 隊列統計',
    value: [
      `總任務數: ${allTasks.length}`,
      `待處理: ${pendingTasks.length}`,
      `運行中: ${allTasks.filter((t) => t.status === 'running').length}`,
      `已完成: ${state.completedCount}`,
      `失敗: ${state.failedCount}`,
    ].join(' | '),
    inline: false,
  });

  // 分頁顯示待處理任務
  if (pendingTasks.length > 0) {
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageTasks = pendingTasks.slice(startIndex, endIndex);

    const taskList = pageTasks
      .map((task, index) => {
        const taskNumber = startIndex + index + 1;
        const promptPreview = task.data.prompt
          ? task.data.prompt.substring(0, 50) + (task.data.prompt.length > 50 ? '...' : '')
          : '無提示詞';
        return `**${taskNumber}.** \`${task.id}\` ${getTaskStatusEmoji(task.status)}\n   📝 ${promptPreview}`;
      })
      .join('\n');

    embed.addFields({
      name: `📝 待處理任務 (${pendingTasks.length} 個)`,
      value: taskList || '無待處理任務',
      inline: false,
    });

    // 分頁資訊
    const totalPages = Math.ceil(pendingTasks.length / itemsPerPage);
    if (totalPages > 1) {
      embed.setFooter({ text: `第 ${page}/${totalPages} 頁` });
    }
  } else {
    embed.addFields({
      name: '📝 待處理任務',
      value: '✅ 隊列為空',
      inline: false,
    });
  }

  // 建立操作按鈕
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('queue_refresh')
      .setLabel('🔄 重新整理')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('queue_clear')
      .setLabel('🗑️ 清空')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(pendingTasks.length === 0),
    state.isPaused
      ? new ButtonBuilder()
          .setCustomId('queue_resume')
          .setLabel('▶️ 恢復')
          .setStyle(ButtonStyle.Success)
      : new ButtonBuilder()
          .setCustomId('queue_pause')
          .setLabel('⏸️ 暫停')
          .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
  });
}

/**
 * 處理 /queue clear
 */
async function handleQueueClear(
  interaction: ChatInputCommandInteraction,
  queueManager: QueueManager
): Promise<void> {
  const state = queueManager.getState();

  if (state.pendingCount === 0) {
    await interaction.reply({
      content: '✅ 隊列已經是空的',
      ephemeral: true,
    });
    return;
  }

  const removedCount = queueManager.clearQueue();

  const embed = new EmbedBuilder()
    .setTitle('🗑️ 隊列已清空')
    .setColor(0x00ff00)
    .setDescription(`已移除 **${removedCount}** 個待處理任務`)
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
  });
}

/**
 * 處理 /queue pause
 */
async function handleQueuePause(
  interaction: ChatInputCommandInteraction,
  queueManager: QueueManager
): Promise<void> {
  if (queueManager.isPaused) {
    await interaction.reply({
      content: '⚠️ 隊列已經是暫停狀態',
      ephemeral: true,
    });
    return;
  }

  queueManager.pause();

  const embed = new EmbedBuilder()
    .setTitle('⏸️ 隊列已暫停')
    .setColor(0xffaa00)
    .setDescription('新的任務將不會自動執行')
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
  });
}

/**
 * 處理 /queue resume
 */
async function handleQueueResume(
  interaction: ChatInputCommandInteraction,
  queueManager: QueueManager
): Promise<void> {
  if (!queueManager.isPaused) {
    await interaction.reply({
      content: '⚠️ 隊列沒有暫停',
      ephemeral: true,
    });
    return;
  }

  queueManager.resume();

  const embed = new EmbedBuilder()
    .setTitle('▶️ 隊列已恢復')
    .setColor(0x00ff00)
    .setDescription('正在繼續執行任務')
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
  });
}

/**
 * 處理 /queue settings
 */
async function handleQueueSettings(
  interaction: ChatInputCommandInteraction,
  queueManager: QueueManager
): Promise<void> {
  const continueOnFailure = interaction.options.getString('continue_on_failure');
  const freshContext = interaction.options.getString('fresh_context');
  const taskTimeout = interaction.options.getInteger('task_timeout');
  const maxRetries = interaction.options.getInteger('max_retries');

  // 如果沒有提供任何選項，顯示當前設定
  if (!continueOnFailure && !freshContext && !taskTimeout && !maxRetries) {
    const settings = queueManager.getSettings();
    const embed = buildSettingsEmbed(settings);
    
    await interaction.reply({
      embeds: [embed],
    });
    return;
  }

  // 更新設定
  const newSettings: Partial<QueueSettings> = {};
  const changes: string[] = [];

  if (continueOnFailure !== null) {
    newSettings.continueOnFailure = continueOnFailure === 'true';
    changes.push(`失敗後繼續: ${continueOnFailure === 'true' ? '啟用' : '停用'}`);
  }

  if (freshContext !== null) {
    newSettings.freshContext = freshContext === 'true';
    changes.push(`新上下文: ${freshContext === 'true' ? '啟用' : '停用'}`);
  }

  if (taskTimeout !== null) {
    newSettings.taskTimeout = taskTimeout * 60 * 1000; // 轉換為毫秒
    changes.push(`超時時間: ${taskTimeout} 分鐘`);
  }

  if (maxRetries !== null) {
    newSettings.maxRetries = maxRetries;
    changes.push(`最大重試: ${maxRetries} 次`);
  }

  queueManager.updateSettings(newSettings);

  const embed = new EmbedBuilder()
    .setTitle('⚙️ 設定已更新')
    .setColor(0x00ff00)
    .setDescription(changes.join('\n'))
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
  });
}

// ==================== Helper Functions ====================

/**
 * 根據隊列狀態取得顏色
 */
function getQueueStatusColor(state: { isPaused: boolean; isProcessing: boolean }): number {
  if (state.isPaused) return 0xffaa00; // 橙色
  if (state.isProcessing) return 0x00aaff; // 藍色
  return 0x00ff00; // 綠色
}

/**
 * 取得任務狀態 Emoji
 */
function getTaskStatusEmoji(status: string): string {
  switch (status) {
    case 'pending':
      return '⏳';
    case 'running':
      return '🔄';
    case 'completed':
      return '✅';
    case 'failed':
      return '❌';
    case 'cancelled':
      return '🚫';
    default:
      return '❓';
  }
}

/**
 * 建立設定 Embed
 */
function buildSettingsEmbed(settings: QueueSettings): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('⚙️ 隊列設定')
    .setColor(0x00aaff)
    .setTimestamp();

  embed.addFields(
    {
      name: '失敗處理',
      value: [
        `**失敗後繼續**: ${settings.continueOnFailure ? '✅ 啟用' : '❌ 停用'}`,
        `**最大重試次數**: ${settings.maxRetries} 次`,
      ].join('\n'),
      inline: true,
    },
    {
      name: '執行選項',
      value: [
        `**新上下文**: ${settings.freshContext ? '✅ 啟用' : '❌ 停用'}`,
        `**任務超時**: ${Math.floor(settings.taskTimeout / 60000)} 分鐘`,
      ].join('\n'),
      inline: true,
    }
  );

  embed.setFooter({ text: '使用 /queue settings <選項> 來修改設定' });

  return embed;
}

// ==================== Queue Status Display ====================

/**
 * 建立隊列狀態顯示訊息
 * @param queueManager 隊列管理器
 * @returns 狀態訊息
 */
export function buildQueueStatusMessage(queueManager: QueueManager): string {
  const state = queueManager.getState();
  const settings = queueManager.getSettings();

  let message = `**📥 排隊指示**\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `**狀態**: ${state.isPaused ? '⏸️ 已暫停' : '▶️ 運行中'}\n`;
  message += `**待處理**: ${state.pendingCount} 個任務\n`;
  message += `**已完成**: ${state.completedCount} 個\n`;

  if (state.currentTask) {
    message += `\n**當前任務**: ${state.currentTask.type}\n`;
    if (state.currentTask.data.prompt) {
      const preview = state.currentTask.data.prompt.substring(0, 100);
      message += `> ${preview}${state.currentTask.data.prompt.length > 100 ? '...' : ''}\n`;
    }
  }

  message += `\n⚙️ **設定**: `;
  message += settings.continueOnFailure ? '繼續執行' : '失敗停止';
  message += ` | 重試 ${settings.maxRetries} 次`;

  return message;
}

/**
 * 建立簡短的排隊進度
 * @param queueManager 隊列管理器
 * @returns 進度訊息
 */
export function buildQueueProgress(queueManager: QueueManager): string {
  const state = queueManager.getState();
  
  if (state.pendingCount === 0 && !state.currentTask) {
    return '';
  }

  const progress = [];
  
  if (state.currentTask) {
    progress.push('🔄 執行中');
  }
  
  if (state.pendingCount > 0) {
    progress.push(`⏳ 待處理 ${state.pendingCount}`);
  }

  return progress.join(' | ');
}

export default {
  command: queueCommand,
  handle: handleQueueCommand,
  buildQueueStatusMessage,
  buildQueueProgress,
};
