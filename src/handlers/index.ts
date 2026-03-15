/**
 * Handlers 匯出模組
 * @description 統一匯出所有交互組件處理器
 */

// Import classes for local use
import {
  ButtonHandler,
  ButtonHandlerError,
  createButtonHandler,
  type ButtonHandlerOptions,
  type ButtonHandlerConfig,
  type ButtonHandlerCallback,
  type HandlerErrorOptions,
  type ButtonId解析結果,
  type HandlerResult,
  type RegisteredHandlerInfo,
} from './ButtonHandler.js';

import {
  ModalHandler,
  MultiStepFormManager,
  createModalHandlerResult,
  type IModalHandler,
  type ModalFieldValue,
  type ModalSubmitData,
  type MultiStepFormState,
  type RegisteredModalInfo,
  type ModalHandlerErrorOptions,
} from './ModalHandler.js';

import {
  SelectMenuHandler,
  type SelectMenuHandlerOptions,
} from './SelectMenuHandler.js';

import {
  ContextMenuHandler,
  ContextMenuHandlerError,
  createContextMenuHandler,
  type ContextMenuHandlerOptions,
  type ContextMenuHandlerErrorOptions,
  type ContextMenuHandlerResult,
  type RegisteredContextMenuInfo,
  type IContextMenuHandler,
} from './ContextMenuHandler.js';

// Re-export all
export {
  ButtonHandler,
  ButtonHandlerError,
  createButtonHandler,
  type ButtonHandlerOptions,
  type ButtonHandlerConfig,
  type ButtonHandlerCallback,
  type HandlerErrorOptions,
  type ButtonId解析結果,
  type HandlerResult,
  type RegisteredHandlerInfo,
};

export {
  ModalHandler,
  MultiStepFormManager,
  createModalHandlerResult,
  type IModalHandler,
  type ModalFieldValue,
  type ModalSubmitData,
  type MultiStepFormState,
  type RegisteredModalInfo,
  type ModalHandlerErrorOptions,
};

export {
  SelectMenuHandler,
  type SelectMenuHandlerOptions,
};

export {
  ContextMenuHandler,
  ContextMenuHandlerError,
  createContextMenuHandler,
  type ContextMenuHandlerOptions,
  type ContextMenuHandlerErrorOptions,
  type ContextMenuHandlerResult,
  type RegisteredContextMenuInfo,
  type IContextMenuHandler,
};

/**
 * 預設匯出的 Handler 列表
 */
export const DEFAULT_HANDLERS = [
  ButtonHandler,
  ModalHandler,
];

/**
 * 獲取所有 Handler 類型
 */
export type HandlerType = 'button' | 'selectMenu' | 'modal' | 'contextMenu';

/**
 * Handler 工廠函數映射
 */
export const HANDLER_FACTORIES: Record<HandlerType, () => unknown> = {
  button: () => new ButtonHandler(),
  selectMenu: () => {
    throw new Error('SelectMenuHandler not implemented yet');
  },
  modal: () => new ModalHandler(),
  contextMenu: () => new ContextMenuHandler(),
};
