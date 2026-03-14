/**
 * Handlers 匯出模組
 * @description 統一匯出所有交互組件處理器
 */

// Button Handler
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
} from './ButtonHandler.js';

// Modal Handler
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
} from './ModalHandler.js';

// Select Menu Handler
export {
  SelectMenuHandler,
  type SelectMenuHandlerOptions,
} from './SelectMenuHandler.js';

// Context Menu Handler
export {
  ContextMenuHandler,
  ContextMenuHandlerError,
  createContextMenuHandler,
  type ContextMenuHandlerOptions,
  type ContextMenuHandlerErrorOptions,
  type ContextMenuHandlerResult,
  type RegisteredContextMenuInfo,
  type IContextMenuHandler,
} from './ContextMenuHandler.js';

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
