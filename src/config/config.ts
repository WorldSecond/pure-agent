/**
 * 配置系统实现
 */

import type {
  AppConfig,
  ConfigManager,
} from './types';
import type { LLMProvider } from '../models/types';
import type { StorageProvider } from '../storage/types';
import { ToolRegistryImpl } from '../tools/registry';
import { MemoryStorage } from '../storage/memory-storage';

/**
 * 配置管理器实现类
 */
export class Config implements ConfigManager {
  private config: AppConfig;
  private provider: LLMProvider;
  private storage?: StorageProvider;
  private toolRegistry: ToolRegistryImpl;

  constructor(config: AppConfig, provider: LLMProvider) {
    this.config = config;
    this.provider = provider;
    this.toolRegistry = new ToolRegistryImpl();

    // 初始化存储
    if (config.storage) {
      if (config.storage.type === 'memory') {
        this.storage = new MemoryStorage();
      }
      // 其他存储类型可以在这里扩展
    }
  }

  /**
   * 获取配置
   */
  getConfig(): AppConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<AppConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取 Provider 实例
   */
  getProvider(): LLMProvider {
    return this.provider;
  }

  /**
   * 设置 Provider
   */
  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  /**
   * 获取存储 Provider 实例
   */
  getStorageProvider(): StorageProvider | undefined {
    return this.storage;
  }

  /**
   * 设置存储 Provider
   */
  setStorageProvider(storage: StorageProvider): void {
    this.storage = storage;
  }

  /**
   * 获取工具注册表
   */
  getToolRegistry(): ToolRegistryImpl {
    return this.toolRegistry;
  }

  /**
   * 验证配置
   */
  validateConfig(): boolean {
    if (!this.provider) {
      return false;
    }

    // 验证 Provider 配置
    const providerConfig = this.config.provider;
    if (!providerConfig.apiKey && !providerConfig.baseURL) {
      return false;
    }

    return true;
  }
}

