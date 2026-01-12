/**
 * 上下文存储相关类型定义
 */

import type { MessageHistory } from '../types/messages';
import type { ChatConfig } from '../types/chat';

/**
 * 会话数据
 */
export interface SessionData {
  id: string;
  history: MessageHistory;
  config: ChatConfig;
  metadata?: {
    createdAt: number;
    updatedAt: number;
    agentId?: string;
    [key: string]: unknown;
  };
}

/**
 * 存储 Provider 接口
 */
export interface StorageProvider {
  /**
   * 保存会话
   */
  saveSession(id: string, session: SessionData): Promise<void>;

  /**
   * 恢复会话
   */
  restoreSession(id: string): Promise<SessionData | null>;

  /**
   * 删除会话
   */
  deleteSession(id: string): Promise<void>;

  /**
   * 列出所有会话 ID
   */
  listSessions?(): Promise<string[]>;

  /**
   * 检查会话是否存在
   */
  hasSession?(id: string): Promise<boolean>;
}

/**
 * 存储配置
 */
export interface StorageConfig {
  type: 'memory' | 'file' | 'database';
  path?: string; // 文件存储路径
  connectionString?: string; // 数据库连接字符串
  [key: string]: unknown; // 允许额外的配置项
}

