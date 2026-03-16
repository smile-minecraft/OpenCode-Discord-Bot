/**
 * Connect Commands - Provider 連接管理指令
 * @description 管理 AI 提供商的連接和 API Key
 */

import {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';

import { getProviderService } from '../services/ProviderService.js';
import { PROVIDERS, type OpenCodeProviderType } from '../services/OpenCodeCloudClient.js';
import { log } from '../utils/logger.js';

// ==================== Command Builder ====================

/**
 * 建立 /connect 指令
 */
export const connectCommand = new SlashCommandBuilder()
  .setName('connect')
  .setDescription('管理 AI 提供商連接')
  .setDMPermission(false)
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('list')
      .setDescription('顯示已連接的提供商')
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('add')
      .setDescription('測試提供商連接（API Key 請透過環境變數設定）')
      .addStringOption((option) =>
        option
          .setName('provider')
          .setDescription('選擇提供商')
          .setRequired(true)
          .addChoices(
            { name: 'OpenCode Zen (GPT-5, Claude Opus)', value: 'opencode-zen' },
            { name: 'OpenCode Go (GLM-5, Kimi K2.5)', value: 'opencode-go' },
            { name: 'Anthropic (Claude)', value: 'anthropic' },
            { name: 'OpenAI (GPT)', value: 'openai' }
          )
      )
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('remove')
      .setDescription('移除提供商連接')
      .addStringOption((option) =>
        option
          .setName('provider')
          .setDescription('選擇要移除的提供商')
          .setRequired(true)
          .addChoices(
            { name: 'OpenCode Zen', value: 'opencode-zen' },
            { name: 'OpenCode Go', value: 'opencode-go' },
            { name: 'Anthropic', value: 'anthropic' },
            { name: 'OpenAI', value: 'openai' }
          )
      )
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('status')
      .setDescription('顯示提供商連接狀態')
      .addStringOption((option) =>
        option
          .setName('provider')
          .setDescription('選擇提供商 (留空顯示所有)')
          .setRequired(false)
          .addChoices(
            { name: 'OpenCode Zen', value: 'opencode-zen' },
            { name: 'OpenCode Go', value: 'opencode-go' },
            { name: 'Anthropic', value: 'anthropic' },
            { name: 'OpenAI', value: 'openai' }
          )
      )
  );

// ==================== Command Handler ====================

/**
 * 處理 /connect 指令
 */
export async function handleConnectCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: '此指令只能在伺服器中使用',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // 記錄命令使用
  log.command(`/connect ${subcommand}`, interaction.user.id, guildId);

  try {
    switch (subcommand) {
      case 'list':
        await handleConnectList(interaction, guildId);
        break;
      case 'add':
        await handleConnectAdd(interaction, guildId);
        break;
      case 'remove':
        await handleConnectRemove(interaction, guildId);
        break;
      case 'status':
        await handleConnectStatus(interaction, guildId);
        break;
      default:
        await interaction.reply({
          content: '未知的子指令',
          flags: [MessageFlags.Ephemeral],
        });
    }
  } catch (error) {
    log.error('[ConnectCommand] Error', {
      error: error instanceof Error ? error.message : String(error),
      subcommand,
      guildId,
    });

    await interaction.reply({
      content: '執行指令時發生錯誤，請稍後再試',
      flags: [MessageFlags.Ephemeral],
    });
  }
}

// ==================== Subcommand Handlers ====================

/**
 * 處理 /connect list
 */
async function handleConnectList(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const providerService = getProviderService();
  const providers = await providerService.getProviders(guildId);

  const connectedProviders = Object.entries(providers).filter(
    ([, connection]) => connection.connected
  );

  const embed = new EmbedBuilder()
    .setTitle('🔗 已連接的提供商')
    .setColor(0x00ff00)
    .setTimestamp();

  if (connectedProviders.length === 0) {
    embed.setDescription('目前沒有已連接的提供商\n使用 `/connect add` 來新增連接');
  } else {
    const providerList = connectedProviders.map(([providerId, connection]) => {
      const provider = PROVIDERS[providerId as OpenCodeProviderType];
      const name = provider?.name || providerId;
      const connectedAt = connection.connectedAt
        ? new Date(connection.connectedAt).toLocaleString('zh-TW')
        : '未知';

      return [
        `**${name}**`,
        `  ✅ 已連接`,
        `  📅 連接時間: ${connectedAt}`,
      ].join('\n');
    }).join('\n\n');

    embed.setDescription(providerList);
  }

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral],
  });
}

/**
 * 處理 /connect add
 */
async function handleConnectAdd(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  const providerId = interaction.options.getString('provider') as OpenCodeProviderType;

  // 從環境變數獲取對應的 API Key
  const envKeyMap: Record<OpenCodeProviderType, string> = {
    'opencode-zen': 'OPENCODE_ZEN_API_KEY',
    'opencode-go': 'OPENCODE_GO_API_KEY',
    'anthropic': 'ANTHROPIC_API_KEY',
    'openai': 'OPENAI_API_KEY',
  };

  const envKeyName = envKeyMap[providerId];
  const apiKey = process.env[envKeyName];

  if (!apiKey) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle('❌ 未設定 API Key')
          .setDescription(`請在 .env 檔案中設定 ${envKeyName} 環境變數`)
          .addFields({
            name: '設定方式',
            value: `1. 開啟專案根目錄的 .env 檔案
2. 添加：${envKeyName}=your_api_key_here
3. 重新啟動 Bot`,
            inline: false,
          }),
      ],
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // 顯示正在驗證
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const providerService = getProviderService();
  const provider = PROVIDERS[providerId];

  // 驗證並添加 Provider
  const result = await providerService.addProvider(guildId, providerId, apiKey);

  const embed = new EmbedBuilder()
    .setTitle(`${provider.name} 連接`)
    .setTimestamp();

  if (result.valid) {
    embed
      .setColor(0x00ff00)
      .setDescription(`✅ **連接成功！**`)
      .addFields(
        { name: '描述', value: provider.description, inline: false },
        { name: '定價資訊', value: `[查看定價](${provider.pricingUrl})`, inline: true }
      );

    // 顯示可用模型
    if (result.models && result.models.length > 0) {
      embed.addFields({
        name: '📋 可用模型',
        value: result.models.map((m) => `• \`${m}\``).join('\n'),
        inline: false,
      });
    }

    embed.setFooter({ text: 'API Key 已加密儲存' });
  } else {
    embed
      .setColor(0xff0000)
      .setDescription(`❌ **連接失敗**`)
      .addFields({
        name: '錯誤原因',
        value: result.error || '無法驗證 API Key',
        inline: false,
      })
      .addFields({
        name: '協助',
        value: `請檢查 API Key 是否正確，然後重試`,
        inline: false,
      });
  }

  await interaction.editReply({
    embeds: [embed],
  });
}

/**
 * 處理 /connect remove
 */
async function handleConnectRemove(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const providerId = interaction.options.getString('provider') as OpenCodeProviderType;
  const providerService = getProviderService();
  const provider = PROVIDERS[providerId];

  // 檢查是否存在連接
  const existingConnection = await providerService.getProvider(guildId, providerId);

  if (!existingConnection) {
    await interaction.reply({
      content: `⚠️ ${provider.name} 尚未連接`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // 移除連接
  const removed = await providerService.removeProvider(guildId, providerId);

  if (removed) {
    const embed = new EmbedBuilder()
      .setTitle('🔌 提供商已移除')
      .setColor(0x00ff00)
      .setDescription(`**${provider.name}** 已從此伺服器移除`)
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
    });
  } else {
    await interaction.reply({
      content: '移除連接時發生錯誤',
      flags: [MessageFlags.Ephemeral],
    });
  }
}

/**
 * 處理 /connect status
 */
async function handleConnectStatus(
  interaction: ChatInputCommandInteraction,
  guildId: string
): Promise<void> {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const providerId = interaction.options.getString('provider') as OpenCodeProviderType | null;
  const providerService = getProviderService();

  const embed = new EmbedBuilder()
    .setTitle('🔍 連接狀態')
    .setTimestamp();

  if (providerId) {
    // 顯示單個 Provider 狀態
    const provider = PROVIDERS[providerId];
    const connection = await providerService.getProvider(guildId, providerId);

    if (!connection) {
      embed
        .setColor(0xffaa00)
        .setDescription(`**${provider.name}** 尚未設定`);
    } else if (connection.connected) {
      embed
        .setColor(0x00ff00)
        .setDescription(`✅ **${provider.name}** 已連接`)
        .addFields(
          { name: '描述', value: provider.description, inline: false },
          { name: '定價資訊', value: `[查看定價](${provider.pricingUrl})`, inline: true }
        );

      if (connection.connectedAt) {
        embed.addFields({
          name: '連接時間',
          value: new Date(connection.connectedAt).toLocaleString('zh-TW'),
          inline: true,
        });
      }

      if (connection.lastValidated) {
        embed.addFields({
          name: '最後驗證',
          value: new Date(connection.lastValidated).toLocaleString('zh-TW'),
          inline: true,
        });
      }
    } else {
      embed
        .setColor(0xff0000)
        .setDescription(`❌ **${provider.name}** 連接失敗`)
        .addFields({
          name: '錯誤原因',
          value: connection.validationError || '未知錯誤',
          inline: false,
        });
    }

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  } else {
    // 顯示所有 Provider 狀態
    const allProviders = await providerService.getProviders(guildId);

    const statusList = Object.entries(PROVIDERS).map(([id, provider]) => {
      const connection = allProviders[id];

      if (!connection) {
        return [
          `**${provider.name}**: ❌ 未設定`,
          `   ${provider.description}`,
        ].join('\n');
      } else if (connection.connected) {
        return [
          `**${provider.name}**: ✅ 已連接`,
          `   連接於: ${connection.connectedAt ? new Date(connection.connectedAt).toLocaleString('zh-TW') : '未知'}`,
        ].join('\n');
      } else {
        return [
          `**${provider.name}**: ❌ 連接失敗`,
          `   錯誤: ${connection.validationError || '未知'}`,
        ].join('\n');
      }
    }).join('\n\n');

    embed
      .setColor(0x00aaff)
      .setDescription(statusList)
      .setFooter({ text: '使用 /connect add 來新增連接，使用 /connect remove 來移除' });

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  }
}

export default {
  connectCommand,
  handleConnectCommand,
};
