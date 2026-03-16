/**
 * Worktree Commands - Git Worktree 管理指令
 * @description 提供 /worktree 指令，包含 create, list, delete, pr 子指令
 */

import path from 'path';
import {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} from 'discord.js';
import { GitWorktreeService, GitWorktreeError } from '../services/GitWorktreeService.js';
import { DefaultButtons } from '../builders/ActionRowBuilder.js';
import { Colors } from '../builders/EmbedBuilder.js';

// ============== 服務實例 ==============

// 建立 GitWorktreeService 實例
const getWorktreeService = () => {
  return new GitWorktreeService({
    repoPath: process.env.GIT_REPO_PATH,
    githubToken: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
  });
};

// ============== Command Builder ==============

/**
 * 構建 /worktree 主指令
 */
export const worktreeCommand = new SlashCommandBuilder()
  .setName('worktree')
  .setDescription('Git Worktree 管理指令')
  .setDMPermission(true)
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('list')
      .setDescription('列出所有 Worktree')
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('create')
      .setDescription('建立新的 Worktree')
      .addStringOption((option) =>
        option
          .setName('branch')
          .setDescription('分支名稱')
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('name')
          .setDescription('Worktree 目錄名稱（可選）')
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option
          .setName('create-branch')
          .setDescription('是否創建新分支')
          .setRequired(false)
      )
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('delete')
      .setDescription('刪除 Worktree')
      .addStringOption((option) =>
        option
          .setName('path')
          .setDescription('Worktree 路徑')
          .setRequired(true)
      )
      .addBooleanOption((option) =>
        option
          .setName('force')
          .setDescription('強制刪除（忽略未提交的更改）')
          .setRequired(false)
      )
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('pr')
      .setDescription('建立 Pull Request')
      .addStringOption((option) =>
        option
          .setName('branch')
          .setDescription('來源分支名稱')
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('title')
          .setDescription('PR 標題')
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('description')
          .setDescription('PR 描述')
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName('base')
          .setDescription('目標分支')
          .setRequired(false)
      )
  );

// ============== 命令處理 ==============

/**
 * 處理 /worktree list 命令
 */
async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const service = getWorktreeService();

  try {
    await interaction.deferReply();
    
    const worktrees = await service.listWorktrees();
    const embed = GitWorktreeService.buildWorktreeListEmbed(worktrees);
    const buttons = GitWorktreeService.buildWorktreeListButtons();

    await interaction.editReply({
      embeds: [embed],
      components: [buttons],
    });
  } catch (error) {
    const errorEmbed = new EmbedBuilder()
      .setColor(Colors.ERROR)
      .setTitle('❌ 錯誤')
      .setDescription(error instanceof Error ? error.message : '未知錯誤')
      .setTimestamp();

    if (interaction.deferred) {
      await interaction.editReply({ embeds: [errorEmbed], components: [] });
    } else {
      await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
    }
  }
}

/**
 * 處理 /worktree create 命令
 */
async function handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const branch = interaction.options.getString('branch', true);
  const name = interaction.options.getString('name') || undefined;
  const createBranch = interaction.options.getBoolean('create-branch') || false;

  const service = getWorktreeService();

  try {
    await interaction.deferReply();

    const worktree = await service.createWorktree({
      branch,
      name,
      createBranch,
    });

    const embed = GitWorktreeService.buildWorktreeDetailEmbed(worktree);
    const buttons = GitWorktreeService.buildWorktreeButtons(worktree.path);

    const successEmbed = new EmbedBuilder()
      .setColor(Colors.SUCCESS)
      .setTitle('✅ Worktree 已建立')
      .setDescription(`已成功建立 Worktree: **${worktree.branch}**`)
      .addFields(
        { name: '📂 路徑', value: `\`${worktree.path}\``, inline: false },
        { name: '🌿 分支', value: worktree.branch, inline: true },
        { name: '🔖 HEAD', value: `\`${worktree.head}\``, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({
      embeds: [successEmbed, embed],
      components: [buttons],
    });
  } catch (error) {
    const errorMessage = error instanceof GitWorktreeError 
      ? error.message 
      : (error instanceof Error ? error.message : '未知錯誤');

    const errorEmbed = new EmbedBuilder()
      .setColor(Colors.ERROR)
      .setTitle('❌ 建立失敗')
      .setDescription(errorMessage)
      .setTimestamp();

    if (interaction.deferred) {
      await interaction.editReply({ embeds: [errorEmbed], components: [] });
    } else {
      await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
    }
  }
}

/**
 * 處理 /worktree delete 命令
 */
async function handleDelete(interaction: ChatInputCommandInteraction): Promise<void> {
  const path = interaction.options.getString('path', true);
  const force = interaction.options.getBoolean('force') || false;

  const service = getWorktreeService();

  // 確認刪除
  const confirmEmbed = new EmbedBuilder()
    .setColor(Colors.WARNING)
    .setTitle('⚠️ 確認刪除')
    .setDescription(`確定要刪除 Worktree \`${path}\` 嗎？`)
    .addFields(
      { name: '🔒 強制刪除', value: force ? '是（忽略未提交的更改）' : '否', inline: true }
    )
    .setTimestamp();

  const confirmRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      DefaultButtons.confirm('worktree:delete:confirm', '確認刪除'),
      DefaultButtons.cancel('worktree:delete:cancel')
    );

  await interaction.reply({
    embeds: [confirmEmbed],
    components: [confirmRow],
    flags: [MessageFlags.Ephemeral],
  });

  // 等待用戶確認
  try {
    const response = await interaction.channel?.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 30000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    if (!response) {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(Colors.WARNING)
          .setTitle('⏰ 逾時')
          .setDescription('操作已取消')
          .setTimestamp()
        ],
        components: [],
      });
      return;
    }

    if (response.customId === 'worktree:delete:cancel') {
      await response.update({
        embeds: [new EmbedBuilder()
          .setColor(Colors.INFO)
          .setTitle('✅ 已取消')
          .setDescription('刪除操作已取消')
          .setTimestamp()
        ],
        components: [],
      });
      return;
    }

    // 執行刪除
    await service.deleteWorktree(path, force);

    await response.update({
      embeds: [new EmbedBuilder()
        .setColor(Colors.SUCCESS)
        .setTitle('✅ 刪除成功')
        .setDescription(`已成功刪除 Worktree \`${path}\``)
        .setTimestamp()
      ],
      components: [],
    });
  } catch (error) {
    const errorMessage = error instanceof GitWorktreeError 
      ? error.message 
      : (error instanceof Error ? error.message : '未知錯誤');

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(Colors.ERROR)
        .setTitle('❌ 刪除失敗')
        .setDescription(errorMessage)
        .setTimestamp()
      ],
      components: [],
    });
  }
}

/**
 * 處理 /worktree pr 命令
 */
async function handlePR(interaction: ChatInputCommandInteraction): Promise<void> {
  const branch = interaction.options.getString('branch', true);
  const title = interaction.options.getString('title', true);
  const description = interaction.options.getString('description') || undefined;
  const base = interaction.options.getString('base') || 'main';

  const service = getWorktreeService();

  // 檢查 GitHub 整合
  if (!service.isGitHubAvailable()) {
    const errorEmbed = new EmbedBuilder()
      .setColor(Colors.ERROR)
      .setTitle('❌ GitHub 未配置')
      .setDescription('無法建立 PR，請配置 GITHUB_TOKEN、GITHUB_OWNER 和 GITHUB_REPO 環境變數')
      .addFields({
        name: '📝 替代方案',
        value: '你可以手動在 GitHub 上建立 PR',
        inline: false,
      })
      .setTimestamp();

    await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
    return;
  }

  try {
    await interaction.deferReply();

    const pr = await service.createPullRequest({
      title,
      body: description,
      head: branch,
      base,
    });

    const openButton = new ButtonBuilder()
      .setURL(pr.url)
      .setLabel('🔗 在 GitHub 開啟')
      .setStyle(ButtonStyle.Link);

    const actionRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(openButton);

    const successEmbed = new EmbedBuilder()
      .setColor(Colors.SUCCESS)
      .setTitle('🚀 Pull Request 已建立')
      .setDescription(`已成功建立 PR: **${title}**`)
      .addFields(
        { name: '🔀 來源分支', value: pr.head, inline: true },
        { name: '🎯 目標分支', value: pr.base, inline: true },
        { name: '🔗 PR 連結', value: `[#${pr.number}](${pr.url})`, inline: false }
      )
      .setTimestamp();

    await interaction.editReply({
      embeds: [successEmbed],
      components: [actionRow],
    });
  } catch (error) {
    const errorMessage = error instanceof GitWorktreeError 
      ? error.message 
      : (error instanceof Error ? error.message : '未知錯誤');

    const errorEmbed = new EmbedBuilder()
      .setColor(Colors.ERROR)
      .setTitle('❌ 建立 PR 失敗')
      .setDescription(errorMessage)
      .setTimestamp();

    if (interaction.deferred) {
      await interaction.editReply({ embeds: [errorEmbed], components: [] });
    } else {
      await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
    }
  }
}

// ============== 命令執行 ==============

/**
 * 執行 /worktree 命令
 */
export async function executeWorktreeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'list':
      await handleList(interaction);
      break;
    case 'create':
      await handleCreate(interaction);
      break;
    case 'delete':
      await handleDelete(interaction);
      break;
    case 'pr':
      await handlePR(interaction);
      break;
    default:
      await interaction.reply({
        content: '未知的子指令',
        flags: [MessageFlags.Ephemeral],
      });
  }
}

// ============== 按鈕處理 ==============

/**
 * 處理 Worktree 按鈕點擊
 */
export async function handleWorktreeButton(interaction: any): Promise<void> {
  const [action, subAction, ...params] = interaction.customId.split(':');
  
  if (action !== 'worktree') {
    return;
  }

  const service = getWorktreeService();

  // 刷新列表
  if (subAction === 'list' && params[0] === 'refresh') {
    await handleList(interaction);
    return;
  }

  // 開始創建
  if (subAction === 'create' && params[0] === 'start') {
    const helpEmbed = new EmbedBuilder()
      .setColor(Colors.INFO)
      .setTitle('➕ 新建 Worktree')
      .setDescription('使用以下指令建立新的 Worktree：')
      .addFields(
        {
          name: '📝 指令格式',
          value: '```\n/worktree create <branch> [--name <name>] [--create-branch]\n```',
          inline: false,
        },
        {
          name: '📌 範例',
          value: '```\n/worktree create feature/my-feature\n/worktree create bugfix/fix-issue --name fix123\n/worktree create new-branch --create-branch\n```',
          inline: false,
        }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [helpEmbed], flags: [MessageFlags.Ephemeral] });
    return;
  }

  // 刪除 Worktree
  if (subAction === 'delete') {
    const worktreePath = params.join(':');
    
    try {
      await service.deleteWorktree(worktreePath, false);
      
      await interaction.update({
        embeds: [new EmbedBuilder()
          .setColor(Colors.SUCCESS)
          .setTitle('✅ 刪除成功')
          .setDescription(`已成功刪除 Worktree`)
          .setTimestamp()
        ],
        components: [],
      });
    } catch (error) {
      // 嘗試強制刪除
      try {
        await service.deleteWorktree(worktreePath, true);
        
        await interaction.update({
          embeds: [new EmbedBuilder()
            .setColor(Colors.SUCCESS)
            .setTitle('✅ 刪除成功')
            .setDescription(`已強制刪除 Worktree`)
            .setTimestamp()
          ],
          components: [],
        });
      } catch (forceError) {
        await interaction.update({
          embeds: [new EmbedBuilder()
            .setColor(Colors.ERROR)
            .setTitle('❌ 刪除失敗')
            .setDescription(error instanceof Error ? error.message : '未知錯誤')
            .setTimestamp()
          ],
          components: [],
        });
      }
    }
    return;
  }

  // 建立 PR
  if (subAction === 'pr') {
    const worktreePath = params.join(':');
    
    // 從路徑提取分支名稱
    const branchName = path.basename(worktreePath).replace(/^.*-worktree-/, '');
    
    // 顯示 PR 建立表單說明
    const prHelpEmbed = new EmbedBuilder()
      .setColor(Colors.INFO)
      .setTitle('🚀 建立 Pull Request')
      .setDescription(`為分支 **${branchName}** 建立 PR`)
      .addFields(
        {
          name: '📝 指令格式',
          value: '```\n/worktree pr <branch> <title> [--description <desc>] [--base <base>]\n```',
          inline: false,
        },
        {
          name: '📌 範例',
          value: `\`\`\`\n/worktree pr ${branchName} "Add new feature"\n/worktree pr ${branchName} "Fix bug" --description "This fixes issue #123" --base develop\n\`\`\``,
          inline: false,
        }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [prHelpEmbed], flags: [MessageFlags.Ephemeral] });
    return;
  }
}

// ============== 導出 ==============

export default {
  worktreeCommand,
  executeWorktreeCommand,
  handleWorktreeButton,
};
