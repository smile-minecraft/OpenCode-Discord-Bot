/**
 * Tool Approval Service - 工具審批服務
 * @description 攔截工具執行請求，發送審批請求到 Discord
 */

import {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  Colors,
  Message,
  GuildTextBasedChannel,
} from 'discord.js';
import { PermissionService, type ToolExecutionRequest, type ApprovalAction, type ToolApprovalRecord } from './PermissionService.js';
import { log as logger } from '../utils/logger.js';

/**
 * 工具審批配置
 */
export interface ToolApprovalConfig {
  /** 是否啟用工具審批 */
  enabled: boolean;
  /** 自動批准的工具清單 */
  autoApprovedTools: string[];
  /** 需要審批的工具清單 */
  requireApprovalTools: string[];
  /** 審批超時時間 (毫秒) */
  approvalTimeout: number;
  /** 審批頻道 ID */
  approvalChannelId?: string;
}

/**
 * 工具模式匹配結果
 */
export interface ToolPatternMatch {
  /** 是否匹配 */
  matched: boolean;
  /** 匹配的工具名稱 */
  matchedTool?: string;
  /** 匹配的模式 */
  pattern?: string;
  /** 是否為精確匹配 */
  isExactMatch: boolean;
}

/**
 * 預設配置
 */
const defaultConfig: ToolApprovalConfig = {
  enabled: true,
  autoApprovedTools: [
    'read_file',
    'read_multiple_files',
    'search_files',
    'list_directory',
    'grep',
  ],
  requireApprovalTools: [
    'write_file',
    'edit_file',
    'delete_file',
    'bash',
    'execute_command',
    'install_package',
    'git_command',
  ],
  approvalTimeout: 5 * 60 * 1000, // 5 分鐘
};

/**
 * 待審批的請求
 */
interface PendingApproval {
  request: ToolExecutionRequest;
  message: Message | null;
  resolve: (action: ApprovalAction) => void;
  timeout: NodeJS.Timeout;
  channelId: string;
}

/**
 * Tool Approval Service 類別
 * @description 管理工具執行的審批流程
 */
export class ToolApprovalService {
  private static instance: ToolApprovalService;
  private config: ToolApprovalConfig;
  private pendingApprovals: Map<string, PendingApproval> = new Map();
  private permissionService: PermissionService;

  private constructor() {
    this.config = defaultConfig;
    this.permissionService = PermissionService.getInstance();
  }

  /**
   * 取得單例實例
   */
  public static getInstance(): ToolApprovalService {
    if (!ToolApprovalService.instance) {
      ToolApprovalService.instance = new ToolApprovalService();
    }
    return ToolApprovalService.instance;
  }

  /**
   * 設定配置
   */
  public setConfig(config: Partial<ToolApprovalConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 獲取配置
   */
  public getConfig(): ToolApprovalConfig {
    return this.config;
  }

  /**
   * 檢查工具審批是否啟用
   */
  public isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * 啟用工具審批
   */
  public enable(): void {
    this.config.enabled = true;
  }

  /**
   * 停用工具審批
   */
  public disable(): void {
    this.config.enabled = false;
  }

  /**
   * 匹配工具名稱模式
   * @param toolName 工具名稱
   * @returns 匹配結果
   */
  public matchToolPattern(toolName: string): ToolPatternMatch {
    // 檢查精確匹配（自動批准清單）
    if (this.config.autoApprovedTools.includes(toolName)) {
      return {
        matched: true,
        matchedTool: toolName,
        pattern: toolName,
        isExactMatch: true,
      };
    }

    // 檢查精確匹配（需要審批清單）
    if (this.config.requireApprovalTools.includes(toolName)) {
      return {
        matched: true,
        matchedTool: toolName,
        pattern: toolName,
        isExactMatch: true,
      };
    }

    // 檢查前綴匹配
    for (const pattern of [...this.config.autoApprovedTools, ...this.config.requireApprovalTools]) {
      if (toolName.startsWith(pattern) || pattern === '*') {
        return {
          matched: true,
          matchedTool: toolName,
          pattern,
          isExactMatch: false,
        };
      }
    }

    // 沒有匹配
    return {
      matched: false,
      isExactMatch: false,
    };
  }

  /**
   * 檢查工具是否需要審批
   * @param toolName 工具名稱
   * @param userId 用戶 ID
   * @param guildId 伺服器 ID
   */
  async checkToolApproval(
    toolName: string,
    userId: string,
    guildId: string
  ): Promise<{ requiresApproval: boolean; action?: ApprovalAction }> {
    // 檢查是否在自動批准清單中
    if (this.config.autoApprovedTools.includes(toolName)) {
      return { requiresApproval: false };
    }

    // 檢查是否需要審批
    if (!this.config.requireApprovalTools.includes(toolName)) {
      return { requiresApproval: false };
    }

    // 檢查用戶權限
    const permission = await this.permissionService.checkPermission(userId, guildId, 'admin');
    if (permission.allowed && permission.level === 'admin') {
      return { requiresApproval: false };
    }

    // 檢查是否已記住允許
    const remembered = await this.permissionService.checkRememberedAllowance(
      userId,
      guildId,
      toolName
    );
    if (remembered) {
      return { requiresApproval: false };
    }

    return { requiresApproval: true };
  }

  /**
   * 請求工具審批
   * @param request 工具執行請求
   * @param channel Discord 頻道
   * @returns 審批結果
   */
  async requestApproval(
    request: ToolExecutionRequest,
    channel: GuildTextBasedChannel
  ): Promise<ApprovalAction> {
    const approvalId = this.permissionService.createApprovalRequest(
      request,
      (action) => this.handleApprovalResponse(approvalId, action)
    );

    // 構建審批 Embed
    const embed = this.buildApprovalEmbed(request);

    // 構建按鈕
    const buttons = this.buildApprovalButtons(approvalId);

    const actionRow = new ActionRowBuilder<ButtonBuilder>({
      components: buttons,
    });

    // 發送到審批頻道或原頻道
    const targetChannel = this.config.approvalChannelId
      ? await channel.guild.channels.fetch(this.config.approvalChannelId)
      : channel;

    let message: Message | null = null;

    if (targetChannel && targetChannel.isTextBased()) {
      message = await (targetChannel as GuildTextBasedChannel).send({
        embeds: [embed],
        components: [actionRow],
      });
    }

    // 設置超時
    const timeout = setTimeout(async () => {
      const pending = this.pendingApprovals.get(approvalId);
      if (pending) {
        // 更新訊息為超時狀態
        if (pending.message) {
          try {
            await pending.message.edit({
              embeds: [
                embed.setColor(Colors.Red).setDescription('⏱️ 審批請求已過期'),
              ],
              components: [],
            });
          } catch {
            // 忽略錯誤
          }
        }
        this.pendingApprovals.delete(approvalId);
      }
    }, this.config.approvalTimeout);

    // 等待審批回應
    return new Promise((resolve) => {
      this.pendingApprovals.set(approvalId, {
        request,
        message,
        resolve,
        timeout,
        channelId: channel.id,
      });
    });
  }

  /**
   * 處理審批回應
   * @param approvalId 審批 ID
   * @param action 審批操作
   */
  private handleApprovalResponse(approvalId: string, action: ApprovalAction): void {
    const pending = this.pendingApprovals.get(approvalId);
    
    if (pending) {
      clearTimeout(pending.timeout);
      
      // 更新訊息狀態
      if (pending.message) {
        this.updateApprovalMessage(pending.message, action, pending.request);
      }

      // 保存審批記錄（如果選擇記住）
      if (action === 'always_allow') {
        this.saveApprovalRecord(pending.request, action);
      }

      pending.resolve(action);
      this.pendingApprovals.delete(approvalId);
    }
  }

  /**
   * 更新審批訊息
   */
  private async updateApprovalMessage(
    message: Message,
    action: ApprovalAction,
    request: ToolExecutionRequest
  ): Promise<void> {
    const color = action === 'allow' || action === 'always_allow' ? Colors.Green : Colors.Red;
    const title = action === 'allow' || action === 'always_allow' 
      ? '✅ 已允許' 
      : '❌ 已拒絕';
    const description = action === 'always_allow' 
      ? '此工具已設為總是允許' 
      : '';

    try {
      await message.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle(title)
            .setColor(color)
            .setDescription(description)
            .addFields(
              {
                name: '🔧 工具',
                value: request.toolName,
                inline: true,
              },
              {
                name: '👤 用戶',
                value: request.username,
                inline: true,
              },
              {
                name: '⏰ 決定時間',
                value: new Date().toLocaleString('zh-TW'),
              }
            ),
        ],
        components: [],
      });
    } catch (error) {
      logger.error('Error updating approval message:', error as Error | Record<string, unknown>);
    }
  }

  /**
   * 構建審批 Embed
   */
  private buildApprovalEmbed(request: ToolExecutionRequest): EmbedBuilder {
    const argsString = Object.entries(request.arguments)
      .map(([key, value]) => `**${key}**: \`${JSON.stringify(value).substring(0, 50)}\``)
      .join('\n');

    return new EmbedBuilder()
      .setTitle('🔒 工具執行請求需要審批')
      .setColor(Colors.Orange)
      .setDescription(`用戶 **${request.username}** 請求執行以下工具`)
      .addFields(
        {
          name: '🔧 工具名稱',
          value: request.toolName,
          inline: true,
        },
        {
          name: '📝 工具描述',
          value: request.toolDescription || '無描述',
          inline: true,
        },
        {
          name: '👤 請求者',
          value: request.username,
          inline: true,
        },
        {
          name: '⏰ 請求時間',
          value: new Date(request.timestamp).toLocaleString('zh-TW'),
          inline: true,
        },
        {
          name: '📋 參數',
          value: argsString || '無',
        }
      )
      .setFooter({ text: '請在 5 分鐘內做出決定' })
      .setTimestamp();
  }

  /**
   * 構建審批按鈕
   */
  private buildApprovalButtons(approvalId: string): ButtonBuilder[] {
    return [
      new ButtonBuilder()
        .setCustomId(`approval:${approvalId}:allow`)
        .setLabel('✅ 允許')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`approval:${approvalId}:deny`)
        .setLabel('❌ 拒絕')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`approval:${approvalId}:always_allow`)
        .setLabel('✅ 總是允許')
        .setStyle(ButtonStyle.Primary),
    ];
  }

  /**
   * 保存審批記錄
   */
  private async saveApprovalRecord(request: ToolExecutionRequest, action: ApprovalAction): Promise<void> {
    const record: ToolApprovalRecord = {
      id: `approval_${Date.now()}`,
      sessionId: request.sessionId,
      toolName: request.toolName,
      pattern: '*',
      action,
      remember: true,
      userId: request.userId,
      timestamp: new Date().toISOString(),
    };

    await this.permissionService.saveApprovalRecord(record);
  }

  /**
   * 處理審批按鈕交互
   * @param customId 按鈕 Custom ID
   */
  public async handleApprovalButton(customId: string): Promise<void> {
    const parts = customId.split(':');
    
    if (parts.length !== 3 || parts[0] !== 'approval') {
      return;
    }

    const [, approvalId, action] = parts;
    const validActions: ApprovalAction[] = ['allow', 'deny', 'always_allow'];

    if (!validActions.includes(action as ApprovalAction)) {
      return;
    }

    this.handleApprovalResponse(approvalId, action as ApprovalAction);
  }

  /**
   * 取消所有待處理的審批
   */
  public cancelAllPending(): void {
    for (const [_id, pending] of this.pendingApprovals) {
      clearTimeout(pending.timeout);
      if (pending.message) {
        pending.message.edit({
          embeds: [
            new EmbedBuilder()
              .setTitle('❌ 審批已取消')
              .setColor(Colors.Red),
          ],
          components: [],
        }).catch(() => {});
      }
    }
    this.pendingApprovals.clear();
  }

  /**
   * 獲取待審批數量
   */
  public getPendingCount(): number {
    return this.pendingApprovals.size;
  }
}

/**
 * 建立 ToolApprovalService 工廠函數
 */
export function createToolApprovalService(): ToolApprovalService {
  return ToolApprovalService.getInstance();
}

export default ToolApprovalService;