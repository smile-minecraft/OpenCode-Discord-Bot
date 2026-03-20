// Services
export { getProjectManager, initializeProjectManager, resetProjectManager } from './ProjectManager.js';
export type { ProjectManager, ProjectManagerConfig, ProjectAlias, ChannelBinding, ProjectExportData } from './ProjectManager.js';
export type { QueueManager, QueueTask, QueueSettings, QueueState, TaskStatus } from './QueueManager.js';
export { getQueueManager, resetQueueManager } from './QueueManager.js';
export { getSessionQueueIntegration } from './SessionQueueIntegration.js';
export type { SessionCompletedEvent, NewSessionRequest } from './SessionQueueIntegration.js';
export { getSessionManager, initializeSessionManager } from './SessionManager.js';
export type { SessionManager, CreateSessionOptions, SessionExecutionResult } from './SessionManager.js';

// Thread Manager
export { getThreadManager, initializeThreadManager, resetThreadManager } from './ThreadManager.js';
export type { ThreadInfo, CreateThreadOptions } from './ThreadManager.js';

// OpenCode Server Manager & SDK Adapter
export { initializeOpenCodeServerManager, getOpenCodeServerManager } from './OpenCodeServerManager.js';
export { initializeOpenCodeSDKAdapter, getOpenCodeSDKAdapter, getInitializedSDKAdapter } from './OpenCodeSDKAdapter.js';
export type { SDKAdapterOptions, SDKAdapterError, CreateSessionParams, SendPromptParams, SendToolApprovalParams, SetProviderAuthParams, SDKModelInfo, SDKProviderInfo } from './OpenCodeSDKAdapter.js';

// Event Stream Factory
export { createEventStreamAdapter, getEventStreamAdapter, initializeEventStreamAdapter, getAdapterType } from './EventStreamFactory.js';
export type { IEventStreamAdapter, ISDKEventStreamAdapter, EventStreamEventHandler } from './EventStreamFactory.js';

// Streaming Message Manager
export { StreamingMessageManager, getStreamingMessageManager, initializeStreamingMessageManager } from './StreamingMessageManager.js';

// Passthrough Service
export { PassthroughService, getPassthroughService, initializePassthroughService } from './PassthroughService.js';
export type { PassthroughState, ForwardMessageOptions } from './PassthroughService.js';

// Git Worktree Service
export { GitWorktreeService, createGitWorktreeService, GitWorktreeError } from './GitWorktreeService.js';
export type { WorktreeInfo, PullRequestInfo } from './GitWorktreeService.js';

// Permission Service
export { PermissionService, createPermissionService } from './PermissionService.js';
export type { PermissionCheckResult, UserPermissionInfo, ToolExecutionRequest, ApprovalAction, ToolApprovalRecord } from './PermissionService.js';

// Tool Approval Service
export { ToolApprovalService, createToolApprovalService } from './ToolApprovalService.js';
export type { ToolApprovalConfig } from './ToolApprovalService.js';

// Tool State Tracker
export { ToolStateTracker, getToolStateTracker } from './ToolStateTracker.js';
export type { ToolExecution, ToolExecutionStatus } from './ToolStateTracker.js';

// Wrapper functions for initialize pattern (used by bot/index.ts)
import { createGitWorktreeService as _createGitWorktreeService } from './GitWorktreeService.js';
import { createToolApprovalService as _createToolApprovalService } from './ToolApprovalService.js';
import type { ToolApprovalConfig } from './ToolApprovalService.js';
import { createPermissionService as _createPermissionService } from './PermissionService.js';

// Note: initializeProjectManager, getProjectManager, resetProjectManager are exported directly above

export function initializeGitWorktreeService(options?: {
  repoPath?: string;
  githubToken?: string;
  owner?: string;
  repo?: string;
}): void {
  _createGitWorktreeService(options);
}

export function initializeToolApprovalService(_config?: ToolApprovalConfig): void {
  _createToolApprovalService();
}

export function initializePermissionService(): void {
  _createPermissionService();
}

export async function initializeSessionQueueIntegration(): Promise<void> {
  // SessionQueueIntegration uses lazy initialization via getSessionQueueIntegration
  // Use dynamic import to avoid circular dependency issues in ESM
  const { getSessionQueueIntegration } = await import('./SessionQueueIntegration.js');
  getSessionQueueIntegration();
}
