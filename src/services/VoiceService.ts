/**
 * Voice Service - 語音訊息轉錄服務
 * @description 下載 Discord 語音訊息並使用 Gemini API 轉錄為文字
 */

import path from 'path';
import { createWriteStream, promises as fsPromises } from 'fs';
import https from 'https';
import { log as logger } from '../utils/logger.js';
import { TIMEOUTS } from '../config/constants.js';

// ============== 類型定義 ==============

/**
 * 語音轉錄選項
 */
export interface TranscribeOptions {
  /** Discord 語音訊息附件 URL */
  attachmentUrl: string;
  /** 臨時下載目錄 */
  tempDir?: string;
}

/**
 * 語音轉錄結果
 */
export interface TranscribeResult {
  /** 是否成功 */
  success: boolean;
  /** 轉錄文字 */
  text?: string;
  /** 錯誤訊息 */
  error?: string;
}

/**
 * Voice Service 配置
 */
export interface VoiceServiceConfig {
  /** Gemini API Key */
  apiKey?: string;
  /** 臨時目錄 */
  tempDir?: string;
}

// ============== Voice Service ==============

/**
 * Voice Service 類
 * @description 負責下載 Discord 語音訊息並轉錄為文字
 */
export class VoiceService {
  /** API Key */
  private apiKey: string | null = null;
  /** 臨時目錄 */
  private readonly tempDir: string;

  /**
   * 創建 Voice Service 實例
   */
  constructor(config: VoiceServiceConfig = {}) {
    // 優先使用傳入的 API Key，其次使用環境變數
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || null;
    this.tempDir = config.tempDir || path.join(process.cwd(), 'temp', 'voice');
    
    // 確保臨時目錄存在
    this.ensureTempDir();
  }

  /**
   * 確保臨時目錄存在
   */
  private async ensureTempDir(): Promise<void> {
    try {
      await fsPromises.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      logger.error('[VoiceService] 創建臨時目錄失敗:', error as Error | Record<string, unknown>);
    }
  }

  /**
   * 設定 API Key (已棄用，請使用環境變數 GEMINI_API_KEY)
   * @deprecated 請透過環境變數設定 API Key
   */
  setApiKey(apiKey: string): void {
    logger.warn('[VoiceService] setApiKey() 已棄用，請使用環境變數 GEMINI_API_KEY');
    this.apiKey = apiKey;
  }

  /**
   * 獲取 API Key 狀態
   */
  hasApiKey(): boolean {
    return !!this.apiKey;
  }

  /**
   * 獲取配置資訊
   */
  getStatus(): { configured: boolean; apiKeySet: boolean } {
    return {
      configured: !!this.apiKey,
      apiKeySet: !!this.apiKey,
    };
  }

  /**
   * 下載檔案
   */
  private async downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(destPath);
      
      const cleanup = () => {
        fsPromises.unlink(destPath).catch(() => {});
      };
      
      const timeout = setTimeout(() => {
        request.destroy();
        cleanup();
        reject(new Error('Download timeout'));
      }, TIMEOUTS.VOICE_DOWNLOAD);
      
      const request = https.get(url, { timeout: TIMEOUTS.HTTP }, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // 處理重定向
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            const redirectRequest = https.get(redirectUrl, { timeout: TIMEOUTS.HTTP }, (redirectResponse) => {
              if (redirectResponse.statusCode !== 200) {
                clearTimeout(timeout);
                cleanup();
                reject(new Error(`下載失敗: HTTP ${redirectResponse.statusCode}`));
                return;
              }
              redirectResponse.pipe(file);
              file.on('finish', () => {
                clearTimeout(timeout);
                file.close();
                resolve();
              });
              file.on('error', (err) => {
                clearTimeout(timeout);
                cleanup();
                reject(err);
              });
            });
            redirectRequest.on('error', (err) => {
              clearTimeout(timeout);
              cleanup();
              reject(err);
            });
            redirectRequest.on('timeout', () => {
              redirectRequest.destroy();
              clearTimeout(timeout);
              cleanup();
              reject(new Error('Request timeout'));
            });
            return;
          }
        }
        
        if (response.statusCode !== 200) {
          clearTimeout(timeout);
          cleanup();
          reject(new Error(`下載失敗: HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on('finish', () => {
          clearTimeout(timeout);
          file.close();
          resolve();
        });
        file.on('error', (err) => {
          clearTimeout(timeout);
          cleanup();
          reject(err);
        });
      });
      
      request.on('error', (err) => {
        clearTimeout(timeout);
        cleanup();
        reject(err);
      });
      
      request.on('timeout', () => {
        request.destroy();
        clearTimeout(timeout);
        cleanup();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * 使用 Gemini API 轉錄音頻
   */
  private async transcribeWithGemini(audioPath: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY 未設定。請透過環境變數設定 GEMINI_API_KEY');
    }

    // 讀取音頻檔案
    const audioData = await fsPromises.readFile(audioPath);
    const base64Audio = audioData.toString('base64');

    // 根據檔案副檔名判斷 MIME 類型
    const ext = path.extname(audioPath).toLowerCase();
    const mimeType = this.getMimeType(ext);

    // 構建 Gemini API 請求
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${this.apiKey}`;

    const payload = {
      contents: [{
        parts: [{
          inline_data: {
            mime_type: mimeType,
            data: base64Audio
          }
        }, {
          text: '請將這段語音轉錄為文字，盡可能準確地還原所說的內容。'
        }]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192,
      }
    };

    // 發送請求
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API 請求失敗: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };
    
    // 解析回應
    const apiResult = result;
    if (apiResult.candidates && apiResult.candidates[0]?.content?.parts) {
      const text = apiResult.candidates[0].content.parts
        .map((part: { text?: string }) => part.text)
        .join('');
      return text;
    }

    throw new Error('Gemini API 回應格式錯誤');
  }

  /**
   * 根據副檔名獲取 MIME 類型
   */
  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.mp4': 'video/mp4',
      '.m4a': 'audio/mp4',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.webm': 'audio/webm',
      '.flac': 'audio/flac',
    };
    return mimeTypes[ext] || 'audio/mpeg';
  }

  /**
   * 清理臨時檔案
   */
  private async cleanupTempFile(filePath: string): Promise<void> {
    try {
      await fsPromises.unlink(filePath);
    } catch (error) {
      logger.warn(`[VoiceService] 清理臨時檔案失敗: ${filePath}`, error as Record<string, unknown>);
    }
  }

  /**
   * 轉錄語音訊息
   */
  async transcribe(options: TranscribeOptions): Promise<TranscribeResult> {
    const { attachmentUrl, tempDir } = options;
    const targetDir = tempDir || this.tempDir;

    // 確保目錄存在
    await this.ensureTempDir();

    // 檢查 API Key
    if (!this.apiKey) {
      return {
        success: false,
        error: 'API Key 未設定。請透過環境變數 GEMINI_API_KEY 設定'
      };
    }

    // 生成臨時檔案名稱
    const timestamp = Date.now();
    const tempFileName = `voice_${timestamp}.ogg`;
    const tempFilePath = path.join(targetDir, tempFileName);

    logger.info(`[VoiceService] 開始下載語音: ${attachmentUrl}`);

    try {
      // 下載語音檔案
      await this.downloadFile(attachmentUrl, tempFilePath);
      logger.info(`[VoiceService] 語音下載完成: ${tempFilePath}`);

      // 檢查檔案是否存在
      const stats = await fsPromises.stat(tempFilePath);
      if (stats.size === 0) {
        throw new Error('下載的檔案為空');
      }

      // 使用 Gemini API 轉錄
      logger.info(`[VoiceService] 開始轉錄...`);
      const text = await this.transcribeWithGemini(tempFilePath);
      logger.info(`[VoiceService] 轉錄完成，文字長度: ${text.length}`);

      // 清理臨時檔案
      await this.cleanupTempFile(tempFilePath);

      return {
        success: true,
        text: text.trim()
      };
    } catch (error) {
      logger.error('[VoiceService] 轉錄失敗:', error as Error | Record<string, unknown>);

      // 嘗試清理臨時檔案
      await this.cleanupTempFile(tempFilePath);

      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * 檢測訊息是否包含語音訊息附件
   */
  static hasVoiceMessage(attachments: readonly { url: string; contentType: string | null }[]): string | null {
    // Discord 語音訊息的 contentType 通常為 'audio/ogg' 或其他音頻格式
    const voiceContentTypes = [
      'audio/ogg',
      'audio/mp4',
      'audio/mpeg',
      'audio/wav',
      'audio/webm',
      'audio/flac',
      'voice-message', // Discord 語音訊息標記
    ];

    for (const attachment of attachments) {
      if (attachment.contentType && voiceContentTypes.some(ct => 
        attachment.contentType!.startsWith('audio/') || 
        attachment.contentType === ct
      )) {
        return attachment.url;
      }
      
      // 也檢查 URL 包含常見語音關鍵字
      if (attachment.url.includes('cdn.discordapp.com/attachments')) {
        const ext = path.extname(attachment.url).toLowerCase();
        const voiceExtensions = ['.ogg', '.mp3', '.mp4', '.m4a', '.wav', '.webm', '.flac'];
        if (voiceExtensions.includes(ext)) {
          return attachment.url;
        }
      }
    }

    return null;
  }
}

// ============== 單例實例 ==============

let voiceServiceInstance: VoiceService | null = null;

/**
 * 獲取 Voice Service 單例實例
 */
export function getVoiceService(config?: VoiceServiceConfig): VoiceService {
  if (!voiceServiceInstance) {
    voiceServiceInstance = new VoiceService(config);
  }
  return voiceServiceInstance;
}

/**
 * 初始化 Voice Service
 */
export function initializeVoiceService(config?: VoiceServiceConfig): VoiceService {
  voiceServiceInstance = new VoiceService(config);
  return voiceServiceInstance;
}

// ============== 導出 ==============

export default {
  VoiceService,
  getVoiceService,
  initializeVoiceService,
};
