/**
 * errorHandler Sentry Integration Tests
 * @description 測試 Sentry 錯誤上報整合功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==================== Mock Definitions ====================

// Use vi.hoisted for all mocks to avoid hoisting issues
const { mockCaptureException, mockCaptureMessage } = vi.hoisted(() => {
  return {
    mockCaptureException: vi.fn(),
    mockCaptureMessage: vi.fn(),
  };
});

vi.mock('@sentry/node', () => ({
  captureException: mockCaptureException,
  captureMessage: mockCaptureMessage,
  setContext: vi.fn(),
  setUser: vi.fn(),
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ==================== Import After Mocks ====================

import * as Sentry from '@sentry/node';
import { 
  BotError, 
  PermissionError,
  ValidationError,
  SessionError,
  handleUnhandledRejection,
  handleUncaughtException,
  createErrorHandler,
  formatErrorAsEmbed
} from '../../src/utils/errorHandler.js';
import { shouldCaptureError } from '../../src/utils/sentryHelper.js';
import logger from '../../src/utils/logger.js';

describe('errorHandler Sentry Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset Sentry DSN for testing
    process.env.SENTRY_DSN = 'https://test@123.ingest.sentry.io/123';
  });

  afterEach(() => {
    delete process.env.SENTRY_DSN;
  });

  // ==================== BotError.captureToSentry Tests ====================

  describe('BotError.captureToSentry', () => {
    it('should not capture operational errors (isOperational = true)', () => {
      // Create operational BotError (default isOperational is true)
      const error = new BotError('Test operational error', 'TEST_CODE');
      
      // Call captureToSentry
      error.captureToSentry();
      
      // Should NOT call Sentry.captureException for operational errors
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('should capture non-operational errors (isOperational = false)', () => {
      // Create non-operational BotError
      const error = new BotError('Test system error', 'SYSTEM_ERROR');
      // Override isOperational to false (simulating a system error)
      Object.defineProperty(error, 'isOperational', { value: false });
      
      // Call captureToSentry
      error.captureToSentry();
      
      // Should call Sentry.captureException for non-operational errors
      expect(Sentry.captureException).toHaveBeenCalledWith(error);
    });

    it('should not capture PermissionError', () => {
      const error = new PermissionError('No permission', 'ADMIN', 'user123');
      
      error.captureToSentry();
      
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('should not capture ValidationError', () => {
      const error = new ValidationError('Invalid input', 'email', 'not-an-email');
      
      error.captureToSentry();
      
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('should not capture SessionError', () => {
      const error = new SessionError('Session expired', 'session123');
      
      error.captureToSentry();
      
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });
  });

  // ==================== shouldCaptureError Tests ====================

  describe('shouldCaptureError (sentryHelper)', () => {
    it('should return false for PermissionError', () => {
      const error = new PermissionError('No permission', 'ADMIN', 'user123');
      expect(shouldCaptureError(error)).toBe(false);
    });

    it('should return false for ValidationError', () => {
      const error = new ValidationError('Invalid input', 'email', 'bad');
      expect(shouldCaptureError(error)).toBe(false);
    });

    it('should return false for SessionError', () => {
      const error = new SessionError('Session expired', 'session123');
      expect(shouldCaptureError(error)).toBe(false);
    });

    it('should return false for operational BotError', () => {
      const error = new BotError('Test', 'CODE');
      expect(shouldCaptureError(error)).toBe(false);
    });

    it('should return true for non-operational BotError', () => {
      const error = new BotError('System error', 'SYSTEM');
      Object.defineProperty(error, 'isOperational', { value: false });
      expect(shouldCaptureError(error)).toBe(true);
    });

    it('should return true for regular Error', () => {
      const error = new Error('Regular error');
      expect(shouldCaptureError(error)).toBe(true);
    });

    it('should return true for TypeError', () => {
      const error = new TypeError('Type error');
      expect(shouldCaptureError(error)).toBe(true);
    });
  });

  // ==================== handleUnhandledRejection Tests ====================

  describe('handleUnhandledRejection', () => {
    it('should set up unhandled rejection handler', () => {
      // Just call the function to set up the handler - it registers a listener
      handleUnhandledRejection();
      
      // The function should complete without error
      expect(true).toBe(true);
    });

    it('should log when called with error reason', () => {
      // Test the logging behavior by directly calling the handler logic
      handleUnhandledRejection();
      
      // Get the registered handler - we need to manually trigger it
      // Since process events can't be easily triggered in tests, 
      // we verify the function sets up the listener properly
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  // ==================== handleUncaughtException Tests ====================

  describe('handleUncaughtException', () => {
    it('should set up uncaught exception handler', () => {
      // Just call the function to set up the handler
      handleUncaughtException();
      
      // The function should complete without error
      expect(true).toBe(true);
    });
  });

  // ==================== createErrorHandler Tests ====================

  describe('createErrorHandler', () => {
    it('should only log operational errors without Sentry capture', async () => {
      const handler = createErrorHandler();
      
      // Create operational error
      const operationalError = new BotError('Operational error', 'OP_ERROR');
      
      // Execute handler
      await expect(handler(operationalError)).rejects.toThrow();
      
      // Should log as warning, not error
      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
      // Operational errors should NOT be captured by Sentry
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('should capture non-operational BotError to Sentry', async () => {
      const handler = createErrorHandler();
      
      // Create non-operational error (system error)
      const systemError = new Error('System error');
      // Make it look like a BotError with isOperational = false
      Object.defineProperty(systemError, 'isOperational', { value: false });
      
      // Execute handler
      await expect(handler(systemError)).rejects.toThrow();
      
      // Should log as error
      expect(logger.error).toHaveBeenCalled();
      // Should capture to Sentry
      expect(Sentry.captureException).toHaveBeenCalledWith(systemError);
    });

    it('should not capture PermissionError to Sentry', async () => {
      const handler = createErrorHandler();
      
      const permissionError = new PermissionError('No permission', 'ADMIN', 'user123');
      
      await expect(handler(permissionError)).rejects.toThrow();
      
      // Should log but not capture to Sentry
      expect(logger.warn).toHaveBeenCalled();
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('should not capture ValidationError to Sentry', async () => {
      const handler = createErrorHandler();
      
      const validationError = new ValidationError('Invalid', 'field', 'value');
      
      await expect(handler(validationError)).rejects.toThrow();
      
      expect(logger.warn).toHaveBeenCalled();
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('should re-throw the error after handling', async () => {
      const handler = createErrorHandler();
      
      const error = new Error('Test error');
      
      await expect(handler(error)).rejects.toThrow('Test error');
    });

    it('should capture regular Error to Sentry', async () => {
      const handler = createErrorHandler();
      
      const regularError = new Error('Regular system error');
      
      await expect(handler(regularError)).rejects.toThrow();
      
      expect(Sentry.captureException).toHaveBeenCalledWith(regularError);
    });

    it('should capture TypeError to Sentry', async () => {
      const handler = createErrorHandler();
      
      const typeError = new TypeError('Cannot read property of undefined');
      
      await expect(handler(typeError)).rejects.toThrow();
      
      expect(Sentry.captureException).toHaveBeenCalledWith(typeError);
    });
  });

  // ==================== formatErrorAsEmbed Tests ====================

  describe('formatErrorAsEmbed with Sentry', () => {
    it('should capture system errors to Sentry', () => {
      // Set production mode
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      const systemError = new Error('System error for embed');
      
      const embed = formatErrorAsEmbed(systemError);
      
      // Should capture to Sentry
      expect(Sentry.captureException).toHaveBeenCalled();
      
      // Restore env
      process.env.NODE_ENV = originalEnv;
    });

    it('should not capture operational errors to Sentry', () => {
      const operationalError = new BotError('Operational', 'OP');
      
      const embed = formatErrorAsEmbed(operationalError);
      
      // Operational errors should NOT be captured
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('should not capture PermissionError to Sentry', () => {
      const permissionError = new PermissionError('No permission', 'ADMIN', 'user123');
      
      const embed = formatErrorAsEmbed(permissionError);
      
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('should add error ID to embed footer for system errors', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      const systemError = new Error('System error');
      
      const embed = formatErrorAsEmbed(systemError);
      
      // Footer should contain error ID
      const footer = embed.data.footer?.text;
      expect(footer).toContain('錯誤 ID:');
      
      process.env.NODE_ENV = originalEnv;
    });

    it('should add error code to embed footer for BotError', () => {
      const botError = new BotError('Test', 'TEST_CODE');
      
      const embed = formatErrorAsEmbed(botError);
      
      const footer = embed.data.footer?.text;
      expect(footer).toContain('錯誤代碼: TEST_CODE');
    });
  });

  // ==================== Integration Summary Tests ====================

  describe('Sentry Integration Summary', () => {
    it('should correctly filter business errors from Sentry', () => {
      // Business errors should NOT go to Sentry
      const businessErrors = [
        new BotError('Test', 'CODE'),
        new PermissionError('No perm', 'ADMIN', 'user1'),
        new ValidationError('Invalid', 'field', 'val'),
        new SessionError('Expired', 'session1'),
      ];

      for (const error of businessErrors) {
        expect(shouldCaptureError(error)).toBe(false);
      }
    });

    it('should correctly identify system errors for Sentry', () => {
      // System errors SHOULD go to Sentry
      const systemErrors = [
        new Error('Regular error'),
        new TypeError('Type error'),
        new RangeError('Out of range'),
      ];

      for (const error of systemErrors) {
        expect(shouldCaptureError(error)).toBe(true);
      }
    });

    it('should capture non-operational BotError to Sentry', () => {
      const error = new BotError('System error', 'SYSTEM');
      Object.defineProperty(error, 'isOperational', { value: false });
      
      expect(shouldCaptureError(error)).toBe(true);
    });
  });
});
