/**
 * Tool State Tracker - 工具執行狀態追蹤服務
 * @description 追蹤每個 Session 中的工具執行狀態
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';

/**
 * 工具執行狀態
 */
export type ToolExecutionStatus = 'pending' | 'running' | 'completed' | 'error';

/**
 * 工具執行記錄
 */
export interface ToolExecution {
  /** 執行 ID */
  id: string;
  /** 工具名稱 */
  toolName: string;
  /** 執行狀態 */
  status: ToolExecutionStatus;
  /** 工具參數 */
  args: Record<string, unknown>;
  /** 執行結果（如有） */
  result?: unknown;
  /** 錯誤訊息（如有） */
  error?: string;
  /** 開始時間 */
  startedAt: number;
  /** 最後更新時間 */
  updatedAt: number;
}

/**
 * ToolStateTracker 類別
 * @description 追蹤工具執行狀態，支援每個 Session 的工具狀態管理
 */
export class ToolStateTracker {
  private static instance: ToolStateTracker;
  /** Session ID 到工具執行 Map */
  private sessionTools: Map<string, Map<string, ToolExecution>> = new Map();

  private constructor() {
    logger.info('[ToolStateTracker] Initialized');
  }

  /**
   * 取得單例實例
   */
  public static getInstance(): ToolStateTracker {
    if (!ToolStateTracker.instance) {
      ToolStateTracker.instance = new ToolStateTracker();
    }
    return ToolStateTracker.instance;
  }

  /**
   * 重置實例（用於測試）
   */
  public static resetInstance(): void {
    ToolStateTracker.instance = new ToolStateTracker();
  }

  /**
   * 追蹤新的工具執行
   * @param sessionId Session ID
   * @param toolName 工具名稱
   * @param args 工具參數
   * @returns 工具執行記錄
   */
  public trackTool(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown> = {}
  ): ToolExecution {
    const toolExecution: ToolExecution = {
      id: uuidv4(),
      toolName,
      status: 'pending',
      args,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (!this.sessionTools.has(sessionId)) {
      this.sessionTools.set(sessionId, new Map());
    }

    const sessionToolMap = this.sessionTools.get(sessionId)!;
    sessionToolMap.set(toolExecution.id, toolExecution);

    logger.debug('[ToolStateTracker] Tool tracked', {
      sessionId,
      toolId: toolExecution.id,
      toolName,
      status: toolExecution.status,
    });

    return toolExecution;
  }

  /**
   * 更新工具執行狀態為執行中
   * @param sessionId Session ID
   * @param toolId 工具執行 ID
   */
  public startTool(sessionId: string, toolId: string): void {
    this.updateStatus(sessionId, toolId, 'running');
  }

  /**
   * 更新工具執行狀態為完成
   * @param sessionId Session ID
   * @param toolId 工具執行 ID
   * @param result 執行結果
   */
  public completeTool(sessionId: string, toolId: string, result?: unknown): void {
    const tool = this.getTool(sessionId, toolId);
    if (tool) {
      tool.status = 'completed';
      tool.result = result;
      tool.updatedAt = Date.now();

      logger.debug('[ToolStateTracker] Tool completed', {
        sessionId,
        toolId,
        toolName: tool.toolName,
      });
    }
  }

  /**
   * 更新工具執行狀態為錯誤
   * @param sessionId Session ID
   * @param toolId 工具執行 ID
   * @param error 錯誤訊息
   */
  public errorTool(sessionId: string, toolId: string, error: string): void {
    const tool = this.getTool(sessionId, toolId);
    if (tool) {
      tool.status = 'error';
      tool.error = error;
      tool.updatedAt = Date.now();

      logger.debug('[ToolStateTracker] Tool error', {
        sessionId,
        toolId,
        toolName: tool.toolName,
        error,
      });
    }
  }

  /**
   * 取得特定工具執行記錄
   * @param sessionId Session ID
   * @param toolId 工具執行 ID
   * @returns 工具執行記錄或 undefined
   */
  public getTool(sessionId: string, toolId: string): ToolExecution | undefined {
    const sessionToolMap = this.sessionTools.get(sessionId);
    return sessionToolMap?.get(toolId);
  }

  /**
   * 取得 Session 所有工具執行記錄
   * @param sessionId Session ID
   * @returns 工具執行記錄陣列
   */
  public getSessionTools(sessionId: string): ToolExecution[] {
    const sessionToolMap = this.sessionTools.get(sessionId);
    return sessionToolMap ? Array.from(sessionToolMap.values()) : [];
  }

  /**
   * 取得 Session 中特定狀態的工具執行記錄
   * @param sessionId Session ID
   * @param status 執行狀態
   * @returns 工具執行記錄陣列
   */
  public getToolsByStatus(sessionId: string, status: ToolExecutionStatus): ToolExecution[] {
    return this.getSessionTools(sessionId).filter((tool) => tool.status === status);
  }

  /**
   * 清除 Session 的工具執行記錄
   * @param sessionId Session ID
   */
  public clearSessionTools(sessionId: string): void {
    this.sessionTools.delete(sessionId);
    logger.debug('[ToolStateTracker] Session tools cleared', { sessionId });
  }

  /**
   * 移除特定工具執行記錄
   * @param sessionId Session ID
   * @param toolId 工具執行 ID
   */
  public removeTool(sessionId: string, toolId: string): void {
    const sessionToolMap = this.sessionTools.get(sessionId);
    if (sessionToolMap) {
      sessionToolMap.delete(toolId);
      logger.debug('[ToolStateTracker] Tool removed', { sessionId, toolId });
    }
  }

  /**
   * 檢查 Session 是否有進行中的工具執行
   * @param sessionId Session ID
   * @returns 是否有進行中的工具
   */
  public hasActiveTools(sessionId: string): boolean {
    const activeStatuses: ToolExecutionStatus[] = ['pending', 'running'];
    return this.getSessionTools(sessionId).some((tool) =>
      activeStatuses.includes(tool.status)
    );
  }

  /**
   * 取得 Session 中最後執行的工具
   * @param sessionId Session ID
   * @returns 最後執行的工具或 undefined
   */
  public getLastTool(sessionId: string): ToolExecution | undefined {
    const tools = this.getSessionTools(sessionId);
    if (tools.length === 0) return undefined;

    return tools.reduce((last, current) =>
      current.updatedAt > last.updatedAt ? current : last
    );
  }

  /**
   * 內部方法：更新工具狀態
   * @param sessionId Session ID
   * @param toolId 工具執行 ID
   * @param status 新狀態
   */
  private updateStatus(sessionId: string, toolId: string, status: ToolExecutionStatus): void {
    const tool = this.getTool(sessionId, toolId);
    if (tool) {
      tool.status = status;
      tool.updatedAt = Date.now();

      logger.debug('[ToolStateTracker] Tool status updated', {
        sessionId,
        toolId,
        toolName: tool.toolName,
        status,
      });
    }
  }
}

/**
 * 取得 ToolStateTracker 單例
 */
export function getToolStateTracker(): ToolStateTracker {
  return ToolStateTracker.getInstance();
}
