/**
 * 自定义 API 适配器
 * 支持自定义 HTTP API，可配置请求/响应转换
 */

import { BaseProvider } from '../base-provider';
import type {
  ChatRequest,
  StreamChunk,
  Model,
  ProviderConfig,
  ProviderAdapter,
} from '../types';
import { FinishReason } from '../../types/chat';

/**
 * 自定义适配器配置
 */
export interface CustomAdapterConfig extends ProviderConfig {
  /**
   * API 端点 URL
   */
  apiUrl: string;

  /**
   * Provider 名称
   */
  name?: string;

  /**
   * 模型列表
   */
  models?: Model[];

  /**
   * HTTP 方法（默认 POST）
   */
  method?: 'GET' | 'POST' | 'PUT';

  /**
   * 请求头
   */
  headers?: Record<string, string>;

  /**
   * 请求转换函数
   */
  transformRequest?: (request: ChatRequest) => unknown;

  /**
   * 响应转换函数
   */
  transformResponse?: (response: unknown) => StreamChunk | null;

  /**
   * 流式响应块转换函数
   */
  transformStreamChunk?: (chunk: unknown) => StreamChunk | null;

  /**
   * 流式响应处理函数
   */
  handleStream?: (response: Response) => AsyncGenerator<StreamChunk, void, unknown>;
}

/**
 * 自定义 API Provider
 */
export class CustomAdapterProvider extends BaseProvider {
  private adapterConfig: CustomAdapterConfig;
  private adapter?: ProviderAdapter;

  constructor(config: CustomAdapterConfig) {
    super(config);
    this.adapterConfig = config;
  }

  /**
   * 设置适配器
   */
  setAdapter(adapter: ProviderAdapter): void {
    this.adapter = adapter;
  }

  /**
   * 流式聊天调用
   */
  async *streamChat(request: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> {
    const { apiUrl, method = 'POST', headers = {} } = this.adapterConfig;

    // 转换请求
    const requestBody = this.adapterConfig.transformRequest
      ? this.adapterConfig.transformRequest(request)
      : this.adapter?.transformRequest
      ? this.adapter.transformRequest(request)
      : this.defaultTransformRequest(request);

    // 发送请求
    const response = await fetch(apiUrl, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(requestBody),
      signal: request.signal,
    });

    if (!response.ok) {
      let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.text();
        if (errorData) {
          errorMessage += `\nResponse body: ${errorData}`;
        }
      } catch (e) {
        // 忽略解析错误
      }
      throw new Error(errorMessage);
    }

    // 处理流式响应
    if (this.adapterConfig.handleStream) {
      yield* this.adapterConfig.handleStream(response);
    } else if (response.body) {
      yield* this.defaultHandleStream(response);
    } else {
      // 非流式响应
      const data = await response.json();
      const chunk = this.adapterConfig.transformStreamChunk
        ? this.adapterConfig.transformStreamChunk(data)
        : this.adapter?.transformStreamChunk
        ? this.adapter.transformStreamChunk(data)
        : this.defaultTransformChunk(data);
      
      if (chunk) {
        yield chunk;
      }
    }
  }

  /**
   * 获取模型列表
   */
  async listModels(): Promise<Model[]> {
    // 如果配置了模型列表，直接返回
    if (this.adapterConfig.models) {
      return this.adapterConfig.models;
    }

    // 否则返回默认模型
    const modelName = String(this.adapterConfig.model || 'custom');
    return [
      {
        id: modelName,
        name: modelName,
        provider: this.getName(),
      },
    ];
  }

  /**
   * 获取 Provider 名称
   */
  getName(): string {
    return String(this.adapterConfig.name || 'custom');
  }

  /**
   * 默认请求转换
   */
  private defaultTransformRequest(request: ChatRequest): unknown {
    return {
      messages: request.messages,
      systemPrompt: request.systemPrompt,
      tools: request.tools,
      model: request.model || this.defaultModel,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      stream: request.stream !== false,
    };
  }

  /**
   * 默认流式响应处理
   */
  private async *defaultHandleStream(response: Response): AsyncGenerator<StreamChunk, void, unknown> {
    const reader = response.body?.getReader();
    if (!reader) {
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              yield {
                type: 'finished',
                finishReason: FinishReason.STOP,
              } as StreamChunk;
              return;
            }

            try {
              const json = JSON.parse(data);
              const chunk = this.adapterConfig.transformStreamChunk
                ? this.adapterConfig.transformStreamChunk(json)
                : this.adapter?.transformStreamChunk
                ? this.adapter.transformStreamChunk(json)
                : this.defaultTransformChunk(json);
              
              if (chunk) {
                yield chunk;
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 默认响应转换
   */
  private defaultTransformChunk(data: unknown): StreamChunk | null {
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      
      if (obj.content) {
        return {
          type: 'content',
          content: String(obj.content),
        };
      }

      if (obj.finishReason) {
        return {
          type: 'finished',
          finishReason: String(obj.finishReason) as FinishReason,
          usageMetadata: obj.usageMetadata as StreamChunk['usageMetadata'],
        };
      }
    }

    return null;
  }
}
