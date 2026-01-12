/**
 * 工具调度器实现
 */

import type {
  ToolCall,
  ToolResult,
  ToolExecutionContext,
} from '../types/tools';
import { ToolErrorType } from '../types/tools';
import { ToolExecutor } from './executor';
import type { ToolRegistry } from '../types/tools';

/**
 * 工具调度器类
 */
export class ToolScheduler {
  private executor: ToolExecutor;

  constructor(private registry: ToolRegistry) {
    this.executor = new ToolExecutor();
  }

  /**
   * 调度工具调用（串行执行）
   */
  async scheduleSequential(
    calls: ToolCall[],
    context: ToolExecutionContext,
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const call of calls) {
      const tool = this.registry.get(call.name);
      if (!tool) {
        results.push({
          success: false,
          error: {
            message: `Tool "${call.name}" not found`,
            type: ToolErrorType.TOOL_NOT_FOUND,
          },
        });
        continue;
      }

      const result = await this.executor.execute(tool, call, context);
      results.push(result);
    }

    return results;
  }

  /**
   * 调度工具调用（并行执行）
   */
  async scheduleParallel(
    calls: ToolCall[],
    context: ToolExecutionContext,
  ): Promise<ToolResult[]> {
    const promises = calls.map(async (call) => {
      const tool = this.registry.get(call.name);
      if (!tool) {
        return {
          success: false,
          error: {
            message: `Tool "${call.name}" not found`,
            type: ToolErrorType.TOOL_NOT_FOUND,
          },
        };
      }

      return await this.executor.execute(tool, call, context);
    });

    return Promise.all(promises);
  }

  /**
   * 调度工具调用（自动选择串行或并行）
   */
  async schedule(
    calls: ToolCall[],
    context: ToolExecutionContext,
    parallel = false,
  ): Promise<ToolResult[]> {
    if (parallel) {
      return this.scheduleParallel(calls, context);
    }
    return this.scheduleSequential(calls, context);
  }
}

