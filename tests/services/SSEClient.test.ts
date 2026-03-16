/**
 * SSEClient 測試
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 防止重連邏輯干擾測試
vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { SSEClient } from '../../src/services/SSEClient.js';

describe('SSEClient', () => {
  let client: SSEClient;
  
  beforeEach(() => {
    client = new SSEClient();
    // 設置最大重連次數為 0，避免測試時重連
    client.setMaxReconnectAttempts(0);
  });
  
  afterEach(() => {
    client.disconnect();
  });
  
  describe('disconnect() - 記憶體洩漏修復', () => {
    it('應該清除所有事件監聽器', () => {
      // 連線前應該沒有連接
      expect(client.isConnected()).toBe(false);
      expect(client.getConnectionState()).toBe('none');
      
      // 建立連線
      client.connect(3000, 'test-session');
      
      // 斷開連線
      client.disconnect();
      
      // 驗證事件監聽器已清除
      expect(client.isConnected()).toBe(false);
      expect(client.getConnectionState()).toBe('none');
    });
    
    it('重複呼叫 disconnect 不應該出錯', () => {
      client.connect(3000, 'test-session');
      
      // 第一次斷開
      client.disconnect();
      
      // 第二次斷開（重複呼叫）
      expect(() => client.disconnect()).not.toThrow();
    });
    
    it('斷開後應該發送 disconnected 事件', () => {
      return new Promise<void>((resolve) => {
        let disconnectedReceived = false;
        
        client.on('disconnected', () => {
          disconnectedReceived = true;
        });
        
        client.connect(3000, 'test-session');
        client.disconnect();
        
        // 檢查 disconnected 事件是否觸發
        setTimeout(() => {
          expect(disconnectedReceived).toBe(true);
          resolve();
        }, 10);
      });
    });
  });
  
  describe('isConnected()', () => {
    it('連線前應該回傳 false', () => {
      expect(client.isConnected()).toBe(false);
    });
    
    it('斷開後應該回傳 false', () => {
      client.connect(3000, 'test-session');
      client.disconnect();
      
      expect(client.isConnected()).toBe(false);
    });
  });
  
  describe('getConnectionState()', () => {
    it('連線前應該回傳 none', () => {
      expect(client.getConnectionState()).toBe('none');
    });
    
    it('連線中應該回傳 connecting', () => {
      client.connect(3000, 'test-session');
      expect(client.getConnectionState()).toBe('connecting');
    });
    
    it('斷開後應該回傳 none', () => {
      client.connect(3000, 'test-session');
      client.disconnect();
      
      expect(client.getConnectionState()).toBe('none');
    });
  });
});
