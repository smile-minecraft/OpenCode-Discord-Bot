/**
 * Test Setup - 測試環境初始化
 * @description 提供測試所需的 mock 對象和輔助函數
 */

import { vi, beforeEach, afterEach } from 'vitest';

// ============== Mock Discord.js 互動 ==============

/**
 * 創建 Mock ButtonInteraction
 */
export function createMockButtonInteraction(customId: string): {
  customId: string;
  reply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  deferReply: ReturnType<typeof vi.fn>;
  deferred: boolean;
  isReplied: boolean;
} {
  const interaction = {
    customId,
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    deferred: false,
    isReplied: false,
  };
  return interaction;
}

/**
 * 創建 Mock Guild
 */
export function createMockGuild(id: string = '123456789'): {
  id: string;
  name: string;
} {
  return {
    id,
    name: 'Test Guild',
  };
}

/**
 * 創建 Mock User
 */
export function createMockUser(id: string = '987654321'): {
  id: string;
  username: string;
  displayName: string;
  avatarURL: ReturnType<typeof vi.fn>;
} {
  return {
    id,
    username: 'testuser',
    displayName: 'Test User',
    avatarURL: vi.fn().mockReturnValue('https://example.com/avatar.png'),
  };
}

/**
 * 創建 Mock Channel
 */
export function createMockChannel(id: string = '111222333'): {
  id: string;
  send: ReturnType<typeof vi.fn>;
} {
  return {
    id,
    send: vi.fn().mockResolvedValue({}),
  };
}

// ============== Mock 文件系統 ==============

/**
 * 模擬文件系統模組
 */
export const mockFs = {
  existsSync: vi.fn((path: string) => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  copyFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ mtime: { getTime: () => Date.now() } })),
};

// ============== 全域鉤子 ==============

// 保存原始的 console 方法
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;

beforeEach(() => {
  // 重置所有 mock
  vi.clearAllMocks();
  
  // 重置計時器
  vi.useRealTimers();

  // 抑制所有 console 輸出，使測試輸出更乾淨
  // 這樣錯誤處理測試中的 expected 錯誤日誌不會顯示在終端
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.resetAllMocks();
  
  // 恢復原始的 console 方法
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
  console.log = originalConsoleLog;
});

// ============== 輔助斷言 ==============

/**
 * 斷言函數是否被調用
 */
export function expectCalled(fn: ReturnType<typeof vi.fn>, times: number = 1): void {
  expect(fn).toHaveBeenCalledTimes(times);
}

/**
 * 斷言函數是否被調用且帶有特定參數
 */
export function expectCalledWith(fn: ReturnType<typeof vi.fn>, ...args: unknown[]): void {
  expect(fn).toHaveBeenCalledWith(...args);
}

/**
 * 創建延遲解決的 Promise
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
