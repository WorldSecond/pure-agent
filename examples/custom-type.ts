/** 单条消息 */
export interface ChatMessage {
    type: "text" | string; // 可根据需要扩展为联合类型
    content: string;
}

/** 运行环境信息 */
export interface EnvironmentDetails {
    osVersion: string;
    currentDate: string; // ISO 时间字符串
}

/** 任务参数 */
export interface TaskParameters {
    personalPrompt: string;
    codebase_search: boolean;
    preferred_language: string;
    enable_code_interpreter: boolean;
    projectLevelPrompt: string;
    tools: unknown[]; // 若后续有结构，可替换为具体类型
    environmentDetails: EnvironmentDetails;
    routerVersion: string;
    contexts: unknown[];
    ide: string;
}

/** 主体数据结构 */
export interface ChatRequest {
    chat_id: string;
    messages: ChatMessage[];
    client: string;
    task: string;
    task_parameters: TaskParameters;
    batch_task_parameters: unknown[];
    attempt: number;
    user_id: string;
    agent_id: string;
    mcp_servers: unknown[];
    model_id: string;
}

export interface ApiResponse {
    id: string;
    model: string;
    prompt: Prompt;
    type: string;
    chat_id: string;
    response_message_id: string;
    request_message_id: string;
    agent_name: string;
    is_model_auto_switched: boolean;
    prompt_id: string;
    prompt_tokens: number;
    rag_references: any[];
    rag_flywheel: any[];
    debug_log: string[];
}

export interface Prompt {
    messages: Message[];
    llm: string;
    truncationLength: number;
    valid: boolean;
}

export interface Message {
    role: "system" | "user" | "assistant" | string;
    content: string;
}

export interface CodeMateResponse {
    text: string;
    output: OutputItem[];
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

export interface OutputItem {
    type: "output_text" | string;
    text: string;
    name: string | null;
    id: string | null;
    arguments: Record<string, unknown>;
}

/**
 * 使用 Agent 处理自定义后台 API 的示例
 */
import { CustomAdapterProvider, Agent } from '../src';
import type { CustomAdapterConfig } from '../src/models/adapters/custom-adapter';
import type { ChatRequest as AgentChatRequest, StreamChunk } from '../src/models/types';
import { FinishReason } from '../src/types/chat';

/**
 * 创建适配自定义后台 API 的 Agent
 */
export function createCodeMateAgent(config: {
  apiUrl: string;
  chatId: string;
  client: string;
  task: string;
  taskParameters: TaskParameters;
  userId: string;
  agentId: string;
  modelId: string;
  headers?: Record<string, string>;
  systemPrompt?: string;
}): Agent {
  // 配置 CustomAdapterProvider
  const adapterConfig: CustomAdapterConfig = {
    apiUrl: config.apiUrl,
    name: 'codemate-api',
    headers: {
      'Content-Type': 'application/json',
      ...config.headers,
    },
    // 转换请求格式：将 agent-lite 的 ChatRequest 转换为后台的 ChatRequest
    transformRequest: (request: AgentChatRequest): ChatRequest => {
      // 转换消息格式
      const messages: ChatMessage[] = request.messages.map((msg) => {
        // 提取文本内容
        const textParts = msg.parts
          .filter((p) => p.type === 'text')
          .map((p) => (p as { text: string }).text);
        const content = textParts.join('');

        return {
          type: msg.role === 'user' ? 'text' : msg.role === 'assistant' ? 'text' : 'text',
          content: content,
        };
      });

      return {
        chat_id: config.chatId,
        messages: messages,
        client: config.client,
        task: config.task,
        task_parameters: config.taskParameters,
        batch_task_parameters: [],
        attempt: 1,
        user_id: config.userId,
        agent_id: config.agentId,
        mcp_servers: [],
        model_id: config.modelId,
      };
    },
    // 自定义流式响应处理
    handleStream: async function* (response: Response): AsyncGenerator<StreamChunk, void, unknown> {
      const reader = response.body?.getReader();
      if (!reader) {
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let isFirstResponse = true;
      let previousText = ''; // 用于存储上一次的 text 内容，计算增量

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim() === '') continue;
            
            // 处理 SSE 格式 (data: {...})
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6);
              if (dataStr === '[DONE]') {
                yield {
                  type: 'finished',
                  finishReason: FinishReason.STOP,
                };
                return;
              }

              try {
                const data = JSON.parse(dataStr);

                // 首次响应：ApiResponse
                if (isFirstResponse && 'id' in data && 'prompt' in data) {
                  const apiResponse = data as ApiResponse;
                  isFirstResponse = false;
                  
                  // 首次响应可能不包含 text，或者包含初始 text
                  // 这里可以根据实际 API 响应调整
                  if (apiResponse.prompt?.messages) {
                    // 可以处理 prompt 信息
                    // 首次响应通常不包含流式内容，继续等待后续响应
                  }
                  continue;
                }

                // 后续响应：CodeMateResponse
                if ('text' in data && 'output' in data) {
                  const codeMateResponse = data as CodeMateResponse;
                  
                  // text 是全量数据，需要计算增量
                  const currentText = codeMateResponse.text || '';
                  const incrementalText = currentText.slice(previousText.length);
                  
                  if (incrementalText) {
                    // 返回增量内容
                    yield {
                      type: 'content',
                      content: incrementalText,
                    };
                  }

                  // 更新 previousText
                  previousText = currentText;

                  // 处理 output（工具调用等）
                  if (codeMateResponse.output && codeMateResponse.output.length > 0) {
                    for (const outputItem of codeMateResponse.output) {
                      if (outputItem.type === 'output_text') {
                        // 可以处理工具输出
                      }
                      // 如果有函数调用，可以转换为 function_call 类型
                      // yield {
                      //   type: 'function_call',
                      //   functionCall: { ... }
                      // }
                    }
                  }

                  // 检查是否完成（根据实际 API 判断）
                  // 如果 API 有明确的完成标志，可以在这里判断
                  // 否则需要等待流结束
                }
              } catch (e) {
                // 忽略解析错误，继续处理下一行
                console.warn('Failed to parse stream chunk:', e);
              }
            }
          }
        }

        // 流结束时，发送完成事件
        yield {
          type: 'finished',
          finishReason: FinishReason.STOP,
          usageMetadata: {
            // 如果最后一次响应包含 token 信息，可以在这里设置
            // promptTokenCount: lastResponse?.prompt_tokens,
            // candidatesTokenCount: lastResponse?.completion_tokens,
            // totalTokenCount: lastResponse?.total_tokens,
          },
        };
      } finally {
        reader.releaseLock();
      }
    },
  };

  // 创建 Provider
  const provider = new CustomAdapterProvider(adapterConfig);

  // 创建 Agent
  const agent = new Agent({
    provider,
    systemPrompt: config.systemPrompt || '你是一个有用的助手',
  });

  return agent;
}

/**
 * 使用示例
 */
export async function exampleUsage() {
  // 创建 Agent
  const agent = createCodeMateAgent({
    apiUrl: 'https://your-api.com/v1/chat/stream',
    chatId: 'chat-123',
    client: 'web',
    task: 'chat',
    taskParameters: {
      personalPrompt: '你是一个专业的编程助手',
      codebase_search: true,
      preferred_language: 'zh-CN',
      enable_code_interpreter: true,
      projectLevelPrompt: '',
      tools: [],
      environmentDetails: {
        osVersion: 'Windows 10',
        currentDate: new Date().toISOString(),
      },
      routerVersion: '1.0',
      contexts: [],
      ide: 'cursor',
    },
    userId: 'user-123',
    agentId: 'agent-123',
    modelId: 'gpt-4',
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY',
    },
    systemPrompt: '你是一个专业的编程助手',
  });

  // 方式1: 非流式使用
  console.log('=== 非流式使用 ===');
  const result = await agent.sendMessage('你好，请介绍一下你自己');
  console.log('响应:', result.content);
  console.log('历史记录:', result.messages);

  // 方式2: 流式使用
  console.log('\n=== 流式使用 ===');
  const stream = agent.sendMessageStream('写一段关于 TypeScript 的代码示例');
  
  for await (const event of stream) {
    if (event.type === 'content') {
      // 实时输出内容
      process.stdout.write(event.value as string);
    } else if (event.type === 'finished') {
      console.log('\n\n响应完成');
    }
  }
  
  // 流式响应完成后，可以从历史记录中获取完整内容
  const history = agent.getHistory();
  const lastMessage = history[history.length - 1];
  if (lastMessage && lastMessage.role === 'assistant') {
    const content = lastMessage.parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as { text: string }).text)
      .join('');
    console.log('完整响应内容:', content);
  }
}

// 如果直接运行此文件，执行示例
if (require.main === module) {
  exampleUsage().catch(console.error);
}