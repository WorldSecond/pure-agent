# Agent Lite 使用指南

## 快速开始

### 1. 安装依赖

```bash
npm install agent-lite
```

### 2. 创建自定义后台适配器

Agent Lite 支持对接任意后台 API，你需要创建一个适配器来实现 `LLMProvider` 接口。

#### 方式一：使用 CustomAdapterProvider（推荐）

`CustomAdapterProvider` 提供了灵活的配置选项，可以快速对接自定义 API：

```typescript
import { CustomAdapterProvider, Agent } from 'agent-lite';
import type { CustomAdapterConfig } from 'agent-lite';

// 配置你的 API
const config: CustomAdapterConfig = {
  apiUrl: 'https://your-api.com/v1/chat',
  name: 'my-custom-api',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
  },
  // 可选：自定义请求转换
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
  // 可选：自定义响应转换
  transformStreamChunk: (data) => {
    // 将你的 API 响应格式转换为 StreamChunk
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

// 创建 Provider
const provider = new CustomAdapterProvider(config);

// 创建 Agent
const agent = new Agent({
  provider,
  systemPrompt: '你是一个有用的助手',
});
```

#### 方式二：实现完整的 LLMProvider 接口

如果你需要更多控制，可以直接实现 `LLMProvider` 接口：

```typescript
import { BaseProvider } from 'agent-lite';
import type {
  LLMProvider,
  ChatRequest,
  StreamChunk,
  Model,
  ProviderConfig,
} from 'agent-lite';

class MyCustomProvider extends BaseProvider implements LLMProvider {
  constructor(config: ProviderConfig) {
    super(config);
  }

  async *streamChat(request: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> {
    // 调用你的 API
    const response = await fetch('https://your-api.com/v1/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        messages: request.messages,
        system_prompt: request.systemPrompt,
        model: request.model,
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    // 处理流式响应
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
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
          if (line.trim() === '' || !line.startsWith('data: ')) continue;
          
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield {
              type: 'finished',
              finishReason: 'stop',
            };
            return;
          }

          try {
            const json = JSON.parse(data);
            // 转换为你 API 的响应格式
            yield {
              type: 'content',
              content: json.content || '',
            };
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<Model[]> {
    // 返回你的 API 支持的模型列表
    return [
      {
        id: 'model-1',
        name: 'Model 1',
        provider: 'my-custom-api',
      },
    ];
  }

  getName(): string {
    return 'my-custom-api';
  }
}

// 使用
const provider = new MyCustomProvider({
  apiKey: 'YOUR_API_KEY',
  baseURL: 'https://your-api.com',
});

const agent = new Agent({
  provider,
});
```

### 3. 使用 Agent

#### 基本使用（非流式）

```typescript
import { Agent } from 'agent-lite';

const agent = new Agent({
  provider: myProvider,
  systemPrompt: '你是一个有用的助手',
});

// 发送消息
const result = await agent.sendMessage('你好，请介绍一下你自己');

console.log(result.content); // 响应内容
console.log(result.messages); // 完整的历史记录
```

#### 流式使用

```typescript
// 流式发送消息
const stream = agent.sendMessageStream('写一首关于春天的诗');

for await (const event of stream) {
  if (event.type === 'content') {
    process.stdout.write(event.value as string); // 实时输出
  }
  if (event.type === 'finished') {
    console.log('\n完成');
  }
}
```

### 4. 使用工具

```typescript
import { Agent, ToolRegistryImpl } from 'agent-lite';
import type { Tool } from 'agent-lite';

// 定义工具
const myTool: Tool = {
  definition: {
    name: 'get_weather',
    description: '获取天气信息',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: '城市名称',
        },
      },
      required: ['city'],
    },
  },
  execute: async (args) => {
    const { city } = args;
    // 调用天气 API
    const weather = await fetch(`https://api.weather.com/${city}`);
    return {
      success: true,
      result: await weather.json(),
    };
  },
};

// 注册工具
const agent = new Agent({
  provider: myProvider,
});

agent.registerTool(myTool);

// Agent 现在可以使用这个工具了
const result = await agent.sendMessage('北京今天天气怎么样？');
```

### 5. 使用子 Agent（Task 工具）

子 Agent 功能允许主 Agent 创建独立的子 Agent 来处理特定任务：

```typescript
import { Agent, createTaskTool } from 'agent-lite';

const agent = new Agent({
  provider: myProvider,
});

// 注册 task 工具（自动启用子 Agent 功能）
const taskTool = createTaskTool(agent);
agent.registerTool(taskTool);

// 主 Agent 可以调用 task 工具创建子 Agent
const result = await agent.sendMessage(
  '请使用 task 工具创建一个子 Agent 来分析用户数据'
);

// 在响应中，Agent 会自动调用 task 工具
// task 工具的参数示例：
// {
//   task: '分析用户数据并生成报告',
//   allowedTools: ['read_file', 'analyze_data'],  // 子 Agent 只能使用这些工具
//   systemPrompt: '你是一个数据分析专家...',      // 自定义系统提示词
//   model: 'gpt-4'  // 可选：使用不同的模型
// }
```

### 6. 会话存储和恢复

```typescript
import { Agent, MemoryStorage } from 'agent-lite';

const storage = new MemoryStorage();

const agent = new Agent({
  provider: myProvider,
  storage, // 启用存储
});

// Agent 会自动保存会话
await agent.sendMessage('你好');

// 恢复会话（Agent 会自动从存储中恢复）
const sessionId = agent.getConfig().storage?.restoreSession?.(sessionId);
```

## 完整示例

### 示例 1：对接 OpenAI 兼容 API

```typescript
import { CustomAdapterProvider, Agent } from 'agent-lite';
import type { CustomAdapterConfig } from 'agent-lite';

const config: CustomAdapterConfig = {
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  name: 'openai-compatible',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
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
  transformStreamChunk: (data) => {
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
const agent = new Agent({ provider });

const result = await agent.sendMessage('Hello!');
console.log(result.content);
```

### 示例 2：对接 Anthropic 兼容 API

```typescript
const anthropicConfig: CustomAdapterConfig = {
  apiUrl: 'https://api.anthropic.com/v1/messages',
  name: 'anthropic-compatible',
  headers: {
    'x-api-key': 'YOUR_API_KEY',
    'anthropic-version': '2023-06-01',
  },
  transformRequest: (request) => {
    return {
      model: request.model || 'claude-3-sonnet-20240229',
      messages: request.messages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.parts
          .filter(p => p.type === 'text')
          .map(p => (p as { text: string }).text)
          .join(''),
      })),
      system: request.systemPrompt,
      max_tokens: request.maxTokens || 1024,
      stream: request.stream !== false,
    };
  },
  transformStreamChunk: (data) => {
    if (data.type === 'content_block_delta' && data.delta?.text) {
      return {
        type: 'content',
        content: data.delta.text,
      };
    }
    if (data.type === 'message_stop') {
      return {
        type: 'finished',
        finishReason: 'stop',
      };
    }
    return null;
  },
};

const anthropicProvider = new CustomAdapterProvider(anthropicConfig);
const agent = new Agent({ provider: anthropicProvider });
```

### 示例 3：对接本地模型（Ollama）

```typescript
const ollamaConfig: CustomAdapterConfig = {
  apiUrl: 'http://localhost:11434/api/chat',
  name: 'ollama',
  transformRequest: (request) => {
    return {
      model: request.model || 'llama2',
      messages: request.messages.map(msg => ({
        role: msg.role,
        content: msg.parts
          .filter(p => p.type === 'text')
          .map(p => (p as { text: string }).text)
          .join(''),
      })),
      stream: true,
    };
  },
  transformStreamChunk: (data) => {
    if (data.message?.content) {
      return {
        type: 'content',
        content: data.message.content,
      };
    }
    if (data.done) {
      return {
        type: 'finished',
        finishReason: 'stop',
      };
    }
    return null;
  },
};

const ollamaProvider = new CustomAdapterProvider(ollamaConfig);
const agent = new Agent({ provider: ollamaProvider });
```

## API 参考

### Agent 类

```typescript
class Agent {
  constructor(config: AgentConfig);
  
  // 发送消息（非流式）
  sendMessage(
    message: string | Message,
    options?: SendMessageOptions
  ): Promise<SendMessageResult>;
  
  // 发送消息（流式）
  sendMessageStream(
    message: string | Message,
    options?: SendMessageOptions
  ): AsyncGenerator<StreamEvent, SendMessageResult>;
  
  // 获取历史记录
  getHistory(): MessageHistory;
  
  // 清除历史
  clearHistory(): void;
  
  // 获取状态
  getStatus(): AgentStatus;
  
  // 注册工具
  registerTool(tool: Tool): void;
  
  // 获取工具注册表
  getToolRegistry(): ToolRegistry;
}
```

### CustomAdapterProvider

```typescript
class CustomAdapterProvider extends BaseProvider {
  constructor(config: CustomAdapterConfig);
  
  // 设置适配器（可选）
  setAdapter(adapter: ProviderAdapter): void;
}
```

## 常见问题

### Q: 如何对接不支持流式的 API？

A: 在 `transformRequest` 中设置 `stream: false`，然后在 `transformResponse` 中处理非流式响应：

```typescript
transformRequest: (request) => ({
  ...request,
  stream: false, // 禁用流式
}),

transformResponse: (response) => {
  // 处理完整的响应
  return {
    type: 'content',
    content: response.content,
  };
},
```

### Q: 如何处理 API 的错误响应？

A: 在 `streamChat` 方法中检查响应状态：

```typescript
if (!response.ok) {
  throw new Error(`API error: ${response.status} ${response.statusText}`);
}
```

### Q: 如何实现自定义的流式响应处理？

A: 使用 `handleStream` 配置项：

```typescript
handleStream: async function* (response) {
  // 自定义流式处理逻辑
  const reader = response.body?.getReader();
  // ... 你的处理逻辑
  yield { type: 'content', content: '...' };
},
```

### Q: 子 Agent 如何访问父 Agent 的工具？

A: 子 Agent 默认继承父 Agent 的工具，但可以通过 `allowedTools` 限制：

```typescript
{
  task: '分析数据',
  allowedTools: ['read_file', 'analyze'], // 只允许这些工具
}
```

## 更多示例

查看 `examples/` 目录获取更多完整示例。
