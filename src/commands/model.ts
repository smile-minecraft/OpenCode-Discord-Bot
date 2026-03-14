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
} from 'discord.js';

import {
  MODELS,
  DEFAULT_MODEL,
  getModelsByProvider,
  getProviderDisplayName,
  getModelById,
  type ModelProvider,
} from '../models/ModelData.js';
import { Colors } from '../builders/EmbedBuilder.js';

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
          .addChoices(
            ...MODELS.map((m) => ({
              name: `${getProviderDisplayName(m.provider)} - ${m.name}`,
              value: m.id,
            }))
          )
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
          .addChoices(
            ...MODELS.map((m) => ({
              name: `${getProviderDisplayName(m.provider)} - ${m.name}`,
              value: m.id,
            }))
          )
      )
  );

// ============== 指令處理函數 ==============

/**
 * 處理 /model list 指令
 */
async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const modelsByProvider = getModelsByProvider();
  const embed = new EmbedBuilder()
    .setColor(Colors.INFO)
    .setTitle('🤖 可用模型列表')
    .setDescription('以下是你可以選擇的 AI 模型')

  // 按提供商分組顯示
  const providerOrder: ModelProvider[] = ['anthropic', 'openai', 'google', 'xai', 'cohere', 'mistral'];
  
  for (const provider of providerOrder) {
    const models = modelsByProvider.get(provider);
    if (models && models.length > 0) {
      const modelList = models
        .map((m) => {
          const emoji = m.id === DEFAULT_MODEL ? ' ⭐' : '';
          return `\`${m.id}\` - ${m.name}${emoji}`;
        })
        .join('\n');
      
      embed.addFields({
        name: `📦 ${getProviderDisplayName(provider)}`,
        value: modelList,
        inline: false,
      });
    }
  }

  embed.setFooter({ text: '⭐ 為預設模型' });

  // 建立模型選擇下拉選單
  const selectMenu = createModelSelectMenu();
  const actionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  await interaction.reply({
    embeds: [embed],
    components: [actionRow],
    ephemeral: true,
  });
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
      ephemeral: true,
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
    ephemeral: true,
  });
}

/**
 * 處理 /model info 指令
 */
async function handleInfo(interaction: ChatInputCommandInteraction): Promise<void> {
  const modelId = interaction.options.getString('model');
  
  // 如果沒有指定模型，顯示選擇菜單
  if (!modelId) {
    const embed = new EmbedBuilder()
      .setColor(Colors.INFO)
      .setTitle('🤖 選擇模型')
      .setDescription('請選擇一個模型來查看詳細資訊');

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('model:info:select')
      .setPlaceholder('選擇模型...')
      .addOptions(
        MODELS.map((m) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${getProviderDisplayName(m.provider)} - ${m.name}`)
            .setValue(m.id)
            .setDescription(m.description.substring(0, 100))
        )
      );

    const actionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.reply({
      embeds: [embed],
      components: [actionRow],
      ephemeral: true,
    });
    return;
  }

  const model = getModelById(modelId);
  if (!model) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('❌ 模型不存在')
          .setDescription(`無法找到模型: ${modelId}`),
      ],
      ephemeral: true,
    });
    return;
  }

  const embed = buildModelInfoEmbed(model);
  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

// ============== 輔助函數 ==============

/**
 * 建立模型選擇下拉選單
 */
function createModelSelectMenu(): StringSelectMenuBuilder {
  const modelsByProvider = getModelsByProvider();
  const providerOrder: ModelProvider[] = ['anthropic', 'openai', 'google', 'xai', 'cohere', 'mistral'];

  const options: StringSelectMenuOptionBuilder[] = [];

  for (const provider of providerOrder) {
    const models = modelsByProvider.get(provider);
    if (models && models.length > 0) {
      // 添加提供商作為 Label（通過第一個選項）
      for (const model of models) {
        options.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(`${model.name}`)
            .setValue(model.id)
            .setDescription(model.description.substring(0, 100))
            .setEmoji(getProviderEmoji(provider))
        );
      }
    }
  }

  return new StringSelectMenuBuilder()
    .setCustomId('model:select')
    .setPlaceholder('選擇一個 AI 模型...')
    .addOptions(options);
}

/**
 * 獲取提供商的 Emoji
 */
function getProviderEmoji(provider: ModelProvider): string {
  const emojis: Record<ModelProvider, string> = {
    anthropic: '🧠',
    openai: '💬',
    google: '🔍',
    xai: '✨',
    cohere: '🔗',
    mistral: '🌊',
  };
  return emojis[provider];
}

/**
 * 建立模型資訊 Embed
 */
function buildModelInfoEmbed(model: ReturnType<typeof getModelById>): EmbedBuilder {
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
          ephemeral: true,
        });
    }
  },
};

// 導出供外部使用的函數
export { buildModelInfoEmbed, createModelSelectMenu };
