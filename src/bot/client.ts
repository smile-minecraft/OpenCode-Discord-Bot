/**
 * Discord Client - 初始化與事件註冊
 * @description Discord Bot Client 設定、Intent 配置與事件監聽器
 * 
 * 整合的服務：
 * - SessionManager: 管理 OpenCode Session 生命週期
 * - ProjectManager: 管理專案和頻道綁定
 * - QueueManager: 管理任務隊列
 * - GitWorktreeService: 管理 Git Worktree
 * - ToolApprovalService: 管理工具審批
 * - PermissionService: 管理權限
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  type Interaction,
  type Message,
  type Guild,
  Collection,
  type ApplicationCommand,
  EmbedBuilder,
} from 'discord.js';

// Handlers
import { ButtonHandler } from '../handlers/ButtonHandler.js';
import { SelectMenuHandler } from '../handlers/SelectMenuHandler.js';
import { ModalHandler } from '../handlers/ModalHandler.js';
import { ContextMenuHandler } from '../handlers/ContextMenuHandler.js';

// Utils
import { log as logger } from '../utils/logger.js';
import errorHandler from '../utils/errorHandler.js';

// 服務
import { getSessionManager } from '../services/SessionManager.js';
import { getProjectManager } from '../services/ProjectManager.js';
import { getQueueManager } from '../services/QueueManager.js';
import { getGitWorktreeService } from '../services/GitWorktreeService.js';
import { getToolApprovalService } from '../services/ToolApprovalService.js';
import { PermissionService } from '../services/PermissionService.js';

// Commands - Session
import { createSessionCommand, handleSessionCommand } from '../commands/session.js';

// Commands - Model
import { model } from '../commands/model.js';

// Commands - Agent
import { agent } from '../commands/agent.js';

// Commands - Project
import { createProjectCommand, handleProjectCommand } from '../commands/project.js';

// Commands - Worktree
import { worktreeCommand, executeWorktreeCommand } from '../commands/worktree.js';

// Commands - Queue
import { queueCommand, handleQueueCommand } from '../commands/queue.js';

// Commands - Permission
import { permissionCommand, executePermissionCommand } from '../commands/permission.js';

// Commands - Code (Passthrough)
import { codeCommand, executeCodeCommand } from '../commands/code.js';

// Commands - Voice
import { voiceCommand, executeVoiceCommand } from '../commands/voice.js';

// Builder
import { Colors } from '../builders/EmbedBuilder.js';

/**
 * Client 選項配置
 */
export interface ClientOptions {
  /** 是否啟用 debug 日誌 */
  debug?: boolean;
  /** 是否自動註冊命令 */
  registerCommands?: boolean;
  /** intents (required by discord.js) */
  intents?: number[];
}

/**
 * Discord Client 擴展類
 * @description 包含所有必要的 intents 和 handler 整合
 */
export class DiscordClient extends Client {
  // ==================== Handlers ====================

  /** 按鈕處理器 */
  public buttonHandler: ButtonHandler;

  /** 選單處理器 */
  public selectMenuHandler: SelectMenuHandler;

  /** Modal 處理器 */
  public modalHandler: ModalHandler;

  /** Context Menu 處理器 */
  public contextMenuHandler: ContextMenuHandler;

  // ==================== Services (Lazy loaded) ====================

  private _sessionManager?: ReturnType<typeof getSessionManager>;
  private _projectManager?: ReturnType<typeof getProjectManager>;
  private _queueManager?: ReturnType<typeof getQueueManager>;

  /**
   * 獲取 Session Manager
   */
  get sessionManager() {
    if (!this._sessionManager) {
      this._sessionManager = getSessionManager();
    }
    return this._sessionManager;
  }

  /**
   * 獲取 Project Manager
   */
  get projectManager() {
    if (!this._projectManager) {
      this._projectManager = getProjectManager();
    }
    return this._projectManager;
  }

  /**
   * 獲取 Queue Manager
   */
  get queueManager() {
    if (!this._queueManager) {
      this._queueManager = getQueueManager();
    }
    return this._queueManager;
  }

  // ==================== Options ====================

  /** Client 選項 */
  public clientOptions: ClientOptions & { debug: boolean; registerCommands: boolean };

  // ==================== State ====================

  /** 啟動時間戳 */
  public readonly startedAt: Date;

  /** 已註冊的指令 */
  public registeredCommands: Collection<string, ApplicationCommand> = new Collection();

  /**
   * 建立 Discord Client 實例
   * @param options Client 選項
   */
  constructor(options: ClientOptions = {}) {
    // 設定 intents
    const intents = [
      // Guild 相關
      GatewayIntentBits.Guilds,           // 伺服器資訊
      GatewayIntentBits.GuildMembers,     // 伺服器成員
      GatewayIntentBits.GuildMessages,    // 伺服器訊息
      GatewayIntentBits.GuildMessageTyping, // 訊息 typing
      GatewayIntentBits.GuildPresences,  // 成員上線狀態
      GatewayIntentBits.GuildVoiceStates, // 語音狀態

      // Direct Messages
      GatewayIntentBits.DirectMessages,   // 私訊
      GatewayIntentBits.DirectMessageTyping, // 私訊 typing

      // 訊息內容（需要 Intent 權限）
      GatewayIntentBits.MessageContent,
    ];

    // 設定 partials
    const partials = [
      Partials.Message,      // 訊息
      Partials.Channel,      // 頻道
      Partials.GuildMember,  // 伺服器成員
      Partials.User,         // 用戶
      Partials.ThreadMember, // 討論串成員
    ];

    super({
      intents,
      partials,
      // 允許暫時性暱稱
      allowedMentions: {
        parse: ['users', 'roles'],
        repliedUser: true,
      },
    });

    // 初始化 handlers
    this.buttonHandler = new ButtonHandler({
      defaultHandler: async (interaction) => {
        logger.warn(`[ButtonHandler] No handler for: ${interaction.customId}`);
        if (interaction.isRepliable()) {
          await interaction.reply({
            content: '此按鈕目前無法使用',
            ephemeral: true,
          });
        }
      },
      errorHandler: async (error) => {
        logger.error(`[ButtonHandler] Error: ${error.message}`, {
          customId: error.interaction.customId,
          stack: error.stack,
        });
      },
    });

    this.selectMenuHandler = new SelectMenuHandler({
      logCalls: options.debug ?? false,
      defaultEnabled: true,
    });

    this.modalHandler = new ModalHandler({
      logSubmits: options.debug ?? false,
    });

    this.contextMenuHandler = new ContextMenuHandler({
      logCalls: options.debug ?? false,
    });

    // 儲存選項
    this.clientOptions = {
      debug: options.debug ?? false,
      registerCommands: options.registerCommands ?? true,
    };

    // 記錄啟動時間
    this.startedAt = new Date();

    // 註冊事件監聽器
    this.registerEventListeners();
  }

  /**
   * 註冊所有事件監聽器
   */
  private registerEventListeners(): void {
    // ==================== Client 事件 ====================

    /** 當 Client 準備就緒時 */
    this.once(Events.ClientReady, (client) => {
      this.handleReady(client);
    });

    /** 當發生錯誤時 */
    this.on(Events.Error, (error) => {
      this.handleError(error);
    });

    /** 當 WebSocket 關閉時 */
    this.on(Events.ShardDisconnect, (event, id) => {
      logger.warn(`[Client] Shard ${id} disconnected`, {
        code: event.code,
        reason: event.reason,
      });
    });

    /** 當 WebSocket 重新連線時 */
    this.on(Events.ShardReconnecting, (id) => {
      logger.info(`[Client] Shard ${id} reconnecting...`);
    });

    /** 當需要重新連線時 */
    this.on(Events.ShardResume, (id, replayedEvents) => {
      logger.info(`[Client] Shard ${id} resumed, replayed ${replayedEvents} events`);
    });

    // ==================== Interaction 事件 ====================

    /** 當收到任何 interaction 時 */
    this.on(Events.InteractionCreate, (interaction) => {
      this.handleInteraction(interaction);
    });

    // ==================== Message 事件 ====================

    /** 當收到訊息時 */
    this.on(Events.MessageCreate, (message) => {
      this.handleMessageCreate(message);
    });

    /** 當訊息更新時 */
    this.on(Events.MessageUpdate, (oldMessage, newMessage) => {
      this.handleMessageUpdate(oldMessage, newMessage);
    });

    /** 當訊息刪除時 */
    this.on(Events.MessageDelete, (message) => {
      this.handleMessageDelete(message);
    });

    /** 當收到 typing 開始時 */
    this.on(Events.TypingStart, (typing) => {
      this.handleTypingStart(typing);
    });

    // ==================== Guild 事件 ====================

    /** 當加入伺服器時 */
    this.on(Events.GuildCreate, (guild) => {
      logger.info(`[Client] Joined guild: ${guild.name} (${guild.id})`);
    });

    /** 當離開伺服器時 */
    this.on(Events.GuildDelete, (guild) => {
      logger.info(`[Client] Left guild: ${guild.name} (${guild.id})`);
    });

    /** 當成員加入時 */
    this.on(Events.GuildMemberAdd, (member) => {
      this.handleGuildMemberAdd(member);
    });

    /** 當成員離開時 */
    this.on(Events.GuildMemberRemove, (member) => {
      this.handleGuildMemberRemove(member);
    });

    logger.info('[Client] Event listeners registered');
  }

  // ==================== Event Handlers ====================

  /**
   * 處理 Client 就緒事件
   */
  private handleReady(client: typeof this): void {
    this.isReady = true;

    logger.info('='.repeat(50));
    logger.info(`[Client] Bot is ready! Logged in as: ${client.user?.tag}`);
    logger.info(`[Client] Bot ID: ${client.user?.id}`);
    logger.info(`[Client] Guilds: ${client.guilds.cache.size}`);
    logger.info(`[Client] Started at: ${this.startedAt.toISOString()}`);
    logger.info('='.repeat(50));

    // 設定 presence
    this.setPresence();

    // 註冊所有 handlers
    this.registerHandlers();
  }

  /**
   * 設定 Bot 狀態
   */
  private setPresence(): void {
    if (!this.user) return;

    this.user.setPresence({
      status: 'online',
      activities: [
        {
          name: '/help | OpenCode Bot',
          type: 0, // Playing
        },
      ],
    });

    logger.info('[Client] Presence set');
  }

  /**
   * 註冊所有交互處理器
   */
  private registerHandlers(): void {
    logger.info('[Client] Registering handlers...');

    // 註冊按鈕處理器
    this.registerButtonHandlers();

    // 註冊選單處理器
    this.registerSelectMenuHandlers();

    // 註冊 Modal 處理器
    this.registerModalHandlers();

    // 註冊 Context Menu 處理器
    this.registerContextMenuHandlers();

    logger.info('[Client] All handlers registered');
  }

  /**
   * 註冊按鈕處理器
   * @description 在此註冊所有按鈕處理器
   */
  private registerButtonHandlers(): void {
    // === 在此註冊您的按鈕處理器 ===
    // 範例:
    // this.buttonHandler.register({
    //   customId: 'example_button',
    //   callback: async (interaction) => {
    //     await interaction.reply('Hello!');
    //   },
    //   description: '範例按鈕',
    // });

    logger.info(`[ButtonHandler] Registered ${this.buttonHandler.getRegisteredHandlers().length} handlers`);
  }

  /**
   * 註冊選單處理器
   * @description 在此註冊所有 Select Menu 處理器
   */
  private registerSelectMenuHandlers(): void {
    // === 在此註冊您的選單處理器 ===
    // 範例:
    // this.selectMenuHandler.registerStringSelect({
    //   customId: 'example_menu',
    //   callback: async (interaction) => {
    //     await interaction.reply('選項: ' + interaction.values[0]);
    //   },
    //   description: '範例選單',
    // });

    const stats = this.selectMenuHandler.getStats();
    logger.info(`[SelectMenuHandler] Registered handlers: ${JSON.stringify(stats)}`);
  }

  /**
   * 註冊 Modal 處理器
   * @description 在此註冊所有 Modal 處理器
   */
  private registerModalHandlers(): void {
    // === 在此註冊您的 Modal 處理器 ===
    // 範例:
    // this.modalHandler.register({
    //   customId: 'example_modal',
    //   callback: async (interaction) => {
    //     const value = interaction.fields.getTextInputValue('input_id');
    //     await interaction.reply(`您輸入: ${value}`);
    //   },
    //   description: '範例 Modal',
    // });

    const modals = this.modalHandler.getRegisteredModals();
    logger.info(`[ModalHandler] Registered ${modals.length} modals`);
  }

  /**
   * 註冊 Context Menu 處理器
   * @description 在此註冊所有 Context Menu 處理器
   */
  private registerContextMenuHandlers(): void {
    // === 在此註冊您的 Context Menu 處理器 ===
    // 範例:
    // this.contextMenuHandler.registerUser({
    //   name: 'user_menu_item',
    //   callback: async (interaction) => {
    //     await interaction.reply(`Target: ${interaction.targetUser.tag}`);
    //   },
    //   description: '用戶選單',
    // });

    logger.info('[ContextMenuHandler] Ready for registration');
  }

  /**
   * 處理所有 interaction 事件
   */
  private async handleInteraction(interaction: Interaction): Promise<void> {
    try {
      // Debug 日誌
      if (this.clientOptions.debug) {
        logger.debug(`[Interaction] ${interaction.type}: ${interaction.id}`, {
          channelId: interaction.channelId,
          userId: interaction.user.id,
          guildId: interaction.guildId,
        });
      }

      // 根據 interaction 類型分發
      if (interaction.isButton()) {
        await this.buttonHandler.handle(interaction);
      } else if (interaction.isStringSelectMenu()) {
        await this.selectMenuHandler.handle(interaction);
      } else if (interaction.isChannelSelectMenu()) {
        await this.selectMenuHandler.handle(interaction);
      } else if (interaction.isRoleSelectMenu()) {
        await this.selectMenuHandler.handle(interaction);
      } else if (interaction.isUserSelectMenu()) {
        await this.selectMenuHandler.handle(interaction);
      } else if (interaction.isMentionableSelectMenu()) {
        await this.selectMenuHandler.handle(interaction);
      } else if (interaction.isModalSubmit()) {
        await this.modalHandler.handle(interaction);
      } else if (interaction.isContextMenuCommand()) {
        // Context Menu 處理
        await this.handleContextMenu(interaction);
      }
    } catch (error) {
      logger.error('[Interaction] Error handling interaction', {
        error: error instanceof Error ? error.message : String(error),
        interactionId: interaction.id,
        type: interaction.type,
      });

      // 嘗試回應用戶
      if (interaction.isRepliable() && !interaction.replied) {
        try {
          await interaction.reply({
            content: '處理互動時發生錯誤，請稍後再試',
            ephemeral: true,
          });
        } catch {
          // 忽略錯誤
        }
      }
    }
  }

  /**
   * 處理 Context Menu 交互
   */
  private async handleContextMenu(interaction: unknown): Promise<void> {
    // Context Menu 處理邏輯
    logger.debug('[ContextMenu] Handler not implemented');
  }

  /**
   * 處理訊息創建事件
   */
  private async handleMessageCreate(message: Message): Promise<void> {
    // 忽略機器人訊息
    if (message.author.bot) return;

    // Debug 日誌
    if (this.clientOptions.debug) {
      logger.debug(`[Message] ${message.author.tag}: ${message.content.substring(0, 50)}`, {
        channelId: message.channelId,
        guildId: message.guildId,
      });
    }

    // === 在此處理訊息命令 ===
    // 例如: 前綴命令處理
  }

  /**
   * 處理訊息更新事件
   */
  private handleMessageUpdate(oldMessage: Message | null, newMessage: Message): void {
    if (this.clientOptions.debug) {
      logger.debug(`[MessageUpdate] ${newMessage.id}`, {
        oldContent: oldMessage?.content,
        newContent: newMessage.content,
      });
    }
  }

  /**
   * 處理訊息刪除事件
   */
  private handleMessageDelete(message: Message): void {
    if (this.clientOptions.debug) {
      logger.debug(`[MessageDelete] ${message.id}`, {
        channelId: message.channelId,
        guildId: message.guildId,
      });
    }
  }

  /**
   * 處理 typing 開始事件
   */
  private handleTypingStart(typing: { userId: string; channelId: string; guildId?: string }): void {
    if (this.clientOptions.debug) {
      logger.debug(`[Typing] User ${typing.userId} in channel ${typing.channelId}`);
    }
  }

  /**
   * 處理成員加入事件
   */
  private handleGuildMemberAdd(member: { id: string; user: { tag: string }; guild: { name: string } }): void {
    logger.info(`[GuildMemberAdd] ${member.user.tag} joined ${member.guild.name}`);
  }

  /**
   * 處理成員離開事件
   */
  private handleGuildMemberRemove(member: { id: string; user: { tag: string }; guild: { name: string } }): void {
    logger.info(`[GuildMemberRemove] ${member.user.tag} left ${member.guild.name}`);
  }

  /**
   * 處理錯誤事件
   */
  private handleError(error: Error): void {
    errorHandler.handleError(error, {
      context: 'DiscordClient',
      showToUser: false,
    });
  }
}

/**
 * 建立 Discord Client 工廠函數
 * @param options Client 選項
 * @returns DiscordClient 實例
 */
export function createDiscordClient(options?: ClientOptions): DiscordClient {
  return new DiscordClient(options);
}

export default DiscordClient;
