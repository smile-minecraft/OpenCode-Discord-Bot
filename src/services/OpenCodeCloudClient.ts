/**
 * OpenCode Cloud Client
 * @description HTTP client for OpenCode Zen/Go cloud API
 */

import { log as logger } from '../utils/logger.js';
import { TIMEOUTS } from '../config/constants.js';

// ============== 常量 ==============

/** 模型列表請求超時（毫秒） */
const MODELS_TIMEOUT = 10000;
/** 聊天完成請求超時（毫秒） */
const CHAT_COMPLETION_TIMEOUT = 120000; // 2分鐘
/** Session 請求超時（毫秒） */
const SESSION_TIMEOUT = TIMEOUTS.HTTP;
/** 訊息發送請求超時（毫秒） */
const MESSAGE_TIMEOUT = 120000; // 2分鐘

// ============== 類型定義 ==============

/**
 * OpenCode Cloud Provider 類型
 */
export type OpenCodeProviderType = 'opencode-zen' | 'opencode-go' | 'anthropic' | 'openai';

/**
 * Provider 定義
 */
export interface ProviderDefinition {
  id: OpenCodeProviderType;
  name: string;
  description: string;
  baseUrl: string;
  pricingUrl: string;
  modelPrefix: string;
}

/**
 * 可用的 Providers
 */
export const PROVIDERS: Record<OpenCodeProviderType, ProviderDefinition> = {
  'opencode-zen': {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    description: '付費模型 (GPT-5, Claude Opus 4.6, etc.)',
    baseUrl: 'https://opencode.ai/zen/v1',
    pricingUrl: 'https://opencode.ai/zen',
    modelPrefix: 'opencode/',
  },
  'opencode-go': {
    id: 'opencode-go',
    name: 'OpenCode Go',
    description: '$10/月訂閱 (GLM-5, Kimi K2.5, MiniMax M2.5)',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    pricingUrl: 'https://opencode.ai/go',
    modelPrefix: 'opencode-go/',
  },
  'anthropic': {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 模型',
    baseUrl: 'https://api.anthropic.com/v1',
    pricingUrl: 'https://www.anthropic.com/pricing',
    modelPrefix: 'claude-',
  },
  'openai': {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT 模型',
    baseUrl: 'https://api.openai.com/v1',
    pricingUrl: 'https://openai.com/pricing',
    modelPrefix: 'gpt-',
  },
};

/**
 * Chat Message 格式
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Chat Completion Request
 */
export interface CreateChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

/**
 * Chat Completion Response
 */
export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Model List Response
 */
export interface ModelListResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
  }>;
}

/**
 * Validation Result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  models?: string[];
}

/**
 * Cloud Session 創建請求
 */
export interface CreateCloudSessionRequest {
  model: string;
  agent?: string;
  projectPath?: string;
  initialPrompt?: string;
}

/**
 * Cloud Session 創建響應
 */
export interface CloudSessionResponse {
  id: string;
  status: string;
  model: string;
  createdAt: string;
}

// ============== Client 類別 ==============

/**
 * OpenCode Cloud Client
 * @description 用於連接 OpenCode Zen/Go API 的 HTTP 客戶端
 */
export class OpenCodeCloudClient {
  private static instance: OpenCodeCloudClient | null = null;
  private apiKey: string;
  private provider: ProviderDefinition;

  /**
   * 建立 OpenCode Cloud Client（單例工廠）
   * @param apiKey - API Key
   * @param provider - Provider 類型
   */
  static getInstance(apiKey?: string, provider?: OpenCodeProviderType): OpenCodeCloudClient {
    if (!OpenCodeCloudClient.instance) {
      if (!apiKey || !provider) {
        throw new Error('OpenCodeCloudClient not initialized. Provide apiKey and provider on first call.');
      }
      OpenCodeCloudClient.instance = new OpenCodeCloudClient(apiKey, provider);
    }
    return OpenCodeCloudClient.instance;
  }

  /**
   * 初始化 OpenCode Cloud Client
   * @param apiKey - API Key
   * @param provider - Provider 類型
   */
  static initialize(apiKey: string, provider: OpenCodeProviderType): OpenCodeCloudClient {
    OpenCodeCloudClient.instance = new OpenCodeCloudClient(apiKey, provider);
    return OpenCodeCloudClient.instance;
  }

  /**
   * 重置實例（用於測試）
   */
  static resetInstance(): void {
    OpenCodeCloudClient.instance = null;
  }

  /**
   * 建立 OpenCode Cloud Client
   * @param apiKey - API Key
   * @param provider - Provider 類型
   */
  constructor(apiKey: string, provider: OpenCodeProviderType) {
    this.apiKey = apiKey;
    this.provider = PROVIDERS[provider];
    if (!this.provider) {
      throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * 獲取 Provider 資訊
   */
  getProvider(): ProviderDefinition {
    return this.provider;
  }

  /**
   * 驗證 API Key
   * @returns 驗證結果
   */
  async validateApiKey(): Promise<ValidationResult> {
    try {
      logger.info('[OpenCodeCloudClient] Starting API key validation', {
        provider: this.provider.id,
        baseUrl: this.provider.baseUrl,
      });

      // Step 1: 首先嘗試調用 getModels() 獲取實際模型列表
      // 這適用於所有 providers，因為如果能成功獲取模型列表，說明 API Key 是有效的
      try {
        const models = await this.getModels();
        
        if (models && models.length > 0) {
          // 成功獲取模型列表，API Key 有效
          logger.info('[OpenCodeCloudClient] Validation successful - fetched models from API', {
            provider: this.provider.id,
            modelCount: models.length,
          });
          return {
            valid: true,
            models: models.slice(0, 5), // 只返回前5個模型
          };
        }
        
        // 模型列表為空，繼續嘗試 chat completion
        logger.warn('[OpenCodeCloudClient] Models list empty, trying chat completion');
      } catch (error) {
        // getModels() 拋出錯誤，檢查是否是 404
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // 如果是 404（端點不存在），則回退到 chat completion 驗證
        if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
          logger.info('[OpenCodeCloudClient] Models endpoint not found (404), falling back to chat completion validation');
        } else {
          // 其他錯誤（如 401 Unauthorized），說明 API Key 無效
          logger.warn('[OpenCodeCloudClient] API key validation failed via getModels', {
            provider: this.provider.id,
            error: errorMessage,
          });
          return {
            valid: false,
            error: `API Key 驗證失敗: ${errorMessage}`,
          };
        }
      }

      // Step 2: 回退到 chat completion 驗證
      // 當 getModels() 返回 404 時使用
      logger.debug('[OpenCodeCloudClient] Attempting chat completion validation');
      const chatValidation = await this.validateWithChatCompletion();
      
      if (chatValidation.valid) {
        logger.info('[OpenCodeCloudClient] Validation successful via chat completion fallback');
      } else {
        logger.warn('[OpenCodeCloudClient] Validation failed via chat completion fallback', {
          error: chatValidation.error,
        });
      }
      
      return chatValidation;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error('[OpenCodeCloudClient] Validation error', {
        provider: this.provider.id,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      
      return {
        valid: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 使用 Chat Completion 驗證 API Key（替代方法）
   * @returns 驗證結果
   */
  private async validateWithChatCompletion(): Promise<ValidationResult> {
    try {
      // 選擇一個便宜的模型進行測試
      const testModel = this.getTestModel();
      
      logger.debug('[OpenCodeCloudClient] Testing API with model', {
        provider: this.provider.id,
        testModel,
        endpoint: `${this.provider.baseUrl}/chat/completions`,
      });
      
      const response = await this.createChatCompletion({
        model: testModel,
        messages: [
          { role: 'user', content: 'Hi' },
        ],
        max_tokens: 10,
      });

      if (response && response.choices && response.choices.length > 0) {
        logger.info('[OpenCodeCloudClient] API validation successful', {
          provider: this.provider.id,
          testModel,
        });
        return {
          valid: true,
          models: [testModel],
        };
      }

      logger.warn('[OpenCodeCloudClient] API validation failed - empty response', {
        provider: this.provider.id,
        testModel,
        response,
      });

      return {
        valid: false,
        error: 'Chat completion validation failed - empty response',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error('[OpenCodeCloudClient] API validation failed with error', {
        provider: this.provider.id,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      
      return {
        valid: false,
        error: `API 驗證失敗: ${errorMessage}`,
      };
    }
  }

  /**
   * 獲取測試用的模型名稱
   * @returns 模型名稱
   */
  private getTestModel(): string {
    switch (this.provider.id) {
      case 'opencode-zen':
        return `${this.provider.modelPrefix}gpt-5.2-codex`;
      case 'opencode-go':
        return `${this.provider.modelPrefix}kimi-k2.5`;
      case 'anthropic':
        return 'claude-sonnet-4-20250514';
      case 'openai':
        return 'gpt-4o';
      default:
        return 'gpt-4o';
    }
  }

  /**
   * 獲取可用的模型列表
   * @returns 模型 ID 列表
   * @throws 如果 API 返回 404，將拋出錯誤而非返回 fallback 模型
   */
  async getModels(): Promise<string[]> {
    const url = `${this.provider.baseUrl}/models`;
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    // Anthropic 需要不同的 header
    if (this.provider.id === 'anthropic') {
      headers['x-api-key'] = this.apiKey;
      delete headers['Authorization'];
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(MODELS_TIMEOUT),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errorMsg = `Failed to get models: ${response.status} ${response.statusText} - ${errorText}`;
        
        // 404 錯誤拋出錯誤，讓 validateApiKey 決定是否回退到 chat completion
        // 不再返回 fallback 模型，因為我們需要先驗證 API Key 的有效性
        if (response.status === 404) {
          logger.warn(`[OpenCodeCloudClient] Models endpoint not found (404)`);
          throw new Error(`404: Models endpoint not found - ${errorText}`);
        }
        
        logger.warn(`[OpenCodeCloudClient] ${errorMsg}`);
        throw new Error(errorMsg);
      }

      const data = await response.json() as ModelListResponse;
      
      if (data.data && Array.isArray(data.data)) {
        return data.data.map((m) => m.id);
      }

      return [];
    } catch (error) {
      // 如果已經是 Error 類型，直接重新拋出
      if (error instanceof Error) {
        logger.error('[OpenCodeCloudClient] Error fetching models', {
          error: error.message,
          provider: this.provider.id,
        });
        throw error;
      }
      
      logger.error('[OpenCodeCloudClient] Error fetching models', {
        error: String(error),
        provider: this.provider.id,
      });
      throw new Error(String(error));
    }
  }

  /**
   * 發送聊天完成請求
   * @param request - 請求參數
   * @returns 回應
   */
  async createChatCompletion(request: CreateChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.provider.baseUrl}/chat/completions`;
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    // Anthropic 需要不同的 header
    if (this.provider.id === 'anthropic') {
      headers['x-api-key'] = this.apiKey;
      delete headers['Authorization'];
      // Anthropic 使用 anthropic-version header
      headers['anthropic-version'] = '2023-06-01';
    }

    try {
      logger.debug('[OpenCodeCloudClient] Sending chat completion request', {
        provider: this.provider.id,
        url,
        model: request.model,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(CHAT_COMPLETION_TIMEOUT),
      });

      if (!response.ok) {
        const errorText = await response.text();
        
        logger.error('[OpenCodeCloudClient] Chat completion request failed', {
          provider: this.provider.id,
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          model: request.model,
        });
        
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json() as ChatCompletionResponse;
      
      logger.debug('[OpenCodeCloudClient] Chat completion request successful', {
        provider: this.provider.id,
        model: request.model,
      });

      return data;
    } catch (error) {
      if (error instanceof Error) {
        logger.error('[OpenCodeCloudClient] Chat completion error', {
          provider: this.provider.id,
          error: error.message,
          model: request.model,
        });
        throw error;
      }
      
      logger.error('[OpenCodeCloudClient] Chat completion unknown error', {
        provider: this.provider.id,
        error: String(error),
        model: request.model,
      });
      throw new Error(String(error));
    }
  }

  /**
   * 發送測試訊息
   * @param message - 測試訊息
   * @returns 回覆內容
   */
  async sendTestMessage(message: string = 'Hello'): Promise<string> {
    // 選擇一個預設模型
    const model = this.provider.id === 'opencode-zen' 
      ? `${this.provider.modelPrefix}gpt-5.2-codex`
      : this.provider.id === 'opencode-go'
      ? `${this.provider.modelPrefix}kimi-k2.5`
      : this.provider.id === 'anthropic'
      ? 'claude-sonnet-4-20250514'
      : 'gpt-4o';

    const response = await this.createChatCompletion({
      model,
      messages: [
        { role: 'user', content: message },
      ],
      max_tokens: 100,
    });

      return response.choices[0]?.message?.content || 'No response';
  }

  /**
   * 創建 Cloud Session
   * @param request - Session 創建請求
   * @returns Session 響應
   */
  async createSession(request: CreateCloudSessionRequest): Promise<CloudSessionResponse> {
    const url = `${this.provider.baseUrl}/sessions`;
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    // Anthropic 需要不同的 header
    if (this.provider.id === 'anthropic') {
      headers['x-api-key'] = this.apiKey;
      delete headers['Authorization'];
      headers['anthropic-version'] = '2023-06-01';
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(SESSION_TIMEOUT),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create session: ${response.status} ${errorText}`);
      }

      return response.json() as Promise<CloudSessionResponse>;
    } catch (error) {
      // 如果是 session API 不支援的错误，返回一个模拟的 session 响应
      // 这样可以让系统继续工作（聊天模式下）
      if (error instanceof Error && error.message.includes('Failed to create session')) {
        logger.warn('[OpenCodeCloudClient] Session API not supported, using chat mode');
        return {
          id: `chat_${Date.now()}`,
          status: 'chat_mode',
          model: request.model,
          createdAt: new Date().toISOString(),
        };
      }
      throw error;
    }
  }

  /**
   * 發送訊息到 Cloud Session
   * @param sessionId - Session ID
   * @param message - 訊息內容
   * @returns 響應內容
   */
  async sendMessage(sessionId: string, message: string): Promise<string> {
    // 如果是 chat mode，直接使用 chat completion
    if (sessionId.startsWith('chat_')) {
      const response = await this.createChatCompletion({
        model: this.provider.id === 'opencode-zen' 
          ? `${this.provider.modelPrefix}gpt-5.2-codex`
          : this.provider.id === 'opencode-go'
          ? `${this.provider.modelPrefix}kimi-k2.5`
          : this.provider.id === 'anthropic'
          ? 'claude-sonnet-4-20250514'
          : 'gpt-4o',
        messages: [
          { role: 'user', content: message },
        ],
        max_tokens: 4096,
      });
      return response.choices[0]?.message?.content || '';
    }

    const url = `${this.provider.baseUrl}/sessions/${sessionId}/messages`;
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    if (this.provider.id === 'anthropic') {
      headers['x-api-key'] = this.apiKey;
      delete headers['Authorization'];
      headers['anthropic-version'] = '2023-06-01';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(MESSAGE_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to send message: ${response.status} ${errorText}`);
    }

    const data = await response.json() as { content?: string };
    return data.content || '';
  }

  /**
   * 終止 Cloud Session
   * @param sessionId - Session ID
   */
  async abortSession(sessionId: string): Promise<void> {
    if (sessionId.startsWith('chat_')) {
      // chat mode 不需要終止
      return;
    }

    const url = `${this.provider.baseUrl}/sessions/${sessionId}`;
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
    };

    if (this.provider.id === 'anthropic') {
      headers['x-api-key'] = this.apiKey;
      delete headers['Authorization'];
    }

    try {
      await fetch(url, {
        method: 'DELETE',
        headers,
      });
    } catch (error) {
      logger.warn('[OpenCodeCloudClient] Failed to abort session', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * 建立 OpenCode Cloud Client 工廠函數
 * @param apiKey - API Key
 * @param provider - Provider 類型
 * @returns OpenCodeCloudClient 實例
 */
export function createOpenCodeCloudClient(apiKey: string, provider: OpenCodeProviderType): OpenCodeCloudClient {
  return new OpenCodeCloudClient(apiKey, provider);
}

export default {
  PROVIDERS,
  OpenCodeCloudClient,
  createOpenCodeCloudClient,
};
