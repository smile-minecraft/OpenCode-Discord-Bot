/**
 * Git Worktree Service - Git Worktree 管理服務
 * @description 執行 git worktree 命令，管理 Worktree 生命週期，與 GitHub API 整合
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';

const execAsync = promisify(exec);

// ============== 類型定義 ==============

/**
 * Worktree 資訊
 */
export interface WorktreeInfo {
  /** Worktree 路徑 */
  path: string;
  /** 分支名稱 */
  branch: string;
  /** HEAD 提交 hash */
  head: string;
  /** 狀態 */
  status: 'clean' | 'dirty' | 'unknown';
  /** 是否為主倉庫 */
  isMain: boolean;
}

/**
 * PR 資訊
 */
export interface PullRequestInfo {
  /** PR 編號 */
  number: number;
  /** PR URL */
  url: string;
  /** 標題 */
  title: string;
  /** 描述 */
  body?: string;
  /** 來源分支 */
  head: string;
  /** 目標分支 */
  base: string;
  /** 狀態 */
  state: 'open' | 'closed' | 'merged';
}

/**
 * Worktree 錯誤類
 */
export class GitWorktreeError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'GitWorktreeError';
  }
}

// ============== Git Worktree Service ==============

/**
 * Git Worktree 管理服務
 */
export class GitWorktreeService {
  private readonly repoPath: string;
  private readonly githubToken?: string;
  private readonly owner?: string;
  private readonly repo?: string;

  /**
   * 建立 GitWorktreeService 實例
   * @param options 配置選項
   */
  constructor(options: {
    /** Git 倉庫路徑 */
    repoPath?: string;
    /** GitHub Token（用於 PR 功能） */
    githubToken?: string;
    /** GitHub 倉庫擁有者 */
    owner?: string;
    /** GitHub 倉庫名稱 */
    repo?: string;
  } = {}) {
    this.repoPath = options.repoPath || process.cwd();
    this.githubToken = options.githubToken || process.env.GITHUB_TOKEN;
    this.owner = options.owner || process.env.GITHUB_OWNER;
    this.repo = options.repo || process.env.GITHUB_REPO;
  }

  // ============== Git 命令執行 ==============

  /**
   * 執行 git 命令
   * @param command 命令
   * @returns 執行結果
   */
  private async execGit(command: string): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.repoPath,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      
      if (stderr && !stderr.includes('warning:')) {
        console.warn(`[GitWorktreeService] Git stderr: ${stderr}`);
      }
      
      return stdout.trim();
    } catch (error) {
      const err = error as Error;
      throw new GitWorktreeError(`Git command failed: ${err.message}`, 'EXEC_ERROR');
    }
  }

  // ============== Worktree 列表 ==============

  /**
   * 獲取所有 Worktrees
   * @returns Worktree 資訊陣列
   */
  async listWorktrees(): Promise<WorktreeInfo[]> {
    try {
      // 獲取主倉庫資訊
      const mainBranch = await this.getCurrentBranch();
      const mainStatus = await this.getRepoStatus();
      
      const worktrees: WorktreeInfo[] = [
        {
          path: this.repoPath,
          branch: mainBranch,
          head: await this.getHeadHash(),
          status: mainStatus,
          isMain: true,
        },
      ];

      // 獲取 worktree 列表
      const output = await this.execGit('git worktree list --porcelain');
      
      if (!output) {
        return worktrees;
      }

      // 解析 worktree 輸出
      const entries = output.split('\n\n').filter(Boolean);
      
      for (const entry of entries) {
        const lines = entry.split('\n');
        const worktreeInfo: Partial<WorktreeInfo> = {
          isMain: false,
          status: 'unknown',
        };

        for (const line of lines) {
          if (line.startsWith('path ')) {
            worktreeInfo.path = line.substring(5);
          } else if (line.startsWith('branch ')) {
            worktreeInfo.branch = line.substring(7);
          } else if (line.startsWith('HEAD ')) {
            worktreeInfo.head = line.substring(5);
          } else if (line.startsWith('detached ')) {
            worktreeInfo.branch = line.substring(9);
          }
        }

        if (worktreeInfo.path) {
          worktrees.push(worktreeInfo as WorktreeInfo);
        }
      }

      return worktrees;
    } catch (error) {
      if (error instanceof GitWorktreeError) {
        throw error;
      }
      throw new GitWorktreeError(`Failed to list worktrees: ${(error as Error).message}`, 'LIST_ERROR');
    }
  }

  /**
   * 獲取當前分支
   * @returns 分支名稱
   */
  async getCurrentBranch(): Promise<string> {
    try {
      const output = await this.execGit('git branch --show-current');
      if (!output) {
        // 可能處於 detached HEAD 狀態
        const head = await this.execGit('git rev-parse --short HEAD');
        return `(detached at ${head})`;
      }
      return output;
    } catch {
      return 'unknown';
    }
  }

  /**
   * 獲取 HEAD 提交 hash
   * @returns 短 hash
   */
  async getHeadHash(): Promise<string> {
    try {
      return await this.execGit('git rev-parse --short HEAD');
    } catch {
      return 'unknown';
    }
  }

  /**
   * 獲取倉庫狀態
   * @returns 狀態
   */
  async getRepoStatus(): Promise<'clean' | 'dirty'> {
    try {
      const output = await this.execGit('git status --porcelain');
      return output ? 'dirty' : 'clean';
    } catch {
      return 'unknown';
    }
  }

  // ============== Worktree 創建 ==============

  /**
   * 創建新的 Worktree
   * @param options 選項
   * @returns 創建的 Worktree 資訊
   */
  async createWorktree(options: {
    /** 分支名稱 */
    branch: string;
    /** Worktree 目錄名稱 */
    name?: string;
    /** 是否基於現有分支創建 */
    createBranch?: boolean;
    /** 起始提交（創建分支時使用） */
    startPoint?: string;
  }): Promise<WorktreeInfo> {
    const { branch, name, createBranch = false, startPoint } = options;

    // 驗證分支名稱
    if (!this.isValidBranchName(branch)) {
      throw new GitWorktreeError(`Invalid branch name: ${branch}`, 'INVALID_BRANCH');
    }

    // 計算 worktree 路徑
    const worktreeName = name || branch.replace(/\//g, '-');
    const worktreePath = path.join(this.repoPath, '..', `${path.basename(this.repoPath)}-worktree-${worktreeName}`);

    // 檢查目錄是否已存在
    try {
      await fs.access(worktreePath);
      throw new GitWorktreeError(`Worktree path already exists: ${worktreePath}`, 'PATH_EXISTS');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    try {
      // 構建命令
      let command = `git worktree add`;
      
      if (createBranch) {
        command += ' -b';
        if (startPoint) {
          command += ` ${branch} ${startPoint}`;
        } else {
          command += ` ${branch}`;
        }
      } else {
        command += ` ${worktreePath} ${branch}`;
      }

      await this.execGit(command);

      // 獲取新創建的 worktree 資訊
      const worktrees = await this.listWorktrees();
      const newWorktree = worktrees.find((w) => w.path === worktreePath);

      if (!newWorktree) {
        throw new GitWorktreeError('Failed to get worktree info after creation', 'CREATE_ERROR');
      }

      return newWorktree;
    } catch (error) {
      if (error instanceof GitWorktreeError) {
        throw error;
      }
      throw new GitWorktreeError(`Failed to create worktree: ${(error as Error).message}`, 'CREATE_ERROR');
    }
  }

  /**
   * 驗證分支名稱
   * @param name 分支名稱
   * @returns 是否有效
   */
  private isValidBranchName(name: string): boolean {
    // Git 分支名稱規則
    const invalidPatterns = [
      /^\.|\/\.|\.\.$/, // 不能以 . 開頭或結尾
      /~|\^|:|\?|\[|\*/ , // 不能包含這些字符
      /@\{/, // 不能包含 @{
      /\\/, // 不能包含反斜杠
    ];

    for (const pattern of invalidPatterns) {
      if (pattern.test(name)) {
        return false;
      }
    }

    return true;
  }

  // ============== Worktree 刪除 ==============

  /**
   * 刪除 Worktree
   * @param worktreePath Worktree 路徑
   * @param force 是否強制刪除（忽略未提交的更改）
   */
  async deleteWorktree(worktreePath: string, force = false): Promise<void> {
    // 驗證路徑（防止意外刪除重要目錄）
    const resolvedPath = path.resolve(worktreePath);
    const repoResolvedPath = path.resolve(this.repoPath);
    
    if (resolvedPath === repoResolvedPath) {
      throw new GitWorktreeError('Cannot delete main repository', 'CANNOT_DELETE_MAIN');
    }

    if (!resolvedPath.includes('worktree')) {
      throw new GitWorktreeError('Worktree path must contain "worktree" in name', 'INVALID_PATH');
    }

    try {
      const command = force 
        ? `git worktree remove --force "${worktreePath}"`
        : `git worktree remove "${worktreePath}"`;
      
      await this.execGit(command);
    } catch (error) {
      if (force) {
        throw new GitWorktreeError(`Failed to delete worktree: ${(error as Error).message}`, 'DELETE_ERROR');
      }
      
      // 嘗試強制刪除
      try {
        await this.execGit(`git worktree remove --force "${worktreePath}"`);
      } catch (forceError) {
        throw new GitWorktreeError(`Failed to delete worktree: ${(forceError as Error).message}`, 'DELETE_ERROR');
      }
    }
  }

  // ============== GitHub PR 整合 ==============

  /**
   * 檢查 GitHub 整合是否可用
   * @returns 是否可用
   */
  isGitHubAvailable(): boolean {
    return !!(this.githubToken && this.owner && this.repo);
  }

  /**
   * 建立 Pull Request
   * @param options PR 選項
   * @returns PR 資訊
   */
  async createPullRequest(options: {
    /** 標題 */
    title: string;
    /** 描述 */
    body?: string;
    /** 來源分支 */
    head: string;
    /** 目標分支 */
    base?: string;
  }): Promise<PullRequestInfo> {
    if (!this.isGitHubAvailable()) {
      throw new GitWorktreeError('GitHub integration not configured', 'GITHUB_NOT_CONFIGURED');
    }

    const { title, body, head, base = 'main' } = options;

    // 驗證分支
    if (!this.isValidBranchName(head)) {
      throw new GitWorktreeError(`Invalid branch name: ${head}`, 'INVALID_BRANCH');
    }

    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body,
        head,
        base,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new GitWorktreeError(`Failed to create PR: ${error.message || 'Unknown error'}`, 'PR_CREATE_ERROR');
    }

    const pr = await response.json() as {
      number: number;
      html_url: string;
      title: string;
      body: string | null;
      head: { ref: string };
      base: { ref: string };
      state: string;
      merged: boolean | null;
    };

    return {
      number: pr.number,
      url: pr.html_url,
      title: pr.title,
      body: pr.body || undefined,
      head: pr.head.ref,
      base: pr.base.ref,
      state: pr.merged ? 'merged' : (pr.state as 'open' | 'closed'),
    };
  }

  // ============== Embed 建構 ==============

  /**
   * 構建 Worktree 列表 Embed
   * @param worktrees Worktree 陣列
   * @returns Embed Builder
   */
  static buildWorktreeListEmbed(worktrees: WorktreeInfo[]): EmbedBuilder {
    const fields = worktrees.map((wt) => ({
      name: `${wt.isMain ? '🏠 主倉庫' : '📁'} ${wt.branch}`,
      value: [
        `路徑: \`${wt.path}\``,
        `HEAD: \`${wt.head}\``,
        `狀態: ${wt.status === 'clean' ? '✅ 乾淨' : wt.status === 'dirty' ? '⚠️ 有更改' : '❓ 未知'}`,
      ].join('\n'),
      inline: false,
    }));

    return new EmbedBuilder()
      .setColor(0x8B5CF6) // Primary color
      .setTitle('🌳 Git Worktree 列表')
      .setDescription(`共有 **${worktrees.length}** 個 Worktree`)
      .addFields(...fields)
      .setTimestamp();
  }

  /**
   * 構建單一 Worktree 詳細 Embed
   * @param worktree Worktree 資訊
   * @returns Embed Builder
   */
  static buildWorktreeDetailEmbed(worktree: WorktreeInfo): EmbedBuilder {
    const statusEmoji = worktree.status === 'clean' ? '✅' : worktree.status === 'dirty' ? '⚠️' : '❓';
    
    return new EmbedBuilder()
      .setColor(0x4ADE80) // Success color
      .setTitle(`🌳 Worktree: ${worktree.branch}`)
      .addFields(
        { name: '📂 路徑', value: `\`${worktree.path}\``, inline: false },
        { name: '🌿 分支', value: worktree.branch, inline: true },
        { name: '🔖 HEAD', value: `\`${worktree.head}\``, inline: true },
        { name: '📊 狀態', value: `${statusEmoji} ${worktree.status}`, inline: true },
        { name: '🏷️ 類型', value: worktree.isMain ? '主倉庫' : 'Worktree', inline: true }
      )
      .setTimestamp();
  }

  /**
   * 構建 PR 創建結果 Embed
   * @param pr PR 資訊
   * @returns Embed Builder
   */
  static buildPREmbed(pr: PullRequestInfo): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(0x4ADE80) // Success color
      .setTitle('🚀 Pull Request 已建立')
      .addFields(
        { name: '📝 標題', value: pr.title, inline: false },
        { name: '🔀 來源分支', value: pr.head, inline: true },
        { name: '🎯 目標分支', value: pr.base, inline: true },
        { name: '🔗 PR 連結', value: `[#${pr.number}](${pr.url})`, inline: false }
      )
      .setTimestamp();
  }

  // ============== 按鈕建構 ==============

  /**
   * 構建 Worktree 操作按鈕
   * @param worktreePath Worktree 路徑（用於刪除）
   * @returns ActionRowBuilder
   */
  static buildWorktreeButtons(worktreePath: string): ActionRowBuilder<ButtonBuilder> {
    const deleteButton = new ButtonBuilder()
      .setCustomId(`worktree:delete:${worktreePath}`)
      .setLabel('🗑️ 刪除 Worktree')
      .setStyle(ButtonStyle.Danger);

    const prButton = new ButtonBuilder()
      .setCustomId(`worktree:pr:${worktreePath}`)
      .setLabel('🚀 建立 PR')
      .setStyle(ButtonStyle.Success);

    return new ActionRowBuilder<ButtonBuilder>()
      .addComponents(deleteButton, prButton);
  }

  /**
   * 構建 Worktree 列表操作按鈕
   * @returns ActionRowBuilder
   */
  static buildWorktreeListButtons(): ActionRowBuilder<ButtonBuilder> {
    const refreshButton = new ButtonBuilder()
      .setCustomId('worktree:list:refresh')
      .setLabel('🔄 重新整理')
      .setStyle(ButtonStyle.Secondary);

    const createButton = new ButtonBuilder()
      .setCustomId('worktree:create:start')
      .setLabel('➕ 新建 Worktree')
      .setStyle(ButtonStyle.Primary);

    return new ActionRowBuilder<ButtonBuilder>()
      .addComponents(refreshButton, createButton);
  }
}

// ============== 工廠函數 ==============

/**
 * 建立 GitWorktreeService 工廠函數
 * @param options 配置選項
 * @returns GitWorktreeService 實例
 */
export function createGitWorktreeService(options?: {
  repoPath?: string;
  githubToken?: string;
  owner?: string;
  repo?: string;
}): GitWorktreeService {
  return new GitWorktreeService(options);
}

// ============== 預設導出 ==============

export default {
  GitWorktreeService,
  createGitWorktreeService,
  GitWorktreeError,
};
