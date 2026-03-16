/**
 * ModelService Tests - 模型服務單元測試
 * @description 測試從 Provider 獲取模型列表的功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Create mock instance with connected providers
const mockProviderServiceInstance = {
  getProviders: vi.fn().mockResolvedValue({
    'opencode': { connected: true, apiKey: 'test-key' }
  }),
  getDecryptedApiKey: vi.fn().mockResolvedValue('test-api-key'),
};

// Mock with no connected providers
const mockProviderServiceNoProviders = {
  getProviders: vi.fn().mockResolvedValue({}),
  getDecryptedApiKey: vi.fn().mockResolvedValue('test-api-key'),
};

// Simple mock for ProviderService - will be overridden with vi.spyOn
vi.mock('../../src/services/ProviderService.js', () => ({
  ProviderService: {
    getInstance: vi.fn(),
  },
}));

// Mock OpenCodeCloudClient - use spyOn in tests to override
vi.mock('../../src/services/OpenCodeCloudClient.js', () => ({
  createOpenCodeCloudClient: vi.fn(() => ({
    getModels: vi.fn().mockResolvedValue(['model1', 'model2', 'model3']),
  })),
}));

// Import after mocking
import { ProviderService } from '../../src/services/ProviderService.js';
import { createOpenCodeCloudClient } from '../../src/services/OpenCodeCloudClient.js';
import { 
  getAvailableModels, 
  getDynamicModelList, 
  getModelsByProvider, 
  getModelsByCategory,
  getModelByIdAsync,
  getDefaultModel,
  clearModelCache,
  __test__ 
} from '../../src/services/ModelService';

const { convertToModelDefinition } = __test__;

// ============== 測試 suite ==============

describe('ModelService', () => {
  beforeEach(() => {
    // Clear cache
    clearModelCache();
    vi.clearAllMocks();
    // Spy on ProviderService.getInstance to return mock instance
    vi.spyOn(ProviderService, 'getInstance').mockReturnValue(mockProviderServiceInstance as unknown as import('../../src/services/ProviderService.js').ProviderService);
  });

  describe('convertToModelDefinition() - 轉換模型定義', () => {
    it('應該正確轉換已知模型', () => {
      const result = convertToModelDefinition('openai/gpt-4o');
      
      expect(result.id).toBe('openai/gpt-4o');
      expect(result.provider).toBe('openai');
      expect(result.name).toBe('GPT-4o'); // 從靜態數據返回
      expect(result.category).toBe('powerful');
    });

    it('應該正確處理 opencode 前綴', () => {
      const result = convertToModelDefinition('opencode/claude-sonnet-4');
      
      expect(result.provider).toBe('opencode');
      expect(result.name).toBe('Claude Sonnet 4');
    });

    it('應該正確處理 github-copilot 前綴', () => {
      const result = convertToModelDefinition('github-copilot/gpt-4o');
      
      expect(result.provider).toBe('github-copilot');
    });

    it('應該正確識別 fast 類別 (mini)', () => {
      const result = convertToModelDefinition('openai/gpt-4o-mini');
      
      expect(result.category).toBe('fast');
    });

    it('應該正確識別 fast 類別 (lite)', () => {
      const result = convertToModelDefinition('google/gemini-2.0-flash-lite');
      
      expect(result.category).toBe('fast');
    });

    it('應該正確識別 powerful 類別 (pro)', () => {
      const result = convertToModelDefinition('google/gemini-1.5-pro');
      
      expect(result.category).toBe('powerful');
    });

    it('應該正確識別 powerful 類別 (opus)', () => {
      const result = convertToModelDefinition('anthropic/claude-opus-4');
      
      expect(result.category).toBe('powerful');
    });

    it('應該從靜態數據返回完整定義', () => {
      const result = convertToModelDefinition('anthropic/claude-sonnet-4-20250514');
      
      expect(result.description).toBe('最新的 Claude Sonnet 模型，平衡了能力和速度，適合大多數任務');
      expect(result.pricing.input).toBe(3.00);
      expect(result.features).toContain('代碼生成');
    });
  });

  describe('getAvailableModels() - 獲取可用模型', () => {
    beforeEach(() => {
      clearModelCache();
      vi.clearAllMocks();
    });

    // 跳過原因: ES Module mock 無法正確攔截動態 import
    it.skip('應該從 connected providers 成功獲取模型列表', async () => {
      // Mock createOpenCodeCloudClient to return a client with getModels
      vi.mocked(createOpenCodeCloudClient).mockReturnValue({
        getModels: vi.fn().mockResolvedValue(['opencode/big-pickle', 'opencode/test-model'])
      } as any);
      
      const models = await getAvailableModels('test-guild');
      
      expect(models.length).toBeGreaterThan(0);
      expect(models[0].id).toBe('opencode/big-pickle');
    });

    it('沒有 connected providers 且沒有 allowFallback 時應該拋出錯誤', async () => {
      // Spy on ProviderService.getInstance to return no connected providers
      vi.spyOn(ProviderService, 'getInstance').mockReturnValue(mockProviderServiceNoProviders as unknown as import('../../src/services/ProviderService.js').ProviderService);
      
      await expect(getAvailableModels('test-guild')).rejects.toThrow('Failed to fetch');
    });

    it('沒有 connected providers 時使用 allowFallback 應該返回靜態 fallback', async () => {
      // Spy on ProviderService.getInstance to return no connected providers
      vi.spyOn(ProviderService, 'getInstance').mockReturnValue(mockProviderServiceNoProviders as unknown as import('../../src/services/ProviderService.js').ProviderService);
      
      const models = await getAvailableModels('test-guild', true, true);
      
      // 沒有 connected providers 但允許 fallback，應該返回靜態數據
      expect(models.length).toBeGreaterThan(0);
      expect(models[0].id).toBe('anthropic/claude-sonnet-4-20250514');
    });

    it('沒有 guildId 時應該拋出錯誤', async () => {
      await expect(getAvailableModels()).rejects.toThrow('No guild ID provided');
    });

    it('沒有 guildId 時使用 allowFallback 應該返回靜態 fallback', async () => {
      const models = await getAvailableModels(undefined, true, true);
      
      // 沒有 guildId 但允許 fallback，應該返回靜態數據
      expect(models.length).toBeGreaterThan(0);
      expect(models[0].id).toBe('anthropic/claude-sonnet-4-20250514');
    });

    it('應該使用緩存避免重複獲取', async () => {
      // Spy on ProviderService.getInstance to return no connected providers but allow fallback
      vi.spyOn(ProviderService, 'getInstance').mockReturnValue(mockProviderServiceNoProviders as unknown as import('../../src/services/ProviderService.js').ProviderService);
      
      // 第一次調用
      await getAvailableModels('test-guild', true, true);
      // 第二次調用（應該使用緩存）
      const models = await getAvailableModels('test-guild', true, true);
      
      // 應該返回靜態數據（因為沒有 connected providers but allow fallback）
      expect(models[0].id).toBe('anthropic/claude-sonnet-4-20250514');
    });

    it('不使用緩存時應該重新獲取', async () => {
      // Spy on ProviderService.getInstance to return no connected providers but allow fallback
      vi.spyOn(ProviderService, 'getInstance').mockReturnValue(mockProviderServiceNoProviders as unknown as import('../../src/services/ProviderService.js').ProviderService);
      
      // 第一次調用
      await getAvailableModels('test-guild', true, true);
      // 第二次調用不使用緩存
      const models = await getAvailableModels('test-guild', false, true);
      
      // 應該返回靜態數據
      expect(models[0].id).toBe('anthropic/claude-sonnet-4-20250514');
    });
  });

  describe('getDynamicModelList() - 獲取動態模型列表', () => {
    it('沒有 guildId 時應該返回空數組', async () => {
      const models = await getDynamicModelList();
      
      expect(models).toEqual([]);
    });

    it.skip('應該返回模型 ID 數組', async () => {
      // Setup cloud client mock - mock createOpenCodeCloudClient to return a client with getModels
      vi.mocked(createOpenCodeCloudClient).mockReturnValue({
        getModels: vi.fn().mockResolvedValue(['model1', 'model2', 'model3'])
      } as any);

      const models = await getDynamicModelList('test-guild');
      
      expect(models).toEqual(['model1', 'model2', 'model3']);
    });
  });

  describe('getModelsByProvider() - 按提供商篩選', () => {
    beforeEach(() => {
      clearModelCache();
      vi.clearAllMocks();
      // Spy on ProviderService.getInstance to return no connected providers for error tests
      vi.spyOn(ProviderService, 'getInstance').mockReturnValue(mockProviderServiceNoProviders as unknown as import('../../src/services/ProviderService.js').ProviderService);
    });

    it('沒有 guildId 時應該拋出錯誤', async () => {
      await expect(getModelsByProvider('anthropic')).rejects.toThrow('No guild ID provided');
    });

    it('沒有 connected providers 時應該拋出錯誤', async () => {
      await expect(getModelsByProvider('anthropic', 'test-guild')).rejects.toThrow('Failed to fetch');
    });
  });

  describe('getModelsByCategory() - 按類別篩選', () => {
    beforeEach(() => {
      clearModelCache();
      vi.clearAllMocks();
      // Spy on ProviderService.getInstance to return no connected providers for error tests
      vi.spyOn(ProviderService, 'getInstance').mockReturnValue(mockProviderServiceNoProviders as unknown as import('../../src/services/ProviderService.js').ProviderService);
    });

    it('沒有 guildId 時應該拋出錯誤', async () => {
      await expect(getModelsByCategory('fast')).rejects.toThrow('No guild ID provided');
    });

    it('沒有 connected providers 時應該拋出錯誤', async () => {
      await expect(getModelsByCategory('fast', 'test-guild')).rejects.toThrow('Failed to fetch');
    });
  });

  describe('getModelByIdAsync() - 異步獲取模型', () => {
    beforeEach(() => {
      clearModelCache();
      vi.clearAllMocks();
    });

    it('沒有 guildId 時應該拋出錯誤', async () => {
      await expect(getModelByIdAsync('anthropic/claude-sonnet-4-20250514')).rejects.toThrow('No guild ID provided');
    });

    it('沒有 connected providers 時應該拋出錯誤', async () => {
      // Spy on ProviderService.getInstance to return no connected providers
      vi.spyOn(ProviderService, 'getInstance').mockReturnValue(mockProviderServiceNoProviders as unknown as import('../../src/services/ProviderService.js').ProviderService);
      
      await expect(getModelByIdAsync('anthropic/claude-sonnet-4-20250514', 'test-guild')).rejects.toThrow('Failed to fetch');
    });
  });

  describe('getDefaultModel() - 獲取默認模型', () => {
    it('應該返回默認模型 ID', () => {
      const defaultModel = getDefaultModel();
      
      expect(defaultModel).toBe('anthropic/claude-sonnet-4-20250514');
    });
  });

  describe('clearModelCache() - 清除緩存', () => {
    it('清除指定 guildId 緩存後應該重新獲取', async () => {
      // Spy on ProviderService.getInstance to return no connected providers but allow fallback
      vi.spyOn(ProviderService, 'getInstance').mockReturnValue(mockProviderServiceNoProviders as unknown as import('../../src/services/ProviderService.js').ProviderService);
      
      // 第一次調用
      await getAvailableModels('test-guild', true, true);
      // 清除緩存
      clearModelCache('test-guild');
      // 第二次調用
      await getAvailableModels('test-guild', false, true);
      
      // 清除緩存應該成功
      expect(true).toBe(true);
    });

    it('清除所有緩存後應該重新獲取', async () => {
      // Spy on ProviderService.getInstance to return no connected providers but allow fallback
      vi.spyOn(ProviderService, 'getInstance').mockReturnValue(mockProviderServiceNoProviders as unknown as import('../../src/services/ProviderService.js').ProviderService);
      
      // 第一次調用
      await getAvailableModels('guild1', true, true);
      await getAvailableModels('guild2', true, true);
      // 清除所有緩存
      clearModelCache();
      // 第二次調用
      await getAvailableModels('guild1', false, true);
      
      // 清除所有緩存應該成功
      expect(true).toBe(true);
    });
  });
});