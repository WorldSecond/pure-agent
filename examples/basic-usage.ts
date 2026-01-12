/**
 * 基本使用示例
 */

import { CustomAdapterProvider, Agent } from '../src';
import { CustomAdapterConfig } from '../src/models/adapters/custom-adapter';

// 示例：对接一个简单的聊天 API
async function basicExample() {
  // 1. 配置你的 API
  const config: CustomAdapterConfig = {
    apiUrl: 'https://your-api.com/v1/chat',
    name: 'my-api',
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY',
    },
    // 转换请求格式
    transformRequest: (request) => {
      return {
        messages: request.messages.map(msg => ({
          role: msg.role,
          content: msg.parts
            .filter(p => p.type === 'text')
            .map(p => (p as { text: string }).text)
            .join(''),
        })),
        system: request.systemPrompt,
        model: request.model || 'default',
      };
    },
    // 转换响应格式
    transformStreamChunk: (data: any) => {
      if (data.content) {
        return {
          type: 'content',
          content: data.content,
        };
      }
      if (data.finish_reason) {
        return {
          type: 'finished',
          finishReason: data.finish_reason,
        };
      }
      return null;
    },
  };

  // 2. 创建 Provider
  const provider = new CustomAdapterProvider(config);

  // 3. 创建 Agent
  const agent = new Agent({
    provider,
    systemPrompt: '你是一个有用的助手',
  });

  // 4. 使用 Agent
  const result = await agent.sendMessage('你好，请介绍一下你自己');
  console.log('响应:', result.content);
  console.log('历史记录:', result.messages);
}

// 运行示例
basicExample().catch(console.error);
