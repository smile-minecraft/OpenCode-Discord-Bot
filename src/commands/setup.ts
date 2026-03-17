/**
 * Setup Command
 * @description 频道项目绑定管理
 * 
 * 简化后的指令：
 * - /setup bind [project_path] - 绑定项目路径（需要 Administrator 权限）
 * - /setup show - 显示当前配置（无权限限制）
 * - /setup unbind - 解除绑定（需要 Administrator 权限）
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';

import { SQLiteDatabase } from '../database/SQLiteDatabase.js';
import { Colors } from '../builders/EmbedBuilder.js';
import logger from '../utils/logger.js';

// ============== 指令定義 ==============

const command = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('管理頻道與項目的綁定')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('bind')
      .setDescription('將當前頻道綁定到指定項目路徑')
      .addStringOption((option) =>
        option
          .setName('project_path')
          .setDescription('項目目錄路徑 (如: /Users/smile/projects/my-app)')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('show')
      .setDescription('顯示當前頻道的項目綁定配置')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('unbind')
      .setDescription('解除當前頻道的項目綁定')
  );

// ============== 執行函數 ==============

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'bind':
      await handleBind(interaction);
      break;
    case 'show':
      await handleShow(interaction);
      break;
    case 'unbind':
      await handleUnbind(interaction);
      break;
    default:
      await interaction.reply({
        content: '未知的子指令',
        flags: ['Ephemeral'],
      });
  }
}

// ============== 處理函數 ==============

/**
 * 處理 bind 子命令 - 綁定項目路徑
 */
async function handleBind(interaction: ChatInputCommandInteraction): Promise<void> {
  // 權限檢查：需要管理員權限
  if (!interaction.memberPermissions?.has('Administrator')) {
    await interaction.reply({
      content: '❌ 您需要「管理員」權限才能使用此指令',
      ephemeral: true,
    });
    return;
  }

  const projectPath = interaction.options.getString('project_path', true);
  const channelId = interaction.channelId;
  const userId = interaction.user.id;

  if (!channelId) {
    await interaction.reply({
      content: '❌ 此命令只能在伺服器頻道中使用',
      ephemeral: true,
    });
    return;
  }

  // 簡單驗證路徑格式
  if (projectPath.length < 2) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('❌ 路徑無效')
          .setDescription('請輸入有效的項目路徑'),
      ],
      ephemeral: true,
    });
    return;
  }

  try {
    const db = SQLiteDatabase.getInstance();
    
    // 檢查是否已有綁定
    const existingBinding = db.getChannelBinding(channelId);
    
    if (existingBinding) {
      // 更新現有綁定
      db.updateChannelBinding(channelId, projectPath, userId);
      logger.info(`[Setup] 更新頻道 ${channelId} 的項目綁定: ${projectPath}`);
    } else {
      // 創建新綁定
      db.saveChannelBinding(channelId, projectPath, userId);
      logger.info(`[Setup] 新增頻道 ${channelId} 的項目綁定: ${projectPath}`);
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.SUCCESS)
      .setTitle('✅ 項目綁定成功')
      .setDescription(`頻道已綁定到項目路徑: \`${projectPath}\``)
      .addFields(
        {
          name: '📁 項目路徑',
          value: `\`${projectPath}\``,
          inline: false,
        },
        {
          name: '💡 提示',
          value: '使用 `/session start` 在此頻道開始新的對話',
          inline: false,
        }
      )
      .setFooter({ text: `綁定者: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  } catch (error) {
    logger.error('[Setup] 綁定項目失敗:', error);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('❌ 綁定失敗')
          .setDescription(`無法綁定項目: ${error instanceof Error ? error.message : '未知錯誤'}`),
      ],
      ephemeral: true,
    });
  }
}

/**
 * 處理 show 子命令 - 顯示當前配置
 */
async function handleShow(interaction: ChatInputCommandInteraction): Promise<void> {
  const channelId = interaction.channelId;

  if (!channelId) {
    await interaction.reply({
      content: '❌ 此命令只能在伺服器頻道中使用',
      ephemeral: true,
    });
    return;
  }

  try {
    const db = SQLiteDatabase.getInstance();
    const binding = db.getChannelBinding(channelId);

    if (!binding) {
      const embed = new EmbedBuilder()
        .setColor(Colors.WARNING)
        .setTitle('📋 頻道配置')
        .setDescription('此頻道尚未綁定任何項目')
        .addFields({
          name: '💡 提示',
          value: '管理員可使用 `/setup bind <project_path>` 綁定項目',
          inline: false,
        })
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
      return;
    }

    // 獲取綁定的項目路徑
    const projectPath = binding.project_path || '未知';
    const boundAt = binding.bound_at ? new Date(binding.bound_at).toLocaleString() : '未知';
    const boundBy = binding.bound_by || '未知';

    const embed = new EmbedBuilder()
      .setColor(Colors.PRIMARY)
      .setTitle('📋 頻道配置')
      .addFields(
        {
          name: '📁 項目路徑',
          value: `\`${projectPath}\``,
          inline: false,
        },
        {
          name: '📅 綁定時間',
          value: boundAt,
          inline: true,
        },
        {
          name: '👤 綁定者',
          value: boundBy,
          inline: true,
        }
      )
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  } catch (error) {
    logger.error('[Setup] 獲取配置失敗:', error);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('❌ 獲取配置失敗')
          .setDescription(`發生錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`),
      ],
      ephemeral: true,
    });
  }
}

/**
 * 處理 unbind 子命令 - 解除綁定
 */
async function handleUnbind(interaction: ChatInputCommandInteraction): Promise<void> {
  // 權限檢查：需要管理員權限
  if (!interaction.memberPermissions?.has('Administrator')) {
    await interaction.reply({
      content: '❌ 您需要「管理員」權限才能使用此指令',
      ephemeral: true,
    });
    return;
  }

  const channelId = interaction.channelId;

  if (!channelId) {
    await interaction.reply({
      content: '❌ 此命令只能在伺服器頻道中使用',
      ephemeral: true,
    });
    return;
  }

  try {
    const db = SQLiteDatabase.getInstance();
    const binding = db.getChannelBinding(channelId);

    if (!binding) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.WARNING)
            .setTitle('⚠️ 無法解除綁定')
            .setDescription('此頻道沒有綁定任何項目'),
        ],
        ephemeral: true,
      });
      return;
    }

    // 刪除綁定
    db.deleteChannelBinding(channelId);
    logger.info(`[Setup] 解除頻道 ${channelId} 的項目綁定`);

    const embed = new EmbedBuilder()
      .setColor(Colors.SUCCESS)
      .setTitle('✅ 解除綁定成功')
      .setDescription('此頻道的項目綁定已被移除')
      .addFields({
        name: '⚠️ 注意',
        value: '正在運行的 Session 不會受到影響',
        inline: false,
      })
      .setFooter({ text: `操作者: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  } catch (error) {
    logger.error('[Setup] 解除綁定失敗:', error);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('❌ 解除綁定失敗')
          .setDescription(`發生錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`),
      ],
      ephemeral: true,
    });
  }
}

// ============== 導出 ==============

export { command, execute };
export default { command, execute };
 