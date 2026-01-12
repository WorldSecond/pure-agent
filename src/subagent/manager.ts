/**
 * SubAgent 管理器实现
 */

import { SubAgent } from './subagent';
import type {
  SubAgentConfig,
  SubAgentManager,
  ISubAgent,
} from './types';

/**
 * SubAgent 管理器类
 */
export class SubAgentManagerImpl implements SubAgentManager {
  private subAgents: Map<string, SubAgent> = new Map();

  /**
   * 创建 SubAgent
   */
  async createSubAgent(config: SubAgentConfig): Promise<string> {
    const subAgent = new SubAgent(config, config.parentAgentId);
    this.subAgents.set(subAgent.id, subAgent);
    return subAgent.id;
  }

  /**
   * 获取 SubAgent
   */
  async getSubAgent(id: string): Promise<ISubAgent | null> {
    return this.subAgents.get(id) || null;
  }

  /**
   * 销毁 SubAgent
   */
  async destroySubAgent(id: string): Promise<void> {
    const subAgent = this.subAgents.get(id);
    if (subAgent) {
      // 取消正在运行的任务
      if (subAgent.getTaskStatus() === 'running') {
        await subAgent.cancelTask();
      }
      this.subAgents.delete(id);
    }
  }

  /**
   * 列出所有 SubAgent ID
   */
  async listSubAgents(): Promise<string[]> {
    return Array.from(this.subAgents.keys());
  }

  /**
   * 获取所有 SubAgent
   */
  getAllSubAgents(): SubAgent[] {
    return Array.from(this.subAgents.values());
  }

  /**
   * 清除所有 SubAgent
   */
  clear(): void {
    this.subAgents.clear();
  }
}

