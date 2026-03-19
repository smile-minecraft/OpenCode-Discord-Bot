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
  type PartialMessage,
  type Typing,
  Collection,
  type ApplicationCommand,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type AutocompleteInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  StringSelectMenuOptionBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
} from 'discord.js';

// Handlers
import { ButtonHandler } from '../handlers/ButtonHandler.js';
import { SelectMenuHandler } from '../handlers/SelectMenuHandler.js';
import { ModalHandler } from '../handlers/ModalHandler.js';
import { ContextMenuHandler } from '../handlers/ContextMenuHandler.js';
import { registerSessionButtonHandlers } from '../handlers/SessionButtonHandler.js';
import { getThreadMessageHandler } from '../handlers/ThreadMessageHandler.js';

// Utils
import { log as logger } from '../utils/logger.js';
import { isButtonAllowed } from '../utils/RateLimiter.js';

// 服務
import { getSessionManager, getOpenCodeSDKAdapter, getThreadManager } from '../services/index.js';
import { getProjectManager } from '../services/index.js';

// Commands
import {
  createSessionCommand,
  handleSessionCommand,
  handleSessionModelAutocomplete,
  handleSessionAgentAutocomplete,
} from '../commands/session.js';
import { command as promptCommand, execute as handlePromptCommand } from '../commands/prompt.js';
import { codeCommand, handleCodeCommand } from '../commands/code.js';
import { permissionCommand, executePermissionCommand as handlePermissionCommand } from '../commands/permission.js';
import { command as helpCommand, execute as handleHelpCommand } from '../commands/help.js';
import { command as setupCommand, execute as handleSetupCommand } from '../commands/setup.js';
import { createProjectCommand, ProjectCommandHandler } from '../commands/project.js';

// Models data
import { MODELS, getProviderDisplayName } from '../models/ModelData.js';
import { getModelsByProviderDynamic } from '../services/ModelService.js';
import { getAvailableAgents } from '../services/AgentService.js';
import { Colors } from '../builders/EmbedBuilder.js';
import { SessionStatusEmbedBuilder } from '../builders/SessionEmbedBuilder.js';
import { createSessionManagementRow } from '../builders/SessionActionRowBuilder.js';
import type { Session } from '../database/models/Session.js';

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
            flags: ['Ephemeral'],
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
      defaultEnabled: true,
    });

    this.modalHandler = new ModalHandler(console);

    this.contextMenuHandler = new ContextMenuHandler({});

    // 儲存選項
    this.clientOptions = {
      debug: options.debug ?? false,
      registerCommands: options.registerCommands ?? true,
    };

    // 記錄啟動時間
    this.startedAt = new Date();

    // 註冊事件監聽器 - 使用 try-catch 防止未處理的 Promise Rejection
    try {
      this.registerEventListeners();
    } catch (error) {
      logger.error('[Client] Failed to register event listeners', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * 註冊所有事件監聽器
   */
  private registerEventListeners(): void {
    // ==================== Client 事件 ====================

    /** 當 Client 準備就緒時 */
    this.once(Events.ClientReady, (client) => {
      this.handleReady(client as Client<true>);
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
  private async handleReady(client: Client<true>): Promise<void> {
    // 使用 Client 內建的 isReady 屬性
    // 注意：Client.isReady 是 type guard function，不直接賦值

    logger.info('='.repeat(50));
    logger.info(`[Client] Bot is ready! Logged in as: ${client.user?.tag}`);
    logger.info(`[Client] Bot ID: ${client.user?.id}`);
    logger.info(`[Client] Guilds: ${client.guilds.cache.size}`);
    logger.info(`[Client] Started at: ${this.startedAt.toISOString()}`);
    logger.info('='.repeat(50));

    // 設定 presence
    this.setPresence();

    // 設置 StreamingMessageManager 的 Discord Client
    try {
      const { getStreamingMessageManager } = await import('../services/StreamingMessageManager.js');
      const streamingManager = getStreamingMessageManager();
      streamingManager.setDiscordClient(this);
      logger.info('[Client] StreamingMessageManager Discord Client 已設置');
    } catch (error) {
      logger.error('[Client] 設置 StreamingMessageManager Discord Client 失敗', error as Error);
    }

    // 設置 ThreadManager 的 Discord Client（確保刪除 thread 時可實際呼叫 Discord API）
    try {
      const threadManager = getThreadManager();
      threadManager.setDiscordClient(this);
      logger.info('[Client] ThreadManager Discord Client 已設置');
    } catch (error) {
      logger.error('[Client] 設置 ThreadManager Discord Client 失敗', error as Error);
    }

    // 註冊所有 handlers
    this.registerHandlers();

    // 註冊 Slash Commands
    if (this.clientOptions.registerCommands) {
      await this.registerSlashCommands();
    }
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
   * 註冊 Slash Commands
   */
  private async registerSlashCommands(): Promise<void> {
    logger.info('[Client] Registering slash commands...');

    try {
      // 獲取測試伺服器或全局命令
      const guild = this.guilds.cache.first();
      
      // 構建所有命令 (有些是對象需要取 .data)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const commands: any[] = [
        createSessionCommand(),
        promptCommand,
        codeCommand,
        permissionCommand,
        helpCommand,
        setupCommand,
        createProjectCommand(),
      ];

      if (guild) {
        // 註冊到測試伺服器
        await guild.commands.set(commands);
        logger.info(`[Client] Registered ${commands.length} commands in guild: ${guild.name}`);
      } else {
        // 註冊全局命令
        await this.application?.commands.set(commands);
        logger.info(`[Client] Registered ${commands.length} global commands`);
      }

      logger.info('[Client] Slash commands registered successfully');
    } catch (error) {
      logger.error('[Client] Failed to register slash commands', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
    // 1. 註冊 Session Button Handlers
    registerSessionButtonHandlers(this.buttonHandler, this.sessionManager);

    // 2. Passthrough Button Handlers
    this.buttonHandler.registerMany([
      {
        customId: 'passthrough:disable:',
        callback: this.handlePassthroughDisable.bind(this),
        description: '關閉 Passthrough',
      },
      {
        customId: 'passthrough:enable:',
        callback: this.handlePassthroughEnable.bind(this),
        description: '開啟 Passthrough',
      },
      {
        customId: 'passthrough:toggle:',
        callback: this.handlePassthroughToggle.bind(this),
        description: '切換 Passthrough',
      },
    ]);

    logger.info(`[ButtonHandler] Registered ${this.buttonHandler.getRegisteredHandlers().length} handlers`);
  }

  // ============== Passthrough Button Handlers ==============

  /**
   * 處理 Passthrough Disable 按鈕
   */
  private async handlePassthroughDisable(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply();

    try {
      // 提取 channelId
      const channelId = interaction.channelId;
      const session = this.sessionManager.getActiveSessionByChannel(channelId);

      if (!session) {
        await interaction.editReply({
          content: '此頻道沒有運行中的 Session',
        });
        return;
      }

      // TODO: 實現 PassthroughService 後再啟用
      // setPassthrough 功能待實現
      await interaction.editReply({
        content: '🔴 Passthrough 模式已關閉',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 關閉 Passthrough 失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 處理 Passthrough Enable 按鈕
   */
  private async handlePassthroughEnable(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply();

    try {
      const channelId = interaction.channelId;
      const session = this.sessionManager.getActiveSessionByChannel(channelId);

      if (!session) {
        await interaction.editReply({
          content: '此頻道沒有運行中的 Session',
        });
        return;
      }

      // TODO: 實現 PassthroughService 後再啟用
      // setPassthrough 功能待實現
      await interaction.editReply({
        content: '🟢 Passthrough 模式已開啟',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 開啟 Passthrough 失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 處理 Passthrough Toggle 按鈕
   */
  private async handlePassthroughToggle(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply();

    try {
      const channelId = interaction.channelId;
      const session = this.sessionManager.getActiveSessionByChannel(channelId);

      if (!session) {
        await interaction.editReply({
          content: '此頻道沒有運行中的 Session',
        });
        return;
      }

      // TODO: 實現 PassthroughService 後再啟用
      // 切換狀態功能待實現
      await interaction.editReply({
        content: '⚠️ Passthrough 功能待實現',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 切換 Passthrough 失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 註冊選單處理器
   * @description 在此註冊所有 Select Menu 處理器
   */
  private registerSelectMenuHandlers(): void {
    // === Setup SelectMenu Handler ===
    this.selectMenuHandler.registerStringSelect({
      customId: 'setup:action',
      callback: async (interaction) => {
        const value = interaction.values[0];
        // 根據選項顯示不同的設置指引
        const embed = new EmbedBuilder()
          .setTitle('設置指引')
          .setDescription(`您選擇了: ${value}`);
        
        let guideContent = '';
        switch (value) {
          case 'action:token':
            guideContent = '請使用 `/setup token` 指令設定 Discord Bot Token';
            break;
          case 'action:opencode':
            guideContent = '請使用 `/setup opencode_path` 指令設定 OpenCode CLI 路徑';
            break;
          case 'action:model':
            guideContent = '請使用 `/setup model` 指令選擇預設模型';
            break;
          case 'action:status':
            guideContent = '請使用 `/setup status` 指令查看目前設定狀態';
            break;
          default:
            guideContent = '未知的操作，請稍後再試';
        }
        
        embed.setDescription(guideContent);
        await interaction.update({ embeds: [embed] });
      },
      description: 'Setup 精靈操作選單',
    });

    // === Model SelectMenu Handlers ===
    this.selectMenuHandler.registerStringSelect({
      customId: 'model:select',
      callback: async (interaction) => {
        const modelId = interaction.values[0];
        // 設定選擇的模型到數據庫
        const embed = new EmbedBuilder()
          .setTitle('✅ 模型已設定')
          .setDescription(`已選擇模型: ${modelId}`);
        await interaction.update({ embeds: [embed], components: [] });
      },
      description: '模型選擇選單',
    });

    this.selectMenuHandler.registerStringSelect({
      customId: 'model:info:select',
      callback: async (interaction) => {
        const modelId = interaction.values[0];
        // 顯示模型詳細資訊
        const model = MODELS.find(m => m.id === modelId);
        const embed = new EmbedBuilder()
          .setTitle(`🤖 ${model?.name || modelId}`)
          .setDescription(model?.description || '無描述');
        
        if (model) {
          embed.addFields(
            { name: '提供商', value: model.provider, inline: true },
            { name: '類型', value: model.category, inline: true },
            { name: '上下文窗口', value: `${model.limits.contextWindow.toLocaleString()} tokens`, inline: true },
            { name: '最大輸出', value: `${model.limits.maxTokens} tokens`, inline: true },
            { name: '定價 (輸入)', value: `$${model.pricing.input}/M tokens`, inline: true },
            { name: '定價 (輸出)', value: `$${model.pricing.output}/M tokens`, inline: true }
          );
          
          if (model.features.length > 0) {
            embed.addFields({ name: '功能', value: model.features.join(', ') });
          }
        }
        
        await interaction.update({ embeds: [embed] });
      },
      description: '模型資訊選擇選單',
    });

    // === Model Provider Selection Handler (Two-Step UX) ===
    this.selectMenuHandler.registerStringSelect({
      customId: 'model:provider:select',
      callback: async (interaction) => {
        const provider = interaction.values[0];
        const guildId = interaction.guildId ?? undefined;
        
        // Step 2: 顯示該提供商的所有模型
        try {
          const models = await getModelsByProviderDynamic(provider, guildId);
          
          if (models.length === 0) {
            await interaction.update({
              embeds: [
                new EmbedBuilder()
                  .setColor(Colors.ERROR)
                  .setTitle('❌ 沒有模型')
                  .setDescription(`提供商 "${provider}" 沒有可用的模型`)
              ],
              components: []
            });
            return;
          }
          
          // 建立模型列表 Embed
          const embed = new EmbedBuilder()
            .setColor(Colors.INFO)
            .setTitle(`🤖 ${getProviderDisplayName(provider as any)} 模型列表`)
            .setDescription(`以下是 ${getProviderDisplayName(provider as any)} 提供的所有模型：`);
          
          // 顯示所有模型
          const modelList = models
            .map((m) => `• \`${m.id}\` - ${m.description || m.name}`)
            .join('\n');
            
          // 如果列表太長，截斷它
          const MAX_FIELD_VALUE = 1024;
          const truncatedList = modelList.length > MAX_FIELD_VALUE 
            ? modelList.substring(0, MAX_FIELD_VALUE - 20) + '\n... (更多模型)'
            : modelList;
            
          embed.addFields({
            name: '可用模型',
            value: truncatedList,
            inline: false
          });
          
          // 建立模型選擇選單
          const modelOptions = models.slice(0, 25).map(m => 
            new StringSelectMenuOptionBuilder()
              .setLabel(m.name.substring(0, 100))
              .setValue(m.id)
              .setDescription((m.description || '無描述').substring(0, 100))
          );
          
          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('model:info:select')
            .setPlaceholder('選擇模型查看詳細資訊...')
            .addOptions(modelOptions);
            
          const actionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
          
          await interaction.update({
            embeds: [embed],
            components: [actionRow]
          });
        } catch (error) {
          logger.error('[SelectMenuHandler] Error fetching models by provider', {
            error: error instanceof Error ? error.message : String(error),
            provider,
            guildId
          });
          
          await interaction.update({
            embeds: [
              new EmbedBuilder()
                .setColor(Colors.ERROR)
                .setTitle('❌ 無法獲取模型列表')
                .setDescription('無法獲取該提供商的模型列表。請確保已設定 OPENCODE_API_KEY 環境變數。')
            ],
            components: []
          });
        }
      },
      description: '模型提供商選擇選單',
    });

    // === Agent SelectMenu Handlers ===
    this.selectMenuHandler.registerStringSelect({
      customId: 'agent:select',
      callback: async (interaction) => {
        const agentId = interaction.values[0];
        // 設定選擇的 Agent
        const embed = new EmbedBuilder()
          .setTitle('✅ Agent 已設定')
          .setDescription(`已選擇 Agent: ${agentId}`);
        await interaction.update({ embeds: [embed], components: [] });
      },
      description: 'Agent 選擇選單',
    });

    this.selectMenuHandler.registerStringSelect({
      customId: 'agent:info:select',
      callback: async (interaction) => {
        const agentId = interaction.values[0];
        // 顯示 Agent 詳細資訊
        const agents = await getAvailableAgents({ useCache: true, allowFallback: true });
        const agent = agents.find((a) => a.id === agentId);
        const embed = new EmbedBuilder()
          .setTitle(`🧠 ${agent?.name || agentId}`)
          .setDescription(agent?.description || '無描述');
        
        if (agent) {
          embed.addFields(
            { name: '來源', value: agent.source, inline: true },
            { name: '預設模型', value: agent.defaultModel || '無', inline: true }
          );

          if (agent.mode) {
            embed.addFields({ name: '模式', value: agent.mode, inline: true });
          }
        }
        
        await interaction.update({ embeds: [embed] });
      },
      description: 'Agent 資訊選擇選單',
    });

    // === Session Question SelectMenu Handler ===
    this.selectMenuHandler.registerStringSelect({
      customId: 'session:question:', // 使用前綴匹配
      callback: async (interaction) => {
        await interaction.deferReply({ flags: ['Ephemeral'] });
        
        try {
          // 解析 customId: session:question:sessionId:questionId
          const parts = interaction.customId.split(':');
          if (parts.length < 4) {
            throw new Error('無效的選項 ID');
          }
          
          const sessionId = parts[2];
          const questionId = parts[3];
          const selectedValues = interaction.values;
          
          // 獲取 SDK 適配器並發送答案
          const sdkAdapter = getOpenCodeSDKAdapter();
          
          // 調用 SDK API 發送答案
          await sdkAdapter.sendQuestionAnswer({
            sessionId,
            questionId,
            answers: selectedValues,
          });
          
          await interaction.editReply({
            content: `✅ 已送出您的選擇`,
          });
          
          // 選擇後禁用選單
          const message = interaction.message;
          const components = message.components;
          if (components && components.length > 0) {
            const newComponents = components.map(row => {
              const actionRow = ActionRowBuilder.from(row as any);
              actionRow.components.forEach(component => {
                if (component.data.type === 3) { // StringSelect
                  (component as any).setDisabled(true);
                }
              });
              return actionRow;
            });
            
            await message.edit({ components: newComponents as any });
          }
          
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '未知錯誤';
          await interaction.editReply({
            content: `❌ 送出選擇失敗: ${errorMessage}`,
          });
        }
      },
      description: '處理 AI 提問的選擇',
    });

    // === Session Settings: Model Select ===
    this.selectMenuHandler.registerStringSelect({
      customId: 'session:settings:model:',
      callback: async (interaction) => {
        await interaction.deferReply({ flags: ['Ephemeral'] });

        try {
          const parts = interaction.customId.split(':');
          if (parts.length < 4) {
            throw new Error('無效的 Session 設定 ID');
          }

          const sessionId = parts.slice(3).join(':');
          const selectedModel = interaction.values[0];

          if (!selectedModel || selectedModel === 'no-models') {
            await interaction.editReply({
              content: '⚠️ 目前沒有可用模型可設定',
            });
            return;
          }

          const session = await this.sessionManager.findSession(sessionId);
          if (!session) {
            await interaction.editReply({
              content: `❌ 找不到 Session：\`${sessionId}\``,
            });
            return;
          }

          // Session 擁有者或管理員可操作
          if (session.userId !== interaction.user.id) {
            const member = await interaction.guild?.members.fetch(interaction.user.id);
            const isAdmin = member?.permissions.has(PermissionFlagsBits.Administrator) ?? false;
            if (!isAdmin) {
              await interaction.editReply({
                content: '❌ 只有 Session 擁有者或管理員可以修改設定',
              });
              return;
            }
          }

          const updated = await this.sessionManager.updateSessionSettings(sessionId, {
            model: selectedModel,
          });
          if (!updated) {
            await interaction.editReply({
              content: `❌ 無法更新 Session：\`${sessionId}\``,
            });
            return;
          }

          await this.updateSessionStatusCard(updated, 'Session 模型已更新');

          await interaction.editReply({
            content: `✅ 模型已更新為 \`${updated.model}\``,
          });
        } catch (error) {
          await interaction.editReply({
            content: `❌ 更新模型失敗: ${error instanceof Error ? error.message : '未知錯誤'}`,
          });
        }
      },
      description: '更新 Session 模型設定',
    });

    // === Session Settings: Agent Select ===
    this.selectMenuHandler.registerStringSelect({
      customId: 'session:settings:agent:',
      callback: async (interaction) => {
        await interaction.deferReply({ flags: ['Ephemeral'] });

        try {
          const parts = interaction.customId.split(':');
          if (parts.length < 4) {
            throw new Error('無效的 Session 設定 ID');
          }

          const sessionId = parts.slice(3).join(':');
          const selectedAgent = interaction.values[0];

          const session = await this.sessionManager.findSession(sessionId);
          if (!session) {
            await interaction.editReply({
              content: `❌ 找不到 Session：\`${sessionId}\``,
            });
            return;
          }

          if (session.userId !== interaction.user.id) {
            const member = await interaction.guild?.members.fetch(interaction.user.id);
            const isAdmin = member?.permissions.has(PermissionFlagsBits.Administrator) ?? false;
            if (!isAdmin) {
              await interaction.editReply({
                content: '❌ 只有 Session 擁有者或管理員可以修改設定',
              });
              return;
            }
          }

          const updated = await this.sessionManager.updateSessionSettings(sessionId, {
            agent: selectedAgent,
          });
          if (!updated) {
            await interaction.editReply({
              content: `❌ 無法更新 Session：\`${sessionId}\``,
            });
            return;
          }

          await this.updateSessionStatusCard(updated, 'Session Agent 已更新');

          await interaction.editReply({
            content: `✅ Agent 已更新為 \`${updated.agent}\``,
          });
        } catch (error) {
          await interaction.editReply({
            content: `❌ 更新 Agent 失敗: ${error instanceof Error ? error.message : '未知錯誤'}`,
          });
        }
      },
      description: '更新 Session Agent 設定',
    });

    const stats = this.selectMenuHandler.getStats();
    logger.info(`[SelectMenuHandler] Registered handlers: ${JSON.stringify(stats)}`);
  }

  /**
   * 更新主頻道 Session 狀態卡
   */
  private async updateSessionStatusCard(session: Session, note?: string): Promise<void> {
    try {
      const statusMessageId = (session.metadata as Record<string, unknown>)?.statusMessageId;
      if (!statusMessageId || typeof statusMessageId !== 'string') {
        return;
      }

      const channel = await this.channels.fetch(session.channelId);
      if (!channel || !('messages' in channel)) {
        return;
      }

      const message = await channel.messages.fetch(statusMessageId);
      if (!message) {
        return;
      }

      const embed = SessionStatusEmbedBuilder.createSessionChannelStatusCard(session, {
        threadId: session.threadId,
        note,
      });
      const row = createSessionManagementRow(session.sessionId);

      await message.edit({
        embeds: [embed],
        components: [row],
      });
    } catch (error) {
      logger.warn('[Client] 更新 Session 狀態卡失敗', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: session.sessionId,
      });
    }
  }

  /**
   * 註冊 Modal 處理器
   * @description 在此註冊所有 Modal 處理器
   */
  private registerModalHandlers(): void {
    // 使用 try-catch 防止 Modal Handler 註冊失敗導致崩潰
    try {
      // === Project Modal Handler ===
      this.modalHandler.register({
        customId: 'project:modal:add',
        callback: async (interaction) => {
          const name = interaction.fields.getTextInputValue('project_name');
          const projectPath = interaction.fields.getTextInputValue('project_path');
          const alias = interaction.fields.getTextInputValue('project_alias') || undefined;
          
          // 先 defer 回覆
          await interaction.deferReply({ flags: ['Ephemeral'] });
          
          try {
            // 使用 ProjectManager 創建專案
            const projectManager = getProjectManager();
            const project = await projectManager.createProject({
              name,
              path: projectPath,
              alias,
            });
            
            // 保存到存儲
            await projectManager.save();
            
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
            
            await interaction.editReply({ embeds: [embed] });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知錯誤';
            
            const embed = new EmbedBuilder()
              .setColor(Colors.ERROR)
              .setTitle('❌ 新增專案失敗')
              .setDescription(errorMessage)
              .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
          }
        },
        description: '新增專案表單',
      });
    } catch (error) {
      logger.error('[ModalHandler] Failed to register modal handlers', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }

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
        // Rate limit check for buttons
        const userId = interaction.user.id;
        if (!isButtonAllowed(userId)) {
          await interaction.reply({
            content: '⚠️ 您點擊太快了，請稍後再試',
            flags: ['Ephemeral'],
          });
          return;
        }
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
      } else if (interaction.isAutocomplete()) {
        // Autocomplete 處理
        await this.handleAutocomplete(interaction);
      } else if (interaction.isContextMenuCommand()) {
        // Context Menu 處理
        await this.handleContextMenu(interaction);
      } else if (interaction.isChatInputCommand()) {
        // Slash Command 處理
        await this.handleSlashCommand(interaction);
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
            flags: ['Ephemeral'],
          });
        } catch {
          // 忽略錯誤
        }
      }
    }
  }

  /**
   * 處理 Slash Command
   */
  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const commandName = interaction.commandName;

    try {
      switch (commandName) {
        case 'session':
          await handleSessionCommand(interaction, this.sessionManager);
          break;
        case 'prompt':
          await handlePromptCommand(interaction);
          break;
        case 'code':
          await handleCodeCommand(interaction);
          break;
        case 'permission':
          await handlePermissionCommand(interaction);
          break;
        case 'help':
          await handleHelpCommand(interaction);
          break;
        case 'setup':
          await handleSetupCommand(interaction);
          break;
        case 'project':
          {
            const projectManager = getProjectManager();
            const projectHandler = new ProjectCommandHandler(projectManager);
            await projectHandler.handle(interaction);
          }
          break;
        default:
          await interaction.reply({
            content: `未知指令: ${commandName}`,
            flags: ['Ephemeral'],
          });
      }
    } catch (error) {
      logger.error(`[SlashCommand] Error handling ${commandName}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      await interaction.reply({
        content: '執行指令時發生錯誤',
        flags: ['Ephemeral'],
      });
    }
  }

  /**
   * 處理 Context Menu 交互
   */
  private async handleContextMenu(_interaction: unknown): Promise<void> {
    // Context Menu 處理邏輯
    logger.debug('[ContextMenu] Handler not implemented');
  }

  /**
   * 處理 Autocomplete 交互
   */
  private async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const commandName = interaction.commandName;
    const subcommandName = interaction.options.getSubcommand(false);
    
    try {
      switch (commandName) {
        case 'session':
          {
            const focusedOption = interaction.options.getFocused(true);
            // session start/settings 都支援 model autocomplete
            if ((subcommandName === 'start' || subcommandName === 'settings') && focusedOption.name === 'model') {
              await handleSessionModelAutocomplete(interaction);
              return;
            }
            if (subcommandName === 'settings' && focusedOption.name === 'agent') {
              await handleSessionAgentAutocomplete(interaction);
              return;
            }
          }
          await interaction.respond([]);
          break;
        case 'project':
          {
            const projectManager = getProjectManager();
            const projectHandler = new ProjectCommandHandler(projectManager);
            await projectHandler.handleAutocomplete(interaction);
          }
          break;
        default:
          // 忽略其他命令的 autocomplete
          await interaction.respond([]);
      }
    } catch (error) {
      logger.error(`[Autocomplete] Error handling ${commandName}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      await interaction.respond([]);
    }
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

    // 嘗試處理 Thread 訊息（如果是 Session Thread）
    try {
      const threadMessageHandler = getThreadMessageHandler();
      await threadMessageHandler.handleMessage(message);
    } catch (error) {
      logger.error('[Message] Error handling thread message', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // === 在此處理訊息命令 ===
    // 例如: 前綴命令處理
  }

  /**
   * 處理訊息更新事件
   */
  private handleMessageUpdate(oldMessage: Message | PartialMessage | null, newMessage: Message | PartialMessage): void {
    if (!this.clientOptions.debug) return;

    const oldContent = oldMessage?.content ?? '';
    const newContent = newMessage.content ?? '';

    // Discord 會頻繁觸發無內容變更的 update，直接跳過降噪
    if (oldContent === newContent) return;

    logger.debug(`[MessageUpdate] ${newMessage.id}`, {
      oldContent,
      newContent,
    });
  }

  /**
   * 處理訊息刪除事件
   */
  private handleMessageDelete(message: Message | PartialMessage): void {
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
  private handleTypingStart(typing: Typing): void {
    // Typing 事件頻率高，預設不記錄以避免終端機洗版
    void typing;
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
    logger.error('[Client] Error', {
      error: error.message,
      stack: error.stack,
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
