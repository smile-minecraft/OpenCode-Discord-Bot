/**
 * SSE Event Emitter Adapter - SDK 事件串流適配器
 * @description 將 SDK 的 AsyncGenerator 轉換為 EventEmitter 格式，實現統一的事件處理介面
 */

import { EventEmitter } from 'events';
import logger from '../utils/logger.js';

// ============== 類型定義 ==============

/**
 * SDK 事件類型
 * 對應 SDK 發送的實際事件類型
 */
export type SDKEventType =
  // Message events
  | 'message.updated'
  | 'message.created'
  | 'message.part.updated'
  | 'message.part.delta'
  | 'message.part.removed'
  // Tool events
  | 'tool_call'
  | 'tool_call_start'
  | 'tool_call_end'
  // Session events
  | 'session.created'
  | 'session.deleted'
  | 'session.idle'
  | 'session.error'
  | 'session.compacted'
  | 'session.started'
  | 'session.ended'
  | 'session.updated'
  | 'session.status'
  | 'session.diff'
  // File watcher events
  | 'file.watcher.updated'
  | 'file.watcher.created'
  | 'file.watcher.deleted'
  // Question events
  | 'question.asked'
  | 'permission.asked'
  // Error events
  | 'error'
  // Server events
  | 'server.connected'
  | 'server.heartbeat'
  // LSP events (noise, ignore)
  | 'lsp.client.diagnostics';

/**
 * SDK 事件屬性
 */
export interface SDKEventProperties {
  /** Session ID */
  session_id?: string;
  sessionId?: string;
  sessionID?: string;
  /** 訊息 ID */
  message_id?: string;
  messageId?: string;
  /** 內容 */
  content?: string;
  /** 訊息角色 */
  role?: string;
  /** 完整標記 */
  is_complete?: boolean;
  isComplete?: boolean;
  /** 工具名稱 */
  tool_name?: string;
  toolName?: string;
  /** 工具參數 */
  tool_args?: Record<string, unknown>;
  toolArgs?: Record<string, unknown>;
  /** 請求 ID */
  request_id?: string;
  requestId?: string;
  /** 錯誤訊息 */
  error?: string;
  /** 問題屬性 */
  question?: {
    id: string;
    text: string;
    options: Array<{ label: string; value: string; description?: string }>;
    multiple?: boolean;
    session_id?: string;
    sessionId?: string;
  };
  /** 問題 ID（部分事件格式會放在頂層） */
  question_id?: string;
  questionId?: string;
  /** 問題文字（部分事件格式會放在頂層） */
  text?: string;
  /** 問題選項（部分事件格式會放在頂層） */
  options?: Array<{ label?: string; value?: string; description?: string } | string>;
  /** 問題陣列（某些 SDK 事件使用） */
  questions?: unknown[];
  /** 是否可複選（部分事件格式會放在頂層） */
  multiple?: boolean;
  /** 其他屬性 */
  [key: string]: unknown;
}

/**
 * SDK 事件
 */
export interface SDKEvent {
  type: string;
  properties?: SDKEventProperties;
}

/**
 * SSE 內部事件類型（與 SSEClient 保持一致）
 */
export type SSEEventTypeInternal =
  | 'message'
  | 'tool_request'
  | 'session_complete'
  | 'waiting'
  | 'error'
  | 'connected'
  | 'disconnected'
  | 'thinking'
  | 'question'
  | 'sdk_event';

/**
 * 訊息事件數據（與 SSEClient 保持一致）
 */
export interface MessageEventData {
  sessionId: string;
  content: string;
  isComplete: boolean;
}

/**
 * 工具請求事件數據（與 SSEClient 保持一致）
 */
export interface ToolRequestEventData {
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  requestId: string;
  status?: 'pending' | 'running' | 'completed' | 'error';
  result?: unknown;
  error?: string;
}

/**
 * 連線事件數據（與 SSEClient 保持一致）
 */
export interface ConnectedEventData {
  sessionId: string;
}

/**
 * 錯誤事件數據（與 SSEClient 保持一致）
 */
export interface ErrorEventData {
  sessionId?: string;
  error: string;
  message?: string;
}

/**
 * Session 完成事件數據（與 SSEClient 保持一致）
 */
export interface SessionCompleteEventData {
  sessionId: string;
}

/**
 * Question 事件數據
 */
export interface QuestionEventData {
  sessionId: string;
  questionId: string;
  text: string;
  options: Array<{ label: string; value: string; description?: string }>;
  multiple: boolean;
}

/**
 * Thinking 開始事件
 */
export interface ThinkingEventData {
  sessionId: string;
}

/**
 * 原始 SDK 事件（通用 fallback）
 */
export interface GenericSDKEventData {
  sessionId: string;
  eventType: string;
  properties: SDKEventProperties;
}

/**
 * 內部 SSE 事件
 */
export interface SSEEventInternal {
  type: SSEEventTypeInternal;
  data:
    | MessageEventData
    | ToolRequestEventData
    | ConnectedEventData
    | ErrorEventData
    | SessionCompleteEventData
    | ThinkingEventData
    | QuestionEventData
    | GenericSDKEventData;
  timestamp: number;
}

/**
 * SSE 事件處理器
 */
export type SSEEventHandler = (event: SSEEventInternal) => void;

// ============== 常量 ==============

/** SDK 事件類型到內部事件類型的映射 */
const EVENT_TYPE_MAP: Record<SDKEventType, SSEEventTypeInternal | null> = {
  // Message events - map to 'message'
  'message.updated': 'message',
  'message.created': 'message',
  'message.part.updated': 'message',
  'message.part.delta': 'message',
  'message.part.removed': null,
  
  // Tool events - map to 'tool_request'
  'tool_call': 'tool_request',
  'tool_call_start': 'tool_request',
  'tool_call_end': 'tool_request',
  
  // Session events
  'session.created': 'connected',
  'session.started': 'connected',
  'session.deleted': 'disconnected',
  'session.ended': 'session_complete',
  'session.idle': 'waiting',
  'session.error': 'error',
  'session.compacted': 'session_complete',
  'session.updated': null,
  'session.status': null,
  'session.diff': null,
  'file.watcher.updated': null,
  'file.watcher.created': null,
  'file.watcher.deleted': null,
  
  // Question events
  'question.asked': 'question',
  'permission.asked': 'question',
  
  // Error events
  'error': 'error',
  
  // Server events
  'server.connected': 'connected',
  'server.heartbeat': null,
  // LSP diagnostics are high-frequency and currently not used for Discord rendering
  'lsp.client.diagnostics': null,
};

// ============== 介面定義 ==============

/**
 * SSEEventEmitterAdapter 公開介面
 */
export interface ISSEEventEmitterAdapter {
  start(eventStream: AsyncIterable<SDKEvent>, sessionId: string): void;
  stop(): void;
  dispose(): void;
  isActive(): boolean;
  getSessionId(): string | null;
  on(eventType: string, handler: SSEEventHandler): this;
  once(eventType: string, handler: SSEEventHandler): this;
  off(eventType: string, handler: SSEEventHandler): this;
}

// ============== SSEEventEmitterAdapter 類別 ==============

/**
 * SSE 事件發射器適配器
 * @description 將 SDK 的 AsyncGenerator 事件轉換為標準 EventEmitter 事件
 *              保持與現有 SSEClient 相同的事件介面
 */
export class SSEEventEmitterAdapter
  extends EventEmitter
  implements ISSEEventEmitterAdapter
{
  /** SDK AsyncIterable 實例 (用於保持引用) */
  private eventStreamRef: AsyncIterable<SDKEvent> | null = null;

  /** 異步迭代器 */
  private iterator: AsyncIterator<SDKEvent> | null = null;

  /** 是否正在處理 */
  private isProcessing = false;

  /** 是否已清理 */
  private isDisposed = false;

  /** 當前 Session ID */
  private currentSessionId: string | null = null;

  /** AbortController for cancellation */
  private abortController: AbortController | null = null;

  /**
   * 建構子
   */
  constructor() {
    super();
    logger.debug('[SSEEventEmitterAdapter] 實例已創建');
  }

  /**
   * 啟動事件監聽
   * @param eventStream SDK 的 AsyncIterable 事件流
   * @param sessionId Session ID
   */
  public start(eventStream: AsyncIterable<SDKEvent>, sessionId: string): void {
    if (this.isDisposed) {
      throw new Error('SSEEventEmitterAdapter 已被銷毀，無法重複使用');
    }

    // 如果已有運行中的流，先停止
    if (this.isProcessing) {
      this.stop();
    }

    this.eventStreamRef = eventStream;
    this.currentSessionId = sessionId;
    this.isProcessing = true;
    this.abortController = new AbortController();

    // 創建異步迭代器
    this.iterator = eventStream[Symbol.asyncIterator]();

    // 發送連接事件
    this.emitEvent('connected', {
      sessionId,
    } as ConnectedEventData);

    // 開始處理事件流（不等待完成）
    this.processStream().catch((error) => {
      logger.error('[SSEEventEmitterAdapter] 事件流處理錯誤:', error);
    });

    logger.debug(`[SSEEventEmitterAdapter] 開始監聽事件, sessionId: ${sessionId}`);
  }

  /**
   * 停止事件監聽
   */
  public stop(): void {
    if (!this.isProcessing) {
      return;
    }

    this.isProcessing = false;

    // 中止迭代
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // 發送斷開事件
    if (this.currentSessionId) {
      this.emitEvent('disconnected', {
        sessionId: this.currentSessionId,
      } as ConnectedEventData);
    }

    this.eventStreamRef = null;
    this.iterator = null;

    logger.debug('[SSEEventEmitterAdapter] 已停止監聽');
  }

  /**
   * 處理事件流
   */
  private async processStream(): Promise<void> {
    if (!this.iterator) {
      return;
    }

    try {
      // Stream timeout constant (30 seconds)
      const STREAM_TIMEOUT = 30000;

      while (this.isProcessing) {
        // Use Promise.race with timeout to prevent hanging
        const result = await Promise.race([
          this.iterator.next(),
          new Promise<IteratorResult<SDKEvent>>((_, reject) => {
            setTimeout(() => reject(new Error('Stream timeout')), STREAM_TIMEOUT);
          }),
        ]);

        if (result.done) {
          logger.debug('[SSEEventEmitterAdapter] 事件流已完成');
          break;
        }

        const event = result.value;
        this.handleSDKEvent(event);
      }
    } catch (error) {
      // Ignore abort errors
      if (error instanceof Error && error.message === 'Aborted') {
        logger.debug('[SSEEventEmitterAdapter] 事件流已中止');
        return;
      }

      // Log timeout errors specially
      if (error instanceof Error && error.message === 'Stream timeout') {
        logger.warn('[SSEEventEmitterAdapter] 事件流逾時');
      } else {
        logger.error('[SSEEventEmitterAdapter] 處理事件流時發生錯誤:', error);
      }

      this.emitEvent('error', {
        sessionId: this.currentSessionId ?? undefined,
        error: error instanceof Error ? error.message : '未知錯誤',
      } as ErrorEventData);
    } finally {
      // Cleanup references
      this.isProcessing = false;
      this.eventStreamRef = null;
      this.iterator = null;

      // Ensure session_complete is emitted if still processing
      if (this.currentSessionId) {
        this.emitEvent('session_complete', {
          sessionId: this.currentSessionId,
        } as SessionCompleteEventData);
      }
    }
  }

  /**
   * 處理 SDK 事件
   * @param event SDK 事件
   */
  private handleSDKEvent(event: SDKEvent): void {
    const internalType = EVENT_TYPE_MAP[event.type as SDKEventType];
    const props = (event.properties && typeof event.properties === 'object'
      ? event.properties
      : {}) as SDKEventProperties;
    const sessionId = props.session_id || props.sessionId || this.currentSessionId || '';

    // 對每個 SDK 事件都發送一個通用事件，確保上層可觀測與擴展處理
    this.emitEvent('sdk_event', {
      sessionId,
      eventType: event.type,
      properties: props,
    } as GenericSDKEventData);

    // null means we want to explicitly ignore this event
    // undefined means the event type is not recognized
    if (internalType === undefined) {
      // 未映射事件走通用 fallback，不視為錯誤
      logger.debug(`[SSEEventEmitterAdapter] 未映射 SDK 事件類型: ${event.type}`);
      return;
    }

    // null means we want to silently ignore this event type
    if (internalType === null) {
      return;
    }

    switch (internalType) {
      case 'message':
        // 先檢查 tool part，優先於文字內容處理
        const toolPartData = this.extractToolPartData(props);
        if (toolPartData) {
          this.emitEvent('tool_request', toolPartData);
          break;
        }

        const messageRole = this.extractMessageRole(props);
        if (this.isIgnoredMessageRole(messageRole)) {
          break;
        }

        const hasThinkingSignal = this.hasThinkingSignal(props);
        if (hasThinkingSignal) {
          this.emitEvent('thinking', {
            sessionId: props.session_id || props.sessionId || this.currentSessionId || '',
          } as ThinkingEventData);
        }

        // 提取內容 - 支援多種 SDK 格式
        let extractedContent = props.content || '';
        
        // 處理 OpenCode SDK v2 的 part 結構 (message.part.updated, message.part.delta)
        if (!extractedContent && props.part && typeof props.part === 'object') {
          const part = props.part as any;
          if (part.type === 'text' && part.text) {
            extractedContent = String(part.text);
          }
        }
        
        // 處理 delta 結構 (message.part.delta)
        if (!extractedContent && props.delta && typeof props.delta === 'object') {
          const delta = props.delta as any;
          if (delta.type === 'text' && delta.text) {
            extractedContent = String(delta.text);
          }
        }
        
        // 處理直接的 text 屬性
        if (!extractedContent && props.text) {
          extractedContent = String(props.text);
        }

        // 處理 props.info 結構 (常見於 message.updated 事件)
        // 優先順序：直接 content > info.content > info.parts
        if (!extractedContent && props.info && typeof props.info === 'object') {
          const info = props.info as any;
          
          // 首先檢查 info.content
          if (info.content) {
            extractedContent = String(info.content);
          }
          
          // 如果沒有 content，檢查 info.parts 陣列
          if (!extractedContent && Array.isArray(info.parts) && info.parts.length > 0) {
            // 合併所有 parts 的 text 內容
            const textParts = info.parts
              .filter((p: any) => p && (p.type === 'text' || p.type === 'output_text') && p.text)
              .map((p: any) => p.text);
            if (textParts.length > 0) {
              extractedContent = textParts.join('');
            }
          }

          // 處理 info.part (單一 part 結構)
          if (!extractedContent && info.part && typeof info.part === 'object') {
            const infoPart = info.part as any;
            if ((infoPart.type === 'text' || infoPart.type === 'output_text') && infoPart.text) {
              extractedContent = String(infoPart.text);
            }
          }
        }
        
        this.emitEvent('message', {
          sessionId: props.session_id || props.sessionId || this.currentSessionId || '',
          content: extractedContent,
          isComplete: props.is_complete || props.isComplete || false,
        } as MessageEventData);
        break;

      case 'tool_request':
        this.emitEvent('tool_request', {
          sessionId,
          toolName: this.extractToolNameFromLegacy(props),
          args: this.extractArgsFromLegacy(props),
          requestId: this.extractRequestIdFromLegacy(props),
          status: this.inferToolStatus(event.type, props),
          result: props.result,
          error: typeof props.error === 'string' ? props.error : undefined,
        } as ToolRequestEventData);
        break;

      case 'session_complete':
        this.emitEvent('session_complete', {
          sessionId: props.session_id || props.sessionId || this.currentSessionId || '',
        } as SessionCompleteEventData);
        break;

      case 'waiting':
        // session.idle means waiting for input - emit as 'waiting' event
        this.emitEvent('waiting', {
          sessionId: props.session_id || props.sessionId || this.currentSessionId || '',
        } as SessionCompleteEventData);
        break;

      case 'error':
        const errorMessage = typeof props.error === 'string' && props.error.trim() !== ''
          ? props.error
          : typeof props.message === 'string' && props.message.trim() !== ''
            ? props.message
            : '未知錯誤';
        this.emitEvent('error', {
          sessionId: props.session_id || props.sessionId || this.currentSessionId || '',
          error: errorMessage,
          message: errorMessage,
        } as ErrorEventData);
        break;

      case 'connected':
        // 連接事件已在 start 時發送
        break;

      case 'disconnected':
        // 斷開事件已在 stop 時發送
        break;

      case 'question': {
        const parsedQuestion = this.parseQuestionEvent(props);
        if (parsedQuestion) {
          this.emitEvent('question', parsedQuestion);
        } else {
          logger.warn('[SSEEventEmitterAdapter] question 事件解析失敗', {
            sessionId: props.session_id || props.sessionId || this.currentSessionId || '',
            keys: Object.keys(props),
          });
        }
        break;
      }
    }

    if (internalType !== 'message' && internalType !== 'thinking') {
      logger.debug(`[SSEEventEmitterAdapter] 處理事件: ${event.type} -> ${internalType}`);
    }
  }

  /**
   * 發送內部事件
   * @param type 事件類型
   * @param data 事件數據
   */
  private emitEvent(
    type: SSEEventTypeInternal,
    data:
      | MessageEventData
      | ToolRequestEventData
      | ConnectedEventData
      | ErrorEventData
      | SessionCompleteEventData
      | ThinkingEventData
      | QuestionEventData
      | GenericSDKEventData
  ): void {
    const event: SSEEventInternal = {
      type,
      data,
      timestamp: Date.now(),
    };

    this.emit(type, event);
    this.emit('*', event); // 通配符事件

    if (type !== 'message' && type !== 'thinking' && type !== 'sdk_event') {
      logger.debug(`[SSEEventEmitterAdapter] 發送事件: ${type}`);
    }
  }

  /**
   * 推導工具名稱（兼容不同 SDK payload）
   * Legacy tool_request 事件專用，支援：tool_name, toolName, tool, name
   */
  private extractToolNameFromLegacy(props: SDKEventProperties): string {
    // 白名單依序檢查
    const candidates = [
      props.tool_name,
      props.toolName,
      (props as Record<string, unknown>).tool,
      (props as Record<string, unknown>).name,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    return 'unknown';
  }

  /**
   * 從 tool_request 事件提取 requestId
   * Legacy tool_request 事件專用，支援：request_id, requestId, call_id, callID, callId, id
   */
  private extractRequestIdFromLegacy(props: SDKEventProperties): string {
    // 白名單依序檢查
    const candidates = [
      props.request_id,
      props.requestId,
      (props as Record<string, unknown>).call_id,
      (props as Record<string, unknown>).callID,
      (props as Record<string, unknown>).callId,
      (props as Record<string, unknown>).id,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    return '';
  }

  /**
   * 從 tool_request 事件提取 args
   * Legacy tool_request 事件專用，支援：tool_args, toolArgs, args, arguments, parameters, input
   * 若為 JSON 字串則嘗試 parse 成 object
   */
  private extractArgsFromLegacy(props: SDKEventProperties): Record<string, unknown> {
    // 白名單依序檢查
    const keys = [
      'tool_args',
      'toolArgs',
      'tool_input',
      'toolInput',
      'args',
      'arguments',
      'parameters',
      'params',
      'input',
      'payload',
    ];

    for (const key of keys) {
      const value = (props as Record<string, unknown>)[key];
      if (value !== undefined) {
        const normalized = this.normalizeArgsCandidate(value);
        if (normalized) {
          return normalized;
        }
      }
    }

    // 某些 SDK 事件會把工具參數放在 info/message 巢狀結構
    const nestedCandidates: Array<Record<string, unknown> | null> = [
      props.info && typeof props.info === 'object' ? props.info as Record<string, unknown> : null,
      props.message && typeof props.message === 'object' ? props.message as Record<string, unknown> : null,
    ];

    for (const container of nestedCandidates) {
      if (!container) continue;
      for (const key of keys) {
        const value = container[key];
        if (value === undefined) continue;
        const normalized = this.normalizeArgsCandidate(value);
        if (normalized) {
          return normalized;
        }
      }
    }

    return {};
  }

  /**
   * 正規化工具參數候選值
   * - 物件：直接返回
   * - JSON 字串：解析後若為物件返回
   * - 非物件（字串/數字/布林/陣列）：以 value 包裝，避免資訊遺失
   */
  private normalizeArgsCandidate(value: unknown): Record<string, unknown> | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    if (typeof value === 'string') {
      if (!value.trim()) return null;

      const parsed = this.tryParseJSON(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }

      return { value };
    }

    if (Array.isArray(value)) {
      return { value };
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return { value };
    }

    return null;
  }

  /**
   * 推導工具狀態（兼容 tool_call/tool_call_start/tool_call_end）
   */
  private inferToolStatus(
    eventType: string,
    props: SDKEventProperties
  ): 'pending' | 'running' | 'completed' | 'error' {
    const status = typeof props.status === 'string' ? props.status.toLowerCase() : '';
    if (status === 'pending' || status === 'running' || status === 'completed' || status === 'error') {
      return status;
    }

    if (eventType === 'tool_call_start') return 'running';
    if (eventType === 'tool_call_end') {
      return typeof props.error === 'string' && props.error.trim() ? 'error' : 'completed';
    }
    return 'pending';
  }

  /**
   * 提取訊息角色
   */
  private extractMessageRole(props: SDKEventProperties): string | null {
    const info = props.info && typeof props.info === 'object'
      ? (props.info as Record<string, unknown>)
      : null;
    const infoMessage = info?.message && typeof info.message === 'object'
      ? (info.message as Record<string, unknown>)
      : null;
    const message = props.message && typeof props.message === 'object'
      ? (props.message as Record<string, unknown>)
      : null;

    const candidates = [
      props.role,
      info?.role,
      infoMessage?.role,
      message?.role,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim() !== '') {
        return candidate.trim().toLowerCase();
      }
    }

    return null;
  }

  /**
   * 判斷是否應忽略該角色的訊息
   */
  private isIgnoredMessageRole(role: string | null): boolean {
    if (!role) return false;
    return role === 'user' || role === 'human' || role === 'system' || role === 'tool';
  }

  /**
   * 判斷事件是否為「思考中」訊號
   */
  private hasThinkingSignal(props: SDKEventProperties): boolean {
    const part = props.part && typeof props.part === 'object'
      ? (props.part as Record<string, unknown>)
      : null;
    if (part && this.isThinkingPartType(part.type)) {
      return true;
    }

    const delta = props.delta && typeof props.delta === 'object'
      ? (props.delta as Record<string, unknown>)
      : null;
    if (delta && this.isThinkingPartType(delta.type)) {
      return true;
    }

    const info = props.info && typeof props.info === 'object'
      ? (props.info as Record<string, unknown>)
      : null;
    const infoPart = info?.part && typeof info.part === 'object'
      ? (info.part as Record<string, unknown>)
      : null;
    if (infoPart && this.isThinkingPartType(infoPart.type)) {
      return true;
    }

    if (Array.isArray(info?.parts)) {
      return info.parts.some((candidate) => {
        if (!candidate || typeof candidate !== 'object') return false;
        return this.isThinkingPartType((candidate as Record<string, unknown>).type);
      });
    }

    return false;
  }

  /**
   * 判斷 part type 是否屬於思考類型
   */
  private isThinkingPartType(type: unknown): boolean {
    if (typeof type !== 'string') return false;
    const normalized = type.toLowerCase();
    return normalized === 'thinking'
      || normalized === 'reasoning'
      || normalized === 'reasoning_text'
      || normalized === 'analysis';
  }

  /**
   * 解析 question 事件（兼容多種 SDK payload）
   */
  private parseQuestionEvent(props: SDKEventProperties): QuestionEventData | null {
    const questionFromNested = props.question && typeof props.question === 'object'
      ? (props.question as Record<string, unknown>)
      : null;

    const questionFromList = Array.isArray(props.questions)
      ? props.questions.find((item) => item && typeof item === 'object') as Record<string, unknown> | undefined
      : undefined;

    const questionObject = questionFromNested || questionFromList || null;

    const questionId = (typeof questionObject?.id === 'string' ? questionObject.id : '')
      || (typeof props.question_id === 'string' ? props.question_id : '')
      || (typeof props.questionId === 'string' ? props.questionId : '')
      || (typeof props.request_id === 'string' ? props.request_id : '')
      || (typeof props.requestId === 'string' ? props.requestId : '')
      || (typeof props.id === 'string' ? props.id : '');

    const text = (typeof questionObject?.text === 'string' ? questionObject.text : '')
      || (typeof questionObject?.question === 'string' ? questionObject.question : '')
      || (typeof questionObject?.prompt === 'string' ? questionObject.prompt : '')
      || (typeof questionObject?.title === 'string' ? questionObject.title : '')
      || (typeof questionObject?.message === 'string' ? questionObject.message : '')
      || (typeof props.text === 'string' ? props.text : '')
      || (typeof props.prompt === 'string' ? props.prompt : '')
      || (typeof props.title === 'string' ? props.title : '');

    if (!questionId || !text) {
      return null;
    }

    const rawOptions = questionObject?.options
      ?? questionObject?.choices
      ?? questionObject?.items
      ?? props.options;
    const options = this.normalizeQuestionOptions(rawOptions);

    const sessionId = (typeof questionObject?.session_id === 'string' ? questionObject.session_id : '')
      || (typeof questionObject?.sessionId === 'string' ? questionObject.sessionId : '')
      || (typeof questionObject?.sessionID === 'string' ? questionObject.sessionID : '')
      || props.session_id
      || props.sessionId
      || props.sessionID
      || this.currentSessionId
      || '';

    return {
      sessionId,
      questionId,
      text,
      options,
      multiple: Boolean(questionObject?.multiple || props.multiple || false),
    };
  }

  /**
   * 從 tool part 中提取 ToolRequestEventData
   * 支援 props.part, props.info.part, props.info.parts[], props.delta
   * 當 part.type === 'tool' 時觸發
   */
  private extractToolPartData(props: SDKEventProperties): ToolRequestEventData | null {
    const sessionId = props.session_id || props.sessionId || this.currentSessionId || '';

    // 嘗試從多個來源找到 tool part
    const toolParts: Array<{ part: Record<string, unknown>; source: string }> = [];

    // 來源 1: props.part
    if (props.part && typeof props.part === 'object') {
      const part = props.part as Record<string, unknown>;
      if (this.isToolPartType(part.type)) {
        toolParts.push({ part, source: 'props.part' });
      }
    }

    // 來源 2: props.delta (常見於 message.part.delta 事件)
    if (props.delta && typeof props.delta === 'object') {
      const delta = props.delta as Record<string, unknown>;
      if (this.isToolPartType(delta.type)) {
        toolParts.push({ part: delta, source: 'props.delta' });
      }
    }

    // 來源 3: props.info.part
    if (props.info && typeof props.info === 'object') {
      const info = props.info as Record<string, unknown>;
      if (info.part && typeof info.part === 'object') {
        const infoPart = info.part as Record<string, unknown>;
        if (this.isToolPartType(infoPart.type)) {
          toolParts.push({ part: infoPart, source: 'props.info.part' });
        }
      }

      // 來源 4: props.info.parts[]
      if (Array.isArray(info.parts)) {
        for (const candidate of info.parts) {
          if (candidate && typeof candidate === 'object' && this.isToolPartType((candidate as Record<string, unknown>).type)) {
            toolParts.push({ part: candidate as Record<string, unknown>, source: 'props.info.parts[]' });
          }
        }
      }
    }

    // 從第一個找到的 tool part 提取資料
    for (const { part } of toolParts) {
      const toolName = this.extractToolNameFromPart(part);
      if (toolName === 'unknown') continue;

      const state = part.state && typeof part.state === 'object'
        ? (part.state as Record<string, unknown>)
        : {};

      const status = this.extractToolStatusFromState(state, part);
      // 優先從 state 提取 args，若為空則從 part 上 fallback
      let args = this.extractToolArgsFromState(state);
      if (Object.keys(args).length === 0) {
        args = this.extractToolArgsFromPart(part);
      }
      const result = state.output !== undefined ? state.output : undefined;
      const error = typeof state.error === 'string' ? state.error : undefined;

      // requestId: 優先 call_id，其次 id
      const requestId = (typeof part.call_id === 'string' ? part.call_id : '')
        || (typeof part.id === 'string' ? part.id : '')
        || (typeof state.call_id === 'string' ? state.call_id : '')
        || (typeof state.id === 'string' ? state.id : '')
        || '';

      return {
        sessionId,
        toolName,
        args,
        requestId,
        status,
        result,
        error,
      };
    }

    return null;
  }

  /**
   * 判斷 part type 是否為 tool 類型
   */
  private isToolPartType(type: unknown): boolean {
    if (typeof type !== 'string') return false;
    return type === 'tool';
  }

  /**
   * 從 tool part 中提取工具名稱
   * 優先順序: part.tool > part.tool_name > part.toolName > part.name > state.tool
   */
  private extractToolNameFromPart(part: Record<string, unknown>): string {
    // 直接的 tool 欄位（最高優先）
    if (typeof part.tool === 'string' && part.tool.trim()) return part.tool.trim();

    // 擴充 fallback: tool_name, toolName, name
    if (typeof part.tool_name === 'string' && part.tool_name.trim()) return part.tool_name.trim();
    if (typeof part.toolName === 'string' && part.toolName.trim()) return part.toolName.trim();
    if (typeof part.name === 'string' && part.name.trim()) return part.name.trim();

    // state.tool (作為最後 fallback)
    const state = part.state && typeof part.state === 'object'
      ? (part.state as Record<string, unknown>)
      : {};
    if (typeof state.tool === 'string' && state.tool.trim()) return state.tool.trim();
    // 也檢查 state.tool_name / state.toolName / state.name
    if (typeof state.tool_name === 'string' && state.tool_name.trim()) return state.tool_name.trim();
    if (typeof state.toolName === 'string' && state.toolName.trim()) return state.toolName.trim();
    if (typeof state.name === 'string' && state.name.trim()) return state.name.trim();

    return 'unknown';
  }

  /**
   * 從 state 中提取工具狀態
   */
  private extractToolStatusFromState(
    state: Record<string, unknown>,
    part: Record<string, unknown>
  ): 'pending' | 'running' | 'completed' | 'error' {
    // state.status
    if (typeof state.status === 'string') {
      const s = state.status.toLowerCase();
      if (s === 'pending' || s === 'running' || s === 'completed' || s === 'error') {
        return s;
      }
    }

    // part.status
    if (typeof part.status === 'string') {
      const s = part.status.toLowerCase();
      if (s === 'pending' || s === 'running' || s === 'completed' || s === 'error') {
        return s;
      }
    }

    // 從 input/output/error 推斷狀態
    if (typeof state.error === 'string' && state.error.trim()) return 'error';
    if (state.output !== undefined) return 'completed';
    if (state.input !== undefined) return 'running';
    return 'pending';
  }

  /**
   * 從 state 中提取工具參數
   * 支援：state.input, state.args, state.arguments, state.parameters
   * 並支援 string JSON 解析
   */
  private extractToolArgsFromState(state: Record<string, unknown>): Record<string, unknown> {
    // 嘗試多個可能的參數來源
    const sources = ['input', 'args', 'arguments', 'parameters'];
    for (const key of sources) {
      const value = state[key];
      if (value !== undefined) {
        // 物件類型直接返回
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return value as Record<string, unknown>;
        }
        // string JSON 嘗試解析
        if (typeof value === 'string' && value.trim()) {
          const parsed = this.tryParseJSON(value);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        }
      }
    }
    return {};
  }

  /**
   * 嘗試解析 JSON 字串
   */
  private tryParseJSON(str: string): unknown | null {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  /**
   * 從 part 上提取工具參數（fallback）
   */
  private extractToolArgsFromPart(part: Record<string, unknown>): Record<string, unknown> {
    // 優先檢查 part.input / part.args / part.arguments / part.parameters
    const sources = ['input', 'args', 'arguments', 'parameters'];
    for (const key of sources) {
      const value = part[key];
      if (value !== undefined) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return value as Record<string, unknown>;
        }
        if (typeof value === 'string' && value.trim()) {
          const parsed = this.tryParseJSON(value);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        }
      }
    }
    return {};
  }

  /**
   * 正規化 question options
   */
  private normalizeQuestionOptions(
    rawOptions: unknown
  ): Array<{ label: string; value: string; description?: string }> {
    if (!Array.isArray(rawOptions)) {
      return [];
    }

    return rawOptions
      .map((option) => {
        if (typeof option === 'string') {
          const text = option.trim();
          if (!text) return null;
          return { label: text, value: text };
        }

        if (!option || typeof option !== 'object') {
          return null;
        }

        const candidate = option as Record<string, unknown>;
        const label = typeof candidate.label === 'string' && candidate.label.trim() !== ''
          ? candidate.label
          : typeof candidate.text === 'string' && candidate.text.trim() !== ''
            ? candidate.text
            : typeof candidate.title === 'string' && candidate.title.trim() !== ''
              ? candidate.title
              : typeof candidate.name === 'string' && candidate.name.trim() !== ''
                ? candidate.name
              : typeof candidate.value === 'string'
                ? candidate.value
                : '';
        if (!label) return null;

        const value = typeof candidate.value === 'string' && candidate.value.trim() !== ''
          ? candidate.value
          : typeof candidate.id === 'string' && candidate.id.trim() !== ''
            ? candidate.id
          : label;

        const description = typeof candidate.description === 'string' && candidate.description.trim() !== ''
          ? candidate.description
          : undefined;

        return { label, value, description };
      })
      .filter((option): option is { label: string; value: string; description?: string } => option !== null);
  }

  /**
   * 檢查是否正在處理
   */
  public isActive(): boolean {
    return this.isProcessing && !this.isDisposed;
  }

  /**
   * 獲取當前 Session ID
   */
  public getSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * 獲取事件流引用（用於調試）
   */
  public getStream(): AsyncIterable<SDKEvent> | null {
    return this.eventStreamRef;
  }

  /**
   * 清理資源
   */
  public dispose(): void {
    this.stop();
    this.isDisposed = true;
    this.removeAllListeners();
    logger.debug('[SSEEventEmitterAdapter] 資源已清理');
  }
}

// ============== 導出 ==============

export default {
  SSEEventEmitterAdapter,
};
