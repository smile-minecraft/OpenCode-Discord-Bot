/**
 * Tool Execution Embed Builder - 工具執行嵌入建構器
 * @description 為不同工具執行狀態建立 Discord Embed 卡片
 */

import { EmbedBuilder, ColorResolvable } from 'discord.js';
import type { ToolExecution, ToolExecutionStatus } from '../services/ToolStateTracker.js';

// ============== 顏色常量 ==============

/**
 * 工具執行狀態對應的顏色
 */
export const ToolExecutionColors: Record<ToolExecutionStatus, ColorResolvable> = {
  pending: 0xFBBF24,   // Yellow - 等待中
  running: 0x60A5FA,   // Blue - 執行中
  completed: 0x4ADE80, // Green - 已完成
  error: 0xF87171,    // Red - 錯誤
} as const;

// ============== 工具執行嵌入建構器 ==============

/**
 * ToolExecutionEmbedBuilder 類別
 * @description 為工具執行建立 Discord Embed 卡片
 */
export class ToolExecutionEmbedBuilder {
  /**
   * 建立工具執行狀態 Embed
   * @param tool 工具執行記錄
   * @returns Discord Embed
   */
  public static buildFromExecution(tool: ToolExecution): EmbedBuilder {
    switch (tool.status) {
      case 'pending':
        return this.buildPending(tool);
      case 'running':
        return this.buildRunning(tool);
      case 'completed':
        return this.buildCompleted(tool);
      case 'error':
        return this.buildError(tool);
      default:
        return this.buildUnknown(tool);
    }
  }

  /**
   * 建立待處理狀態 Embed
   * @param tool 工具執行記錄
   * @returns Discord Embed
   */
  public static buildPending(tool: ToolExecution): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('🔄 Tool Pending')
      .setDescription(`**${this.escapeMarkdown(tool.toolName)}** is waiting to execute`)
      .setColor(ToolExecutionColors.pending)
      .setTimestamp(new Date(tool.startedAt))
      .addFields(this.formatArgsAsFields(tool.args));

    return embed;
  }

  /**
   * 建立執行中狀態 Embed
   * @param tool 工具執行記錄
   * @returns Discord Embed
   */
  public static buildRunning(tool: ToolExecution): EmbedBuilder {
    const duration = this.calculateDuration(tool.startedAt, tool.updatedAt);
    
    const embed = new EmbedBuilder()
      .setTitle('⚙️ Tool Running')
      .setDescription(`Executing **${this.escapeMarkdown(tool.toolName)}**...`)
      .setColor(ToolExecutionColors.running)
      .setTimestamp(new Date(tool.updatedAt))
      .addFields([
        {
          name: '⏱️ Duration',
          value: duration,
          inline: true,
        },
        ...this.formatArgsAsFields(tool.args),
      ]);

    return embed;
  }

  /**
   * 建立完成狀態 Embed
   * @param tool 工具執行記錄
   * @returns Discord Embed
   */
  public static buildCompleted(tool: ToolExecution): EmbedBuilder {
    const duration = this.calculateDuration(tool.startedAt, tool.updatedAt);

    const embed = new EmbedBuilder()
      .setTitle('✅ Tool Completed')
      .setDescription(`**${this.escapeMarkdown(tool.toolName)}** completed successfully`)
      .setColor(ToolExecutionColors.completed)
      .setTimestamp(new Date(tool.updatedAt))
      .addFields([
        {
          name: '⏱️ Duration',
          value: duration,
          inline: true,
        },
        {
          name: '🆔 Tool ID',
          value: `\`${tool.id}\``,
          inline: true,
        },
      ]);

    // Add result if present
    if (tool.result !== undefined) {
      const resultText = this.formatResult(tool.result);
      embed.addFields([
        {
          name: '📤 Result',
          value: resultText,
          inline: false,
        },
      ]);
    }

    return embed;
  }

  /**
   * 建立錯誤狀態 Embed
   * @param tool 工具執行記錄
   * @returns Discord Embed
   */
  public static buildError(tool: ToolExecution): EmbedBuilder {
    const duration = this.calculateDuration(tool.startedAt, tool.updatedAt);

    const embed = new EmbedBuilder()
      .setTitle('❌ Tool Error')
      .setDescription(`**${this.escapeMarkdown(tool.toolName)}** encountered an error`)
      .setColor(ToolExecutionColors.error)
      .setTimestamp(new Date(tool.updatedAt))
      .addFields([
        {
          name: '⏱️ Duration',
          value: duration,
          inline: true,
        },
        {
          name: '🆔 Tool ID',
          value: `\`${tool.id}\``,
          inline: true,
        },
      ]);

    // Add error message if present
    if (tool.error) {
      embed.addFields([
        {
          name: '🚫 Error',
          value: this.escapeMarkdown(this.truncateText(tool.error, 1000)),
          inline: false,
        },
      ]);
    }

    // Add result if present (may contain error details)
    if (tool.result !== undefined) {
      const resultText = this.formatResult(tool.result);
      embed.addFields([
        {
          name: '📤 Output',
          value: resultText,
          inline: false,
        },
      ]);
    }

    return embed;
  }

  /**
   * 建立未知狀態 Embed
   * @param tool 工具執行記錄
   * @returns Discord Embed
   */
  public static buildUnknown(tool: ToolExecution): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('❓ Tool Unknown Status')
      .setDescription(`**${this.escapeMarkdown(tool.toolName)}** has unknown status: ${tool.status}`)
      .setColor(0x6B7280) // Gray
      .setTimestamp(new Date(tool.updatedAt))
      .addFields([
        {
          name: '🆔 Tool ID',
          value: `\`${tool.id}\``,
          inline: true,
        },
        {
          name: '🕐 Last Updated',
          value: `<t:${Math.floor(tool.updatedAt / 1000)}:R>`,
          inline: true,
        },
      ]);

    return embed;
  }

  /**
   * 建立簡潔的狀態摘要 Embed
   * @param tools 工具執行記錄陣列
   * @returns Discord Embed
   */
  public static buildSummary(tools: ToolExecution[]): EmbedBuilder {
    const pending = tools.filter((t) => t.status === 'pending').length;
    const running = tools.filter((t) => t.status === 'running').length;
    const completed = tools.filter((t) => t.status === 'completed').length;
    const errors = tools.filter((t) => t.status === 'error').length;

    const embed = new EmbedBuilder()
      .setTitle('📊 Tool Execution Summary')
      .setColor(0x8B5CF6) // Purple
      .setTimestamp(new Date())
      .addFields([
        {
          name: '🔄 Pending',
          value: String(pending),
          inline: true,
        },
        {
          name: '⚙️ Running',
          value: String(running),
          inline: true,
        },
        {
          name: '✅ Completed',
          value: String(completed),
          inline: true,
        },
        {
          name: '❌ Errors',
          value: String(errors),
          inline: true,
        },
      ]);

    // Add last tool info if available
    const lastTool = tools.length > 0 
      ? tools.reduce((latest, current) => 
          current.updatedAt > latest.updatedAt ? current : latest
        )
      : null;

    if (lastTool) {
      embed.addFields([
        {
          name: '🔹 Last Tool',
          value: `${this.getStatusEmoji(lastTool.status)} **${this.escapeMarkdown(lastTool.toolName)}**`,
          inline: false,
        },
      ]);
    }

    return embed;
  }

  // ============== 輔助方法 ==============

  /**
   * 格式化參數為 Embed Fields
   * @param args 工具參數
   * @returns Embed Fields
   */
  private static formatArgsAsFields(args: Record<string, unknown>): { name: string; value: string; inline?: boolean }[] {
    if (!args || Object.keys(args).length === 0) {
      return [
        {
          name: '📥 Arguments',
          value: '_No arguments_',
          inline: false,
        },
      ];
    }

    const fields: { name: string; value: string; inline?: boolean }[] = [];

    for (const [key, value] of Object.entries(args)) {
      const formattedValue = this.formatArgValue(value);
      fields.push({
        name: `📥 ${this.escapeMarkdown(key)}`,
        value: this.truncateText(formattedValue, 500),
        inline: true,
      });
    }

    return fields;
  }

  /**
   * 格式化單個參數值
   * @param value 參數值
   * @returns 格式化後的字串
   */
  private static formatArgValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '`null`';
    }

    if (typeof value === 'string') {
      return `\`${this.escapeMarkdown(this.truncateText(value, 200))}\``;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return `\`${value}\``;
    }

    if (Array.isArray(value)) {
      const items = value.slice(0, 5).map((item) => this.formatArgValue(item)).join(', ');
      const suffix = value.length > 5 ? ` ... (+${value.length - 5} more)` : '';
      return `\`[${items}${suffix}]\``;
    }

    if (typeof value === 'object') {
      try {
        const jsonStr = JSON.stringify(value, null, 2);
        return `\`\`\`json\n${this.truncateText(jsonStr, 400)}\n\`\`\``;
      } catch {
        return '`[Object]`';
      }
    }

    return `\`${String(value)}\``;
  }

  /**
   * 格式化結果為 Embed Field Value
   * @param result 執行結果
   * @returns 格式化後的字串
   */
  private static formatResult(result: unknown): string {
    if (result === null || result === undefined) {
      return '_No result_';
    }

    if (typeof result === 'string') {
      return this.truncateText(this.escapeMarkdown(result), 1000);
    }

    if (typeof result === 'number' || typeof result === 'boolean') {
      return `\`${result}\``;
    }

    if (Array.isArray(result)) {
      const items = result.slice(0, 10).map((item) => this.formatArgValue(item)).join('\n');
      const suffix = result.length > 10 ? `\n_... (+${result.length - 10} more items)_` : '';
      return `\`\`\`\n${items}\n\`\`\`${suffix}`;
    }

    if (typeof result === 'object') {
      try {
        const jsonStr = JSON.stringify(result, null, 2);
        return `\`\`\`json\n${this.truncateText(jsonStr, 800)}\n\`\`\``;
      } catch {
        return '_[Unable to format result]_';
      }
    }

    return this.truncateText(String(result), 1000);
  }

  /**
   * 計算執行時間
   * @param start 開始時間戳
   * @param end 結束時間戳
   * @returns 格式化後的時間字串
   */
  private static calculateDuration(start: number, end: number): string {
    const durationMs = end - start;
    
    if (durationMs < 1000) {
      return `${durationMs}ms`;
    }

    if (durationMs < 60000) {
      return `${(durationMs / 1000).toFixed(1)}s`;
    }

    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  /**
   * 取得狀態對應的表情符號
   * @param status 執行狀態
   * @returns emoji
   */
  private static getStatusEmoji(status: ToolExecutionStatus): string {
    switch (status) {
      case 'pending':
        return '🔄';
      case 'running':
        return '⚙️';
      case 'completed':
        return '✅';
      case 'error':
        return '❌';
      default:
        return '❓';
    }
  }

  /**
   * 逸出 Markdown 特殊字元
   * @param text 要處理的文字
   * @returns 逸出後的文字
   */
  private static escapeMarkdown(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/`/g, '\\`')
      .replace(/\|/g, '\\|');
  }

  /**
   * 截斷文字到指定長度
   * @param text 要截斷的文字
   * @param maxLength 最大長度
   * @returns 截斷後的文字
   */
  private static truncateText(text: string, maxLength: number): string {
    if (!text) return text;
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }
}
