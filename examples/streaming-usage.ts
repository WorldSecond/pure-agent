/**
 * 流式使用示例
 */

import { CustomAdapterProvider, Agent } from '../src';
import { CustomAdapterConfig } from '../src/models/adapters/custom-adapter';

async function streamingExample() {
  const config: CustomAdapterConfig = {
    apiUrl: 'https://your-api.com/v1/chat/stream',
    name: 'streaming-api',
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY',
    },
    transformRequest: (request) => ({
      messages: request.messages,
      stream: true,
    }),
    transformStreamChunk: (data: any) => {
      if (data.chunk) {
        return {
          type: 'content',
          content: data.chunk,
        };
      }
      return null;
    },
  };

  const provider = new CustomAdapterProvider(config);
  const agent = new Agent({ provider });

  // 流式发送消息
  console.log('开始流式响应:');
  const stream = agent.sendMessageStream('写一首关于春天的诗');

  for await (const event of stream) {
    if (event.type === 'content') {
      process.stdout.write(event.value as string);
    }
    if (event.type === 'finished') {
      console.log('\n\n完成');
    }
  }
}

streamingExample().catch(console.error);
