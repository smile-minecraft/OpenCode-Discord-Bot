// Logger
export { default as logger, log } from './logger.js';

// Error Handler
export {
  BotError,
  PermissionError,
  ValidationError,
  SessionError,
  formatErrorAsEmbed,
  formatErrorMessage,
  initErrorHandling,
  createErrorHandler
} from './errorHandler.js';

// Types
export type { ErrorSeverity } from './errorHandler.js';
