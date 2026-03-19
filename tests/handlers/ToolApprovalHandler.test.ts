/**
 * ToolApprovalHandler Tests - 工具審批處理器單元測試
 * @description 測試工具審批按鈕的解析和處理功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ButtonInteraction, EmbedBuilder, Colors } from 'discord.js';
import { ToolApprovalHandler, createToolApprovalHandler } from '../../src/handlers/ToolApprovalHandler';
import { ToolApprovalService } from '../../src/services/ToolApprovalService';

// ============== Mock 創建輔助函數 ==============

function createMockButtonInteraction(customId: string): ButtonInteraction {
  return {
    customId,
    user: {
      id: 'user123',
      username: 'testuser',
    },
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction;
}

// ============== Mock ToolApprovalService ==============

const mockToolApprovalService = {
  handleApprovalButton: vi.fn().mockResolvedValue(undefined),
  getInstance: vi.fn().mockReturnValue({}),
} as unknown as typeof ToolApprovalService.getInstance;

// ============== 測試 suite ==============

describe('ToolApprovalHandler', () => {
  let handler: ToolApprovalHandler;

  beforeEach(() => {
    handler = new ToolApprovalHandler();
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('應該正確創建實例', () => {
      expect(handler).toBeDefined();
    });

    it('應該正確創建帶有自定義 ToolApprovalService 的實例', () => {
      const customService = ToolApprovalService.getInstance();
      const h = new ToolApprovalHandler(customService);
      expect(h).toBeDefined();
    });
  });

  describe('getHandlerConfigs()', () => {
    it('應該返回按鈕處理器配置', () => {
      const configs = handler.getHandlerConfigs();
      
      expect(configs).toBeDefined();
      expect(Array.isArray(configs)).toBe(true);
      expect(configs.length).toBeGreaterThan(0);
      
      const config = configs[0];
      expect(config.customId).toBe('approval:');
      expect(config.callback).toBeDefined();
      expect(config.description).toBeDefined();
    });
  });

  describe('parseApprovalButtonId()', () => {
    it('應該正確解析批準按鈕 ID', () => {
      const result = handler.parseApprovalButtonId('approval:session123:allow');
      
      expect(result.isValid).toBe(true);
      expect(result.approvalId).toBe('session123');
      expect(result.action).toBe('allow');
    });

    it('應該正確解析總是允許按鈕 ID', () => {
      const result = handler.parseApprovalButtonId('approval:session456:always_allow');
      
      expect(result.isValid).toBe(true);
      expect(result.approvalId).toBe('session456');
      expect(result.action).toBe('always_allow');
    });

    it('應該正確解析拒絕按鈕 ID', () => {
      const result = handler.parseApprovalButtonId('approval:session789:deny');
      
      expect(result.isValid).toBe(true);
      expect(result.approvalId).toBe('session789');
      expect(result.action).toBe('deny');
    });

    it('應該正確處理無效的操作', () => {
      const result = handler.parseApprovalButtonId('approval:session999:invalid');
      
      expect(result.isValid).toBe(false);
      expect(result.action).toBe('deny'); // 默認拒絕
    });

    it('應該正確處理格式錯誤的 ID', () => {
      const result = handler.parseApprovalButtonId('invalid:id');
      
      expect(result.isValid).toBe(false);
    });

    it('應該正確處理缺少部分的 ID', () => {
      const result = handler.parseApprovalButtonId('approval:');
      
      expect(result.isValid).toBe(false);
    });
  });

  describe('getPendingCount()', () => {
    it('應該返回 0 當沒有待處理的審批', () => {
      const count = handler.getPendingCount();
      expect(count).toBe(0);
    });
  });

  describe('createToolApprovalHandler()', () => {
    it('應該正確創建處理器實例', () => {
      const h = createToolApprovalHandler();
      expect(h).toBeDefined();
      expect(h).toBeInstanceOf(ToolApprovalHandler);
    });
  });
});

describe('ToolApprovalHandler 集成', () => {
  describe('按鈕 ID 模式匹配', () => {
    let handler: ToolApprovalHandler;

    beforeEach(() => {
      handler = new ToolApprovalHandler();
    });

    it('應該匹配批准前綴', () => {
      const config = handler.getHandlerConfigs()[0];
      expect(config.customId).toBe('approval:');
    });

    it('應該能處理各種 sessionId 格式', () => {
      // 測試一般 session ID
      let result = handler.parseApprovalButtonId('approval:abc123:allow');
      expect(result.isValid).toBe(true);

      // 測試帶有特殊字符的 session ID
      result = handler.parseApprovalButtonId('approval:session-with-dashes:allow');
      expect(result.isValid).toBe(true);

      // 測試帶有數字的 session ID
      result = handler.parseApprovalButtonId('approval:session1234567890:deny');
      expect(result.isValid).toBe(true);
    });
  });
});
