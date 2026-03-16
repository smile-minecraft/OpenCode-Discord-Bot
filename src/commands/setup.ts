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
} from 'discord.js';

import { Database } from '../database/index.js';
import { MODELS, DEFAULT_MODEL } from '../models/ModelData.js';
import { getAvailableModels } from '../services/ModelService.js';
import { Colors } from '../builders/EmbedBuilder.js';

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
          .setDescription('選擇預設模型')
          .setRequired(true)
          .addChoices(
            ...MODELS.slice(0, 25).map((m) => ({
              name: `${m.name} (${m.provider})`,
              value: m.id,
            }))
          )
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('gemini_key')
      .setDescription('設定 Gemini API Key (語音轉錄用)')
      .addStringOption((option) =>
        option
          .setName('api_key')
          .setDescription('Gemini API Key')
          .setRequired(true)
      )
  );

// ============== 設定項目 ==============

interface SetupConfig {
  opencodePath?: string;
  defaultModel?: string;
  geminiApiKey?: string;
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
    case 'gemini_key':
      await handleGeminiKey(interaction);
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
  const guildId = interaction.guildId!;
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
    {
      name: '🎙️ Gemini API Key',
      value: config.geminiApiKey ? '✅ 已設定' : '⚠️ 可選（用於語音轉錄）',
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
        .setLabel('設定 Gemini Key')
        .setValue('action:gemini')
        .setEmoji('🎙️')
        .setDescription('設定 Gemini API Key（可選）'),
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
  const guildId = interaction.guildId!;
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
      },
      {
        name: '🎙️ Gemini API Key',
        value: config.geminiApiKey ? '✅ 已設定' : '⚠️ 未設定（可選）',
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
  await saveConfig(interaction.guildId!, 'opencodePath', path);

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
  
  // 嘗試從 CLI 獲取動態模型列表，如果失敗則使用靜態列表
  const models = await getAvailableModels();
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
  await saveConfig(interaction.guildId!, 'defaultModel', modelId);

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
}

/**
 * 處理 gemini_key 子命令
 */
async function handleGeminiKey(interaction: ChatInputCommandInteraction): Promise<void> {
  const apiKey = interaction.options.getString('api_key', true);

  // 簡單驗證 key 格式
  if (apiKey.length < 20) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('❌ API Key 格式無效')
          .setDescription('請輸入正確的 Gemini API Key'),
      ],
      flags: ['Ephemeral'],
    });
    return;
  }

  // 保存 API Key
  await saveConfig(interaction.guildId!, 'geminiApiKey', apiKey);

  const embed = new EmbedBuilder()
    .setColor(Colors.SUCCESS)
    .setTitle('✅ Gemini API Key 已設定')
    .setDescription('API Key 已成功保存！')
    .addFields(
      {
        name: '🎙️ 功能啟用',
        value: '現在可以使用語音轉錄功能了',
        inline: false,
      },
      {
        name: '⚠️ 安全性提醒',
        value: '請勿將 API Key 分享給他人',
        inline: false,
      }
    )
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    flags: ['Ephemeral'],
  });
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
      geminiApiKey: guild?.settings?.geminiApiKey || process.env.GEMINI_API_KEY,
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
  // Gemini API Key 是可選的
  if (!config.geminiApiKey) {
    items.push('`/setup gemini_key <key>` - 設定 Gemini API Key (可選)');
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
    } else if (key === 'geminiApiKey') {
      guild.settings.geminiApiKey = value;
    } else if (key === 'defaultModel') {
      guild.settings.defaultModel = value;
    }

    await db.saveGuild(guild);
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

// ============== 導出 ==============

export { command, execute };
export default { command, execute };
