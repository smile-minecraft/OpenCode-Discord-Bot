/**
 * Tool Approval Handler - 工具審批處理器
 * @description 處理工具審批的 Discord 按鈕互動
 * 
 * 支援的按鈕：
 * - approval:{approvalId}:allow - 批准工具執行
 * - approval:{approvalId}:deny - 拒絕工具執行
 * - approval:{approvalId}:always_allow - 批准並總是允許
 */

import {
  ButtonInteraction,
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
} from 'discord.js';
import type { ButtonHandlerConfig } from '../types/handlers.js';
import { ToolApprovalService } from '../services/ToolApprovalService.js';
import type { ToolExecutionRequest, ApprovalAction } from '../services/PermissionService.js';
import logger from '../utils/logger.js';

/**
 * 工具審批按鈕 ID 解析結果
 */
export interface ApprovalButtonParseResult {
  approvalId: string;
  action: ApprovalAction;
  isValid: boolean;
}

/**
 * 工具審批處理器
 * @description 管理工具審批的 Discord 互動
 */
export class ToolApprovalHandler {
  private toolApprovalService: ToolApprovalService;
  private pendingMessages: Map<string, Message> = new Map();

  /**
   * 創建工具審批處理器
   */
  constructor(toolApprovalService?: ToolApprovalService) {
    this.toolApprovalService = toolApprovalService || ToolApprovalService.getInstance();
  }

  /**
   * 獲取所有按鈕處理器配置
   */
  getHandlerConfigs(): ButtonHandlerConfig[] {
    return [
      {
        customId: 'approval:',
        callback: this.handleApprovalButton.bind(this),
        description: '工具審批按鈕（批准/拒絕/總是允許）',
      },
    ];
  }

  /**
   * 解析審批按鈕 ID
   * @param customId 按鈕 Custom ID
   * @returns 解析結果
   */
  parseApprovalButtonId(customId: string): ApprovalButtonParseResult {
    const parts = customId.split(':');
    
    if (parts.length < 3 || parts[0] !== 'approval') {
      return {
        approvalId: '',
        action: 'deny',
        isValid: false,
      };
    }

    const approvalId = parts[1];
    const action = parts[2] as ApprovalAction;
    const validActions: ApprovalAction[] = ['allow', 'deny', 'always_allow'];

    return {
      approvalId,
      action: validActions.includes(action) ? action : 'deny',
      isValid: validActions.includes(action),
    };
  }

  /**
   * 處理審批按鈕點擊
   */
  async handleApprovalButton(interaction: ButtonInteraction): Promise<void> {
    const parseResult = this.parseApprovalButtonId(interaction.customId);

    if (!parseResult.isValid) {
      await interaction.reply({
        content: '無法識別的審批操作',
        ephemeral: true,
      });
      return;
    }

    const { approvalId, action } = parseResult;

    try {
      // 處理審批回應
      await this.toolApprovalService.handleApprovalButton(interaction.customId);

      // 根據操作更新訊息
      await this.updateApprovalMessage(interaction, approvalId, action);

      logger.info(`[ToolApprovalHandler] 用戶 ${interaction.user.id} 審批 #${approvalId}: ${action}`);
    } catch (error) {
      logger.error('[ToolApprovalHandler] 處理審批按鈕失敗:', error);
      await interaction.reply({
        content: `處理審批時發生錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`,
        ephemeral: true,
      });
    }
  }

  /**
   * 更新審批訊息
   */
  private async updateApprovalMessage(
    interaction: ButtonInteraction,
    approvalId: string,
    action: ApprovalAction
  ): Promise<void> {
    const color = action === 'allow' || action === 'always_allow' ? Colors.Green : Colors.Red;
    const title = action === 'allow' || action === 'always_allow' 
      ? '✅ 已批准' 
      : '❌ 已拒絕';
    const description = action === 'always_allow' 
      ? '此工具已設為總是允許' 
      : action === 'allow'
      ? '此工具已獲批准執行'
      : '此工具已被拒絕執行';

    // 記錄日誌
    logger.info(`[ToolApprovalHandler] 審批 #${approvalId}: ${action} by ${interaction.user.username}`);

    try {
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setTitle(title)
            .setColor(color)
            .setDescription(description)
            .addFields(
              {
                name: '⏰ 決定時間',
                value: new Date().toLocaleString('zh-TW'),
                inline: true,
              },
              {
                name: '👤 決定者',
                value: interaction.user.username,
                inline: true,
              }
            )
            .setTimestamp(),
        ],
        components: [], // 移除按鈕
      });
    } catch (error) {
      logger.error('[ToolApprovalHandler] 更新審批訊息失敗:', error);
    }
  }

  /**
   * 發送審批請求訊息
   * @param channel Discord 頻道
   * @param request 工具執行請求
   * @returns 發送的訊息
   */
  async sendApprovalRequest(
    channel: { send: (options: unknown) => Promise<Message> },
    request: ToolExecutionRequest
  ): Promise<Message | null> {
    try {
      // 構建審批 Embed
      const embed = this.buildApprovalEmbed(request);

      // 構建按鈕
      const buttons = this.buildApprovalButtons(request.sessionId);

      const actionRow = new ActionRowBuilder<ButtonBuilder>({
        components: buttons,
      });

      const message = await channel.send({
        embeds: [embed],
        components: [actionRow],
      });

      // 記住訊息以便後續更新
      this.pendingMessages.set(request.sessionId, message);

      return message;
    } catch (error) {
      logger.error('[ToolApprovalHandler] 發送審批請求失敗:', error);
      return null;
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
          value: `\`${request.toolName}\``,
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
  private buildApprovalButtons(sessionId: string): ButtonBuilder[] {
    return [
      new ButtonBuilder()
        .setCustomId(`approval:${sessionId}:allow`)
        .setLabel('✅ 允許')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`approval:${sessionId}:always_allow`)
        .setLabel('✅ 總是允許')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`approval:${sessionId}:deny`)
        .setLabel('❌ 拒絕')
        .setStyle(ButtonStyle.Danger),
    ];
  }

  /**
   * 取消所有待處理的審批訊息
   */
  async cancelAllPending(): Promise<void> {
    for (const [_sessionId, message] of this.pendingMessages) {
      try {
        await message.edit({
          embeds: [
            new EmbedBuilder()
              .setTitle('❌ 審批已取消')
              .setColor(Colors.Red)
              .setDescription('Session 已結束或發生錯誤')
              .setTimestamp(),
          ],
          components: [],
        });
      } catch {
        // 忽略錯誤
      }
    }
    this.pendingMessages.clear();
  }

  /**
   * 獲取待審批數量
   */
  getPendingCount(): number {
    return this.pendingMessages.size;
  }
}

/**
 * 創建工具審批處理器
 */
export function createToolApprovalHandler(
  toolApprovalService?: ToolApprovalService
): ToolApprovalHandler {
  return new ToolApprovalHandler(toolApprovalService);
}

/**
 * 註冊工具審批按鈕處理器
 */
export function registerToolApprovalHandlers(
  buttonHandler: { registerMany: (configs: ButtonHandlerConfig[]) => void },
  toolApprovalService?: ToolApprovalService
): void {
  const handler = new ToolApprovalHandler(toolApprovalService);
  buttonHandler.registerMany(handler.getHandlerConfigs());
}

// ============== 導出 ==============

export default {
  ToolApprovalHandler,
  createToolApprovalHandler,
  registerToolApprovalHandlers,
};
