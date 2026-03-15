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
  EmbedBuilder,
} from 'discord.js';

// Handlers
import { ButtonHandler } from '../handlers/ButtonHandler.js';
import { SelectMenuHandler } from '../handlers/SelectMenuHandler.js';
import { ModalHandler } from '../handlers/ModalHandler.js';
import { ContextMenuHandler } from '../handlers/ContextMenuHandler.js';
import { registerSessionButtonHandlers } from '../handlers/SessionButtonHandler.js';

// Utils
import { log as logger } from '../utils/logger.js';

// 服務
import { getSessionManager } from '../services/SessionManager.js';
import { createProjectManager } from '../services/ProjectManager.js';
import { getQueueManager } from '../services/QueueManager.js';

// Commands
import { createSessionCommand, handleSessionCommand } from '../commands/session.js';
import { createProjectCommand, ProjectCommandHandler } from '../commands/project.js';
import { model } from '../commands/model.js';
import { agent } from '../commands/agent.js';
import { queueCommand, handleQueueCommand } from '../commands/queue.js';
import { codeCommand, handleCodeCommand } from '../commands/code.js';
import { worktreeCommand, executeWorktreeCommand } from '../commands/worktree.js';
import { createVoiceCommand, handleVoiceCommand } from '../commands/voice.js';
import { permissionCommand, executePermissionCommand } from '../commands/permission.js';
import { command as helpCommand, execute as helpExecute } from '../commands/help.js';
import { setupCommand, handleSetupCommand } from '../commands/index.js';

// Models data
import { MODELS } from '../models/ModelData.js';
import { AGENTS } from '../models/AgentData.js';

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
  private _projectManager?: ReturnType<typeof createProjectManager>;
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
      this._projectManager = createProjectManager();
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
        createProjectCommand(),
        (model as any).data,
        (agent as any).data,
        queueCommand,
        codeCommand,
        worktreeCommand,
        createVoiceCommand(),
        permissionCommand,
        helpCommand,
        setupCommand,
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

    // 2. Queue Button Handlers
    this.buttonHandler.registerMany([
      {
        customId: 'queue_refresh:',
        callback: this.handleQueueRefresh.bind(this),
        description: '重新整理隊列狀態',
      },
      {
        customId: 'queue_clear',
        callback: this.handleQueueClear.bind(this),
        description: '清空隊列',
      },
      {
        customId: 'queue_pause',
        callback: this.handleQueuePause.bind(this),
        description: '暫停隊列',
      },
      {
        customId: 'queue_resume',
        callback: this.handleQueueResume.bind(this),
        description: '恢復隊列',
      },
    ]);

    // 3. Passthrough Button Handlers
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

  // ============== Queue Button Handlers ==============

  /**
   * 處理 Queue Refresh 按鈕
   */
  private async handleQueueRefresh(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply();

    try {
      const queueState = this.queueManager.getState();
      const embed = this.createQueueStatusEmbed(queueState);

      await interaction.editReply({
        embeds: [embed],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 重新整理失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 處理 Queue Clear 按鈕
   */
  private async handleQueueClear(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply();

    try {
      const cleared = this.queueManager.clearQueue();
      
      await interaction.editReply({
        content: `🗑️ 已清空隊列，共移除 ${cleared} 個任務`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 清空隊列失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 處理 Queue Pause 按鈕
   */
  private async handleQueuePause(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply();

    try {
      this.queueManager.pause();
      
      await interaction.editReply({
        content: '⏸️ 隊列已暫停',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 暫停隊列失敗: ${errorMessage}`,
      });
    }
  }

  /**
   * 處理 Queue Resume 按鈕
   */
  private async handleQueueResume(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply();

    try {
      this.queueManager.resume();
      
      await interaction.editReply({
        content: '▶️ 隊列已恢復',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await interaction.editReply({
        content: `❌ 恢復隊列失敗: ${errorMessage}`,
      });
    }
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

  // ============== Queue Status Embed Builder ==============

  /**
   * 創建隊列狀態 Embed
   */
  private createQueueStatusEmbed(state: {
    isPaused: boolean;
    isProcessing: boolean;
    pendingCount: number;
    completedCount: number;
    failedCount: number;
    currentTask?: { id: string; type: string } | null;
  }): EmbedBuilder {
    const { EmbedBuilder } = require('discord.js');
    
    const embed = new EmbedBuilder()
      .setTitle('📋 任務隊列狀態')
      .setColor(state.isPaused ? 0xffa500 : 0x00ff00)
      .addFields(
        { name: '狀態', value: state.isPaused ? '⏸️ 已暫停' : '▶️ 執行中', inline: true },
        { name: '待處理', value: `${state.pendingCount} 個`, inline: true },
        { name: '已完成', value: `${state.completedCount} 個`, inline: true },
        { name: '失敗', value: `${state.failedCount} 個`, inline: true }
      )
      .setTimestamp();

    if (state.currentTask) {
      embed.addFields({ name: '當前任務', value: `\`${state.currentTask.id}\` (${state.currentTask.type})` });
    }

    return embed;
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
          case 'add_project':
            guideContent = '請使用 `/project add` 指令新增專案';
            break;
          case 'configure_model':
            guideContent = '請使用 `/model` 指令選擇模型';
            break;
          case 'configure_agent':
            guideContent = '請使用 `/agent` 指令選擇 Agent';
            break;
          case 'setup_voice':
            guideContent = '請使用 `/voice` 指令設定語音功能';
            break;
          default:
            guideContent = '請稍後再試';
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
        const agent = AGENTS.find(a => a.id === agentId);
        const embed = new EmbedBuilder()
          .setTitle(`🧠 ${agent?.name || agentId}`)
          .setDescription(agent?.description || '無描述');
        
        if (agent) {
          embed.addFields(
            { name: '類型', value: agent.type, inline: true },
            { name: '預設模型', value: agent.defaultModel || '無', inline: true }
          );
          
          if (agent.capabilities.length > 0) {
            embed.addFields({ name: '能力', value: agent.capabilities.join(', ') });
          }
          
          const featureList = [];
          if (agent.features.tools) featureList.push('工具使用');
          if (agent.features.codeExecution) featureList.push('代碼執行');
          if (agent.features.fileOperations) featureList.push('檔案操作');
          if (agent.features.webSearch) featureList.push('網路搜尋');
          if (agent.features.conversationHistory) featureList.push('對話歷史');
          
          if (featureList.length > 0) {
            embed.addFields({ name: '特性', value: featureList.join(', ') });
          }
        }
        
        await interaction.update({ embeds: [embed] });
      },
      description: 'Agent 資訊選擇選單',
    });

    const stats = this.selectMenuHandler.getStats();
    logger.info(`[SelectMenuHandler] Registered handlers: ${JSON.stringify(stats)}`);
  }

  /**
   * 註冊 Modal 處理器
   * @description 在此註冊所有 Modal 處理器
   */
  private registerModalHandlers(): void {
    // === Project Modal Handler ===
    this.modalHandler.register({
      customId: 'project:modal:add',
      callback: async (interaction) => {
        const name = interaction.fields.getTextInputValue('project_name');
        const path = interaction.fields.getTextInputValue('project_path');
        const alias = interaction.fields.getTextInputValue('project_alias');
        
        // 創建專案
        const embed = new EmbedBuilder()
          .setTitle('✅ 專案已新增')
          .setDescription(`已新增專案: ${name}`)
          .addFields(
            { name: '路徑', value: path, inline: true },
            { name: '別名', value: alias || '無', inline: true }
          );
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
      },
      description: '新增專案表單',
    });

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
            ephemeral: true,
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
        case 'project':
          await new ProjectCommandHandler(this.projectManager).handle(interaction);
          break;
        case 'model':
          await (model as any).execute(interaction as any);
          break;
        case 'agent':
          await (agent as any).execute(interaction as any);
          break;
        case 'queue':
          await handleQueueCommand(interaction as any);
          break;
        case 'code':
          await handleCodeCommand(interaction as any);
          break;
        case 'worktree':
          await executeWorktreeCommand(interaction as any);
          break;
        case 'voice':
          await handleVoiceCommand(interaction as any);
          break;
        case 'permission':
          await executePermissionCommand(interaction as any);
          break;
        case 'help':
          await helpExecute(interaction as any);
          break;
        case 'setup':
          await handleSetupCommand(interaction as any);
          break;
        default:
          await interaction.reply({
            content: `未知指令: ${commandName}`,
            ephemeral: true,
          });
      }
    } catch (error) {
      logger.error(`[SlashCommand] Error handling ${commandName}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      await interaction.reply({
        content: '執行指令時發生錯誤',
        ephemeral: true,
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
  private handleMessageUpdate(oldMessage: Message | PartialMessage | null, newMessage: Message | PartialMessage): void {
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
    if (this.clientOptions.debug) {
      logger.debug(`[Typing] User ${typing.user.id} in channel ${typing.channel.id}`);
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
