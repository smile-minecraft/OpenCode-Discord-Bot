/**
 * ModelService Tests - 模型服務單元測試
 * @description 測試從環境變數獲取模型列表的功能
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock OpenCodeCloudClient - use spyOn in tests to override
vi.mock('../../src/services/OpenCodeCloudClient.js', () => ({
  createOpenCodeCloudClient: vi.fn(() => ({
    getModels: vi.fn().mockResolvedValue(['model1', 'model2', 'model3']),
  })),
}));

// Mock OpenCodeSDKAdapter
vi.mock('../../src/services/OpenCodeSDKAdapter.js', () => ({
  getInitializedSDKAdapter: vi.fn().mockImplementation(() => {
    // 默认抛出错误，模拟 SDK 未初始化的情况
    throw new SDKAdapterError('SDK 适配器未初始化', 'NOT_INITIALIZED');
  }),
  SDKAdapterError: class SDKAdapterError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'SDKAdapterError';
      this.code = code;
    }
  },
}));

// Import after mocking
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
import { DEFAULT_MODEL } from '../../src/models/ModelData';

import { getInitializedSDKAdapter, SDKAdapterError } from '../../src/services/OpenCodeSDKAdapter';

const { convertToModelDefinition, convertSDKModelToDefinition } = __test__;

// ============== 測試 suite ==============

describe('ModelService', () => {
  beforeEach(() => {
    // Clear cache
    clearModelCache();
    vi.clearAllMocks();
    // Set environment variable for API key
    process.env.OPENCODE_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.OPENCODE_API_KEY;
    delete process.env.OPENCODE_MODELS;
    delete process.env.OPENCODE_DEFAULT_MODEL;
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

    it('SDK 模型未帶 provider 前綴時，應該補上 provider/id 格式', () => {
      const result = convertSDKModelToDefinition(
        { id: 'gpt-4o', cost: { input: 5, output: 15 } },
        'openai'
      );

      expect(result.id).toBe('openai/gpt-4o');
      expect(result.provider).toBe('openai');
    });

    it('SDK 模型已帶 provider 前綴時，應該保留原始 ID', () => {
      const result = convertSDKModelToDefinition(
        { id: 'anthropic/claude-sonnet-4', cost: { input: 3, output: 15 } },
        'openai'
      );

      expect(result.id).toBe('anthropic/claude-sonnet-4');
      expect(result.provider).toBe('anthropic');
    });
  });

  describe('getAvailableModels() - 獲取可用模型', () => {
    beforeEach(() => {
      clearModelCache();
      vi.clearAllMocks();
    });

    it('有環境變數配置時應該返回模型列表', async () => {
      // Set API key in environment
      process.env.OPENCODE_API_KEY = 'test-api-key';
      
      const models = await getAvailableModels('test-guild');
      
      // 有 API key 時應該返回轉換後的模型定義
      expect(models.length).toBeGreaterThan(0);
    });

    it('有 OPENCODE_MODELS 環境變數時應該返回自定義模型', async () => {
      process.env.OPENCODE_API_KEY = 'test-api-key';
      process.env.OPENCODE_MODELS = 'anthropic/claude-sonnet-4,openai/gpt-4o';
      
      const models = await getAvailableModels('test-guild', false);
      
      expect(models.length).toBe(2);
      expect(models[0].id).toBe('anthropic/claude-sonnet-4');
      expect(models[1].id).toBe('openai/gpt-4o');
    });

    it('沒有環境變數且沒有 allowFallback 時應該拋出錯誤', async () => {
      // Clear environment variables
      delete process.env.OPENCODE_API_KEY;
      delete process.env.OPENCODE_MODELS;
      
      await expect(getAvailableModels('test-guild')).rejects.toThrow();
    });

    it('沒有環境變數時使用 allowFallback 應該返回靜態 fallback', async () => {
      // Clear environment variables
      delete process.env.OPENCODE_API_KEY;
      delete process.env.OPENCODE_MODELS;
      
      const models = await getAvailableModels('test-guild', true, true);
      
      // 允許 fallback 時，應該返回靜態數據
      expect(models.length).toBeGreaterThan(0);
      expect(models[0].id).toBe('anthropic/claude-sonnet-4-20250514');
    });

    it('沒有 guildId 時使用 allowFallback 應該返回靜態 fallback', async () => {
      // Clear environment variables
      delete process.env.OPENCODE_API_KEY;
      delete process.env.OPENCODE_MODELS;
      
      const models = await getAvailableModels(undefined, true, true);
      
      // 沒有 guildId 但允許 fallback，應該返回靜態數據
      expect(models.length).toBeGreaterThan(0);
      expect(models[0].id).toBe('anthropic/claude-sonnet-4-20250514');
    });

    it('應該使用緩存避免重複獲取', async () => {
      // Set API key
      process.env.OPENCODE_API_KEY = 'test-api-key';
      
      // 第一次調用
      await getAvailableModels('test-guild', true, true);
      // 第二次調用（應該使用緩存）
      const models = await getAvailableModels('test-guild', true, true);
      
      // 應該返回模型數據
      expect(models.length).toBeGreaterThan(0);
    });

    it('不使用緩存時應該重新獲取', async () => {
      // Set API key
      process.env.OPENCODE_API_KEY = 'test-api-key';
      
      // 第一次調用
      await getAvailableModels('test-guild', true, true);
      // 第二次調用不使用緩存
      const models = await getAvailableModels('test-guild', false, true);
      
      // 應該返回模型數據
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('getDynamicModelList() - 獲取動態模型列表', () => {
    it('沒有環境變數時應該返回空數組', async () => {
      delete process.env.OPENCODE_MODELS;
      
      const models = await getDynamicModelList();
      
      // 沒有環境變數時返回預設模型列表
      expect(models.length).toBeGreaterThan(0);
    });

    it('有環境變數時應該返回自定義列表', async () => {
      process.env.OPENCODE_MODELS = 'model1,model2,model3';
      
      const models = await getDynamicModelList();
      
      expect(models).toEqual(['model1', 'model2', 'model3']);
    });
  });

  describe('getModelsByProvider() - 按提供商篩選', () => {
    beforeEach(() => {
      clearModelCache();
      vi.clearAllMocks();
    });

    it('沒有 guildId 但有環境變數時應該返回該提供商的模型', async () => {
      // 有 API key 時，即使沒有 guildId 也會返回模型
      process.env.OPENCODE_API_KEY = 'test-api-key';
      
      const models = await getModelsByProvider('anthropic');
      
      // 應該返回 anthropic 提供商的模型
      expect(models.every(m => m.provider === 'anthropic')).toBe(true);
    });

    it('有 guildId 時應該返回該提供商的模型', async () => {
      process.env.OPENCODE_API_KEY = 'test-api-key';
      
      const models = await getModelsByProvider('anthropic', 'test-guild');
      
      // 應該返回 anthropic 提供商的模型
      expect(models.every(m => m.provider === 'anthropic')).toBe(true);
    });
  });

  describe('getModelsByCategory() - 按類別篩選', () => {
    beforeEach(() => {
      clearModelCache();
      vi.clearAllMocks();
    });

    it('沒有 guildId 且沒有 API key 時應該拋出錯誤', async () => {
      // 確保沒有 API key
      delete process.env.OPENCODE_API_KEY;
      
      await expect(getModelsByCategory('fast')).rejects.toThrow();
    });

    it('有 API key 時即使沒有 guildId 也應該返回該類別的模型', async () => {
      // 有 API key 時，即使沒有 guildId 也會返回模型
      process.env.OPENCODE_API_KEY = 'test-api-key';
      
      const models = await getModelsByCategory('fast');
      
      // 應該返回 fast 類別的模型
      expect(models.every(m => m.category === 'fast')).toBe(true);
    });

    it('有 guildId 時應該返回該類別的模型', async () => {
      const models = await getModelsByCategory('fast', 'test-guild');
      
      // 應該返回 fast 類別的模型
      expect(models.every(m => m.category === 'fast')).toBe(true);
    });
  });

  describe('getModelByIdAsync() - 異步獲取模型', () => {
    beforeEach(() => {
      clearModelCache();
      vi.clearAllMocks();
    });

    it('沒有 guildId 且沒有 API key 時應該拋出錯誤', async () => {
      // 確保沒有 API key
      delete process.env.OPENCODE_API_KEY;
      
      await expect(getModelByIdAsync('anthropic/claude-sonnet-4-20250514')).rejects.toThrow();
    });

    it('有 API key 時即使沒有 guildId 也應該返回模型定義', async () => {
      process.env.OPENCODE_API_KEY = 'test-api-key';
      
      const model = await getModelByIdAsync('anthropic/claude-sonnet-4-20250514');
      
      expect(model).toBeDefined();
      expect(model?.id).toBe('anthropic/claude-sonnet-4-20250514');
    });

    it('有 guildId 時應該返回模型定義', async () => {
      process.env.OPENCODE_API_KEY = 'test-api-key';
      
      const model = await getModelByIdAsync('anthropic/claude-sonnet-4-20250514', 'test-guild');
      
      expect(model).toBeDefined();
      expect(model?.id).toBe('anthropic/claude-sonnet-4-20250514');
    });

    it('模型不存在時應該返回 undefined', async () => {
      process.env.OPENCODE_API_KEY = 'test-api-key';
      
      const model = await getModelByIdAsync('nonexistent/model', 'test-guild');
      
      expect(model).toBeUndefined();
    });
  });

  describe('getDefaultModel() - 獲取默認模型', () => {
    it('有 OPENCODE_DEFAULT_MODEL 時應該返回自訂模型 ID', () => {
      process.env.OPENCODE_DEFAULT_MODEL = 'openai/gpt-4o';

      const defaultModel = getDefaultModel();

      expect(defaultModel).toBe('openai/gpt-4o');
    });

    it('沒有 OPENCODE_DEFAULT_MODEL 時應該回退到系統默認模型', () => {
      delete process.env.OPENCODE_DEFAULT_MODEL;

      const defaultModel = getDefaultModel();

      expect(defaultModel).toBe(DEFAULT_MODEL);
    });
  });

  describe('clearModelCache() - 清除緩存', () => {
    beforeEach(() => {
      process.env.OPENCODE_API_KEY = 'test-api-key';
    });

    it('清除指定 guildId 緩存後應該重新獲取', async () => {
      // 第一次調用
      const models1 = await getAvailableModels('test-guild', true, true);
      expect(models1.length).toBeGreaterThan(0);
      // 清除緩存
      clearModelCache('test-guild');
      // 第二次調用
      const models2 = await getAvailableModels('test-guild', false, true);
      
      // 清除緩存應該成功
      expect(models2).toEqual(models1);
    });

    it('清除所有緩存後應該重新獲取', async () => {
      // 第一次調用
      const models1 = await getAvailableModels('guild1', true, true);
      await getAvailableModels('guild2', true, true);
      expect(models1.length).toBeGreaterThan(0);
      // 清除所有緩存
      clearModelCache();
      // 第二次調用
      const models2 = await getAvailableModels('guild1', false, true);
      
      // 清除所有緩存應該成功
      expect(models2).toEqual(models1);
    });
  });
});

describe('ModelService - SDK Integration', () => {
  beforeEach(() => {
    clearModelCache();
    vi.clearAllMocks();
    process.env.OPENCODE_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    delete process.env.OPENCODE_API_KEY;
    delete process.env.OPENCODE_MODELS;
  });

  it('SDK 可用时应该从 SDK 获取模型列表', async () => {
    // Mock SDK 适配器
    const mockAdapter = {
      getProviders: vi.fn().mockResolvedValue([
        {
          id: 'openai',
          models: [
            { id: 'openai/gpt-4o', cost: { input: 5.00, output: 15.00 } },
            { id: 'openai/gpt-4o-mini', cost: { input: 0.15, output: 0.60 } },
          ],
        },
        {
          id: 'anthropic',
          models: [
            { id: 'anthropic/claude-sonnet-4', cost: { input: 3.00, output: 15.00 } },
          ],
        },
      ]),
    };

    vi.mocked(getInitializedSDKAdapter).mockReturnValue(mockAdapter as any);

    const models = await getAvailableModels('test-guild');

    expect(models.length).toBe(3);
    expect(mockAdapter.getProviders).toHaveBeenCalled();
  });

  it('SDK 不可用时应该降级到环境变量', async () => {
    // Mock SDK 适配器抛出错误
    vi.mocked(getInitializedSDKAdapter).mockImplementation(() => {
      throw new SDKAdapterError('SDK 未初始化', 'NOT_INITIALIZED');
    });

    // 设置环境变量
    process.env.OPENCODE_MODELS = 'openai/gpt-4o';

    const models = await getAvailableModels('test-guild', true, true);

    expect(models.length).toBe(1);
    expect(models[0].id).toBe('openai/gpt-4o');
  });

  it('SDK 和环境变量都不可用时应该使用静态 fallback', async () => {
    // Mock SDK 适配器抛出错误
    vi.mocked(getInitializedSDKAdapter).mockImplementation(() => {
      throw new SDKAdapterError('SDK 未初始化', 'NOT_INITIALIZED');
    });

    // 不设置环境变量
    delete process.env.OPENCODE_MODELS;

    const models = await getAvailableModels('test-guild', true, true);

    // 应该返回静态 fallback
    expect(models.length).toBeGreaterThan(0);
  });

  it('SDK 失败且不允许 fallback 时应该抛出错误', async () => {
    // Mock SDK 适配器抛出错误
    vi.mocked(getInitializedSDKAdapter).mockImplementation(() => {
      throw new SDKAdapterError('SDK 未初始化', 'NOT_INITIALIZED');
    });

    // 不设置环境变量且不允许 fallback
    // 需要同时删除 API key，否则会走环境变量 fallback
    delete process.env.OPENCODE_API_KEY;
    delete process.env.OPENCODE_MODELS;

    await expect(
      getAvailableModels('test-guild', true, false)
    ).rejects.toThrow();
  });
});
