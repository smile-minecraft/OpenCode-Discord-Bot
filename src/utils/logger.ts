import winston, { format, transports } from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    // 控制台輸出
    new transports.Console({
      format: consoleFormat
    }),
    // 錯誤日誌文件
    new transports.File({
      filename: path.join(__dirname, '../../logs/error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5
    }),
    // 合併日誌文件
    new transports.File({
      filename: path.join(__dirname, '../../logs/combined.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5
    })
  ]
});

// 導出各級別日誌函數
export const log = {
  error: (message: string, meta?: Record<string, unknown>) => 
    logger.error(message, meta),
  
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
