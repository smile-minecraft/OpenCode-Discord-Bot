/**
 * Setup Command
 * @description 初始設定精靈，引導用戶完成機器人配置
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  AutocompleteInteraction,
} from 'discord.js';

import { Database } from '../database/index.js';
import { DEFAULT_MODEL, getProviderDisplayName } from '../models/ModelData.js';
import { getAvailableModels } from '../services/ModelService.js';
import { Colors } from '../builders/EmbedBuilder.js';
import { log as logger } from '../utils/logger.js';
import { isAutocompleteAllowed } from '../utils/RateLimiter.js';

// ============== 指令定義 ==============

const command = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('OpenCode Bot 初始設定精靈')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('start')
      .setDescription('開始設定精靈')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('status')
      .setDescription('查看目前設定狀態')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('opencode_path')
      .setDescription('設定 OpenCode CLI 路徑')
      .addStringOption((option) =>
        option
          .setName('path')
          .setDescription('OpenCode CLI 路徑 (如: /usr/local/bin/opencode)')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('model')
      .setDescription('設定預設 AI 模型')
      .addStringOption((option) =>
        option
          .setName('model_id')
          .setDescription('選擇預設模型（請先使用 /connect 連接 API 提供商）')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
// ============== 設定項目 ==============

interface SetupConfig {
  opencodePath?: string;
  defaultModel?: string;
  configured: boolean;
}

// ============== 執行函數 ==============

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'start':
      await handleStart(interaction);
      break;
    case 'status':
      await handleStatus(interaction);
      break;
    case 'opencode_path':
      await handleOpencodePath(interaction);
      break;
    case 'model':
      await handleModel(interaction);
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
 * 處理 start 子命令 - 顯示設定精靈
 */
async function handleStart(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: '❌ 此命令只能在伺服器中使用',
      ephemeral: true
    });
    return;
  }
  
  const config = await getCurrentConfig(guildId);
  const missingItems = getMissingConfigItems(config);

  const embed = new EmbedBuilder()
    .setTitle('🚀 OpenCode Bot 設定精靈')
    .setDescription('歡迎使用 OpenCode Bot！讓我們一起完成初始設定。')
    .setColor(Colors.PRIMARY)
    .addFields({
      name: '📋 設定狀態',
      value: missingItems.length === 0
        ? '✅ 所有設定已完成！'
        : `⚠️ 還有 ${missingItems.length} 項需要設定`,
      inline: false,
    });

  // 顯示各項設定狀態
  const statusFields = [
    {
      name: '📁 OpenCode CLI 路徑',
      value: config.opencodePath ? `✅ 已設定: ${config.opencodePath}` : '❌ 未設定',
    },
    {
      name: '🧠 預設 AI 模型',
      value: config.defaultModel ? `✅ 已設定: ${config.defaultModel}` : '❌ 未設定',
    },
  ];

  embed.addFields(statusFields);

  // 如果有缺失項目，顯示說明
  if (missingItems.length > 0) {
    embed.addFields({
      name: '📝 設定說明',
      value: [
        '請依序執行以下指令完成設定：',
        ...missingItems.map((item, i) => `${i + 1}. ${item}`),
      ].join('\n'),
      inline: false,
    });
  }

  // 建立操作選單
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('setup:action')
    .setPlaceholder('選擇操作...')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('設定 OpenCode 路徑')
        .setValue('action:opencode')
        .setEmoji('📁')
        .setDescription('設定 OpenCode CLI 路徑'),
      new StringSelectMenuOptionBuilder()
        .setLabel('設定預設模型')
        .setValue('action:model')
        .setEmoji('🧠')
        .setDescription('選擇預設 AI 模型'),
      new StringSelectMenuOptionBuilder()
        .setLabel('查看狀態')
        .setValue('action:status')
        .setEmoji('📊')
        .setDescription('查看目前設定狀態')
    );

  const actionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  await interaction.reply({
    embeds: [embed],
    components: [actionRow],
    flags: ['Ephemeral'],
  });
}

/**
 * 處理 status 子命令 - 顯示設定狀態
 */
async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: '❌ 此命令只能在伺服器中使用',
      ephemeral: true
    });
    return;
  }
  
  const config = await getCurrentConfig(guildId);
  const missingItems = getMissingConfigItems(config);

  const embed = new EmbedBuilder()
    .setTitle('📊 設定狀態')
    .setColor(missingItems.length === 0 ? Colors.SUCCESS : Colors.WARNING)
    .addFields(
      {
        name: '📁 OpenCode CLI 路徑',
        value: config.opencodePath ? '✅ 已設定' : '❌ 未設定',
        inline: true,
      },
      {
        name: '🧠 預設 AI 模型',
        value: config.defaultModel ? `✅ ${config.defaultModel}` : '❌ 未設定',
        inline: true,
      }
    );

  if (missingItems.length > 0) {
    embed.setDescription(`⚠️ 還有 ${missingItems.length} 項需要設定`);
    embed.addFields({
      name: '📋 請使用以下指令完成設定：',
      value: missingItems.join('\n'),
      inline: false,
    });
  } else {
    embed.setDescription('✅ 所有設定已完成！');
  }

  // 顯示下一步建議
  const nextSteps = [
    '1. 使用 `/project add` 新增專案',
    '2. 在頻道中使用 `/session start` 開始對話',
    '3. 使用 `/help` 查看所有指令',
  ];

  embed.addFields({
    name: '🚀 下一步',
    value: nextSteps.join('\n'),
    inline: false,
  });

  embed.setFooter({ text: '設定將自動保存到資料庫' }).setTimestamp();

  await interaction.reply({
    embeds: [embed],
    flags: ['Ephemeral'],
  });
}

/**
 * 處理 opencode_path 子命令
 */
async function handleOpencodePath(interaction: ChatInputCommandInteraction): Promise<void> {
  const path = interaction.options.getString('path', true);

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: '❌ 此命令只能在伺服器中使用',
      ephemeral: true
    });
    return;
  }

  // 簡單驗證路徑格式
  if (path.length < 2) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('❌ 路徑無效')
          .setDescription('請輸入有效的路徑'),
      ],
      flags: ['Ephemeral'],
    });
    return;
  }

  // 保存路徑
  await saveConfig(guildId, 'opencodePath', path);

  const embed = new EmbedBuilder()
    .setColor(Colors.SUCCESS)
    .setTitle('✅ OpenCode CLI 路徑已設定')
    .setDescription(`路徑: \`${path}\``)
    .addFields(
      {
        name: '💡 提示',
        value: '確保 OpenCode CLI 已正確安裝並可執行',
        inline: false,
      }
    )
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    flags: ['Ephemeral'],
  });
}

/**
 * 處理 model 子命令
 */
async function handleModel(interaction: ChatInputCommandInteraction): Promise<void> {
  const modelId = interaction.options.getString('model_id', true);
  const guildId = interaction.guildId;
  
  if (!guildId) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('❌ 無法使用')
          .setDescription('此指令只能在伺服器中使用，請在伺服器頻道中使用。'),
      ],
      flags: ['Ephemeral'],
    });
    return;
  }
  
  // 從 connected providers 動態獲取模型列表
  try {
    const models = await getAvailableModels(guildId);
    const model = models.find(m => m.id === modelId);

  if (!model) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('❌ 模型不存在')
          .setDescription(`無法找到模型: ${modelId}`),
      ],
      flags: ['Ephemeral'],
    });
    return;
  }

  // 保存模型設定
    await saveConfig(guildId, 'defaultModel', modelId);

    const embed = new EmbedBuilder()
      .setColor(Colors.SUCCESS)
      .setTitle('✅ 預設 AI 模型已設定')
      .setDescription(`已將預設模型設定為 **${model.name}**`)
      .addFields(
        { name: '🤖 模型', value: model.name, inline: true },
        { name: '🏢 提供商', value: model.provider, inline: true },
        { name: '💰 定價', value: `$${model.pricing.input}/M 輸入 | $${model.pricing.output}/M 輸出`, inline: true }
      )
      .setFooter({ text: '新對話將使用此模型' })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      flags: ['Ephemeral'],
    });
  } catch (error) {
    console.error('Error in handleModel:', error);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('❌ 無法設定模型')
          .setDescription('目前沒有已連接的 AI 提供商。請先使用 `/connect` 指令連接您的 API 提供商，然後再使用此指令。')
          .addFields({
            name: '📝 說明',
            value: '使用 `/connect` 指令可以連接您的 OpenAI、Anthropic、Google 等 API 提供商。',
            inline: false,
          }),
      ],
      flags: ['Ephemeral'],
    });
  }
}

// ============== 輔助函數 ==============

/**
 * 取得目前配置 - 從資料庫讀取
 */
async function getCurrentConfig(guildId: string): Promise<SetupConfig> {
  try {
    const db = Database.getInstance();
    const guild = await db.getGuild(guildId);

    return {
      opencodePath: guild?.settings?.opencodePath || process.env.OPENCODE_PATH,
      defaultModel: guild?.settings?.defaultModel || process.env.DEFAULT_MODEL || DEFAULT_MODEL,
      configured: !!(guild?.settings?.opencodePath),
    };
  } catch (error) {
    console.error('Failed to get config:', error);
    return {
      defaultModel: DEFAULT_MODEL,
      configured: false,
    };
  }
}

/**
 * 取得缺失的設定項目
 */
function getMissingConfigItems(config: SetupConfig): string[] {
  const items: string[] = [];

  if (!config.opencodePath) {
    items.push('`/setup opencode_path <path>` - 設定 OpenCode CLI 路徑');
  }
  if (!config.defaultModel) {
    items.push('`/setup model <model_id>` - 設定預設 AI 模型');
  }

  return items;
}

/**
 * 保存設定到資料庫
 */
async function saveConfig(guildId: string, key: string, value: string): Promise<void> {
  try {
    const db = Database.getInstance();
    const guild = await db.getOrCreateGuild(guildId, 'Setup');

    // 初始化 settings 如果不存在
    if (!guild.settings) {
      guild.settings = {
        enabled: true,
        autoStartSession: false,
        maxConcurrentSessions: 3,
        defaultModel: DEFAULT_MODEL,
        defaultAgent: 'general',
        allowedModels: [],
        allowedAgents: [],
      };
    }

    // 保存設定到 settings 的正確欄位
    if (key === 'opencodePath') {
      guild.settings.opencodePath = value;
    } else if (key === 'defaultModel') {
      guild.settings.defaultModel = value;
    }

    await db.saveGuild(guild);
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

// ============== Autocomplete 處理 ==============

/**
 * 處理 Setup 指令的 Autocomplete 交互
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
  
  // 只處理 model_id 選項
  if (focusedOption.name !== 'model_id') {
    await interaction.respond([]);
    return;
  }
  
  const query = focusedOption.value.toLowerCase();
  const guildId = interaction.guildId ?? undefined;
  
  // 如果沒有 guildId，返回錯誤提示
  if (!guildId) {
    await interaction.respond([
      { name: '⚠️ 請在伺服器中使用此指令', value: '' }
    ]);
    return;
  }
  
  try {
    // 獲取可用模型列表（動態從 providers）
    const models = await getAvailableModels(guildId);
    
    if (models.length === 0) {
      await interaction.respond([
        { name: '⚠️ 沒有可用的模型，請檢查 API 連接', value: '' }
      ]);
      return;
    }
    
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
    logger.error('[Setup] Autocomplete error', { error: error instanceof Error ? error.message : String(error) });
    await interaction.respond([
      { name: '⚠️ 請先使用 /connect 連接 API 提供商', value: '' }
    ]);
  }
}

// ============== 導出 ==============

export { command, execute, handleAutocomplete };
export default { command, execute, handleAutocomplete };
