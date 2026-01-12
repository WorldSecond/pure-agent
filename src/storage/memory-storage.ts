/**
 * 内存存储实现
 */

import type {
  StorageProvider,
  SessionData,
} from './types';

/**
 * 内存存储实现类
 */
export class MemoryStorage implements StorageProvider {
  private sessions: Map<string, SessionData> = new Map();

  /**
   * 保存会话
   */
  async saveSession(id: string, session: SessionData): Promise<void> {
    this.sessions.set(id, {
      ...session,
      metadata: {
        createdAt: session.metadata?.createdAt || Date.now(),
        updatedAt: Date.now(),
        ...session.metadata,
      },
    });
  }

  /**
   * 恢复会话
   */
  async restoreSession(id: string): Promise<SessionData | null> {
    const session = this.sessions.get(id);
    return session ? { ...session } : null;
  }

  /**
   * 删除会话
   */
  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  /**
   * 列出所有会话 ID
   */
  async listSessions(): Promise<string[]> {
    return Array.from(this.sessions.keys());
  }

  /**
   * 检查会话是否存在
   */
  async hasSession(id: string): Promise<boolean> {
    return this.sessions.has(id);
  }

  /**
   * 清除所有会话
   */
  clear(): void {
    this.sessions.clear();
  }

  /**
   * 获取会话数量
   */
  size(): number {
    return this.sessions.size;
  }
}

