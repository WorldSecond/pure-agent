# Agent Lite

一个轻量级 AI Agent 框架，专注于核心 Agent 能力，不包含 UI、文件系统等额外内容，可在任意 JavaScript 环境中使用。

## 特性

### 核心能力

- **Agent** - 核心 Agent 实现，支持自主决策和任务执行
- **SubAgent** - 子 Agent 支持，实现 Agent 间的协作和任务分解
- **Tools** - 工具系统
  - 本地工具支持
  - 工具注册和执行管理
- **流式处理** - 支持流式和非流式响应
- **会话管理** - 支持上下文存储和会话恢复

### 可扩展能力

- **模型配置** - 灵活的模型配置和管理
- **自定义后台** - 支持对接任意后台 API
- **上下文存储** - 可扩展的存储机制（内存/文件/数据库）

## 快速开始

### 安装

```bash
npm install agent-lite
```

### 基本使用

```typescript
import { CustomAdapterProvider, Agent } from 'agent-lite';

// 1. 配置你的 API
const provider = new CustomAdapterProvider({
  apiUrl: 'https://your-api.com/v1/chat',
  name: 'my-api',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
  },
  transformRequest: (request) => ({
    messages: request.messages,
    model: request.model || 'default',
  }),
  transformStreamChunk: (data) => {
    if (data.content) {
      return { type: 'content', content: data.content };
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

## 对接后台 API

Agent Lite 支持对接任意后台 API，有两种方式：

### 方式一：使用 CustomAdapterProvider（推荐）

适合快速对接标准 HTTP API：

```typescript
import { CustomAdapterProvider } from 'agent-lite';

const provider = new CustomAdapterProvider({
  apiUrl: 'https://your-api.com/v1/chat',
  headers: { 'Authorization': 'Bearer YOUR_KEY' },
  transformRequest: (request) => {
    // 转换请求格式
    return {
      messages: request.messages,
      system: request.systemPrompt,
    };
  },
  transformStreamChunk: (data) => {
    // 转换响应格式
    if (data.content) {
      return { type: 'content', content: data.content };
    }
    return null;
  },
});
```

### 方式二：实现 LLMProvider 接口

适合需要完全控制的场景：

```typescript
import { BaseProvider } from 'agent-lite';
import type { LLMProvider, ChatRequest, StreamChunk } from 'agent-lite';

class MyProvider extends BaseProvider implements LLMProvider {
  async *streamChat(request: ChatRequest) {
    // 你的 API 调用逻辑
    const response = await fetch('your-api', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    // 处理流式响应
    // ...
  }
  
  async listModels() {
    return [{ id: 'model-1', name: 'Model 1', provider: 'my-api' }];
  }
  
  getName() {
    return 'my-api';
  }
}
```

## 使用子 Agent

通过 `task` 工具创建子 Agent：

```typescript
import { Agent, createTaskTool } from 'agent-lite';

const agent = new Agent({ provider });

// 注册 task 工具
const taskTool = createTaskTool(agent);
agent.registerTool(taskTool);

// Agent 可以调用 task 工具创建子 Agent
await agent.sendMessage(
  '请使用 task 工具创建一个子 Agent 来分析数据'
);
```

## 文档

- [使用指南](./USAGE.md) - 详细的使用文档和示例
- [API 参考](./docs/api-reference.md) - 完整的 API 文档
- [架构文档](./architecture.md) - 架构设计说明

## 示例

查看 `examples/` 目录获取更多示例：

- `basic-usage.ts` - 基本使用示例
- `streaming-usage.ts` - 流式使用示例
- `subagent-usage.ts` - 子 Agent 使用示例
- `openai-compatible.ts` - OpenAI 兼容 API 示例
- `custom-provider.ts` - 自定义 Provider 完整实现

## 项目结构

```
src/
├── agent/          # Agent 核心
├── models/         # LLM Provider
├── storage/        # 上下文存储
├── tools/          # 工具系统
├── subagent/       # 子 Agent 系统
├── config/         # 配置系统
└── types/          # 类型定义
```

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 测试
npm test

# Lint
npm run lint
```

## 许可证

MIT License
