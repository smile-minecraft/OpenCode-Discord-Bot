/**
 * Migration: Add Thread Mappings
 * @description 
 *   - Creates thread_mappings table for tracking Discord thread associations
 *   - Adds thread_archived column to sessions table
 * 
 * Version: 2
 * Created: 2026-03-18
 */

import type { Database } from 'better-sqlite3';
import logger from '../../utils/logger.js';

/**
 * Run the migration - creates thread_mappings table and adds columns
 * @param db - SQLite database instance
 */
export async function up(db: Database): Promise<void> {
  logger.info('[Migration 002] Starting thread_mappings migration...');

  try {
    // Check if thread_mappings table already exists
    const existingTable = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='thread_mappings'"
    ).get();

    if (existingTable) {
      logger.info('[Migration 002] thread_mappings table already exists, skipping creation');
    } else {
      // Create thread_mappings table
      db.exec(`
        CREATE TABLE IF NOT EXISTS thread_mappings (
          thread_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          opencode_session_id TEXT,
          channel_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          archived_at INTEGER,
          needs_cleanup INTEGER DEFAULT 0,
          cleanup_error TEXT,
          
          -- Foreign key constraint with CASCADE delete
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )
      `);
      logger.info('[Migration 002] Created thread_mappings table');
    }

    // Create indexes for thread_mappings
    const indexes = [
      // Index on session_id for looking up threads by session
      `CREATE INDEX IF NOT EXISTS idx_thread_mappings_session ON thread_mappings(session_id)`,
      
      // Index on opencode_session_id for OpenCode session lookup
      `CREATE INDEX IF NOT EXISTS idx_thread_mappings_opencode ON thread_mappings(opencode_session_id)`,
      
      // Index on channel_id for channel thread listing
      `CREATE INDEX IF NOT EXISTS idx_thread_mappings_channel ON thread_mappings(channel_id)`,
      
      // Index on guild_id for guild thread listing
      `CREATE INDEX IF NOT EXISTS idx_thread_mappings_guild ON thread_mappings(guild_id)`
    ];

    for (const indexSql of indexes) {
      try {
        db.exec(indexSql);
      } catch (error) {
        logger.warn(`[Migration 002] Index creation warning: ${error}`);
      }
    }
    logger.info('[Migration 002] Created thread_mappings indexes');

    // Add thread_archived column to sessions table if it doesn't exist
    const sessionsTableInfo = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    const hasThreadArchived = sessionsTableInfo.some(col => col.name === 'thread_archived');

    if (!hasThreadArchived) {
      db.exec(`
        ALTER TABLE sessions ADD COLUMN thread_archived INTEGER DEFAULT 0
      `);
      logger.info('[Migration 002] Added thread_archived column to sessions table');
    } else {
      logger.info('[Migration 002] thread_archived column already exists in sessions');
    }

    logger.info('[Migration 002] Migration completed successfully');
  } catch (error) {
    logger.error('[Migration 002] Migration failed:', error);
    throw error;
  }
}

/**
 * Rollback the migration - drops thread_mappings table and removes columns
 * @param db - SQLite database instance
 */
export async function down(db: Database): Promise<void> {
  logger.info('[Migration 002] Rolling back thread_mappings migration...');

  try {
    // Drop indexes first
    const indexes = [
      'idx_thread_mappings_session',
      'idx_thread_mappings_opencode',
      'idx_thread_mappings_channel',
      'idx_thread_mappings_guild'
    ];

    for (const indexName of indexes) {
      try {
        db.exec(`DROP INDEX IF EXISTS ${indexName}`);
      } catch (error) {
        logger.warn(`[Migration 002] Index ${indexName} may not exist: ${error}`);
      }
    }
    logger.info('[Migration 002] Dropped thread_mappings indexes');

    // Drop thread_mappings table
    db.exec(`DROP TABLE IF EXISTS thread_mappings`);
    logger.info('[Migration 002] Dropped thread_mappings table');

    // Note: SQLite does not support DROP COLUMN directly in all versions
    // We use a workaround to remove the thread_archived column
    // This is a limitation of SQLite migrations
    const sessionsTableInfo = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    const hasThreadArchived = sessionsTableInfo.some(col => col.name === 'thread_archived');

    if (hasThreadArchived) {
      // SQLite 3.35.0+ supports DROP COLUMN
      try {
        db.exec(`ALTER TABLE sessions DROP COLUMN thread_archived`);
        logger.info('[Migration 002] Dropped thread_archived column from sessions');
      } catch {
        // For older SQLite versions, log the limitation
        logger.warn('[Migration 002] SQLite version does not support DROP COLUMN. thread_archived column remains.');
      }
    }

    logger.info('[Migration 002] Rollback completed');
  } catch (error) {
    logger.error('[Migration 002] Rollback failed:', error);
    throw error;
  }
}

export default { up, down };
