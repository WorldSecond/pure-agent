/**
 * 工具相关类型定义
 */

/**
 * 工具参数定义（JSON Schema 格式）
 */
export interface ToolParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: unknown[];
  properties?: Record<string, ToolParameterSchema>;
  items?: ToolParameterSchema;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * 工具定义（FunctionDeclaration 格式）
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

/**
 * 工具调用请求
 */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  success: boolean;
  result?: unknown;
  error?: {
    message: string;
    code?: string;
    type?: ToolErrorType;
  };
}

/**
 * 工具错误类型
 */
export enum ToolErrorType {
  TOOL_NOT_FOUND = 'tool_not_found',
  INVALID_PARAMETERS = 'invalid_parameters',
  EXECUTION_ERROR = 'execution_error',
  TIMEOUT = 'timeout',
  PERMISSION_DENIED = 'permission_denied',
}

/**
 * 工具执行上下文
 */
export interface ToolExecutionContext {
  call: ToolCall;
  signal?: AbortSignal;
  agentId?: string;
  sessionId?: string;
}

/**
 * 工具实现接口
 */
export interface Tool {
  definition: ToolDefinition;
  execute: (
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ) => Promise<ToolResult> | ToolResult;
}

/**
 * 工具注册表接口
 */
export interface ToolRegistry {
  register(tool: Tool): void;
  unregister(name: string): void;
  get(name: string): Tool | undefined;
  getAll(): Tool[];
  getDefinitions(): ToolDefinition[];
  has(name: string): boolean;
}

