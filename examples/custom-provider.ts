/**
 * 自定义 Provider 完整实现示例
 */

import { BaseProvider, Agent } from '../src';
import type {
  LLMProvider,
  ChatRequest,
  StreamChunk,
  Model,
  ProviderConfig,
} from '../src';
import { FinishReason } from '../src/types/chat';

/**
 * 自定义 Provider 实现
 */
class MyCustomProvider extends BaseProvider implements LLMProvider {
  private apiKey: string;
  private baseURL: string;

  constructor(config: ProviderConfig & { apiKey: string; baseURL: string }) {
    super(config);
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
  }

  async *streamChat(
    request: ChatRequest,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    // 构建请求 URL
    const url = `${this.baseURL}/v1/chat`;

    // 转换消息格式
    const messages = request.messages.map((msg) => ({
      role: msg.role,
      content: msg.parts
        .filter((p) => p.type === 'text')
        .map((p) => (p as { text: string }).text)
        .join(''),
    }));

    // 发送请求
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        messages,
        system_prompt: request.systemPrompt,
        model: request.model || this.defaultModel,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: request.stream !== false,
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `API request failed: ${response.status} ${error.message || response.statusText}`,
      );
    }

    // 处理流式响应
    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
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

          // 处理 Server-Sent Events 格式
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();

            if (data === '[DONE]') {
              yield {
                type: 'finished',
                finishReason: FinishReason.STOP,
              };
              return;
            }

            try {
              const json = JSON.parse(data);

              // 根据你的 API 响应格式转换
              if (json.content) {
                yield {
                  type: 'content',
                  content: json.content,
                };
              }

              if (json.finish_reason) {
                yield {
                  type: 'finished',
                  finishReason: json.finish_reason as FinishReason,
                  usageMetadata: json.usage,
                };
                return;
              }
            } catch (e) {
              // 忽略解析错误，继续处理下一行
              console.warn('Failed to parse JSON:', e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<Model[]> {
    // 调用你的 API 获取模型列表
    const response = await fetch(`${this.baseURL}/v1/models`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      return [
        {
          id: 'default',
          name: 'Default Model',
          provider: this.getName(),
        },
      ];
    }

    const data = await response.json();
    return data.models.map((model: any) => ({
      id: model.id,
      name: model.name,
      provider: this.getName(),
      contextWindow: model.context_window,
    }));
  }

  getName(): string {
    return 'my-custom-provider';
  }
}

// 使用示例
async function example() {
  const provider = new MyCustomProvider({
    apiKey: 'YOUR_API_KEY',
    baseURL: 'https://your-api.com',
    defaultModel: 'model-1',
  });

  const agent = new Agent({
    provider,
    systemPrompt: '你是一个有用的助手',
  });

  const result = await agent.sendMessage('你好');
  console.log(result.content);
}

example().catch(console.error);
