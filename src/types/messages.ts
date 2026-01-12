/**
 * 消息相关类型定义
 */

/**
 * 消息角色
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * 消息部分类型
 */
export interface TextPart {
  type: 'text';
  text: string;
}

export interface FunctionCallPart {
  type: 'function_call';
  functionCall: {
    name: string;
    args: Record<string, unknown>;
    id?: string;
  };
}

export interface FunctionResponsePart {
  type: 'function_response';
  functionResponse: {
    name: string;
    response: unknown;
    id?: string;
  };
}

export type MessagePart = TextPart | FunctionCallPart | FunctionResponsePart;

/**
 * 消息内容
 */
export interface Message {
  role: MessageRole;
  parts: MessagePart[];
  timestamp?: number;
}

/**
 * 用户消息
 */
export interface UserMessage extends Message {
  role: 'user';
}

/**
 * 助手消息
 */
export interface AssistantMessage extends Message {
  role: 'assistant';
}

/**
 * 工具消息
 */
export interface ToolMessage extends Message {
  role: 'tool';
}

/**
 * 系统消息
 */
export interface SystemMessage extends Message {
  role: 'system';
}

/**
 * 消息历史
 */
export type MessageHistory = Message[];

/**
 * 创建用户消息的辅助函数类型
 */
export type CreateUserMessage = (text: string) => UserMessage;

/**
 * 创建助手消息的辅助函数类型
 */
export type CreateAssistantMessage = (text: string) => AssistantMessage;

/**
 * 创建工具消息的辅助函数类型
 */
export type CreateToolMessage = (
  name: string,
  response: unknown,
  id?: string,
) => ToolMessage;

