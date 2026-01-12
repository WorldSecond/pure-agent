/**
 * 子 Agent 使用示例
 */

import { CustomAdapterProvider, Agent, createTaskTool } from '../src';
import type { Tool } from '../src';
import { CustomAdapterConfig } from '../src/models/adapters/custom-adapter';

async function subAgentExample() {
  // 创建主 Agent
  const config: CustomAdapterConfig = {
    apiUrl: 'https://your-api.com/v1/chat',
    name: 'main-agent',
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY',
    },
    transformRequest: (request) => ({
      messages: request.messages,
    }),
    transformStreamChunk: (data: any) => {
      if (data.content) {
        return { type: 'content', content: data.content };
      }
      return null;
    },
  };

  const provider = new CustomAdapterProvider(config);
  const agent = new Agent({
    provider,
    systemPrompt: '你是一个任务协调者，可以将复杂任务分解为子任务。',
  });

  // 注册一些工具
  const readFileTool: Tool = {
    definition: {
      name: 'read_file',
      description: '读取文件内容',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
        },
        required: ['path'],
      },
    },
    execute: async (args) => {
      // 实现文件读取逻辑
      return {
        success: true,
        result: '文件内容...',
      };
    },
  };

  agent.registerTool(readFileTool);

  // 注册 task 工具（启用子 Agent 功能）
  const taskTool = createTaskTool(agent);
  agent.registerTool(taskTool);

  // 主 Agent 可以调用 task 工具创建子 Agent
  const result = await agent.sendMessage(
    '请使用 task 工具创建一个子 Agent 来分析 data.json 文件'
  );

  // Agent 会自动：
  // 1. 调用 task 工具
  // 2. 创建子 Agent（只能使用 read_file 工具）
  // 3. 子 Agent 执行任务
  // 4. 返回结果给主 Agent

  console.log('主 Agent 响应:', result.content);
}

subAgentExample().catch(console.error);
