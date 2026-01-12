/**
 * OpenAI 兼容 API 示例
 */

import { CustomAdapterProvider, Agent } from '../src';
import { CustomAdapterConfig } from '../src/models/adapters/custom-adapter';

async function openAICompatibleExample() {
  const config: CustomAdapterConfig = {
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    name: 'openai',
    headers: {
      'Authorization': 'Bearer YOUR_OPENAI_API_KEY',
    },
    transformRequest: (request) => {
      return {
        model: request.model || 'gpt-3.5-turbo',
        messages: request.messages.map(msg => ({
          role: msg.role,
          content: msg.parts
            .filter(p => p.type === 'text')
            .map(p => (p as { text: string }).text)
            .join(''),
        })),
        stream: request.stream !== false,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
      };
    },
    transformStreamChunk: (data: any) => {
      // OpenAI 流式响应格式
      if (data.choices?.[0]?.delta?.content) {
        return {
          type: 'content',
          content: data.choices[0].delta.content,
        };
      }
      if (data.choices?.[0]?.finish_reason) {
        return {
          type: 'finished',
          finishReason: data.choices[0].finish_reason,
          usageMetadata: data.usage,
        };
      }
      return null;
    },
  };

  const provider = new CustomAdapterProvider(config);
  const agent = new Agent({
    provider,
    systemPrompt: '你是一个有用的助手',
  });

  // 使用
  const result = await agent.sendMessage('Hello!');
  console.log(result.content);
}

openAICompatibleExample().catch(console.error);
