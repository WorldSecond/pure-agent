/**
 * 默认配置
 */

import type { AppConfig } from './types';

/**
 * 默认应用配置
 */
export const defaultConfig: Partial<AppConfig> = {
  logLevel: 'info',
  debug: false,
  storage: {
    type: 'memory',
  },
};

