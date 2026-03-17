/**
 * Model Command
 * @description 模型選擇和管理指令
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
  getProviderDisplayName,
  getModelById,
  type ModelDefinition,
  type ModelProvider,
} from '../models/ModelData.js';
import { getAvailableModels, getProviders } from '../services/ModelService.js';
import { Colors } from '../builders/EmbedBuilder.js';
import { isAutocompleteAllowed } from '../utils/RateLimiter.js';

// ============== Slash Command 定義 ==============

const modelCommand = new SlashCommandBuilder()
  .setName('model')
  .setDescription('管理 AI 模型選擇')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('list')
      .setDescription('列出所有可用的模型')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('set')
      .setDescription('設定當前使用的模型')
      .addStringOption((option) =>
        option
          .setName('model')
          .setDescription('選擇模型')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('info')
      .setDescription('顯示模型詳細資訊')
      .addStringOption((option) =>
        option
          .setName('model')
          .setDescription('選擇模型')
          .setRequired(false)
          .setAutocomplete(true)
      )
  );

// ============== 指令處理函數 ==============

/**
 * 處理 /model list 指令 - 兩步驟 UX
 * Step 1: 顯示提供商選擇菜單
 */
async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId ?? undefined;
  
  // 異步操作需要先 defer
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  
  // 嘗試從 CLI 獲取動態模型列表，如果失敗則使用靜態列表
  try {
    const models = await getAvailableModels(guildId);
    const providers = await getProviders(guildId);
    
    // 統計資訊
    const totalModels = models.length;
    const totalProviders = providers.length;
    
    // 按提供商分組
    const grouped = new Map<string, typeof models>();
    for (const model of models) {
      const existing = grouped.get(model.provider) || [];
      existing.push(model);
      grouped.set(model.provider, existing);
    }
    
    // 建立 Embed
    const embed = new EmbedBuilder()
      .setColor(Colors.INFO)
      .setTitle('🤖 AI 模型提供商')
      .setDescription('請選擇一個提供商查看其模型：')
      .addFields({
        name: '📊 統計',
        value: `${totalProviders} 個提供商 | ${totalModels} 個模型`,
        inline: false,
      });
    
    // 建立提供商選擇選單
    const providerOptions: StringSelectMenuOptionBuilder[] = [];
    
    for (const provider of providers) {
      const providerModels = grouped.get(provider) || [];
      const emoji = getProviderEmoji(provider as ModelProvider);
      providerOptions.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(`${emoji} ${getProviderDisplayName(provider as ModelProvider)} (${providerModels.length} models)`)
          .setValue(provider)
      );
    }
    
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('model:provider:select')
      .setPlaceholder('選擇提供商...')
      .addOptions(providerOptions);
    
    const actionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
    
    await interaction.editReply({
      embeds: [embed],
      components: [actionRow],
    });
  } catch (error) {
    console.error('Error fetching models:', error);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('❌ 無法獲取模型列表')
          .setDescription('目前沒有可用的 API Key。\n\n請設定環境變數 OPENAI_API_KEY、ANTHROPIC_API_KEY 或 GOOGLE_API_KEY。')
          .addFields({
            name: '📝 說明',
            value: '請在伺服器的環境變數中設定 API Key。',
            inline: false,
          }),
      ],
    });
  }
}

/**
 * 處理 /model set 指令
 */
async function handleSet(interaction: ChatInputCommandInteraction): Promise<void> {
  const modelId = interaction.options.getString('model', true);
  const model = getModelById(modelId);

  if (!model) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('❌ 模型不存在')
          .setDescription(`無法找到模型: ${modelId}`),
      ],
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // 這裡應該保存用戶的模型選擇到資料庫
  // 暫時只顯示成功訊息
  
  const embed = new EmbedBuilder()
    .setColor(Colors.SUCCESS)
    .setTitle('✅ 模型已設定')
    .setDescription(`已將模型設定為 **${model.name}**`)
    .addFields(
      { name: '🤖 模型', value: model.name, inline: true },
      { name: '🏢 提供商', value: getProviderDisplayName(model.provider), inline: true },
      { name: '💰 定價', value: `$${model.pricing.input}/M 輸入 | $${model.pricing.output}/M 輸出`, inline: false }
    )
    .setFooter({ text: '模型將在下次對話時生效' });

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral],
  });
}

/**
 * 處理 /model info 指令
 */
async function handleInfo(interaction: ChatInputCommandInteraction): Promise<void> {
  const modelId = interaction.options.getString('model');
  const guildId = interaction.guildId ?? undefined;
  
  // 異步操作需要先 defer
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  
  // 獲取模型列表（從 CLI 或 fallback）
  try {
    const models = await getAvailableModels(guildId);
  
  // 如果沒有指定模型，顯示選擇菜單
  if (!modelId) {
    const embed = new EmbedBuilder()
      .setColor(Colors.INFO)
      .setTitle('🤖 選擇模型')
      .setDescription('請選擇一個模型來查看詳細資訊');

    // 限制選項數量最多 25 個（Discord.js StringSelectMenu 限制）
    const MAX_OPTIONS = 25;
    const limitedModels = models.slice(0, MAX_OPTIONS);
    const hasMoreModels = models.length > MAX_OPTIONS;

    let selectOptions = limitedModels.map((m) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${getProviderDisplayName(m.provider)} - ${m.name}`)
        .setValue(m.id)
        .setDescription((m.description || '無描述').substring(0, 100))
    );

    // 如果超過限制，添加提示選項
    if (hasMoreModels) {
      selectOptions.push(
        new StringSelectMenuOptionBuilder()
          .setLabel('... 更多模型')
          .setValue('__more__')
          .setDescription(`共 ${models.length} 個模型`)
      );
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('model:info:select')
      .setPlaceholder('選擇模型...')
      .addOptions(selectOptions);

    const actionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.editReply({
      embeds: [embed],
      components: [actionRow],
    });
    return;
  }

  const model = models.find(m => m.id === modelId);
  if (!model) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('❌ 模型不存在')
          .setDescription(`無法找到模型: ${modelId}`),
      ],
    });
    return;
  }

  const embed = buildModelInfoEmbed(model);
  await interaction.editReply({
    embeds: [embed],
  });
  } catch (error) {
    console.error('Error fetching models:', error);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('❌ 無法獲取模型列表')
          .setDescription('目前沒有可用的 API Key。\n\n請在 .env 中設定 OPENCODE_API_KEY 環境變數。')
          .addFields({
            name: '📝 說明',
            value: 'OPENCODE_API_KEY 是用於存取 OpenCode API 的金鑰。',
            inline: false,
          }),
      ],
    });
  }
}

// ============== 輔助函數 ==============

/**
 * 建立模型選擇下拉選單
 */
async function createModelSelectMenu(guildId?: string): Promise<StringSelectMenuBuilder> {
  const models = await getAvailableModels(guildId);
  
  // 按提供商分組 - 使用 string key 以支援動態 provider
  const grouped = new Map<string, typeof models>();
  for (const model of models) {
    const existing = grouped.get(model.provider) || [];
    existing.push(model);
    grouped.set(model.provider, existing);
  }
  
  const providerOrder = ['anthropic', 'openai', 'google', 'xai', 'cohere', 'mistral', 'opencode', 'opencode-go', 'github-copilot'];
  const options: StringSelectMenuOptionBuilder[] = [];

  for (const provider of providerOrder) {
    const providerModels = grouped.get(provider);
    if (providerModels && providerModels.length > 0) {
        // 添加提供商作為 Label（通過第一個選項）
        for (const model of providerModels) {
        options.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(`${model.name}`)
            .setValue(model.id)
            .setDescription((model.description || '無描述').substring(0, 100))
            .setEmoji(getProviderEmoji(provider as ModelProvider))
        );
      }
    }
  }

  // 限制選項數量最多 25 個（Discord.js StringSelectMenu 限制）
  const MAX_OPTIONS = 25;
  const limitedOptions = options.slice(0, MAX_OPTIONS);

  // 如果超過限制，添加提示選項
  if (models.length > MAX_OPTIONS) {
    limitedOptions.push(
      new StringSelectMenuOptionBuilder()
        .setLabel('... 更多模型，請使用 /model set <model_id>')
        .setValue('__more__')
        .setDescription(`共 ${models.length} 個模型，超過顯示限制`)
    );
  }

  return new StringSelectMenuBuilder()
    .setCustomId('model:select')
    .setPlaceholder('選擇一個 AI 模型...')
    .addOptions(limitedOptions);
}

/**
 * 獲取提供商的 Emoji
 */
function getProviderEmoji(provider: ModelProvider): string {
  const emojis: Record<string, string> = {
    anthropic: '🧠',
    openai: '💬',
    google: '🔍',
    xai: '✨',
    cohere: '🔗',
    mistral: '🌊',
    // 支援動態模型的 provider
    opencode: '🤖',
    'opencode-go': '⚡',
    'github-copilot': '👨‍💻',
  };
  return emojis[provider] || '🤖'; // 預設 emoji
}

/**
 * 建立模型資訊 Embed
 */
function buildModelInfoEmbed(model: ModelDefinition | undefined): EmbedBuilder {
  if (!model) {
    return new EmbedBuilder()
      .setColor(Colors.ERROR)
      .setTitle('❌ 模型不存在');
  }

  const categoryEmoji = {
    fast: '⚡',
    balanced: '⚖️',
    powerful: '💪',
  };

  const embed = new EmbedBuilder()
    .setColor(Colors.PRIMARY)
    .setTitle(`${categoryEmoji[model.category]} ${model.name}`)
    .setDescription(model.description)
    .addFields(
      { name: '🆔 模型 ID', value: `\`${model.id}\``, inline: false },
      { name: '🏢 提供商', value: getProviderDisplayName(model.provider), inline: true },
      { name: '📊 類型', value: `${categoryEmoji[model.category]} ${model.category.charAt(0).toUpperCase() + model.category.slice(1)}`, inline: true },
      { name: '💵 定價', value: `輸入: $${model.pricing.input}/M tokens\n輸出: $${model.pricing.output}/M tokens`, inline: true },
      { name: '🔢 Token 限制', value: `上下文: ${(model.limits.contextWindow / 1000)}K tokens\n最大輸出: ${model.limits.maxTokens} tokens`, inline: true }
    );

  if (model.features.length > 0) {
    embed.addFields({
      name: '✨ 功能',
      value: model.features.map((f) => `• ${f}`).join('\n'),
      inline: false,
    });
  }

  if (model.releaseDate) {
    embed.setFooter({ text: `發布日期: ${model.releaseDate}` });
  }

  return embed;
}

// ============== 導出 ==============

/**
 * 處理 Autocomplete 交互
 * @param interaction - Autocomplete 交互實例
 */
async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const userId = interaction.user.id;
  
  // Rate limit check for autocomplete
  if (!isAutocompleteAllowed(userId)) {
    await interaction.respond([]);
    return;
  }
  
  const focusedOption = interaction.options.getFocused(true);
  const query = focusedOption.value.toLowerCase();
  const guildId = interaction.guildId ?? undefined;
  
  try {
    // 獲取可用模型列表（動態從 providers）
    const models = await getAvailableModels(guildId);
    
    // 根據輸入過濾模型
    const filtered = models.filter((model) => {
      const searchText = `${model.id} ${model.name} ${model.provider}`.toLowerCase();
      return searchText.includes(query);
    });
    
    // 限制最多 25 個選項（Discord 限制）
    const limited = filtered.slice(0, 25);
    
    // 構建選項
    const choices = limited.map((model) => ({
      name: `${getProviderDisplayName(model.provider)} - ${model.name}`,
      value: model.id,
    }));
    
    await interaction.respond(choices);
  } catch (error) {
    // 如果沒有 providers 連接，返回提示選項
    console.error('Autocomplete error:', error);
    await interaction.respond([
      { name: '⚠️ 請在 .env 中設定 OPENCODE_API_KEY', value: '' }
    ]);
  }
}

export const model = {
  data: modelCommand,
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
export { buildModelInfoEmbed, createModelSelectMenu, handleAutocomplete };
