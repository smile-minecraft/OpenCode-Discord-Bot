/**
 * 資料庫模組匯出
 * @description 統一匯出所有資料庫相關的類型和類別
 */

// Models
export { Guild, type GuildData } from './models/Guild.js';
export { Channel, type ChannelData, type ChannelSettings } from './models/Channel.js';
export { Session, type SessionData, type SessionStatus, type SessionMetadata, type FileChange, type ToolApproval } from './models/Session.js';
export { Project, type ProjectData, type ProjectSettings, type ProjectStats } from './models/Project.js';

// Database Core
export { Database, createDatabase, type DatabaseOptions } from './Database.js';
export { DatabaseError } from './Database.js';

// 重新匯出常見類型
export type {
  PermissionData,
  PermissionLevel,
  QueueItem,
  GuildSettings,
} from './models/Guild.js';
