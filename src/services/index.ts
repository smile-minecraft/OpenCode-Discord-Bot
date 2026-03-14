// Services
export { ProjectManager, createProjectManager } from './ProjectManager.js';
export type { ProjectManagerConfig, ProjectAlias, ChannelBinding, ProjectExportData } from './ProjectManager.js';
export { QueueManager, getQueueManager, resetQueueManager } from './QueueManager.js';
export type { QueueTask, QueueSettings, QueueState, TaskStatus } from './QueueManager.js';
export { SessionQueueIntegration, getSessionQueueIntegration } from './SessionQueueIntegration.js';
export type { SessionCompletedEvent, NewSessionRequest } from './SessionQueueIntegration.js';
export { SessionManager, getSessionManager, initializeSessionManager } from './SessionManager.js';
export type { CreateSessionOptions, SessionExecutionResult, OpenCodeExecutionOptions } from './SessionManager.js';

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
