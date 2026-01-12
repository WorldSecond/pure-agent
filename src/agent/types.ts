/**
 * Agent 相关类型定义
 */

import type { Message, MessageHistory } from '../types/messages';
import type { StreamEvent, TurnResult } from '../types/chat';
import type { ToolDefinition } from '../types/tools';
import type { LLMProvider } from '../models/types';
import type { StorageProvider } from '../storage/types';

/**
 * Agent 配置
 */
export interface AgentConfig {
  model?: string;
  provider: LLMProvider;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  maxTurns?: number;
  maxTokens?: number;
  temperature?: number;
  storage?: StorageProvider;
  enableStreaming?: boolean;
  [key: string]: unknown; // 允许额外的配置项
}

/**
 * Agent 状态
 */
export type AgentStatus = 'idle' | 'processing' | 'waiting_tool' | 'completed' | 'error';

/**
 * 发送消息选项
 */
export interface SendMessageOptions {
  stream?: boolean;
  signal?: AbortSignal;
  tools?: ToolDefinition[];
  systemPrompt?: string;
}

/**
 * 发送消息结果（非流式）
 */
export interface SendMessageResult {
  content: string;
  messages: MessageHistory;
  turnResult: TurnResult;
}

/**
 * Agent 接口
 */
export interface IAgent {
  /**
   * 发送消息（非流式）
   */
  sendMessage(
    message: string | Message,
    options?: SendMessageOptions,
  ): Promise<SendMessageResult>;

  /**
   * 发送消息（流式）
   */
  sendMessageStream(
    message: string | Message,
    options?: SendMessageOptions,
  ): AsyncGenerator<StreamEvent, SendMessageResult, unknown>;

  /**
   * 获取消息历史
   */
  getHistory(): MessageHistory;

  /**
   * 清除历史
   */
  clearHistory(): void;

  /**
   * 获取当前状态
   */
  getStatus(): AgentStatus;

  /**
   * 获取配置
   */
  getConfig(): AgentConfig;
}

