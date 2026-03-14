/**
 * 模型定義
 * @description 定義所有可用的 AI 模型及其元數據
 */

// 模型供應商
export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'xai' | 'cohere' | 'mistral';

// 模型類型
export type ModelCategory = 'fast' | 'balanced' | 'powerful';

// 模型定價（每百萬 tokens）
export interface ModelPricing {
  input: number;  // $/M tokens
  output: number; // $/M tokens
}

// 模型限制
export interface ModelLimits {
  maxTokens: number;      // 最大輸出 tokens
  contextWindow: number;   // 上下文窗口 tokens
  maxImageSize?: number;   // 圖片大小限制 (MB)
}

// 模型定義
export interface ModelDefinition {
  id: string;              // 模型 ID (如: anthropic/claude-sonnet-4-20250514)
  provider: ModelProvider;  // 提供商
  name: string;            // 顯示名稱
  description: string;      // 模型描述
  category: ModelCategory; // 模型類型
  pricing: ModelPricing;   // 定價
  limits: ModelLimits;     // 限制
  features: string[];       // 支援的功能
  releaseDate?: string;    // 發布日期
}

// 模型列表
export const MODELS: ModelDefinition[] = [
  // Anthropic 模型
  {
    id: 'anthropic/claude-sonnet-4-20250514',
    provider: 'anthropic',
    name: 'Claude Sonnet 4',
    description: '最新的 Claude Sonnet 模型，平衡了能力和速度，適合大多數任務',
    category: 'balanced',
    pricing: { input: 3.00, output: 15.00 },
    limits: { maxTokens: 8192, contextWindow: 200000 },
    features: ['代碼生成', '推理分析', '文件理解', '工具使用', '多模態'],
    releaseDate: '2025-05-14',
  },
  {
    id: 'anthropic/claude-opus-4-20250514',
    provider: 'anthropic',
    name: 'Claude Opus 4',
    description: '最强大的 Claude 模型，適合複雜的推理和創意寫作任務',
    category: 'powerful',
    pricing: { input: 15.00, output: 75.00 },
    limits: { maxTokens: 8192, contextWindow: 200000 },
    features: ['高級推理', '創意寫作', '複雜分析', '代碼審查', '多模態'],
    releaseDate: '2025-05-14',
  },
  {
    id: 'anthropic/claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    name: 'Claude 3.5 Sonnet',
    description: '穩定且高效的模型，適合日常開發任務',
    category: 'balanced',
    pricing: { input: 3.00, output: 15.00 },
    limits: { maxTokens: 8192, contextWindow: 200000 },
    features: ['代碼生成', '推理分析', '工具使用'],
    releaseDate: '2024-10-22',
  },
  {
    id: 'anthropic/claude-3-haiku-20240307',
    provider: 'anthropic',
    name: 'Claude 3 Haiku',
    description: '快速響應的模型，適合簡單任務和即時反饋',
    category: 'fast',
    pricing: { input: 0.25, output: 1.25 },
    limits: { maxTokens: 4096, contextWindow: 200000 },
    features: ['快速響應', '簡單任務', '成本效益'],
    releaseDate: '2024-03-07',
  },

  // OpenAI 模型
  {
    id: 'openai/gpt-4o',
    provider: 'openai',
    name: 'GPT-4o',
    description: 'OpenAI 最新的旗艦多模態模型，支援文字、圖片和音頻',
    category: 'powerful',
    pricing: { input: 5.00, output: 15.00 },
    limits: { maxTokens: 16384, contextWindow: 128000 },
    features: ['多模態', '實時推理', '代碼生成', '工具使用'],
    releaseDate: '2024-05-13',
  },
  {
    id: 'openai/gpt-4o-mini',
    provider: 'openai',
    name: 'GPT-4o Mini',
    description: 'GPT-4o 的精簡版本，成本更低，速度更快',
    category: 'fast',
    pricing: { input: 0.15, output: 0.60 },
    limits: { maxTokens: 16384, contextWindow: 128000 },
    features: ['快速響應', '成本效益', '多模態'],
    releaseDate: '2024-07-18',
  },
  {
    id: 'openai/gpt-4-turbo',
    provider: 'openai',
    name: 'GPT-4 Turbo',
    description: '高性能的 GPT-4 模型，支援更長的上下文',
    category: 'balanced',
    pricing: { input: 10.00, output: 30.00 },
    limits: { maxTokens: 4096, contextWindow: 128000 },
    features: ['代碼生成', '推理分析', '工具使用'],
    releaseDate: '2023-11-06',
  },

  // Google 模型
  {
    id: 'google/gemini-2.0-flash-exp',
    provider: 'google',
    name: 'Gemini 2.0 Flash Experimental',
    description: 'Google 最新實驗性模型，極速響應，支援新功能',
    category: 'fast',
    pricing: { input: 0.00, output: 0.00 },
    limits: { maxTokens: 8192, contextWindow: 1000000 },
    features: ['極速響應', '原生工具', '多模態'],
    releaseDate: '2025-02',
  },
  {
    id: 'google/gemini-1.5-pro',
    provider: 'google',
    name: 'Gemini 1.5 Pro',
    description: 'Google 旗艦模型，支援超長上下文和先進的多模態能力',
    category: 'powerful',
    pricing: { input: 1.25, output: 5.00 },
    limits: { maxTokens: 8192, contextWindow: 2000000 },
    features: ['超長上下文', '多模態', '代碼生成', '推理分析'],
    releaseDate: '2024-05-14',
  },
  {
    id: 'google/gemini-1.5-flash',
    provider: 'google',
    name: 'Gemini 1.5 Flash',
    description: '快速且成本效益高的模型，適合大規模應用',
    category: 'fast',
    pricing: { input: 0.075, output: 0.30 },
    limits: { maxTokens: 8192, contextWindow: 1000000 },
    features: ['快速響應', '成本效益', '多模態', '長上下文'],
    releaseDate: '2024-05-14',
  },

  // xAI 模型
  {
    id: 'xai/grok-2',
    provider: 'xai',
    name: 'Grok 2',
    description: 'xAI 開發的模型，具備獨特的幽默感和開放性',
    category: 'balanced',
    pricing: { input: 2.00, output: 10.00 },
    limits: { maxTokens: 8192, contextWindow: 131072 },
    features: ['代碼生成', '推理分析', '實時資訊'],
    releaseDate: '2024-08',
  },
  {
    id: 'xai/grok-2-vision',
    provider: 'xai',
    name: 'Grok 2 Vision',
    description: 'Grok 2 的多模態版本，支援圖像理解',
    category: 'balanced',
    pricing: { input: 2.00, output: 10.00 },
    limits: { maxTokens: 8192, contextWindow: 131072, maxImageSize: 20 },
    features: ['多模態', '圖像理解', '代碼生成'],
    releaseDate: '2024-11',
  },

  // Cohere 模型
  {
    id: 'cohere/command-r-plus',
    provider: 'cohere',
    name: 'Command R+',
    description: '企業級模型，擅長 RAG 和工具使用場景',
    category: 'powerful',
    pricing: { input: 3.00, output: 15.00 },
    limits: { maxTokens: 4096, contextWindow: 128000 },
    features: ['RAG', '工具使用', '企業級安全', '多語言'],
    releaseDate: '2024-04',
  },
  {
    id: 'cohere/command-r',
    provider: 'cohere',
    name: 'Command R',
    description: '高效能的企業模型，適合各種商業應用',
    category: 'balanced',
    pricing: { input: 0.50, output: 1.50 },
    limits: { maxTokens: 4096, contextWindow: 128000 },
    features: ['成本效益', 'RAG', '工具使用'],
    releaseDate: '2024-04',
  },

  // Mistral 模型
  {
    id: 'mistral/mistral-large-latest',
    provider: 'mistral',
    name: 'Mistral Large',
    description: 'Mistral 旗艦模型，歐洲最強大的語言模型之一',
    category: 'powerful',
    pricing: { input: 2.00, output: 6.00 },
    limits: { maxTokens: 32768, contextWindow: 128000 },
    features: ['代碼生成', '推理分析', '多語言', '工具使用'],
    releaseDate: '2024-02',
  },
  {
    id: 'mistral/mistral-small-latest',
    provider: 'mistral',
    name: 'Mistral Small',
    description: 'Mistral 精簡模型，適合快速任務',
    category: 'fast',
    pricing: { input: 0.20, output: 0.60 },
    limits: { maxTokens: 32768, contextWindow: 128000 },
    features: ['快速響應', '成本效益', '代碼生成'],
    releaseDate: '2024-06',
  },
];

// 預設模型
export const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-20250514';

// 按提供商分組模型
export function getModelsByProvider(): Map<ModelProvider, ModelDefinition[]> {
  const grouped = new Map<ModelProvider, ModelDefinition[]>();
  
  for (const model of MODELS) {
    const existing = grouped.get(model.provider) || [];
    existing.push(model);
    grouped.set(model.provider, existing);
  }
  
  return grouped;
}

// 獲取提供商顯示名稱
export function getProviderDisplayName(provider: ModelProvider): string {
  const names: Record<ModelProvider, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google',
    xai: 'xAI',
    cohere: 'Cohere',
    mistral: 'Mistral',
  };
  return names[provider];
}

// 根據 ID 獲取模型
export function getModelById(id: string): ModelDefinition | undefined {
  return MODELS.find(m => m.id === id);
}

// 根據類別獲取模型
export function getModelsByCategory(category: ModelCategory): ModelDefinition[] {
  return MODELS.filter(m => m.category === category);
}
