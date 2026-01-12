/**
 * SubAgent 类实现
 */

import { Agent } from '../agent/agent';
import type { SubAgentConfig, ISubAgent, TaskToolResult } from './types';
import type { AgentConfig } from '../agent/types';
import type { ToolDefinition } from '../types/tools';

/**
 * SubAgent 类（继承自 Agent）
 */
export class SubAgent extends Agent implements ISubAgent {
  public readonly id: string;
  public readonly parentAgentId?: string;
  private taskStatus: 'pending' | 'running' | 'completed' | 'error' = 'pending';
  private taskResult?: TaskToolResult;
  private task?: string;

  constructor(
    config: SubAgentConfig,
    parentAgentId?: string,
  ) {
    // 构建 Agent 配置
    const agentConfig: AgentConfig = {
      provider: config.provider as AgentConfig['provider'],
      systemPrompt: config.systemPrompt,
      tools: (config.tools as AgentConfig['tools']) || undefined,
      maxTurns: config.maxTurns,
      storage: (config.storage as AgentConfig['storage']) || undefined,
    };

    super(agentConfig);

    // 保存任务和 ID
    this.task = config.task;
    this.id = `subagent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.parentAgentId = parentAgentId;

    // 如果配置了允许的工具，过滤工具注册表
    if (config.allowedTools && config.allowedTools.length > 0) {
      const registry = this.getToolRegistry();
      const allTools = registry.getAll();
      registry.clear();
      
      // 只注册允许的工具（需要检查工具名）
      for (const tool of allTools) {
        let shouldInclude = false;
        if (typeof config.allowedTools[0] === 'string') {
          shouldInclude = (config.allowedTools as string[]).includes(tool.definition.name);
        } else {
          shouldInclude = (config.allowedTools as ToolDefinition[]).some(
            t => t.name === tool.definition.name
          );
        }
        if (shouldInclude) {
          registry.register(tool);
        }
      }
    }
  }

  /**
   * 执行任务
   */
  async executeTask(): Promise<TaskToolResult> {
    if (!this.task) {
      throw new Error('No task specified');
    }

    this.taskStatus = 'running';

    try {
      const result = await this.sendMessage(this.task);
      
      const taskResult: TaskToolResult = {
        success: true,
        result: result.content,
        turns: result.turnResult.toolCalls?.length || 0,
        tokensUsed: result.turnResult.usageMetadata?.totalTokenCount,
        subAgentId: this.id,
      };

      this.taskResult = taskResult;
      this.taskStatus = 'completed';
      return taskResult;
    } catch (error) {
      const taskResult: TaskToolResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        subAgentId: this.id,
      };

      this.taskResult = taskResult;
      this.taskStatus = 'error';
      return taskResult;
    }
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(): 'pending' | 'running' | 'completed' | 'error' {
    return this.taskStatus;
  }

  /**
   * 取消任务
   */
  async cancelTask(): Promise<void> {
    if (this.taskStatus === 'running') {
      this.taskStatus = 'error';
      this.taskResult = {
        success: false,
        error: 'Task cancelled',
        subAgentId: this.id,
      };
    }
  }

  /**
   * 获取任务结果
   */
  getTaskResult(): TaskToolResult | undefined {
    return this.taskResult;
  }
}

