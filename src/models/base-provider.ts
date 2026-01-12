/**
 * 基础 LLM Provider 实现
 * 提供通用功能：错误处理、重试逻辑等
 */

import type {
  LLMProvider,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  Model,
  ProviderConfig,
} from './types';

/**
 * 基础 Provider 抽象类
 * 子类需要实现具体的 API 调用逻辑
 */
export abstract class BaseProvider implements LLMProvider {
  protected config: ProviderConfig;
  protected defaultModel?: string;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.defaultModel = config.defaultModel || config.model;
  }

  /**
   * 流式聊天调用（必须实现）
   */
  abstract streamChat(request: ChatRequest): AsyncGenerator<StreamChunk, void, unknown>;

  /**
   * 非流式聊天调用（可选实现）
   * 默认实现：将流式响应聚合为非流式响应
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const chunks: StreamChunk[] = [];
    let content = '';
    const toolCalls: Array<{
      name: string;
      args: Record<string, unknown>;
      id?: string;
    }> = [];
    let finishReason: string | undefined;
    let usageMetadata: ChatResponse['usageMetadata'];

    for await (const chunk of this.streamChat(request)) {
      chunks.push(chunk);

      if (chunk.type === 'content' && chunk.content) {
        content += chunk.content;
      }

      if (chunk.type === 'function_call' && chunk.functionCall) {
        toolCalls.push({
          name: chunk.functionCall.name,
          args: chunk.functionCall.args,
          id: chunk.functionCall.id,
        });
      }

      if (chunk.type === 'finished') {
        finishReason = chunk.finishReason as string;
        usageMetadata = chunk.usageMetadata;
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: (finishReason as ChatResponse['finishReason']) || 'stop',
      usageMetadata,
      model: request.model || this.defaultModel,
    };
  }

  /**
   * 获取模型列表（必须实现）
   */
  abstract listModels(): Promise<Model[]>;

  /**
   * 估算 token 数量（可选实现）
   */
  async estimateTokens(content: string | ChatRequest['messages']): Promise<number> {
    // 默认实现：简单字符数估算（1 token ≈ 4 字符）
    const text = typeof content === 'string' 
      ? content 
      : content.map(m => 
          m.parts
            .filter(p => p.type === 'text')
            .map(p => (p as { text: string }).text)
            .join('')
        ).join('');
    return Math.ceil(text.length / 4);
  }

  /**
   * 获取 Provider 名称（必须实现）
   */
  abstract getName(): string;

  /**
   * 获取配置
   */
  getConfig(): ProviderConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ProviderConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.defaultModel || config.model) {
      this.defaultModel = config.defaultModel || config.model;
    }
  }
}

