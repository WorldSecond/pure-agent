/**
 * LLM Provider 相关类型定义
 */

import type { MessageHistory } from '../types/messages';
import type { ToolDefinition } from '../types/tools';
import type { FinishReason, UsageMetadata } from '../types/chat';

/**
 * 模型信息
 */
export interface Model {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  supportsStreaming?: boolean;
  supportsFunctionCalling?: boolean;
}

/**
 * 聊天请求
 */
export interface ChatRequest {
  messages: MessageHistory;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  stream?: boolean;
  signal?: AbortSignal;
}

/**
 * 聊天响应
 */
export interface ChatResponse {
  content: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    id?: string;
  }>;
  finishReason: FinishReason;
  usageMetadata?: UsageMetadata;
  model?: string;
}

/**
 * 流式响应块
 */
export interface StreamChunk {
  type: 'content' | 'function_call' | 'function_response' | 'thought' | 'finished' | 'error';
  content?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
    id?: string;
  };
  finishReason?: FinishReason;
  usageMetadata?: UsageMetadata;
  error?: {
    message: string;
    code?: string;
  };
}

/**
 * LLM Provider 接口
 */
export interface LLMProvider {
  /**
   * 流式聊天调用
   */
  streamChat(request: ChatRequest): AsyncGenerator<StreamChunk, void, unknown>;

  /**
   * 非流式聊天调用（可选）
   */
  chat?(request: ChatRequest): Promise<ChatResponse>;

  /**
   * 获取模型列表
   */
  listModels(): Promise<Model[]>;

  /**
   * 估算 token 数量（可选）
   */
  estimateTokens?(content: string | MessageHistory): Promise<number>;

  /**
   * 获取 Provider 名称
   */
  getName(): string;
}

/**
 * Provider 配置
 */
export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  defaultModel?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  [key: string]: unknown; // 允许额外的配置项
}

/**
 * Provider 适配器接口
 */
export interface ProviderAdapter {
  /**
   * 转换请求格式
   */
  transformRequest(request: ChatRequest): unknown;

  /**
   * 转换响应格式
   */
  transformResponse(response: unknown): ChatResponse;

  /**
   * 转换流式响应格式
   */
  transformStreamChunk(chunk: unknown): StreamChunk | null;

  /**
   * 验证配置
   */
  validateConfig(config: ProviderConfig): boolean;
}

