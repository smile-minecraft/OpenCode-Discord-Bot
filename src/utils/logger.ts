import winston, { format, transports } from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// P2-11: 從環境變數讀取日誌配置，預設值保持向後兼容
const LOG_MAX_SIZE = parseInt(process.env.LOG_MAX_SIZE || String(5 * 1024 * 1024), 10);  // 預設 5MB
const LOG_MAX_FILES = parseInt(process.env.LOG_MAX_FILES || '5', 10);  // 預設 5 個文件
// P2-12: 從環境變數讀取日誌路徑，預設值保持向後兼容
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '../../logs');

// 日誌格式
const logFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.printf(({ timestamp, level, message, stack, ...metadata }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    if (Object.keys(metadata).length > 0) {
      log += ` ${JSON.stringify(metadata)}`;
    }
    
    if (stack) {
      log += `\n${stack}`;
    }
    
    return log;
  })
);

// 控制台格式（更易讀）
const consoleFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.printf(({ timestamp, level, message, stack, ...metadata }) => {
    let log = `${timestamp} ${level}: ${message}`;
    
    if (Object.keys(metadata).length > 0) {
      log += ` ${JSON.stringify(metadata)}`;
    }
    
    if (stack && level === 'error') {
      log += `\n${stack}`;
    }
    
    return log;
  })
);

// 創建 logger 實例
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: logFormat,
  transports: [
    // 控制台輸出
    new transports.Console({
      format: consoleFormat
    }),
    // 錯誤日誌文件 (P2-12: 使用可配置的 LOG_DIR)
    new transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: LOG_MAX_SIZE,
      maxFiles: LOG_MAX_FILES
    }),
    // 合併日誌文件 (P2-12: 使用可配置的 LOG_DIR)
    new transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize: LOG_MAX_SIZE,
      maxFiles: LOG_MAX_FILES
    })
  ]
});

// 導出各級別日誌函數
export const log = {
  error: (message: string, meta?: Record<string, unknown> | Error) => {
    if (meta instanceof Error) {
      logger.error(message, { error: meta.message, stack: meta.stack });
    } else {
      logger.error(message, meta);
    }
  },
  
  warn: (message: string, meta?: Record<string, unknown>) => 
    logger.warn(message, meta),
  
  info: (message: string, meta?: Record<string, unknown>) => 
    logger.info(message, meta),
  
  debug: (message: string, meta?: Record<string, unknown>) => 
    logger.debug(message, meta),
  
  // 記錄命令使用
  command: (command: string, userId: string, guildId?: string) => 
    logger.info(`Command executed: ${command}`, { userId, guildId, type: 'command' }),
  
  // 記錄 Discord 事件
  event: (event: string, data?: Record<string, unknown>) => 
    logger.info(`Discord event: ${event}`, { ...data, type: 'event' }),
  
  // 記錄互動
  interaction: (type: string, id: string, userId: string) => 
    logger.info(`Interaction: ${type}`, { interactionId: id, userId, type: 'interaction' })
};

export default logger;
