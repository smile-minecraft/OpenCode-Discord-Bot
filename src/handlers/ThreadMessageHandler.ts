/**
 * Thread Message Handler - 處理 Session Thread 中的使用者訊息
 * @description 監聽 Session Thread 中的使用者訊息，並將其轉發到 OpenCode SDK
 */

import { Message, ChannelType } from 'discord.js';
import { getThreadManager } from '../services/ThreadManager.js';
import { getSessionManager } from '../services/SessionManager.js';
import { getSessionEventManager } from '../services/SessionEventManager.js';
import { getStreamingMessageManager, type SSEEventEmitterAdapter } from '../services/StreamingMessageManager.js';
import { getOpenCodeSDKAdapter } from '../services/OpenCodeSDKAdapter.js';
import { log as logger } from '../utils/logger.js';

/**
 * Thread Message Handler 類別
 * @description 處理 Session Thread 中的使用者訊息
 */
export class ThreadMessageHandler {
  /**
   * 處理訊息
   * @param message Discord Message 物件
   */
  async handleMessage(message: Message): Promise<void> {
    // 忽略機器人訊息
    if (message.author.bot) {
      return;
    }

    // 檢查是否為 Thread 頻道
    if (message.channel.type !== ChannelType.PublicThread &&
      message.channel.type !== ChannelType.PrivateThread &&
      message.channel.type !== ChannelType.AnnouncementThread) {
      return;
    }

    const threadId = message.channelId;

    // 檢查是否為追蹤的 Session Thread
    const sessionId = getThreadManager().getSessionIdByThreadId(threadId);

    if (!sessionId) {
      // 不是有效的 Session Thread，不處理
      return;
    }

    // 獲取訊息內容
    const prompt = message.content.trim();

    if (!prompt) {
      // 忽略空訊息
      logger.debug(`[ThreadMessageHandler] Empty message in thread ${threadId}, skipping`);
      return;
    }

    // 驗證 session 是否存在且仍在運行
    const sessionManager = getSessionManager();
    let session = sessionManager.getSession(sessionId);

    // Bug 2 Fix: 如果 session 在 activeSessions 中找不到，嘗試從資料庫恢復
    // 這發生在 Bot 重啟後，session 已持久化但尚未恢復到記憶體
    if (!session) {
      logger.info(`[ThreadMessageHandler] Session ${sessionId} not in memory, attempting DB recovery...`);
      const recovered = await sessionManager.findSession(sessionId);
      if (recovered && !recovered.isEnded()) {
        session = recovered;
        logger.info(`[ThreadMessageHandler] Session ${sessionId} recovered from DB, status: ${session.status}`);
      }
    }

    if (!session) {
      // Session 真的不存在
      logger.warn(`[ThreadMessageHandler] Session not found: ${sessionId}`);
      try {
        await message.reply({
          content: '❌ 找不到對應的 Session，請重新開始對話',
        });
      } catch {
        // 忽略回覆錯誤
      }
      return;
    }

    if (!session.isRunning()) {
      // Session 已結束
      logger.warn(`[ThreadMessageHandler] Session not running: ${sessionId}, status: ${session.status}`);
      try {
        await message.reply({
          content: '⚠️ 此 Session 已結束，請使用 `/session start` 開始新的對話',
        });
      } catch {
        // 忽略回覆錯誤
      }
      return;
    }

    const streamingManager = getStreamingMessageManager();
    let streamingStarted = false;

    try {
      logger.info(`[ThreadMessageHandler] Forwarding message to session ${sessionId}`, {
        threadId,
        userId: message.author.id,
        messageLength: prompt.length,
      } as Record<string, unknown>);

      // ===== Phase 7: 啟動 Streaming (使用 Typing Indicator) =====
      // 先訂閱事件並啟動串流，確保在發送訊息前已經准备好接收 events
      try {
        // 獲取 SDK 適配器端口
        const sdkAdapter = getOpenCodeSDKAdapter();
        const port = sdkAdapter.getPort();

        if (!port) {
          throw new Error('OpenCode 串流未就緒，請稍後再試');
        }

        // 訂閱 Session 事件獲取適配器 - 必須在發送訊息之前完成訂閱
        const sessionEventManager = getSessionEventManager();
        let adapter = sessionEventManager.getSubscription(sessionId)?.adapter as SSEEventEmitterAdapter | undefined;
        if (!adapter) {
          adapter = await sessionEventManager.subscribe(sessionId, session.projectPath) as SSEEventEmitterAdapter;
        }

        // 啟動 Streaming（傳入 channelId 而非初始訊息）
        streamingManager.startStreaming(session, threadId, port, adapter);
        streamingStarted = true;

        logger.info(`[ThreadMessageHandler] Streaming subscribed and started for session ${sessionId}`);
      } catch (streamingError) {
        logger.error(`[ThreadMessageHandler] Failed to setup streaming for session ${sessionId}`, streamingError as Error);
        throw streamingError;
      }

      // 轉發訊息到 SDK - 現在 event listener 已準備好，可以接收所有 events
      await sessionManager.sendPrompt(sessionId, prompt);

      logger.info(`[ThreadMessageHandler] Message forwarded successfully to session ${sessionId}`);
    } catch (error) {
      if (streamingStarted) {
        streamingManager.removeStream(sessionId, threadId);
      }

      logger.error(`[ThreadMessageHandler] Failed to forward message to session ${sessionId}`, error as Error);

      // 嘗試回覆錯誤訊息給使用者
      try {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await message.reply({
          content: `❌ 發送訊息失敗: ${errorMessage}`,
        });
      } catch {
        // 忽略回覆錯誤
      }
    }
  }
}

// ============== 單例實例 ==============

let threadMessageHandlerInstance: ThreadMessageHandler | null = null;

/**
 * 獲取 ThreadMessageHandler 單例實例
 */
export function getThreadMessageHandler(): ThreadMessageHandler {
  if (!threadMessageHandlerInstance) {
    threadMessageHandlerInstance = new ThreadMessageHandler();
  }
  return threadMessageHandlerInstance;
}

// ============== 導出 ==============

export default {
  ThreadMessageHandler,
  getThreadMessageHandler,
};
