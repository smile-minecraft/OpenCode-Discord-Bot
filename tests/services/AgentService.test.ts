/**
 * AgentService Tests - Agent 服務單元測試
 * @description 測試 AgentService 的主代理過濾功能
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock OpenCode SDK Adapter
vi.mock('../../src/services/OpenCodeSDKAdapter.js', () => ({
  getInitializedSDKAdapter: vi.fn(() => ({
    getAgents: vi.fn().mockResolvedValue([]),
  })),
  SDKAdapterError: class SDKAdapterError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
      this.name = 'SDKAdapterError';
    }
  },
}));

// Import after mocking
import {
  isPrimaryAgent,
  filterPrimaryAgents,
  type RuntimeAgentDefinition,
} from '../../src/services/AgentService';

describe('AgentService - 主代理過濾', () => {
  const createAgent = (overrides: Partial<RuntimeAgentDefinition> = {}): RuntimeAgentDefinition => ({
    id: 'test-agent',
    name: 'Test Agent',
    description: 'A test agent',
    source: 'sdk',
    ...overrides,
  });

  describe('isPrimaryAgent()', () => {
    // ========== SDK mode 優先測試 ==========
    describe('SDK mode 優先判定', () => {
      it('mode=primary 應該是主代理（忽略 id 白名單）', () => {
        const agent = createAgent({ id: 'implementer', mode: 'primary' });
        expect(isPrimaryAgent(agent)).toBe(true);
      });

      it('mode=primary（大寫）應該是主代理', () => {
        const agent = createAgent({ id: 'custom-agent', mode: 'PRIMARY' });
        expect(isPrimaryAgent(agent)).toBe(true);
      });

      it('mode=subagent 不應是主代理（即使 id 在白名單也要以 mode 為準）', () => {
        const agent = createAgent({ id: 'arch', mode: 'subagent' });
        expect(isPrimaryAgent(agent)).toBe(false);
      });

      it('mode=all 不應是主代理', () => {
        const agent = createAgent({ id: 'general', mode: 'all' });
        expect(isPrimaryAgent(agent)).toBe(false);
      });

      it('mode=其他值不應是主代理', () => {
        const agent = createAgent({ id: 'custom-agent', mode: 'custom' });
        expect(isPrimaryAgent(agent)).toBe(false);
      });

      it('mode 缺失時應 fallback 到 id 白名單', () => {
        const agent = createAgent({ id: 'arch' });
        expect(isPrimaryAgent(agent)).toBe(true);
      });

      it('mode 缺失時應 fallback 到「主代理」關鍵字', () => {
        const agent = createAgent({ id: 'custom-agent', description: '這是自訂主代理' });
        expect(isPrimaryAgent(agent)).toBe(true);
      });

      it('mode=primary 時不應再檢查 id 白名單或關鍵字', () => {
        // 即使 id 不在白名單且沒有「主代理」關鍵字，mode=primary 就够了
        const agent = createAgent({
          id: 'totally-random-id',
          name: 'Random Agent',
          description: 'Random description',
          mode: 'primary',
        });
        expect(isPrimaryAgent(agent)).toBe(true);
      });
    });

    it('id 為 arch 應該是主代理', () => {
      const agent = createAgent({ id: 'arch' });
      expect(isPrimaryAgent(agent)).toBe(true);
    });

    it('id 為 build 應該是主代理', () => {
      const agent = createAgent({ id: 'build' });
      expect(isPrimaryAgent(agent)).toBe(true);
    });

    it('id 為 review 應該是主代理', () => {
      const agent = createAgent({ id: 'review' });
      expect(isPrimaryAgent(agent)).toBe(true);
    });

    it('id 為 ultra 應該是主代理', () => {
      const agent = createAgent({ id: 'ultra' });
      expect(isPrimaryAgent(agent)).toBe(true);
    });

    it('id 為 general 應該是主代理', () => {
      const agent = createAgent({ id: 'general' });
      expect(isPrimaryAgent(agent)).toBe(true);
    });

    it('id 大寫 ARCH 應該是主代理（大小寫不敏感）', () => {
      const agent = createAgent({ id: 'ARCH' });
      expect(isPrimaryAgent(agent)).toBe(true);
    });

    it('id 為 implementer 應該不是主代理', () => {
      const agent = createAgent({ id: 'implementer' });
      expect(isPrimaryAgent(agent)).toBe(false);
    });

    it('id 為 ask 應該不是主代理', () => {
      const agent = createAgent({ id: 'ask' });
      expect(isPrimaryAgent(agent)).toBe(false);
    });

    it('id 為 brainstorm 應該不是主代理', () => {
      const agent = createAgent({ id: 'brainstorm' });
      expect(isPrimaryAgent(agent)).toBe(false);
    });

    it('id 為 elite-coder 應該不是主代理', () => {
      const agent = createAgent({ id: 'elite-coder' });
      expect(isPrimaryAgent(agent)).toBe(false);
    });

    it('id 為 explorer 應該不是主代理', () => {
      const agent = createAgent({ id: 'explorer' });
      expect(isPrimaryAgent(agent)).toBe(false);
    });

    it('id 為 debugger 應該不是主代理', () => {
      const agent = createAgent({ id: 'debugger' });
      expect(isPrimaryAgent(agent)).toBe(false);
    });

    it('description 含「主代理」應該是主代理', () => {
      const agent = createAgent({ id: 'custom-agent', description: '這是自訂主代理' });
      expect(isPrimaryAgent(agent)).toBe(true);
    });

    it('name 含「主代理」應該是主代理', () => {
      const agent = createAgent({ id: 'custom-agent', name: '主代理-測試' });
      expect(isPrimaryAgent(agent)).toBe(true);
    });

    it('description 含 "primary"（非「主代理」）不應是主代理', () => {
      const agent = createAgent({ id: 'custom-agent', description: 'This is a primary agent' });
      expect(isPrimaryAgent(agent)).toBe(false); // "primary" 不等於「主代理」關鍵字
    });

    it('name 含 "primary"（非「主代理」）不應是主代理', () => {
      const agent = createAgent({ id: 'custom-agent', name: 'Primary Test Agent' });
      expect(isPrimaryAgent(agent)).toBe(false); // "Primary" 不等於「主代理」關鍵字
    });

    it('description 大小寫不敏感含 "Primary" 應該是主代理', () => {
      const agent = createAgent({ id: 'custom-agent', description: 'PRIMARY Agent' });
      expect(isPrimaryAgent(agent)).toBe(false); // 移除 "primary" 寬鬆匹配
    });

    // ========== 防誤判測試 ==========
    it('description 含 "primary color" 不應是主代理', () => {
      const agent = createAgent({ id: 'designer', description: 'This tool handles primary color selection' });
      expect(isPrimaryAgent(agent)).toBe(false);
    });

    it('description 含 "my primary objective" 不應是主代理', () => {
      const agent = createAgent({ id: 'task-manager', description: 'My primary objective is task management' });
      expect(isPrimaryAgent(agent)).toBe(false);
    });

    it('name 含 "primary" 作為形容詞不應是主代理', () => {
      const agent = createAgent({ id: 'assistant', name: 'Primary Assistant' });
      expect(isPrimaryAgent(agent)).toBe(false);
    });

    it('description 含 "primary" 作為普通形容詞不應是主代理', () => {
      const agent = createAgent({ id: 'helper', description: 'This is a primary helper for the system' });
      expect(isPrimaryAgent(agent)).toBe(false);
    });

    it('description 含 "primary" 但非「主代理」關鍵字不應是主代理', () => {
      const agent = createAgent({ id: 'core', description: 'Primary core functionality' });
      expect(isPrimaryAgent(agent)).toBe(false);
    });
  });

  describe('filterPrimaryAgents()', () => {
    it('應該過濾出所有主代理', () => {
      const agents = [
        createAgent({ id: 'arch' }),
        createAgent({ id: 'implementer' }),
        createAgent({ id: 'build' }),
        createAgent({ id: 'ask' }),
        createAgent({ id: 'general' }),
        createAgent({ id: 'brainstorm' }),
      ];

      const result = filterPrimaryAgents(agents);

      expect(result.length).toBe(3);
      expect(result.map(a => a.id)).toEqual(['arch', 'build', 'general']);
    });

    it('應該過濾出含「主代理」的項目', () => {
      const agents = [
        createAgent({ id: 'custom-1', name: '主代理-測試' }),
        createAgent({ id: 'custom-2', description: '這是另一個主代理' }),
        createAgent({ id: 'sub-agent-1' }),
      ];

      const result = filterPrimaryAgents(agents);

      expect(result.length).toBe(2);
      expect(result.map(a => a.id)).toEqual(['custom-1', 'custom-2']);
    });

    // ========== filterPrimaryAgents 防誤判測試 ==========
    it('含 "primary" 作為普通形容詞不應被過濾出', () => {
      const agents = [
        createAgent({ id: 'primary-color', description: 'Handles primary color selection' }),
        createAgent({ id: 'helper', name: 'Primary Helper' }),
        createAgent({ id: 'sub-agent' }),
      ];

      const result = filterPrimaryAgents(agents);

      // 只有 sub-agent 會因為有 general 而 fallback，但 primary-color 和 Primary Helper 都會被過濾掉
      expect(result.some(a => a.id === 'primary-color')).toBe(false);
      expect(result.some(a => a.id === 'helper')).toBe(false);
    });

    it('若過濾後為空且有 general，回傳 general', () => {
      const agents = [
        createAgent({ id: 'implementer' }),
        createAgent({ id: 'ask' }),
        createAgent({ id: 'general' }),
      ];

      const result = filterPrimaryAgents(agents);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('general');
    });

    it('若過濾後為空且無 general，回傳空陣列', () => {
      const agents = [
        createAgent({ id: 'implementer' }),
        createAgent({ id: 'ask' }),
        createAgent({ id: 'sub-agent' }),
      ];

      const result = filterPrimaryAgents(agents);

      expect(result.length).toBe(0);
    });

    it('若輸入空陣列，回傳空陣列', () => {
      const result = filterPrimaryAgents([]);
      expect(result.length).toBe(0);
    });

    it('應該保留所有主代理的完整資訊', () => {
      const agents = [
        createAgent({
          id: 'arch',
          name: 'Architect Agent',
          description: 'Planning and coordination',
          mode: 'primary', // mode='primary' 使其成為主代理
          defaultModel: 'claude-3-5-sonnet',
        }),
        createAgent({ id: 'implementer' }),
      ];

      const result = filterPrimaryAgents(agents);

      expect(result.length).toBe(1);
      expect(result[0]).toEqual({
        id: 'arch',
        name: 'Architect Agent',
        description: 'Planning and coordination',
        source: 'sdk',
        mode: 'primary',
        defaultModel: 'claude-3-5-sonnet',
      });
    });

    it('混合主代理和自訂主代理應該全部返回', () => {
      const agents = [
        createAgent({ id: 'arch' }),
        createAgent({ id: 'build' }),
        createAgent({ id: 'custom-primary', description: 'Custom Primary Agent' }), // "primary" 不再通過
        createAgent({ id: 'custom-agent', description: '這是一個主代理工具' }), // 含「主代理」才通過
        createAgent({ id: 'sub-agent' }),
      ];

      const result = filterPrimaryAgents(agents);

      expect(result.length).toBe(3);
      expect(result.map(a => a.id)).toEqual(['arch', 'build', 'custom-agent']);
    });
  });
});
