/**
 * Rate Limiter Utility
 * @description Simple rate limiter for Discord button clicks and autocomplete
 */

import { log as logger } from './logger.js';

/**
 * Rate Limiter options
 */
export interface RateLimiterOptions {
  /** Max requests allowed in the time window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Whether to log rate limit violations */
  verbose?: boolean;
}

/**
 * Rate Limiter class
 * Simple in-memory rate limiter using sliding window algorithm
 */
export class RateLimiter {
  private maxRequests: number;
  private windowMs: number;
  private verbose: boolean;
  private cache: Map<string, { count: number; resetTime: number }> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options: RateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
    this.verbose = options.verbose ?? false;

    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);

    // Handle graceful shutdown
    process.on('SIGINT', () => this.destroy());
    process.on('SIGTERM', () => this.destroy());
  }

  /**
   * Check if the request is allowed
   * @param key - Unique identifier for rate limiting (e.g., userId, channelId)
   * @returns true if allowed, false if rate limited
   */
  isAllowed(key: string): boolean {
    const now = Date.now();
    const record = this.cache.get(key);

    if (!record) {
      // First request from this key
      this.cache.set(key, {
        count: 1,
        resetTime: now + this.windowMs,
      });
      return true;
    }

    if (now > record.resetTime) {
      // Time window has expired, reset
      this.cache.set(key, {
        count: 1,
        resetTime: now + this.windowMs,
      });
      return true;
    }

    if (record.count >= this.maxRequests) {
      // Rate limited
      if (this.verbose) {
        logger.warn(`[RateLimiter] Rate limit exceeded for key: ${key}`, {
          count: record.count,
          maxRequests: this.maxRequests,
          windowMs: this.windowMs,
        });
      }
      return false;
    }

    // Increment count
    record.count++;
    this.cache.set(key, record);
    return true;
  }

  /**
   * Get remaining requests for a key
   * @param key - Unique identifier
   * @returns Number of remaining requests, or -1 if key not found
   */
  getRemaining(key: string): number {
    const record = this.cache.get(key);
    if (!record) {
      return this.maxRequests;
    }

    const now = Date.now();
    if (now > record.resetTime) {
      return this.maxRequests;
    }

    return Math.max(0, this.maxRequests - record.count);
  }

  /**
   * Get reset time for a key
   * @param key - Unique identifier
   * @returns Reset timestamp, or null if key not found
   */
  getResetTime(key: string): number | null {
    const record = this.cache.get(key);
    if (!record) {
      return null;
    }

    const now = Date.now();
    if (now > record.resetTime) {
      return null;
    }

    return record.resetTime;
  }

  /**
   * Reset rate limit for a key
   * @param key - Unique identifier
   */
  reset(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, record] of this.cache.entries()) {
      if (now > record.resetTime) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (this.verbose && cleaned > 0) {
      logger.debug(`[RateLimiter] Cleaned up ${cleaned} expired entries`);
    }
  }

  /**
   * Destroy the rate limiter
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
  }
}

// ============== Pre-configured rate limiters ==============

/**
 * Rate limiter for button clicks
 * - 10 requests per 5 seconds per user
 */
export const buttonRateLimiter = new RateLimiter({
  maxRequests: 10,
  windowMs: 5000,
  verbose: false,
});

/**
 * Rate limiter for autocomplete
 * - 20 requests per 10 seconds per user
 */
export const autocompleteRateLimiter = new RateLimiter({
  maxRequests: 20,
  windowMs: 10000,
  verbose: false,
});

/**
 * Check if button click is allowed
 * @param userId - User ID
 * @returns true if allowed
 */
export function isButtonAllowed(userId: string): boolean {
  return buttonRateLimiter.isAllowed(userId);
}

/**
 * Check if autocomplete is allowed
 * @param userId - User ID
 * @returns true if allowed
 */
export function isAutocompleteAllowed(userId: string): boolean {
  return autocompleteRateLimiter.isAllowed(userId);
}
