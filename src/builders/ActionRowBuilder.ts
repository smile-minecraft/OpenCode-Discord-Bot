/**
 * Action Row Builder - 按鈕與選單建構工具
 * @description 提供按鈕行和選單行的統一建構方式
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentType,
  Message,
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';

// ============== 按鈕常量 ==============

/** 預設按鈕樣式 */
export const ButtonStyles = {
  PRIMARY: ButtonStyle.Primary,
  SECONDARY: ButtonStyle.Secondary,
  SUCCESS: ButtonStyle.Success,
  DANGER: ButtonStyle.Danger,
  LINK: ButtonStyle.Link,
} as const;

// ============== 基礎 Action Row 構建器 ==============

/**
 * 按鈕行構建器
 * @extends ActionRowBuilder<ButtonBuilder>
 */
export class ButtonActionRowBuilder extends ActionRowBuilder<ButtonBuilder> {
  /**
   * 創建一個新的按鈕行
   */
  static create(): ButtonActionRowBuilder {
    return new ButtonActionRowBuilder();
  }

  /**
   * 添加按鈕
   */
  addButton(options: {
    /** 自定義 ID（樣式為 Link 時無效） */
    customId?: string;
    /** 按鈕文字 */
    label: string;
    /** 按鈕樣式 */
    style: ButtonStyle;
    /** 圖標（可選） */
    emoji?: string;
    /** 連結（樣式為 Link 時必填） */
    url?: string;
    /** 是否禁用 */
    disabled?: boolean;
  }): this {
    const button = new ButtonBuilder()
      .setLabel(options.label)
      .setStyle(options.style)
      .setDisabled(options.disabled ?? false);

    if (options.customId && options.style !== ButtonStyle.Link) {
      button.setCustomId(options.customId);
    }

    if (options.emoji) {
      button.setEmoji(options.emoji);
    }

    if (options.url && options.style === ButtonStyle.Link) {
      button.setURL(options.url);
    }

    return this.addComponents(button);
  }

  /**
   * 添加主要按鈕（Primary）
   */
  addPrimaryButton(options: {
    customId: string;
    label: string;
    emoji?: string;
    disabled?: boolean;
  }): this {
    return this.addButton({
      ...options,
      style: ButtonStyle.Primary,
    });
  }

  /**
   * 添加次要按鈕（Secondary）
   */
  addSecondaryButton(options: {
    customId: string;
    label: string;
    emoji?: string;
    disabled?: boolean;
  }): this {
    return this.addButton({
      ...options,
      style: ButtonStyle.Secondary,
    });
  }

  /**
   * 添加成功按鈕（Success）
   */
  addSuccessButton(options: {
    customId: string;
    label: string;
    emoji?: string;
    disabled?: boolean;
  }): this {
    return this.addButton({
      ...options,
      style: ButtonStyle.Success,
    });
  }

  /**
   * 添加危險按鈕（Danger）
   */
  addDangerButton(options: {
    customId: string;
    label: string;
    emoji?: string;
    disabled?: boolean;
  }): this {
    return this.addButton({
      ...options,
      style: ButtonStyle.Danger,
    });
  }

  /**
   * 添加連結按鈕
   */
  addLinkButton(options: {
    label: string;
    url: string;
    emoji?: string;
  }): this {
    return this.addButton({
      ...options,
      style: ButtonStyle.Link,
    });
  }
}

/**
 * 選單行構建器
 * @extends ActionRowBuilder<StringSelectMenuBuilder>
 */
export class SelectMenuActionRowBuilder extends ActionRowBuilder<StringSelectMenuBuilder> {
  /**
   * 創建一個新的選單行
   */
  static create(): SelectMenuActionRowBuilder {
    return new SelectMenuActionRowBuilder();
  }

  /**
   * 添加選單
   */
  addSelectMenu(options: {
    /** 自定義 ID */
    customId: string;
    /** 選單選項 */
    options: Array<{
      /** 選項標籤（顯示文字） */
      label: string;
      /** 選項值（提交值） */
      value: string;
      /** 描述（可選） */
      description?: string;
      /** 預設是否選中 */
      default?: boolean;
      /** 表情符號（可選） */
      emoji?: string;
    }>;
    /** 選擇框提示文字 */
    placeholder?: string;
    /** 最小/最大選擇數 */
    minValues?: number;
    maxValues?: number;
    /** 是否禁用 */
    disabled?: boolean;
  }): this {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(options.customId)
      .setOptions(
        options.options.map((opt) => {
          const optionBuilder = new StringSelectMenuOptionBuilder()
            .setLabel(opt.label)
            .setValue(opt.value)
            .setDefault(opt.default ?? false);
          
          if (opt.description) {
            optionBuilder.setDescription(opt.description);
          }
          if (opt.emoji) {
            optionBuilder.setEmoji(opt.emoji);
          }
          return optionBuilder;
        })
      )
      .setDisabled(options.disabled ?? false);

    if (options.placeholder) {
      selectMenu.setPlaceholder(options.placeholder);
    }

    if (options.minValues !== undefined) {
      selectMenu.setMinValues(options.minValues);
    }

    if (options.maxValues !== undefined) {
      selectMenu.setMaxValues(options.maxValues);
    }

    return this.addComponents(selectMenu);
  }

  /**
   * 添加模型選擇選單
   */
  addModelSelectMenu(options: {
    customId: string;
    models: Array<{
      id: string;
      name: string;
      description?: string;
    }>;
    placeholder?: string;
    disabled?: boolean;
  }): this {
    return this.addSelectMenu({
      ...options,
      options: options.models.map((model) => ({
        label: model.name,
        value: model.id,
        description: model.description,
      })),
    });
  }
}

// ============== 預設按鈕模板 ==============

/**
 * 預設按鈕模板集合
 */
export const DefaultButtons = {
  /**
   * 確認按鈕
   */
  confirm: (customId: string, label = '確認') =>
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),

  /**
   * 取消按鈕
   */
  cancel: (customId: string, label = '取消') =>
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌'),

  /**
   * 關閉按鈕
   */
  close: (customId: string) =>
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel('關閉')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✖️'),

  /**
   * 返回按鈕
   */
  back: (customId: string) =>
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel('返回')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('◀️'),

  /**
   * 下一頁按鈕
   */
  next: (customId: string) =>
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel('下一頁')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('▶️'),

  /**
   * 上一頁按鈕
   */
  previous: (customId: string) =>
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel('上一頁')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('◀️'),

  /**
   * 重新整理按鈕
   */
  refresh: (customId: string) =>
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel('重新整理')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄'),

  /**
   * 停止按鈕
   */
  stop: (customId: string) =>
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel('停止')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⏹️'),

  /**
   * 繼續按鈕
   */
  resume: (customId: string) =>
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel('繼續')
      .setStyle(ButtonStyle.Success)
      .setEmoji('▶️'),

  /**
   * 連結按鈕
   */
  link: (url: string, label: string, emoji?: string) => {
    const button = new ButtonBuilder()
      .setURL(url)
      .setLabel(label)
      .setStyle(ButtonStyle.Link);
    
    if (emoji) {
      button.setEmoji(emoji);
    }
    
    return button;
  },
} as const;

// ============== 常用 Action Row 模板 ==============

/**
 * 預設 Action Row 模板
 */
export const DefaultActionRows = {
  /**
   * 確認/取消按鈕行
   */
  confirmCancel: (confirmCustomId: string, cancelCustomId: string) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      DefaultButtons.confirm(confirmCustomId),
      DefaultButtons.cancel(cancelCustomId)
    ),

  /**
   * 關閉按鈕行
   */
  close: (customId: string) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(DefaultButtons.close(customId)),

  /**
   * 上一頁/下一頁按鈕行
   */
  pagination: (prevCustomId: string, nextCustomId: string) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      DefaultButtons.previous(prevCustomId),
      DefaultButtons.next(nextCustomId)
    ),

  /**
   * 停止/繼續按鈕行
   */
  control: (stopCustomId: string, resumeCustomId: string) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      DefaultButtons.stop(stopCustomId),
      DefaultButtons.resume(resumeCustomId)
    ),
} as const;

// ============== 便捷函數 ==============

/**
 * 等待並收集按鈕交互
 * @param message 要監聽的消息
 * @param options 配置選項
 * @returns 按鈕交互或超時返回 null
 */
export async function waitForButton(
  message: Message,
  options: {
    /** 要監聽的 customId（支援字串陣列） */
    customIds: string | string[];
    /** 超時時間（毫秒） */
    timeout?: number;
    /** 用於過濾的函數 */
    filter?: (interaction: ButtonInteraction) => boolean | Promise<boolean>;
  }
): Promise<ButtonInteraction | null> {
  const customIds = Array.isArray(options.customIds) ? options.customIds : [options.customIds];
  const timeout = options.timeout ?? 60000;

  try {
    const collected = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: timeout,
      filter: (interaction) => {
        // 檢查 customId
        if (!customIds.some((id) => interaction.customId === id)) {
          return false;
        }
        // 執行自定義過濾器
        if (options.filter) {
          return options.filter(interaction);
        }
        return true;
      },
    });

    return collected as ButtonInteraction;
  } catch {
    return null;
  }
}

/**
 * 等待並收集選單選擇
 * @param message 要監聽的消息
 * @param options 配置選項
 * @returns 選單交互或超時返回 null
 */
export async function waitForSelect(
  message: Message,
  options: {
    /** 要監聽的 customId */
    customId: string;
    /** 超時時間（毫秒） */
    timeout?: number;
    /** 用於過濾的函數 */
    filter?: (interaction: StringSelectMenuInteraction) => boolean | Promise<boolean>;
  }
): Promise<StringSelectMenuInteraction | null> {
  const timeout = options.timeout ?? 60000;

  try {
    const collected = await message.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      time: timeout,
      filter: (interaction) => {
        if (interaction.customId !== options.customId) {
          return false;
        }
        if (options.filter) {
          return options.filter(interaction);
        }
        return true;
      },
    });

    return collected as StringSelectMenuInteraction;
  } catch {
    return null;
  }
}

// ============== 預設導出 ==============

export default {
  ButtonStyles,
  ButtonActionRowBuilder,
  SelectMenuActionRowBuilder,
  DefaultButtons,
  DefaultActionRows,
  waitForButton,
  waitForSelect,
};
