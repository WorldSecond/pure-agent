/**
 * 配置系统相关类型定义
 */

import type { LLMProvider } from '../models/types';
import type { StorageProvider } from '../storage/types';
import type { ToolRegistry } from '../types/tools';
import type { ProviderConfig } from '../models/types';
import type { StorageConfig } from '../storage/types';

/**
 * 应用配置
 */
export interface AppConfig {
  /**
   * LLM Provider 配置
   */
  provider: ProviderConfig;

  /**
   * 存储配置
   */
  storage?: StorageConfig;

  /**
   * 默认模型
   */
  defaultModel?: string;

  /**
   * 默认系统提示词
   */
  defaultSystemPrompt?: string;

  /**
   * 日志级别
   */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';

  /**
   * 调试模式
   */
  debug?: boolean;

  /**
   * 其他配置项
   */
  [key: string]: unknown;
}

/**
 * 配置管理器接口
 */
export interface ConfigManager {
  /**
   * 获取配置
   */
  getConfig(): AppConfig;

  /**
   * 更新配置
   */
  updateConfig(config: Partial<AppConfig>): void;

  /**
   * 获取 Provider 实例
   */
  getProvider(): LLMProvider;

  /**
   * 获取存储 Provider 实例
   */
  getStorageProvider(): StorageProvider | undefined;

  /**
   * 获取工具注册表
   */
  getToolRegistry(): ToolRegistry;

  /**
   * 验证配置
   */
  validateConfig(): boolean;
}

