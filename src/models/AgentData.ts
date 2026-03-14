/**
 * Agent 定義
 * @description 定義所有可用的 Agent 及其元數據
 */

// Agent 類型
export type AgentType = 'general' | 'coder' | 'reviewer' | 'architect' | 'debugger';

// Agent 定義
export interface AgentDefinition {
  id: string;               // Agent ID
  name: string;            // 顯示名稱
  description: string;     // Agent 描述
  type: AgentType;         // Agent 類型
  capabilities: string[];  // 支援的功能
  defaultModel?: string;   // 預設模型
  features: {
    /** 是否支援工具使用 */
    tools?: boolean;
    /** 是否支援代碼執行 */
    codeExecution?: boolean;
    /** 是否支援檔案操作 */
    fileOperations?: boolean;
    /** 是否支援網路搜尋 */
    webSearch?: boolean;
    /** 是否支援對話歷史 */
    conversationHistory?: boolean;
  };
}

// Agent 列表
export const AGENTS: AgentDefinition[] = [
  {
    id: 'general',
    name: 'General',
    description: '通用的 AI 助手，適合大多數任務',
    type: 'general',
    capabilities: ['問答', '代碼生成', '分析', '寫作'],
    features: {
      tools: true,
      conversationHistory: true,
    },
  },
  {
    id: 'coder',
    name: 'Coder',
    description: '專注於程式開發的 Agent，擅長代碼生成和重構',
    type: 'coder',
    capabilities: ['代碼生成', '代碼重構', '調試', '測試生成', '文件生成'],
    defaultModel: 'anthropic/claude-sonnet-4-20250514',
    features: {
      tools: true,
      codeExecution: true,
      fileOperations: true,
      conversationHistory: true,
    },
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    description: '專門用於代碼審查的 Agent，提供詳細的回饋和建議',
    type: 'reviewer',
    capabilities: ['代碼審查', '安全檢查', '效能分析', '最佳實踐'],
    defaultModel: 'anthropic/claude-opus-4-20250514',
    features: {
      tools: true,
      fileOperations: true,
    },
  },
  {
    id: 'architect',
    name: 'Architect',
    description: '系統架構顧問，幫助設計和規劃專案結構',
    type: 'architect',
    capabilities: ['架構設計', '技術選型', '系統規劃', '最佳實踐'],
    defaultModel: 'anthropic/claude-opus-4-20250514',
    features: {
      tools: true,
      webSearch: true,
      conversationHistory: true,
    },
  },
  {
    id: 'debugger',
    name: 'Debugger',
    description: '專門用於調試和錯誤排除的 Agent',
    type: 'debugger',
    capabilities: ['錯誤診斷', '問題定位', '修復建議', '調試技巧'],
    defaultModel: 'anthropic/claude-sonnet-4-20250514',
    features: {
      tools: true,
      codeExecution: true,
      fileOperations: true,
      conversationHistory: true,
    },
  },
];

// 預設 Agent
export const DEFAULT_AGENT = 'general';

// 根據類型獲取 Agent
export function getAgentById(id: string): AgentDefinition | undefined {
  return AGENTS.find(a => a.id === id);
}

// 根據類型獲取 Agents
export function getAgentsByType(type: AgentType): AgentDefinition[] {
  return AGENTS.filter(a => a.type === type);
}

// 獲取 Agent 類型顯示名稱
export function getAgentTypeDisplayName(type: AgentType): string {
  const names: Record<AgentType, string> = {
    general: '通用',
    coder: '開發',
    reviewer: '審查',
    architect: '架構',
    debugger: '調試',
  };
  return names[type];
}
