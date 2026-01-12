/**
 * 聊天会话相关类型定义
 */

import type { Message, MessageHistory } from './messages';

/**
 * 聊天会话状态
 */
export type ChatStatus = 'idle' | 'processing' | 'waiting_tool' | 'completed' | 'error';

/**
 * 聊天会话配置
 */
export interface ChatConfig {
  systemPrompt?: string;
  maxHistoryLength?: number;
  enableHistoryCompression?: boolean;
  compressionThreshold?: number;
}

/**
 * 聊天会话数据
 */
export interface ChatSession {
  id: string;
  history: MessageHistory;
  status: ChatStatus;
  config: ChatConfig;
  createdAt: number;
  updatedAt: number;
}

/**
 * 流式响应事件类型
 */
export enum StreamEventType {
  CONTENT = 'content',
  FUNCTION_CALL = 'function_call',
  FUNCTION_RESPONSE = 'function_response',
  THOUGHT = 'thought',
  FINISHED = 'finished',
  ERROR = 'error',
  RETRY = 'retry',
}

/**
 * 流式响应事件
 */
export interface StreamEvent {
  type: StreamEventType;
  value?: unknown;
  traceId?: string;
}

/**
 * 内容事件
 */
export interface ContentEvent extends StreamEvent {
  type: StreamEventType.CONTENT;
  value: string;
}

/**
 * 函数调用事件
 */
export interface FunctionCallEvent extends StreamEvent {
  type: StreamEventType.FUNCTION_CALL;
  value: {
    name: string;
    args: Record<string, unknown>;
    id?: string;
  };
}

/**
 * 完成事件
 */
export interface FinishedEvent extends StreamEvent {
  type: StreamEventType.FINISHED;
  value: {
    reason: FinishReason;
    usageMetadata?: UsageMetadata;
  };
}

/**
 * 完成原因
 */
export enum FinishReason {
  STOP = 'stop',
  LENGTH = 'length',
  TOOL_CALLS = 'tool_calls',
  ERROR = 'error',
  CANCELLED = 'cancelled',
}

/**
 * Token 使用元数据
 */
export interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

/**
 * 轮次结果
 */
export interface TurnResult {
  messages: Message[];
  finishReason?: FinishReason;
  usageMetadata?: UsageMetadata;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    id?: string;
  }>;
}

