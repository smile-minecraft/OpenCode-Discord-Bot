/**
 * Defaults - 預設配置值
 * @description 當 config.json 不存在時使用的預設值
 */

export const DEFAULTS = {
  /**
   * OpenCode API 預設配置
   */
  OPENCODE_API: {
    /** API 基礎 URL */
    BASE_URL: 'https://opencode.ai/zen/v1',
    /** API 請求超時（毫秒） */
    TIMEOUT: 30000,
  },

  /**
   * OpenCode 伺服器預設配置
   */
  OPENCODE_SERVER: {
    /** 伺服器端口 */
    PORT: 4096,
    /** 伺服器 URL */
    URL: 'http://127.0.0.1:4096',
  },

  /**
   * AI 模型預設配置
   */
  MODEL: {
    /** 預設模型 ID */
    DEFAULT: 'anthropic/claude-sonnet-4-20250514',
  },

  /**
   * 超時配置（毫秒）
   */
  TIMEOUTS: {
    /** HTTP 請求超時 */
    HTTP: 30000,
    /** 健康檢查超時 */
    HEALTH_CHECK: 5000,
    /** 工具審批超時 */
    TOOL_APPROVAL: 300000,
    /** 任務超時 */
    TASK: 300000,
    /** SSE 重連最大延遲 */
    RECONNECT: 30000,
    /** 語音下載超時 */
    VOICE_DOWNLOAD: 30000,
  },

  /**
   * Discord 相關配置
   */
  DISCORD: {
    /** 串流訊息更新間隔（毫秒） */
    STREAM_UPDATE_INTERVAL: 500,
  },
} as const;

export default DEFAULTS;
