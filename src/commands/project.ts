/**
 * Project Commands - 專案管理指令
 * @description 處理 /project 指令及其子指令
 */

import {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ModalActionRowComponentBuilder,
  MessageFlags,
  ChannelType,
} from 'discord.js';
import { ProjectManager } from '../services/ProjectManager.js';
import { Colors } from '../builders/EmbedBuilder.js';

// ============== 指令配置 ==============

/** 指令名稱 */
export const COMMAND_NAME = 'project';

/** 指令描述 */
export const COMMAND_DESCRIPTION = '管理 OpenCode 專案';

/**
 * 創建專案指令
 */
export function createProjectCommand(): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription(COMMAND_DESCRIPTION)
    .addSubcommand(createProjectAddSubcommand())
    .addSubcommand(createProjectListSubcommand())
    .addSubcommand(createProjectUseSubcommand())
    .addSubcommand(createProjectRemoveSubcommand()) as SlashCommandBuilder;
}

/**
 * 創建 add 子指令
 */
function createProjectAddSubcommand(): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName('add')
    .setDescription('新增一個 OpenCode 專案')
    .addStringOption((option) =>
      option
        .setName('name')
        .setDescription('專案名稱')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('path')
        .setDescription('專案路徑')
        .setRequired(false)
    );
}

/**
 * 創建 list 子指令
 */
function createProjectListSubcommand(): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName('list')
    .setDescription('列出所有已添加的專案');
}

/**
 * 創建 use 子指令
 */
function createProjectUseSubcommand(): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName('use')
    .setDescription('綁定專案到當前頻道')
    .addStringOption((option) =>
      option
        .setName('project')
        .setDescription('選擇要綁定的專案')
        .setRequired(true)
        .setAutocomplete(true)
    );
}

/**
 * 創建 remove 子指令
 */
function createProjectRemoveSubcommand(): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName('remove')
    .setDescription('移除一個專案')
    .addStringOption((option) =>
      option
        .setName('project')
        .setDescription('選擇要移除的專案')
        .setRequired(true)
        .setAutocomplete(true)
    );
}

// ============== Modal Custom IDs ==============

export const ModalIds = {
  /** 新增專案表單 */
  ADD_PROJECT: 'project:modal:add',
} as const;

// ============== 指令處理器 ==============

/**
 * 專案指令處理器
 */
export class ProjectCommandHandler {
  private projectManager: ProjectManager;

  constructor(projectManager: ProjectManager) {
    this.projectManager = projectManager;
  }

  /**
   * 處理指令
   */
  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'add':
        await this.handleAdd(interaction);
        break;
      case 'list':
        await this.handleList(interaction);
        break;
      case 'use':
        await this.handleUse(interaction);
        break;
      case 'remove':
        await this.handleRemove(interaction);
        break;
      default:
        await interaction.reply({
          content: '❌ 未知的子指令',
          flags: [MessageFlags.Ephemeral],
        });
    }
  }

  /**
   * 處理 add 子指令
   */
  async handleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
    // 檢查是否有提供參數
    const name = interaction.options.getString('name');
    const path = interaction.options.getString('path');

    if (name && path) {
      // 直接創建專案
      await this.createProject(interaction, name, path);
    } else {
      // 顯示 Modal 表單
      await this.showAddProjectModal(interaction);
    }
  }

  /**
   * 顯示新增專案 Modal
   */
  async showAddProjectModal(interaction: ChatInputCommandInteraction): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId(ModalIds.ADD_PROJECT)
      .setTitle('建立新專案')
      .addComponents(
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('project_name')
            .setLabel('專案名稱')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('例如: My Awesome Project')
            .setMinLength(2)
            .setMaxLength(50)
            .setRequired(true)
        )
      )
      .addComponents(
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('project_path')
            .setLabel('專案路徑')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('例如: /Users/name/projects/my-project')
            .setMinLength(1)
            .setMaxLength(200)
            .setRequired(true)
        )
      )
      .addComponents(
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('project_alias')
            .setLabel('專案別名 (可選)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('例如: myproject')
            .setMinLength(2)
            .setMaxLength(20)
            .setRequired(false)
        )
      );

    await interaction.showModal(modal);
  }

  /**
   * 處理 Modal 提交
   */
  async handleModalSubmit(
    interaction: import('discord.js').ModalSubmitInteraction
  ): Promise<void> {
    const modalId = interaction.customId;

    if (modalId === ModalIds.ADD_PROJECT) {
      await this.handleAddProjectModal(interaction);
    }
  }

  /**
   * 處理新增專案表單提交
   */
  private async handleAddProjectModal(
    interaction: import('discord.js').ModalSubmitInteraction
  ): Promise<void> {
    const name = interaction.fields.getTextInputValue('project_name');
    const path = interaction.fields.getTextInputValue('project_path');
    const alias = interaction.fields.getTextInputValue('project_alias') || undefined;

    await this.createProject(interaction, name, path, alias);
  }

  /**
   * 創建專案
   */
  private async createProject(
    interaction: ChatInputCommandInteraction | import('discord.js').ModalSubmitInteraction,
    name: string,
    projectPath: string,
    alias?: string
  ): Promise<void> {
    // 檢查 interaction 是否可以回覆
    if (!interaction.isRepliable()) {
      return;
    }

    // 異步操作需要先 defer
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
      const project = await this.projectManager.createProject({
        name,
        path: projectPath,
        alias,
      });

      const embed = new EmbedBuilder()
        .setColor(Colors.SUCCESS)
        .setTitle('✅ 專案已新增')
        .setDescription(`專案 **${project.name}** 已成功添加`)
        .addFields(
          { name: '📁 路徑', value: `\`${project.path}\``, inline: false },
          { name: '🆔 專案 ID', value: `\`${project.projectId}\``, inline: true }
        )
        .setTimestamp();

      if (alias) {
        embed.addFields({
          name: '🔖 別名',
          value: `\`${alias}\``,
          inline: true,
        });
      }

      await interaction.editReply({
        embeds: [embed],
      });
    } catch (error) {
      const errorMessage = (error as Error).message;

      const embed = new EmbedBuilder()
        .setColor(Colors.ERROR)
        .setTitle('❌ 新增專案失敗')
        .setDescription(errorMessage)
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
      });
    }
  }

  /**
   * 處理 list 子指令
   */
  async handleList(interaction: ChatInputCommandInteraction): Promise<void> {
    const projects = this.projectManager.getAllProjects();

    if (projects.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(Colors.WARNING)
        .setTitle('📋 專案列表')
        .setDescription('目前沒有任何專案')
        .addFields({
          name: '💡 提示',
          value: '使用 `/project add` 指令新增第一個專案',
          inline: false,
        })
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Bug 2 Fix: 解析 channel ID（如果是 thread，回溯到 parent channel）
    // 確保 thread 內使用 /project list 時能看到 parent channel 的綁定
    const resolvedChannelId = this.resolveParentChannelId(interaction.channel, interaction.channelId);
    const channelBinding = this.projectManager.getChannelBinding(resolvedChannelId);

    const embed = new EmbedBuilder()
      .setColor(Colors.INFO)
      .setTitle('📋 專案列表')
      .setDescription(`共有 **${projects.length}** 個專案`)
      .setTimestamp();

    // 添加專案字段
    for (const project of projects) {
      const aliases = this.projectManager.getAliasesForProject(project.projectId);
      const aliasText = aliases.length > 0 ? `\`${aliases.join(', ')}\`` : '-';
      const statusText = project.settings.enabled ? '✅ 啟用' : '❌ 停用';
      const isBound = channelBinding?.projectId === project.projectId;

      embed.addFields({
        name: `${project.name} ${isBound ? '📌' : ''}`,
        value: [
          `**別名:** ${aliasText}`,
          `**路徑:** \`${this.truncatePath(project.path)}\``,
          `**狀態:** ${statusText}`,
          isBound ? `**頻道:** 📍 當前頻道` : '',
        ].filter(Boolean).join('\n'),
        inline: false,
      });
    }

    // 添加說明
    embed.addFields({
      name: '💡 操作說明',
      value: [
        '`/project add` - 新增專案',
        '`/project use [專案]` - 綁定專案到頻道',
        '`/project remove [專案]` - 移除專案',
      ].join('\n'),
      inline: false,
    });

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  }

  /**
   * 處理 use 子指令
   */
  async handleUse(interaction: ChatInputCommandInteraction): Promise<void> {
    const projectId = interaction.options.getString('project');

    if (!projectId) {
      await interaction.reply({
        content: '❌ 請選擇要綁定的專案',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const project = this.projectManager.getProject(projectId);

    if (!project) {
      await interaction.reply({
        content: '❌ 找不到指定的專案',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Bug 2 Fix: 解析 thread -> parent channel 後再綁定
    const resolvedChannelId = this.resolveParentChannelId(interaction.channel, interaction.channelId);
    const isThreadContext = resolvedChannelId !== interaction.channelId;

    // 異步操作需要先 defer
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
      this.projectManager.bindProjectToChannel(projectId, resolvedChannelId);
      await this.projectManager.save();

      const embed = new EmbedBuilder()
        .setColor(Colors.SUCCESS)
        .setTitle('✅ 專案已綁定')
        .setDescription(`專案 **${project.name}** 已成功綁定`)
        .addFields(
          { name: '📁 路徑', value: `\`${project.path}\``, inline: false },
          { name: '📍 頻道', value: `<#${resolvedChannelId}>`, inline: true }
        )
        .setTimestamp();

      if (isThreadContext) {
        embed.addFields({
          name: '💡 說明',
          value: `此指令在 Thread 中執行，專案已綁定至父頻道 <#${resolvedChannelId}>（Session 綁定以此為準）`,
          inline: false,
        });
      }

      await interaction.editReply({
        embeds: [embed],
      });
    } catch (error) {
      const errorMessage = (error as Error).message;

      const embed = new EmbedBuilder()
        .setColor(Colors.ERROR)
        .setTitle('❌ 綁定失敗')
        .setDescription(errorMessage)
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
      });
    }
  }

  /**
   * 處理 remove 子指令
   */
  async handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
    const projectId = interaction.options.getString('project');

    if (!projectId) {
      await interaction.reply({
        content: '❌ 請選擇要移除的專案',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const project = this.projectManager.getProject(projectId);

    if (!project) {
      await interaction.reply({
        content: '❌ 找不到指定的專案',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // 異步操作需要先 defer
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
      const deleted = await this.projectManager.deleteProject(projectId);

      if (deleted) {
        const embed = new EmbedBuilder()
          .setColor(Colors.SUCCESS)
          .setTitle('✅ 專案已移除')
          .setDescription(`專案 **${project.name}** 已成功移除`)
          .addFields({
            name: '📁 路徑',
            value: `\`${project.path}\``,
            inline: false,
          })
          .setTimestamp();

        await interaction.editReply({
          embeds: [embed],
        });
      } else {
        throw new Error('無法刪除專案');
      }
    } catch (error) {
      const errorMessage = (error as Error).message;

      const embed = new EmbedBuilder()
        .setColor(Colors.ERROR)
        .setTitle('❌ 移除失敗')
        .setDescription(errorMessage)
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
      });
    }
  }

  /**
   * 處理 Autocomplete
   */
  async handleAutocomplete(
    interaction: import('discord.js').AutocompleteInteraction
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    const query = focused.value.toLowerCase();

    let projects = this.projectManager.getAllProjects();

    // 如果有搜尋關鍵字，進行過濾
    if (query) {
      projects = this.projectManager.searchProjects(query);
    }

    // 限制選項數量
    const options = projects.slice(0, 25).map((project) => ({
      name: `${project.name} (${this.truncatePath(project.path, 30)})`,
      value: project.projectId,
    }));

    await interaction.respond(options);
  }

  /**
   * 截斷路徑顯示
   */
  private truncatePath(path: string, maxLength: number = 40): string {
    if (path.length <= maxLength) {
      return path;
    }

    const parts = path.split('/');
    if (parts.length <= 2) {
      return '...' + path.slice(-maxLength + 3);
    }

    // 保留開頭和結尾
    const first = parts[0];
    const last = parts[parts.length - 1];

    return `${first}/.../${last}`;
  }

  /**
   * 解析 parent channel ID（如果是 thread，回溯到 parent）
   * @param channel Discord Channel 物件
   * @param channelId 頻道 ID
   * @returns parent channel ID（如果是 thread）或原 channel ID
   */
  private resolveParentChannelId(channel: import('discord.js').Channel | null, channelId: string): string {
    if (!channel) {
      return channelId;
    }
    // 檢查是否為 thread channel
    if (
      channel.type === ChannelType.PublicThread ||
      channel.type === ChannelType.PrivateThread ||
      channel.type === ChannelType.AnnouncementThread
    ) {
      // Thread channel - 回溯到 parent channel
      const parentId = channel.parentId;
      if (parentId) {
        return parentId;
      }
    }
    // 非 thread 或無法解析，直接返回原 ID
    return channelId;
  }
}

// ============== 快捷函數 ==============

/**
 * 創建專案列表 Embed
 */
export function createProjectListEmbed(options: {
  projects: import('../database/models/Project.js').Project[];
  channelBinding?: import('../services/ProjectManager.js').ChannelBinding | null;
  projectManager: ProjectManager;
}): EmbedBuilder {
  const { projects, channelBinding, projectManager } = options;

  if (projects.length === 0) {
    return new EmbedBuilder()
      .setColor(Colors.WARNING)
      .setTitle('📋 專案列表')
      .setDescription('目前沒有任何專案');
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.INFO)
    .setTitle('📋 專案列表')
    .setDescription(`共有 **${projects.length}** 個專案`)
    .setTimestamp();

  for (const project of projects) {
    const aliases = projectManager.getAliasesForProject(project.projectId);
    const aliasText = aliases.length > 0 ? `\`${aliases.join(', ')}\`` : '-';
    const statusText = project.settings.enabled ? '✅ 啟用' : '❌ 停用';
    const isBound = channelBinding?.projectId === project.projectId;

    embed.addFields({
      name: `${project.name} ${isBound ? '📌' : ''}`,
      value: [
        `**別名:** ${aliasText}`,
        `**路徑:** \`${project.path}\``,
        `**狀態:** ${statusText}`,
        isBound ? `**頻道:** 📍 當前頻道` : '',
      ].filter(Boolean).join('\n'),
      inline: false,
    });
  }

  return embed;
}

/**
 * 創建新增專案 Modal
 */
export function createAddProjectModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(ModalIds.ADD_PROJECT)
    .setTitle('建立新專案')
    .addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('project_name')
          .setLabel('專案名稱')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('例如: My Awesome Project')
          .setMinLength(2)
          .setMaxLength(50)
          .setRequired(true)
      )
    )
    .addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('project_path')
          .setLabel('專案路徑')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('例如: /Users/name/projects/my-project')
          .setMinLength(1)
          .setMaxLength(200)
          .setRequired(true)
      )
    )
    .addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('project_alias')
          .setLabel('專案別名 (可選)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('例如: myproject')
          .setMinLength(2)
          .setMaxLength(20)
          .setRequired(false)
      )
    );
}

export default {
  COMMAND_NAME,
  COMMAND_DESCRIPTION,
  createProjectCommand,
  ProjectCommandHandler,
  createProjectListEmbed,
  createAddProjectModal,
  ModalIds,
};
