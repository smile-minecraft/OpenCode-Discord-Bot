/**
 * Agent Command
 * @description Agent 選擇和管理指令
 */

import {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  MessageFlags,
} from 'discord.js';

import {
  AGENTS,
  DEFAULT_AGENT,
  getAgentById,
  getAgentTypeDisplayName,
  type AgentType,
  type AgentDefinition,
} from '../models/AgentData.js';
import { Colors } from '../builders/EmbedBuilder.js';

// ============== Slash Command 定義 ==============

const agentCommand = new SlashCommandBuilder()
  .setName('agent')
  .setDescription('管理 Agent 選擇')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('list')
      .setDescription('列出所有可用的 Agents')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('set')
      .setDescription('設定當前使用的 Agent')
      .addStringOption((option) =>
        option
          .setName('agent')
          .setDescription('選擇 Agent')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('info')
      .setDescription('顯示 Agent 詳細資訊')
      .addStringOption((option) =>
        option
          .setName('agent')
          .setDescription('選擇 Agent')
          .setRequired(false)
          .setAutocomplete(true)
      )
  );

// ============== 指令處理函數 ==============

/**
 * 處理 /agent list 指令
 */
async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  // 按類型分組
  const agentsByType = new Map<AgentType, AgentDefinition[]>();
  
  for (const agent of AGENTS) {
    const existing = agentsByType.get(agent.type) || [];
    existing.push(agent);
    agentsByType.set(agent.type, existing);
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.INFO)
    .setTitle('🤖 可用 Agent 列表')
    .setDescription('以下是你可以選擇的 Agent 類型');

  // 顯示所有 Agents
  for (const agent of AGENTS) {
    const isDefault = agent.id === DEFAULT_AGENT;
    const emoji = isDefault ? ' ⭐' : '';
    
    embed.addFields({
      name: `${getAgentEmoji(agent.type)} ${agent.name}${emoji}`,
      value: agent.description,
      inline: false,
    });
  }

  embed.setFooter({ text: '⭐ 為預設 Agent' });

  // 建立 Agent 選擇下拉選單
  const selectMenu = createAgentSelectMenu();
  const actionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  await interaction.reply({
    embeds: [embed],
    components: [actionRow],
    flags: [MessageFlags.Ephemeral],
  });
}

/**
 * 處理 /agent set 指令
 */
async function handleSet(interaction: ChatInputCommandInteraction): Promise<void> {
  const agentId = interaction.options.getString('agent', true);
  const agent = getAgentById(agentId);

  if (!agent) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('❌ Agent 不存在')
          .setDescription(`無法找到 Agent: ${agentId}`),
      ],
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // 這裡應該保存用戶的 Agent 選擇到資料庫
  // 暫時只顯示成功訊息
  
  const embed = new EmbedBuilder()
    .setColor(Colors.SUCCESS)
    .setTitle('✅ Agent 已設定')
    .setDescription(`已將 Agent 設定為 **${agent.name}**`)
    .addFields(
      { name: '🤖 Agent', value: agent.name, inline: true },
      { name: '📂 類型', value: getAgentTypeDisplayName(agent.type), inline: true },
      { name: '📝 描述', value: agent.description, inline: false }
    );

  if (agent.capabilities.length > 0) {
    embed.addFields({
      name: '✨ 功能',
      value: agent.capabilities.map((c) => `• ${c}`).join('\n'),
      inline: false,
    });
  }

  embed.setFooter({ text: 'Agent 將在下次對話時生效' });

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral],
  });
}

/**
 * 處理 /agent info 指令
 */
async function handleInfo(interaction: ChatInputCommandInteraction): Promise<void> {
  const agentId = interaction.options.getString('agent');
  
  // 如果沒有指定 Agent，顯示選擇菜單
  if (!agentId) {
    const embed = new EmbedBuilder()
      .setColor(Colors.INFO)
      .setTitle('🤖 選擇 Agent')
      .setDescription('請選擇一個 Agent 來查看詳細資訊');

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('agent:info:select')
      .setPlaceholder('選擇 Agent...')
      .addOptions(
        AGENTS.map((a) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${a.name} - ${getAgentTypeDisplayName(a.type)}`)
            .setValue(a.id)
            .setDescription(a.description.substring(0, 100))
        )
      );

    const actionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.reply({
      embeds: [embed],
      components: [actionRow],
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const agent = getAgentById(agentId);
  if (!agent) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('❌ Agent 不存在')
          .setDescription(`無法找到 Agent: ${agentId}`),
      ],
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const embed = buildAgentInfoEmbed(agent);
  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral],
  });
}

// ============== 輔助函數 ==============

/**
 * 獲取 Agent 類型的 Emoji
 */
function getAgentEmoji(type: AgentType): string {
  const emojis: Record<AgentType, string> = {
    general: '🤖',
    coder: '💻',
    reviewer: '🔍',
    architect: '🏗️',
    debugger: '🔧',
  };
  return emojis[type];
}

/**
 * 建立 Agent 選擇下拉選單
 */
function createAgentSelectMenu(): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder()
    .setCustomId('agent:select')
    .setPlaceholder('選擇一個 Agent...')
    .addOptions(
      AGENTS.map((a) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(a.name)
          .setValue(a.id)
          .setDescription(a.description.substring(0, 100))
          .setEmoji(getAgentEmoji(a.type))
      )
    );
}

/**
 * 建立 Agent 資訊 Embed
 */
function buildAgentInfoEmbed(agent: AgentDefinition): EmbedBuilder {
  const featureItems: string[] = [];
  
  if (agent.features.tools) featureItems.push('✅ 工具使用');
  else featureItems.push('❌ 工具使用');
  
  if (agent.features.codeExecution) featureItems.push('✅ 代碼執行');
  else featureItems.push('❌ 代碼執行');
  
  if (agent.features.fileOperations) featureItems.push('✅ 檔案操作');
  else featureItems.push('❌ 檔案操作');
  
  if (agent.features.webSearch) featureItems.push('✅ 網路搜尋');
  else featureItems.push('❌ 網路搜尋');
  
  if (agent.features.conversationHistory) featureItems.push('✅ 對話歷史');
  else featureItems.push('❌ 對話歷史');

  const embed = new EmbedBuilder()
    .setColor(Colors.PRIMARY)
    .setTitle(`${getAgentEmoji(agent.type)} ${agent.name}`)
    .setDescription(agent.description)
    .addFields(
      { name: '🆔 Agent ID', value: agent.id, inline: true },
      { name: '📂 類型', value: getAgentTypeDisplayName(agent.type), inline: true }
    );

  if (agent.capabilities.length > 0) {
    embed.addFields({
      name: '💡 功能',
      value: agent.capabilities.map((c) => `• ${c}`).join('\n'),
      inline: false,
    });
  }

  embed.addFields({
    name: '⚙️ 支援情況',
    value: featureItems.join('\n'),
    inline: false,
  });

  if (agent.defaultModel) {
    embed.setFooter({ text: `預設模型: ${agent.defaultModel}` });
  }

  return embed;
}

// ============== 導出 ==============

/**
 * 處理 Autocomplete 交互
 * @param interaction - Autocomplete 交互實例
 */
async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);
  const query = focusedOption.value.toLowerCase();
  
  try {
    // 根據輸入過濾 Agent
    const filtered = AGENTS.filter((agent) => {
      const searchText = `${agent.id} ${agent.name} ${agent.type}`.toLowerCase();
      return searchText.includes(query);
    });
    
    // 限制最多 25 個選項（Discord 限制）
    const limited = filtered.slice(0, 25);
    
    // 構建選項
    const choices = limited.map((agent) => ({
      name: `${agent.name} - ${getAgentTypeDisplayName(agent.type)}`,
      value: agent.id,
    }));
    
    await interaction.respond(choices);
  } catch (error) {
    console.error('Autocomplete error:', error);
    // 如果出錯，返回空選項
    await interaction.respond([]);
  }
}

export const agent = {
  data: agentCommand,
  execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'list':
        await handleList(interaction);
        break;
      case 'set':
        await handleSet(interaction);
        break;
      case 'info':
        await handleInfo(interaction);
        break;
      default:
        await interaction.reply({
          content: '未知的子指令',
          flags: [MessageFlags.Ephemeral],
        });
    }
  },
};

// 導出供外部使用的函數
export { buildAgentInfoEmbed, createAgentSelectMenu, handleAutocomplete };
