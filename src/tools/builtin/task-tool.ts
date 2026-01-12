/**
 * Task 工具实现
 * 用于创建和管理子 Agent
 */

import type { Tool } from '../../types/tools';
import type { TaskToolParameters, TaskToolResult } from '../../subagent/types';
import { SubAgentManagerImpl } from '../../subagent/manager';
import { formatTaskResultAsToolResponse } from '../../subagent/communication';
import type { Agent } from '../../agent/agent';
import { ToolErrorType } from '../../types/tools';

/**
 * 创建 Task 工具
 */
export function createTaskTool(parentAgent: Agent): Tool {
  const manager = new SubAgentManagerImpl();

  return {
    definition: {
      name: 'task',
      description: '创建一个子 Agent 来执行特定任务。子 Agent 有独立的上下文和受限的工具集。',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: '任务描述，子 Agent 将执行此任务',
          },
          allowedTools: {
            type: 'array',
            items: { type: 'string' },
            description: '允许子 Agent 使用的工具列表（可选）。如果不指定，子 Agent 可以使用所有可用工具。',
          },
          systemPrompt: {
            type: 'string',
            description: '子 Agent 的自定义系统提示词（可选）',
          },
          model: {
            type: 'string',
            description: '子 Agent 使用的模型（可选）。如果不指定，使用主 Agent 的模型。',
          },
          maxTurns: {
            type: 'number',
            description: '子 Agent 的最大轮次（可选）',
          },
          timeout: {
            type: 'number',
            description: '任务超时时间，单位毫秒（可选）',
          },
        },
        required: ['task'],
      },
    },
    execute: async (args: Record<string, unknown>, context) => {
      if (!args.task || typeof args.task !== 'string') {
        return {
          success: false,
          error: {
            message: 'Task parameter is required',
            type: ToolErrorType.INVALID_PARAMETERS,
          },
        };
      }
      const params = args as unknown as TaskToolParameters;

      try {
        // 创建 SubAgent 配置
        const subAgentConfig = {
          provider: parentAgent.getConfig().provider,
          systemPrompt: params.systemPrompt,
          allowedTools: params.allowedTools,
          task: params.task,
          maxTurns: params.maxTurns,
          parentAgentId: context.agentId,
        };

        // 创建 SubAgent
        const subAgentId = await manager.createSubAgent(subAgentConfig);
        const subAgent = await manager.getSubAgent(subAgentId);

        if (!subAgent) {
          throw new Error('Failed to create SubAgent');
        }

        // 执行任务（带超时）
        let taskResult: TaskToolResult;
        if (params.timeout) {
          taskResult = await Promise.race([
            subAgent.executeTask(),
            new Promise<TaskToolResult>((_, reject) =>
              setTimeout(() => reject(new Error('Task timeout')), params.timeout),
            ),
          ]);
        } else {
          taskResult = await subAgent.executeTask();
        }

        // 清理 SubAgent
        await manager.destroySubAgent(subAgentId);

        // 返回结果
        return formatTaskResultAsToolResponse(taskResult);
      } catch (error) {
        return {
          success: false,
          error: {
            message: error instanceof Error ? error.message : String(error),
            type: ToolErrorType.EXECUTION_ERROR,
          },
        };
      }
    },
  };
}

