/**
 * 工具执行器实现
 */

import type {
  Tool,
  ToolResult,
  ToolCall,
  ToolExecutionContext,
  ToolErrorType,
} from '../types/tools';

/**
 * 工具执行器类
 */
export class ToolExecutor {
  /**
   * 执行工具调用
   */
  async execute(
    tool: Tool,
    call: ToolCall,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      // 验证参数
      this.validateParameters(tool.definition.parameters, call.args);

      // 执行工具
      const result = await Promise.resolve(
        tool.execute(call.args, context),
      );

      return result;
    } catch (error) {
      return this.createErrorResult(
        error instanceof Error ? error.message : String(error),
        'execution_error' as ToolErrorType,
      );
    }
  }

  /**
   * 验证参数
   */
  private validateParameters(
    schema: Tool['definition']['parameters'],
    args: Record<string, unknown>,
  ): void {
    // 检查必需参数
    if (schema.required) {
      for (const param of schema.required) {
        if (!(param in args)) {
          throw new Error(`Missing required parameter: ${param}`);
        }
      }
    }

    // 检查参数类型（简单验证）
    if (schema.properties) {
      for (const [key, value] of Object.entries(args)) {
        const paramSchema = schema.properties[key];
        if (paramSchema) {
          this.validateParameterType(key, value, paramSchema);
        }
      }
    }
  }

  /**
   * 验证参数类型
   */
  private validateParameterType(
    name: string,
    value: unknown,
    schema: Tool['definition']['parameters'],
  ): void {
    const expectedType = schema.type;

    switch (expectedType) {
      case 'string':
        if (typeof value !== 'string') {
          throw new Error(`Parameter "${name}" must be a string`);
        }
        break;
      case 'number':
        if (typeof value !== 'number') {
          throw new Error(`Parameter "${name}" must be a number`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new Error(`Parameter "${name}" must be a boolean`);
        }
        break;
      case 'array':
        if (!Array.isArray(value)) {
          throw new Error(`Parameter "${name}" must be an array`);
        }
        break;
      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw new Error(`Parameter "${name}" must be an object`);
        }
        break;
    }
  }

  /**
   * 创建错误结果
   */
  private createErrorResult(
    message: string,
    type: ToolErrorType,
  ): ToolResult {
    return {
      success: false,
      error: {
        message,
        type,
      },
    };
  }
}

