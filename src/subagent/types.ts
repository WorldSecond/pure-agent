/**
 * SubAgent 相关类型定义
 */

import type { AgentConfig } from '../agent/types';
import type { ToolDefinition } from '../types/tools';

/**
 * SubAgent 配置
 */
export interface SubAgentConfig extends Omit<AgentConfig, 'tools'> {
  /**
   * 允许使用的工具列表（受限工具集）
   */
  allowedTools?: string[] | ToolDefinition[];

  /**
   * 自定义系统提示词
   */
  systemPrompt?: string;

  /**
   * 父 Agent ID
   */
  parentAgentId?: string;

  /**
   * 任务描述
   */
  task?: string;

  /**
   * 最大轮次
   */
  maxTurns?: number;

  /**
   * 超时时间（毫秒）
   */
  timeout?: number;
}

/**
 * Task 工具参数
 */
export interface TaskToolParameters {
  /**
   * 任务描述
   */
  task: string;

  /**
   * 允许使用的工具列表（可选）
   */
  allowedTools?: string[];

  /**
   * 自定义系统提示词（可选）
   */
  systemPrompt?: string;

  /**
   * 使用的模型（可选，默认使用主 Agent 的模型）
   */
  model?: string;

  /**
   * 最大轮次（可选）
   */
  maxTurns?: number;

  /**
   * 超时时间（可选，毫秒）
   */
  timeout?: number;
}

/**
 * Task 工具结果
 */
export interface TaskToolResult {
  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 任务执行结果
   */
  result?: string;

  /**
   * 错误信息（如果有）
   */
  error?: string;

  /**
   * 实际执行的轮次
   */
  turns?: number;

  /**
   * 使用的 token 数量
   */
  tokensUsed?: number;

  /**
   * 子 Agent ID
   */
  subAgentId?: string;
}

/**
 * SubAgent 接口（继承自 Agent）
 * 注意：实际实现类需要继承 Agent 类
 */
export interface ISubAgent {
  /**
   * SubAgent ID
   */
  id: string;

  /**
   * 父 Agent ID
   */
  parentAgentId?: string;

  /**
   * 执行任务
   */
  executeTask(): Promise<TaskToolResult>;

  /**
   * 获取任务状态
   */
  getTaskStatus(): 'pending' | 'running' | 'completed' | 'error';

  /**
   * 取消任务
   */
  cancelTask(): Promise<void>;
}

/**
 * SubAgent 管理器接口
 */
export interface SubAgentManager {
  /**
   * 创建 SubAgent
   */
  createSubAgent(config: SubAgentConfig): Promise<string>; // 返回 SubAgent ID

  /**
   * 获取 SubAgent
   */
  getSubAgent(id: string): Promise<ISubAgent | null>;

  /**
   * 销毁 SubAgent
   */
  destroySubAgent(id: string): Promise<void>;

  /**
   * 列出所有 SubAgent ID
   */
  listSubAgents(): Promise<string[]>;
}

