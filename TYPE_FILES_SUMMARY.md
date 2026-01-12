# 类型文件总结

本文档列出了所有已创建的类型接口文件及其主要内容。

## 文件结构

```
src/
├── types/                    # 通用类型定义
│   ├── messages.ts          # 消息相关类型
│   ├── chat.ts             # 聊天会话相关类型
│   ├── tools.ts             # 工具相关类型
│   └── index.ts             # 统一导出
├── models/
│   └── types.ts             # LLM Provider 类型
├── storage/
│   └── types.ts             # 存储 Provider 类型
├── agent/
│   └── types.ts             # Agent 类型
├── subagent/
│   └── types.ts             # SubAgent 类型
└── config/
    └── types.ts             # 配置类型
```

## 类型文件详情

### 1. `src/types/messages.ts` - 消息类型

**主要类型：**
- `MessageRole`: 消息角色（'user' | 'assistant' | 'system' | 'tool'）
- `MessagePart`: 消息部分（文本、函数调用、函数响应）
- `Message`: 基础消息接口
- `UserMessage`, `AssistantMessage`, `ToolMessage`, `SystemMessage`: 具体消息类型
- `MessageHistory`: 消息历史数组

### 2. `src/types/chat.ts` - 聊天会话类型

**主要类型：**
- `ChatStatus`: 会话状态
- `ChatConfig`: 会话配置
- `ChatSession`: 会话数据
- `StreamEventType`: 流式事件类型枚举
- `StreamEvent`: 流式事件接口
- `FinishReason`: 完成原因枚举
- `UsageMetadata`: Token 使用元数据
- `TurnResult`: 轮次结果

### 3. `src/types/tools.ts` - 工具类型

**主要类型：**
- `ToolParameterSchema`: 工具参数定义（JSON Schema）
- `ToolDefinition`: 工具定义（FunctionDeclaration）
- `ToolCall`: 工具调用请求
- `ToolResult`: 工具执行结果
- `ToolErrorType`: 工具错误类型枚举
- `ToolExecutionContext`: 工具执行上下文
- `Tool`: 工具实现接口
- `ToolRegistry`: 工具注册表接口

### 4. `src/models/types.ts` - LLM Provider 类型

**主要类型：**
- `Model`: 模型信息
- `ChatRequest`: 聊天请求
- `ChatResponse`: 聊天响应
- `StreamChunk`: 流式响应块
- `LLMProvider`: LLM Provider 接口
- `ProviderConfig`: Provider 配置
- `ProviderAdapter`: Provider 适配器接口

### 5. `src/storage/types.ts` - 存储类型

**主要类型：**
- `SessionData`: 会话数据
- `StorageProvider`: 存储 Provider 接口
- `StorageConfig`: 存储配置

### 6. `src/agent/types.ts` - Agent 类型

**主要类型：**
- `AgentConfig`: Agent 配置
- `AgentStatus`: Agent 状态
- `SendMessageOptions`: 发送消息选项
- `SendMessageResult`: 发送消息结果（非流式）
- `IAgent`: Agent 接口

### 7. `src/subagent/types.ts` - SubAgent 类型

**主要类型：**
- `SubAgentConfig`: SubAgent 配置（继承自 AgentConfig）
- `TaskToolParameters`: Task 工具参数
- `TaskToolResult`: Task 工具结果
- `ISubAgent`: SubAgent 接口
- `SubAgentManager`: SubAgent 管理器接口

### 8. `src/config/types.ts` - 配置类型

**主要类型：**
- `AppConfig`: 应用配置
- `ConfigManager`: 配置管理器接口

## 关键接口说明

### LLMProvider 接口

```typescript
interface LLMProvider {
  streamChat(request: ChatRequest): AsyncGenerator<StreamChunk>;
  chat?(request: ChatRequest): Promise<ChatResponse>;
  listModels(): Promise<Model[]>;
  estimateTokens?(content: string | MessageHistory): Promise<number>;
  getName(): string;
}
```

### StorageProvider 接口

```typescript
interface StorageProvider {
  saveSession(id: string, session: SessionData): Promise<void>;
  restoreSession(id: string): Promise<SessionData | null>;
  deleteSession(id: string): Promise<void>;
  listSessions?(): Promise<string[]>;
  hasSession?(id: string): Promise<boolean>;
}
```

### IAgent 接口

```typescript
interface IAgent {
  sendMessage(message: string | Message, options?: SendMessageOptions): Promise<SendMessageResult>;
  sendMessageStream(message: string | Message, options?: SendMessageOptions): AsyncGenerator<StreamEvent>;
  getHistory(): MessageHistory;
  clearHistory(): void;
  getStatus(): AgentStatus;
  getConfig(): AgentConfig;
}
```

### Tool 接口

```typescript
interface Tool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> | ToolResult;
}
```

### Task 工具参数

```typescript
interface TaskToolParameters {
  task: string;                    // 任务描述
  allowedTools?: string[];          // 允许使用的工具列表
  systemPrompt?: string;            // 自定义系统提示词
  model?: string;                   // 使用的模型
  maxTurns?: number;                // 最大轮次
  timeout?: number;                 // 超时时间（毫秒）
}
```

## 类型关系图

```
Message (消息)
  ├─ UserMessage
  ├─ AssistantMessage
  ├─ ToolMessage
  └─ SystemMessage

ChatRequest (聊天请求)
  ├─ messages: MessageHistory
  ├─ systemPrompt?: string
  ├─ tools?: ToolDefinition[]
  └─ model?: string

ChatResponse (聊天响应)
  ├─ content: string
  ├─ toolCalls?: ToolCall[]
  └─ finishReason: FinishReason

AgentConfig (Agent 配置)
  ├─ provider: LLMProvider
  ├─ systemPrompt?: string
  ├─ tools?: ToolDefinition[]
  └─ storage?: StorageProvider

SubAgentConfig (SubAgent 配置)
  ├─ extends AgentConfig
  ├─ allowedTools?: string[]
  ├─ systemPrompt?: string
  └─ parentAgentId?: string
```

## 下一步

确认这些类型定义后，可以开始实现：
1. LLM Provider 接口实现
2. Storage Provider 接口实现
3. Agent 核心类实现
4. 工具系统实现
5. SubAgent 系统实现

