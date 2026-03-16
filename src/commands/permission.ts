/**
 * Permission Commands - 權限管理指令
 * @description 處理 /permission 指令系列
 */

import {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
  Colors,
  MessageFlags,
} from 'discord.js';
import { PermissionService } from '../services/PermissionService.js';
import { Database } from '../database/index.js';

/**
 * 權限指令構建器
 */
export const permissionCommand = new SlashCommandBuilder()
  .setName('permission')
  .setDescription('權限管理指令')
  .setDMPermission(false)
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('check')
      .setDescription('檢查用戶權限')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('要檢查的用戶 (預設為自己)')
          .setRequired(false)
      )
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('grant')
      .setDescription('授予權限給用戶')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('要授予權限的用戶')
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('level')
          .setDescription('權限等級')
          .setRequired(true)
          .addChoices(
            { name: '管理員 (admin)', value: 'admin' },
            { name: '版主 (moderator)', value: 'moderator' },
            { name: '一般用戶 (user)', value: 'user' }
          )
      )
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('revoke')
      .setDescription('撤銷用戶權限')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('要撤銷權限的用戶')
          .setRequired(true)
      )
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('list')
      .setDescription('列出所有已授權的用戶')
  )
  .addSubcommand(
    new SlashCommandSubcommandBuilder()
      .setName('mode')
      .setDescription('設定權限模式')
      .addStringOption((option) =>
        option
          .setName('mode')
          .setDescription('權限模式')
          .setRequired(true)
          .addChoices(
            { name: '所有人 (everyone)', value: 'everyone' },
            { name: '特定用戶 (user)', value: 'user' },
            { name: '特定角色 (role)', value: 'role' }
          )
      )
  );

/**
 * 處理 /permission mode 指令
 */
async function handleMode(interaction: ChatInputCommandInteraction): Promise<void> {
  const mode = interaction.options.getString('mode') as 'everyone' | 'user' | 'role';
  const guild = interaction.guild;
  
  if (!guild) {
    await interaction.reply({
      content: '此指令只能在伺服器中使用',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // 異步操作需要先 defer
  await interaction.deferReply();

  // 檢查權限
  const permissionService = PermissionService.getInstance();
  const checkResult = await permissionService.checkPermission(
    interaction.user.id,
    guild.id,
    'admin'
  );

  if (!checkResult.allowed) {
    await interaction.editReply({
      content: '❌ 您沒有足夠的權限來設定權限模式',
    });
    return;
  }

  const success = await permissionService.setPermissionMode(guild.id, mode, 'user');

  if (success) {
    const embed = new EmbedBuilder()
      .setTitle('⚙️ 權限模式已更新')
      .setColor(Colors.Green)
      .setDescription(`權限模式已設定為 **${getModeName(mode)}**`)
      .addFields(
        {
          name: '📝 說明',
          value: getModeDescription(mode),
        }
      )
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
    });
  } else {
    await interaction.editReply({
      content: '❌ 設定權限模式失敗',
    });
  }
}

/**
 * 處理 /permission grant 指令
 */
async function handleGrant(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser('user');
  const level = interaction.options.getString('level') as 'admin' | 'moderator' | 'user';
  const guild = interaction.guild;
  
  if (!guild) {
    await interaction.reply({
      content: '此指令只能在伺服器中使用',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!targetUser) {
    await interaction.reply({
      content: '❌ 無法找到指定的用戶',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // 異步操作需要先 defer
  await interaction.deferReply();

  // 檢查權限
  const permissionService = PermissionService.getInstance();
  const checkResult = await permissionService.checkPermission(
    interaction.user.id,
    guild.id,
    'admin'
  );

  if (!checkResult.allowed) {
    await interaction.editReply({
      content: '❌ 您沒有足夠的權限來授予權限',
    });
    return;
  }

  // 執行授予
  const success = await permissionService.grantPermission(targetUser.id, guild.id, level);

  if (success) {
    const embed = new EmbedBuilder()
      .setTitle('✅ 權限已授予')
      .setColor(Colors.Green)
      .setDescription(
        `已授予 **${targetUser.username}** ${getLevelName(level)} 權限`
      )
      .addFields(
        {
          name: '👤 用戶',
          value: `${targetUser.username} (\`${targetUser.id}\`)`,
          inline: true,
        },
        {
          name: '📊 權限等級',
          value: getLevelEmoji(level) + ' ' + getLevelName(level),
          inline: true,
        }
      )
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
    });

    // 通知被授予權限的用戶
    try {
      await targetUser.send({
        content: `您在伺服器 **${guild.name}** 被授予了 ${getLevelName(level)} 權限`,
      });
    } catch {
      // 用戶可能關閉了 DM
    }
  } else {
    await interaction.editReply({
      content: '❌ 授予權限失敗',
    });
  }
}

/**
 * 處理 /permission revoke 指令
 */
async function handleRevoke(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  
  if (!guild) {
    await interaction.reply({
      content: '此指令只能在伺服器中使用',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // 檢查 targetUser 是否存在
  const targetUser = interaction.options.getUser('user');
  if (!targetUser) {
    await interaction.reply({
      content: '❌ 無法找到指定的用戶',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // 異步操作需要先 defer
  await interaction.deferReply();

  // 檢查權限
  const permissionService = PermissionService.getInstance();
  const checkResult = await permissionService.checkPermission(
    interaction.user.id,
    guild.id,
    'admin'
  );

  if (!checkResult.allowed) {
    await interaction.editReply({
      content: '❌ 您沒有足夠的權限來撤銷權限',
    });
    return;
  }

  // 不能撤銷伺服器擁有者的權限
  if (targetUser.id === guild.ownerId) {
    await interaction.editReply({
      content: '❌ 無法撤銷伺服器擁有者的權限',
    });
    return;
  }

  // 執行撤銷
  const success = await permissionService.revokePermission(targetUser.id, guild.id);

  if (success) {
    const embed = new EmbedBuilder()
      .setTitle('✅ 權限已撤銷')
      .setColor(Colors.Red)
      .setDescription(
        `已撤銷 **${targetUser.username}** 的權限`
      )
      .addFields(
        {
          name: '👤 用戶',
          value: `${targetUser.username} (\`${targetUser.id}\`)`,
        }
      )
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
    });
  } else {
    await interaction.editReply({
      content: '❌ 撤銷權限失敗',
    });
  }
}

/**
 * 處理 /permission list 指令
 */
async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  
  if (!guild) {
    await interaction.reply({
      content: '此指令只能在伺服器中使用',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // 異步操作需要先 defer
  await interaction.deferReply();

  // 檢查權限
  const permissionService = PermissionService.getInstance();
  const checkResult = await permissionService.checkPermission(
    interaction.user.id,
    guild.id,
    'moderator'
  );

  if (!checkResult.allowed) {
    await interaction.editReply({
      content: '❌ 您沒有足夠的權限來查看權限列表',
    });
    return;
  }

  const guildData = await Database.getInstance().getGuild(guild.id);
  
  if (!guildData) {
    await interaction.editReply({
      content: '無法獲取伺服器資料',
    });
    return;
  }

  const { permissions } = guildData;

  // 獲取允許的用戶和角色名稱
  const allowedUsers: string[] = [];
  const allowedRoles: string[] = [];

  for (const userId of permissions.allowedUsers) {
    try {
      const user = await guild.client.users.fetch(userId);
      if (user) {
        allowedUsers.push(user.username);
      }
    } catch {
      allowedUsers.push(userId);
    }
  }

  for (const roleId of permissions.allowedRoles) {
    try {
      const role = await guild.roles.fetch(roleId);
      if (role) {
        allowedRoles.push(role.name);
      }
    } catch {
      allowedRoles.push(roleId);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('📋 權限列表')
    .setColor(Colors.Blurple)
    .addFields(
      {
        name: '🔧 權限模式',
        value: getModeName(permissions.mode),
        inline: true,
      },
      {
        name: '📊 預設等級',
        value: getLevelEmoji(permissions.defaultLevel) + ' ' + getLevelName(permissions.defaultLevel),
        inline: true,
      },
      {
        name: '👥 允許的用戶',
        value: allowedUsers.length > 0 ? allowedUsers.join(', ') : '無',
        inline: false,
      },
      {
        name: '🎭 允許的角色',
        value: allowedRoles.length > 0 ? allowedRoles.join(', ') : '無',
        inline: false,
      }
    )
    .setTimestamp();

  await interaction.editReply({
    embeds: [embed],
  });
}

/**
 * 處理 /permission check 指令
 */
async function handleCheck(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser('user') || interaction.user;
  const guild = interaction.guild;
  
  if (!guild) {
    await interaction.reply({
      content: '此指令只能在伺服器中使用',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // 異步操作需要先 defer
  await interaction.deferReply();

  // 檢查權限
  const permissionService = PermissionService.getInstance();
  const userPermission = await permissionService.checkPermission(
    targetUser.id,
    guild.id,
    'user'
  );

  const embed = new EmbedBuilder()
    .setTitle('🔍 權限檢查結果')
    .setColor(userPermission.allowed ? Colors.Green : Colors.Red)
    .setDescription(
      `用戶 **${targetUser.username}** 的權限狀態`
    )
    .addFields(
      {
        name: '👤 用戶',
        value: `${targetUser.username} (\`${targetUser.id}\`)`,
        inline: true,
      },
      {
        name: '📊 權限狀態',
        value: userPermission.allowed ? '✅ 已授權' : '❌ 未授權',
        inline: true,
      },
      {
        name: '📈 權限等級',
        value: userPermission.level ? getLevelEmoji(userPermission.level) + ' ' + getLevelName(userPermission.level) : '無',
        inline: true,
      }
    )
    .setTimestamp();

  await interaction.editReply({
    embeds: [embed],
  });
}

/**
 * 指令執行器
 */
export async function executePermissionCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'check':
      await handleCheck(interaction);
      break;
    case 'grant':
      await handleGrant(interaction);
      break;
    case 'revoke':
      await handleRevoke(interaction);
      break;
    case 'list':
      await handleList(interaction);
      break;
    case 'mode':
      await handleMode(interaction);
      break;
    default:
      await interaction.reply({
        content: '未知的子指令',
        flags: [MessageFlags.Ephemeral],
      });
  }
}

// ==================== 輔助函數 ====================

/**
 * 獲取權限等級顯示名稱
 */
function getLevelName(level: string): string {
  const names: Record<string, string> = {
    admin: '管理員',
    moderator: '版主',
    user: '一般用戶',
    none: '無權限',
  };
  return names[level] || level;
}

/**
 * 獲取權限等級 Emoji
 */
function getLevelEmoji(level: string): string {
  const emojis: Record<string, string> = {
    admin: '🔑',
    moderator: '🛡️',
    user: '👤',
    none: '❌',
  };
  return emojis[level] || '❓';
}

/**
 * 獲取權限模式顯示名稱
 */
function getModeName(mode: string): string {
  const names: Record<string, string> = {
    everyone: '所有人',
    user: '特定用戶',
    role: '特定角色',
  };
  return names[mode] || mode;
}

/**
 * 獲取權限模式描述
 */
function getModeDescription(mode: string): string {
  const descriptions: Record<string, string> = {
    everyone: '伺服器所有成員都可以使用 Bot',
    user: '只有被授權的用戶可以使用 Bot',
    role: '只有擁有特定角色的成員可以使用 Bot',
  };
  return descriptions[mode] || '';
}

export default {
  command: permissionCommand,
  execute: executePermissionCommand,
};