/**
 * 上下文构建器
 * 抽象化系统提示词构建，移除 Gemini 特定内容
 */

import type { MessageHistory } from '../types/messages';
import type { ToolDefinition } from '../types/tools';
import type { ChatConfig } from '../types/chat';

/**
 * 上下文构建器类
 */
export class ContextBuilder {
  /**
   * 构建系统提示词
   */
  buildSystemPrompt(
    basePrompt?: string,
    tools?: ToolDefinition[],
    userMemory?: string,
  ): string {
    const parts: string[] = [];

    // 基础提示词
    if (basePrompt) {
      parts.push(basePrompt);
    }

    // 用户内存
    if (userMemory) {
      parts.push('\n## User Memory\n');
      parts.push(userMemory);
    }

    // 工具定义
    if (tools && tools.length > 0) {
      parts.push('\n## Available Tools\n');
      parts.push('You have access to the following tools:');
      for (const tool of tools) {
        parts.push(`\n### ${tool.name}`);
        parts.push(tool.description || '');
        parts.push('\nParameters:');
        parts.push(JSON.stringify(tool.parameters, null, 2));
      }
      parts.push(
        '\n\nWhen you need to use a tool, call it with the appropriate parameters.',
      );
    }

    return parts.join('\n');
  }

  /**
   * 构建环境上下文
   */
  buildEnvironmentContext(): string {
    const parts: string[] = [];

    // 日期信息
    const now = new Date();
    parts.push(`Current date: ${now.toLocaleDateString()}`);
    parts.push(`Current time: ${now.toLocaleTimeString()}`);

    // 操作系统信息
    if (typeof process !== 'undefined' && process.platform) {
      parts.push(`Platform: ${process.platform}`);
    }

    // 工作目录
    if (typeof process !== 'undefined' && process.cwd) {
      parts.push(`Working directory: ${process.cwd()}`);
    }

    return parts.join('\n');
  }

  /**
   * 构建初始历史记录
   */
  buildInitialHistory(
    _config?: ChatConfig,
    extraHistory?: MessageHistory,
  ): MessageHistory {
    const history: MessageHistory = [];

    // 添加环境上下文
    const envContext = this.buildEnvironmentContext();
    if (envContext) {
      history.push({
        role: 'system',
        parts: [{ type: 'text', text: envContext }],
        timestamp: Date.now(),
      });
    }

    // 添加额外历史
    if (extraHistory) {
      history.push(...extraHistory);
    }

    return history;
  }

  /**
   * 构建完整的聊天请求
   */
  buildChatRequest(
    messages: MessageHistory,
    systemPrompt?: string,
    tools?: ToolDefinition[],
    userMemory?: string,
  ): {
    messages: MessageHistory;
    systemPrompt?: string;
  } {
    const finalSystemPrompt = this.buildSystemPrompt(
      systemPrompt,
      tools,
      userMemory,
    );

    return {
      messages,
      systemPrompt: finalSystemPrompt || undefined,
    };
  }
}

