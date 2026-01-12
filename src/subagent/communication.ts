/**
 * 父 Agent 通信机制
 */

import type { TaskToolResult } from './types';
import type { ToolResult } from '../types/tools';
import { ToolErrorType } from '../types/tools';

/**
 * 格式化任务结果为工具响应
 */
export function formatTaskResultAsToolResponse(
  result: TaskToolResult,
): ToolResult {
  if (result.success) {
    return {
      success: true,
      result: result.result || '',
    };
  } else {
    return {
      success: false,
      error: {
        message: result.error || 'Task execution failed',
        type: ToolErrorType.EXECUTION_ERROR,
      },
    };
  }
}

/**
 * 格式化任务结果为 JSON 字符串
 */
export function formatTaskResultAsJSON(result: TaskToolResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * 创建任务状态报告
 */
export function createTaskStatusReport(result: TaskToolResult): string {
  const parts: string[] = [];

  parts.push(`Task Status: ${result.success ? 'Success' : 'Failed'}`);
  
  if (result.result) {
    parts.push(`\nResult:\n${result.result}`);
  }

  if (result.error) {
    parts.push(`\nError: ${result.error}`);
  }

  if (result.turns !== undefined) {
    parts.push(`\nTurns: ${result.turns}`);
  }

  if (result.tokensUsed !== undefined) {
    parts.push(`\nTokens Used: ${result.tokensUsed}`);
  }

  if (result.subAgentId) {
    parts.push(`\nSubAgent ID: ${result.subAgentId}`);
  }

  return parts.join('\n');
}

