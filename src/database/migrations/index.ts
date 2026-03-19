/**
 * Database Migrations Index
 * @description Exports all database migrations for easy import
 */

export { up as migration002Up, down as migration002Down } from './002_add_thread_mappings.js';

/**
 * Migration Registry
 * Maps migration version numbers to their up/down functions
 */
export const migrations = {
  2: {
    up: async (db: import('better-sqlite3').Database) => {
      const { up } = await import('./002_add_thread_mappings.js');
      return up(db);
    },
    down: async (db: import('better-sqlite3').Database) => {
      const { down } = await import('./002_add_thread_mappings.js');
      return down(db);
    }
  }
} as const;
