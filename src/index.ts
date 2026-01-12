/**
 * Agent Lite 主入口
 */

// 导出核心类型
export * from './types';

// 导出 Agent
export { Agent } from './agent/agent';
export type {
  AgentConfig,
  AgentStatus,
  SendMessageOptions,
  SendMessageResult,
  IAgent,
} from './agent/types';

// 导出 Chat
export { Chat } from './agent/chat';
export type { ChatConfig, ChatStatus } from './types/chat';

// 导出 Turn
export { Turn } from './agent/turn';

// 导出 ContextBuilder
export { ContextBuilder } from './agent/context-builder';

// 导出 LLM Provider
export { BaseProvider } from './models/base-provider';
export { CustomAdapterProvider } from './models/adapters/custom-adapter';
export type {
  LLMProvider,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  Model,
  ProviderConfig,
  ProviderAdapter,
} from './models/types';

// 导出 Storage
export { MemoryStorage } from './storage/memory-storage';
export type {
  StorageProvider,
  SessionData,
  StorageConfig,
} from './storage/types';

// 导出工具系统
export { ToolRegistryImpl } from './tools/registry';
export { ToolExecutor } from './tools/executor';
export { ToolScheduler } from './tools/scheduler';
export { createTaskTool } from './tools/builtin/task-tool';
export type {
  Tool,
  ToolRegistry,
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolExecutionContext,
} from './types/tools';

// 导出 SubAgent
export { SubAgent } from './subagent/subagent';
export { SubAgentManagerImpl } from './subagent/manager';
export type {
  ISubAgent,
  SubAgentConfig,
  SubAgentManager,
  TaskToolParameters,
  TaskToolResult,
} from './subagent/types';

// 导出配置
export { Config } from './config/config';
export { defaultConfig } from './config/defaults';
export type { AppConfig, ConfigManager } from './config/types';

// 导出消息类型
export type {
  Message,
  MessageRole,
  MessagePart,
  MessageHistory,
  UserMessage,
  AssistantMessage,
  ToolMessage,
  SystemMessage,
} from './types/messages';

// 导出聊天类型
export type {
  StreamEvent,
  StreamEventType,
  FinishReason,
  UsageMetadata,
  TurnResult,
} from './types/chat';
