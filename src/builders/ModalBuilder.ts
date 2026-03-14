/**
 * Modal Builder - 彈出表單建構工具
 * @description 提供常用 Modal 模板的快速創建
 */

import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ModalActionRowComponentBuilder,
  APIActionRowComponent,
} from 'discord.js';

// ============== 文字輸入樣式常量 ==============

/** 文字輸入樣式 */
export const InputStyles = {
  SHORT: TextInputStyle.Short,
  PARAGRAPH: TextInputStyle.Paragraph,
} as const;

// ============== 通用 Modal 構建器 ==============

/**
 * 通用 Modal 構建器
 * @extends ModalBuilder
 */
export class CustomModalBuilder extends ModalBuilder {
  constructor() {
    super();
  }

  /**
   * 設置標題
   */
  setTitle(title: string): this {
    return super.setTitle(title);
  }

  /**
   * 設置自定義 ID
   */
  setCustomId(customId: string): this {
    return super.setCustomId(customId);
  }

  /**
   * 添加文字輸入組件
   */
  addTextInput(options: {
    /** 自定義 ID */
    customId: string;
    /** 標籤 */
    label: string;
    /** 樣式 */
    style: TextInputStyle;
    /** 佔位符（可選） */
    placeholder?: string;
    /** 預設值（可選） */
    defaultValue?: string;
    /** 最小長度（可選） */
    minLength?: number;
    /** 最大長度（可選） */
    maxLength?: number;
    /** 是否必填 */
    required?: boolean;
  }): this {
    const textInput = new TextInputBuilder()
      .setCustomId(options.customId)
      .setLabel(options.label)
      .setStyle(options.style)
      .setRequired(options.required ?? true);

    if (options.placeholder) {
      textInput.setPlaceholder(options.placeholder);
    }

    if (options.defaultValue) {
      textInput.setValue(options.defaultValue);
    }

    if (options.minLength !== undefined) {
      textInput.setMinLength(options.minLength);
    }

    if (options.maxLength !== undefined) {
      textInput.setMaxLength(options.maxLength);
    }

    const actionRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      textInput
    );

    return super.addComponents(actionRow as unknown as APIActionRowComponent<ModalActionRowComponentBuilder>);
  }

  /**
   * 添加短文字輸入（單行）
   */
  addShortInput(options: {
    customId: string;
    label: string;
    placeholder?: string;
    defaultValue?: string;
    minLength?: number;
    maxLength?: number;
    required?: boolean;
  }): this {
    return this.addTextInput({
      ...options,
      style: TextInputStyle.Short,
    });
  }

  /**
   * 添加段落輸入（多行）
   */
  addParagraphInput(options: {
    customId: string;
    label: string;
    placeholder?: string;
    defaultValue?: string;
    minLength?: number;
    maxLength?: number;
    required?: boolean;
  }): this {
    return this.addTextInput({
      ...options,
      style: TextInputStyle.Paragraph,
    });
  }
}

// ============== 專用 Modal 模板 ==============

/**
 * 輸入框 Modal
 * @description 單行文字輸入
 */
export class InputModalBuilder extends CustomModalBuilder {
  /**
   * 創建一個輸入框 Modal
   */
  static create(options: {
    /** 自定義 ID */
    customId: string;
    /** 標題 */
    title: string;
    /** 輸入框配置 */
    input: {
      /** 自定義 ID */
      customId: string;
      /** 標籤 */
      label: string;
      /** 佔位符 */
      placeholder?: string;
      /** 預設值 */
      defaultValue?: string;
      /** 最小長度 */
      minLength?: number;
      /** 最大長度 */
      maxLength?: number;
      /** 是否必填 */
      required?: boolean;
    };
  }): ModalBuilder {
    return new ModalBuilder()
      .setCustomId(options.customId)
      .setTitle(options.title)
      .addComponents(
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(options.input.customId)
            .setLabel(options.input.label)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(options.input.placeholder || '')
            .setValue(options.input.defaultValue || '')
            .setMinLength(options.input.minLength ?? 0)
            .setMaxLength(options.input.maxLength ?? 100)
            .setRequired(options.input.required ?? true)
        )
      );
  }
}

/**
 * 訊息輸入 Modal
 * @description 多行文字輸入，用於長訊息
 */
export class MessageModalBuilder extends CustomModalBuilder {
  /**
   * 創建訊息輸入 Modal
   */
  static create(options: {
    /** 自定義 ID */
    customId: string;
    /** 標題 */
    title: string;
    /** 訊息配置 */
    message: {
      /** 自定義 ID */
      customId: string;
      /** 標籤 */
      label: string;
      /** 佔位符 */
      placeholder?: string;
      /** 預設值 */
      defaultValue?: string;
      /** 最小長度 */
      minLength?: number;
      /** 最大長度 */
      maxLength?: number;
      /** 是否必填 */
      required?: boolean;
    };
  }): ModalBuilder {
    return new ModalBuilder()
      .setCustomId(options.customId)
      .setTitle(options.title)
      .addComponents(
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(options.message.customId)
            .setLabel(options.message.label)
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(options.message.placeholder || '')
            .setValue(options.message.defaultValue || '')
            .setMinLength(options.message.minLength ?? 1)
            .setMaxLength(options.message.maxLength ?? 2000)
            .setRequired(options.message.required ?? true)
        )
      );
  }
}

/**
 * 雙輸入 Modal
 * @description 兩個文字輸入框
 */
export class DualInputModalBuilder extends CustomModalBuilder {
  /**
   * 創建雙輸入 Modal
   */
  static create(options: {
    /** 自定義 ID */
    customId: string;
    /** 標題 */
    title: string;
    /** 第一個輸入框 */
    firstInput: {
      customId: string;
      label: string;
      placeholder?: string;
      defaultValue?: string;
      minLength?: number;
      maxLength?: number;
      required?: boolean;
    };
    /** 第二個輸入框 */
    secondInput: {
      customId: string;
      label: string;
      placeholder?: string;
      defaultValue?: string;
      minLength?: number;
      maxLength?: number;
      required?: boolean;
    };
  }): ModalBuilder {
    return new ModalBuilder()
      .setCustomId(options.customId)
      .setTitle(options.title)
      .addComponents(
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(options.firstInput.customId)
            .setLabel(options.firstInput.label)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(options.firstInput.placeholder || '')
            .setValue(options.firstInput.defaultValue || '')
            .setMinLength(options.firstInput.minLength ?? 0)
            .setMaxLength(options.firstInput.maxLength ?? 100)
            .setRequired(options.firstInput.required ?? true)
        )
      )
      .addComponents(
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(options.secondInput.customId)
            .setLabel(options.secondInput.label)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(options.secondInput.placeholder || '')
            .setValue(options.secondInput.defaultValue || '')
            .setMinLength(options.secondInput.minLength ?? 0)
            .setMaxLength(options.secondInput.maxLength ?? 100)
            .setRequired(options.secondInput.required ?? true)
        )
      );
  }
}

/**
 * 回覆訊息 Modal
 * @description 用於回覆訊息的 Modal
 */
export class ReplyModalBuilder extends CustomModalBuilder {
  /**
   * 創建回覆 Modal
   */
  static create(options: {
    /** 自定義 ID */
    customId: string;
    /** 要回覆的訊息 ID（可選，用於顯示） */
    messageId?: string;
    /** 回覆內容 */
    reply: {
      /** 自定義 ID */
      customId: string;
      /** 佔位符 */
      placeholder?: string;
      /** 最小長度 */
      minLength?: number;
      /** 最大長度 */
      maxLength?: number;
    };
  }): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(options.customId)
      .setTitle('回覆訊息');

    if (options.messageId) {
      modal.setTitle(`回覆訊息 #${options.messageId.slice(0, 8)}`);
    }

    modal.addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(options.reply.customId)
          .setLabel('回覆內容')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder(options.reply.placeholder || '輸入你的回覆...')
          .setMinLength(options.reply.minLength ?? 1)
          .setMaxLength(options.reply.maxLength ?? 2000)
          .setRequired(true)
      )
    );

    return modal;
  }
}

/**
 * 反饋 Modal
 * @description 用於收集用戶反饋
 */
export class FeedbackModalBuilder extends CustomModalBuilder {
  /**
   * 創建反饋 Modal
   */
  static create(options: {
    /** 自定義 ID */
    customId: string;
    /** 反饋類型標題 */
    feedbackTitle?: string;
  }): ModalBuilder {
    return new ModalBuilder()
      .setCustomId(options.customId)
      .setTitle(options.feedbackTitle || '提交反饋')
      .addComponents(
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('feedback_title')
            .setLabel('標題')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('簡短描述你的問題或建議')
            .setMaxLength(100)
            .setRequired(true)
        )
      )
      .addComponents(
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('feedback_content')
            .setLabel('詳細內容')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('請詳細描述你的問題或建議...')
            .setMinLength(10)
            .setMaxLength(2000)
            .setRequired(true)
        )
      );
  }
}

// ============== 便捷函數 ==============

/**
 * 快速創建自定義 Modal
 * @param customId 自定義 ID
 * @param title 標題
 * @param inputs 輸入框配置陣列
 */
export function createQuickModal(
  customId: string,
  title: string,
  inputs: Array<{
    customId: string;
    label: string;
    style: TextInputStyle;
    placeholder?: string;
    defaultValue?: string;
    minLength?: number;
    maxLength?: number;
    required?: boolean;
  }>
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title);

  inputs.forEach((input) => {
    const textInput = new TextInputBuilder()
      .setCustomId(input.customId)
      .setLabel(input.label)
      .setStyle(input.style)
      .setPlaceholder(input.placeholder || '')
      .setValue(input.defaultValue || '')
      .setMinLength(input.minLength ?? 0)
      .setMaxLength(input.maxLength ?? 1000)
      .setRequired(input.required ?? true);

    modal.addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(textInput)
    );
  });

  return modal;
}

// ============== 預設導出 ==============

export default {
  InputStyles,
  CustomModalBuilder,
  InputModalBuilder,
  MessageModalBuilder,
  DualInputModalBuilder,
  ReplyModalBuilder,
  FeedbackModalBuilder,
  createQuickModal,
};
