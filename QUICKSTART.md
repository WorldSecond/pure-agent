# 快速开始指南

## 如何对接后台 API

Pure Agent 提供了两种方式对接后台：

### 方式一：使用 CustomAdapterProvider（最简单）

适合快速对接标准 HTTP API，只需配置请求/响应转换函数：

```typescript
import { CustomAdapterProvider, Agent } from 'pure-agent';

// 1. 配置你的 API
const provider = new CustomAdapterProvider({
  // API 地址
  apiUrl: 'https://your-api.com/v1/chat',
  
  // API 名称（可选）
  name: 'my-api',
  
  // 请求头（认证等）
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
  },
  
  // 请求转换：将 Pure Agent 的请求格式转换为你的 API 格式
  transformRequest: (request) => {
    return {
      messages: request.messages.map(msg => ({
        role: msg.role,
        content: msg.parts
          .filter(p => p.type === 'text')
          .map(p => p.text)
          .join(''),
      })),
      system: request.systemPrompt,
      model: request.model || 'default',
    };
  },
  
  // 响应转换：将你的 API 响应格式转换为 Pure Agent 格式
  transformStreamChunk: (data) => {
    if (data.content) {
      return { type: 'content', content: data.content };
    }
    if (data.finish_reason) {
      return { type: 'finished', finishReason: data.finish_reason };
    }
    return null;
  },
});

// 2. 创建 Agent
const agent = new Agent({
  provider,
  systemPrompt: '你是一个有用的助手',
});

// 3. 使用
const result = await agent.sendMessage('你好');
console.log(result.content);
```

### 方式二：实现完整的 LLMProvider 接口

如果需要完全控制，可以继承 `BaseProvider` 并实现接口：

```typescript
import { BaseProvider } from 'pure-agent';
import type { ChatRequest, StreamChunk } from 'pure-agent';

class MyProvider extends BaseProvider {
  async *streamChat(request: ChatRequest) {
    // 调用你的 API
    const response = await fetch('your-api-url', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    
    // 处理流式响应
    // yield { type: 'content', content: '...' };
  }
  
  async listModels() {
    return [{ id: 'model-1', name: 'Model 1', provider: 'my-api' }];
  }
  
  getName() {
    return 'my-api';
  }
}
```

## 常见 API 格式对接示例

### OpenAI 兼容 API

```typescript
const provider = new CustomAdapterProvider({
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  headers: { 'Authorization': 'Bearer YOUR_KEY' },
  transformRequest: (req) => ({
    model: req.model || 'gpt-3.5-turbo',
    messages: req.messages.map(m => ({
      role: m.role,
      content: m.parts.filter(p => p.type === 'text').map(p => p.text).join(''),
    })),
    stream: true,
  }),
  transformStreamChunk: (data) => {
    if (data.choices?.[0]?.delta?.content) {
      return { type: 'content', content: data.choices[0].delta.content };
    }
    if (data.choices?.[0]?.finish_reason) {
      return { type: 'finished', finishReason: data.choices[0].finish_reason };
    }
    return null;
  },
});
```

### 简单 JSON API（非流式）

```typescript
const provider = new CustomAdapterProvider({
  apiUrl: 'https://your-api.com/chat',
  transformRequest: (req) => ({
    messages: req.messages,
    stream: false, // 非流式
  }),
  transformResponse: (data) => {
    // 处理完整响应
    return {
      type: 'content',
      content: data.response,
    };
  },
});
```

## 完整示例

查看 `examples/` 目录：
- `basic-usage.ts` - 基本使用
- `openai-compatible.ts` - OpenAI 兼容 API
- `custom-provider.ts` - 完整自定义实现

## 详细文档

查看 [USAGE.md](./USAGE.md) 获取完整使用文档。
