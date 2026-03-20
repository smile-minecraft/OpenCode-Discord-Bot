// instrument.mjs — Sentry SDK initialization
// Must be loaded before any other module using --import flag
import * as Sentry from "@sentry/node";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ==================== 版本讀取 ====================

/**
 * 讀取 package.json 版本號
 * @returns {string|undefined} 版本號
 */
function getReleaseFromPackageJson() {
  try {
    // 嘗試多個可能的路徑
    const possiblePaths = [
      // 從專案根目錄
      join(process.cwd(), "package.json"),
      // 從 instrument.mjs 所在目錄的父目錄
      join(dirname(fileURLToPath(import.meta.url)), "package.json"),
    ];

    for (const packageJsonPath of possiblePaths) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        if (packageJson.version) {
          return `discord-bot@${packageJson.version}`;
        }
      } catch {
        // 繼續嘗試下一個路徑
      }
    }
  } catch {
    // 忽略錯誤
  }
  return undefined;
}

// ==================== 敏感資訊過濾 ====================

/**
 * 敏感關鍵詞列表
 * @type {RegExp[]}
 */
const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /token/i,
  /authorization/i,
  /bearer/i,
  /credential/i,
  /private[_-]?key/i,
  /discord[_-]?token/i,
  /github[_-]?token/i,
];

/**
 * 過濾敏感資訊
 * @param {unknown} value - 要檢查的值
 * @returns {unknown} 清理後的值
 */
function sanitizeValue(value) {
  if (typeof value === "string") {
    // 檢查是否包含敏感關鍵詞
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(value)) {
        return "[REDACTED]";
      }
    }
    // 檢查是否看起來像 token（很長的隨機字串）
    if (value.length > 50 && /^[A-Za-z0-9_-]+$/.test(value)) {
      return "[REDACTED]";
    }
  }
  return value;
}

/**
 * 清理事件資料中的敏感資訊
 * @param {import('@sentry/node').Event} event - Sentry 事件
 * @returns {import('@sentry/node').Event} 清理後的事件
 */
function sanitizeEvent(event) {
  // 清理 request body
  if (event.request?.data) {
    event.request.data = sanitizeValue(event.request.data);
  }

  // 清理 user data
  if (event.user) {
    if (event.user.ip_address) {
      event.user.ip_address = "[REDACTED]";
    }
  }

  // 清理 extra data
  if (event.extra) {
    const sanitizedExtra = {};
    for (const [key, value] of Object.entries(event.extra)) {
      sanitizedExtra[key] = sanitizeValue(value);
    }
    event.extra = sanitizedExtra;
  }

  // 清理 context
  if (event.contexts) {
    for (const contextName of Object.keys(event.contexts)) {
      const context = event.contexts[contextName];
      if (context && typeof context === "object") {
        const sanitizedContext = {};
        for (const [key, value] of Object.entries(context)) {
          sanitizedContext[key] = sanitizeValue(value);
        }
        event.contexts[contextName] = sanitizedContext;
      }
    }
  }

  return event;
}

// ==================== Sentry 初始化 ====================

// 讀取版本號
const release = getReleaseFromPackageJson();

// 獲取環境變數
const nodeEnv = process.env.NODE_ENV ?? "development";
const sentryDsn = process.env.SENTRY_DSN;
const sentryDebug = process.env.SENTRY_DEBUG === "true";
const sentryTracesSampleRate = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? (nodeEnv === "development" ? "1.0" : "0.1"));

// 只在有 DSN 的情況下初始化 Sentry
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,

    // Release 追蹤
    release: release,

    // 環境配置
    environment: process.env.SENTRY_ENVIRONMENT ?? nodeEnv,

    // 追蹤樣本率
    tracesSampleRate: sentryTracesSampleRate,

    // 包含 PII 資料
    sendDefaultPii: true,

    // 捕獲局部變數
    includeLocalVariables: true,

    // 啟用日誌
    enableLogs: true,

    // 調試模式
    debug: sentryDebug,

    // 預設標籤
    defaultIntegrations: true,

    // BeforeSend 回調 - 過濾敏感資訊
    beforeSend(event) {
      return sanitizeEvent(event);
    },

    // 忽略特定錯誤
    ignoreErrors: [
      // PermissionError - 業務錯誤，不需要上報
      /PermissionError/i,
      // ValidationError - 業務錯誤，不需要上報
      /ValidationError/i,
      // Discord API 錯誤 - 常見但不需要上報
      /DiscordAPIError/i,
      // 網路超時 - 常見
      /ECONNREFUSED/i,
      /ETIMEDOUT/i,
      /ENOTFOUND/i,
      // 客戶端斷開連接
      /CLIENT_DISCONNECTED/i,
      /INTERACTION_ALREADY_REPLIED/i,
    ],

    // 拒絕監控的錯誤
    denyUrls: [
      // 忽略瀏覽器擴展
      /chrome-extension:\/\//i,
      /moz-extension:\/\//i,
    ],
  });

  // 添加預設上下文
  Sentry.setContext("app", {
    name: "OpenCode Discord Bot",
    version: release ?? "unknown",
    nodeEnv: nodeEnv,
  });

  console.log(`[Sentry] Initialized with release: ${release ?? "unknown"}, environment: ${nodeEnv}`);
} else {
  console.warn("[Sentry] SENTRY_DSN not set, Sentry is disabled");
}
