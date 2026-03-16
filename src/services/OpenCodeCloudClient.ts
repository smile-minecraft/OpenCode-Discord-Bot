/**
 * OpenCode Cloud Client
 * @description HTTP client for OpenCode Zen/Go cloud API
 */

import { log as logger } from '../utils/logger.js';

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
      // 嘗試獲取模型列表來驗證 API Key
      const models = await this.getModels();
      
      if (models && models.length > 0) {
        return {
          valid: true,
          models: models.slice(0, 5), // 只返回前5個模型
        };
      }

      return {
        valid: false,
        error: '無法獲取模型列表',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        valid: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 獲取可用的模型列表
   * @returns 模型 ID 列表
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
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`[OpenCodeCloudClient] Failed to get models: ${response.status} ${errorText}`);
        return [];
      }

      const data = await response.json() as ModelListResponse;
      
      if (data.data && Array.isArray(data.data)) {
        return data.data.map((m) => m.id);
      }

      return [];
    } catch (error) {
      logger.error('[OpenCodeCloudClient] Error fetching models', {
        error: error instanceof Error ? error.message : String(error),
        provider: this.provider.id,
      });
      return [];
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

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${errorText}`);
    }

    return response.json() as Promise<ChatCompletionResponse>;
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
