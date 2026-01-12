/**
 * Agent 主类
 */

import type {
  Message,
  MessageHistory,
  UserMessage,
} from '../types/messages';
import type {
  AgentConfig,
  AgentStatus,
  SendMessageOptions,
  SendMessageResult,
} from './types';
import type { StreamEvent } from '../types/chat';
import { StreamEventType } from '../types/chat';
import type { ToolCall } from '../types/tools';
import { Chat } from './chat';
import { Turn } from './turn';
import { ContextBuilder } from './context-builder';
import { ToolRegistryImpl } from '../tools/registry';
import { ToolScheduler } from '../tools/scheduler';
/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Agent 类实现
 */
export class Agent {
  private chat: Chat;
  private contextBuilder: ContextBuilder;
  private toolRegistry: ToolRegistryImpl;
  private toolScheduler: ToolScheduler;
  private status: AgentStatus = 'idle';
  private config: AgentConfig;
  private sessionId: string;
  private turnCount = 0;

  constructor(config: AgentConfig) {
    this.config = config;
    this.sessionId = generateId();

    // 初始化 Chat
    this.chat = new Chat(config.provider, {
      maxHistoryLength: config.maxTurns ? config.maxTurns * 2 : 1000,
    });

    // 初始化上下文构建器
    this.contextBuilder = new ContextBuilder();

    // 初始化工具注册表
    this.toolRegistry = new ToolRegistryImpl();
    if (config.tools) {
      // 注册工具（需要将 ToolDefinition 转换为 Tool）
      // 这里假设工具已经注册，实际使用时需要实现工具注册逻辑
    }

    // 初始化工具调度器
    this.toolScheduler = new ToolScheduler(this.toolRegistry);

    // 恢复会话（如果配置了存储）
    if (config.storage) {
      this.restoreSession().catch((error) => {
        console.error('Failed to restore session:', error);
      });
    }
  }

  /**
   * 发送消息（非流式）
   */
  async sendMessage(
    message: string | Message,
    options?: SendMessageOptions,
  ): Promise<SendMessageResult> {
    this.status = 'processing';

    try {
      // 转换消息格式
      const userMessage: UserMessage =
        typeof message === 'string'
          ? {
              role: 'user',
              parts: [{ type: 'text', text: message }],
              timestamp: Date.now(),
            }
          : (message as UserMessage);

      // 构建请求
      const request = this.contextBuilder.buildChatRequest(
        this.chat.getHistory(),
        options?.systemPrompt || this.config.systemPrompt,
        options?.tools || this.config.tools,
      );

      // 创建 Turn
      const promptId = generateId();
      const turn = new Turn(this.chat, promptId);

      // 执行轮次
      const turnResult = await this.processTurn(turn, {
        ...request,
        messages: [...request.messages, userMessage],
      });

      // 处理工具调用
      if (turnResult.toolCalls && turnResult.toolCalls.length > 0) {
        await this.handleToolCalls(turnResult.toolCalls);
      }

      // 保存会话
      if (this.config.storage) {
        await this.saveSession();
      }

      this.status = 'idle';
      this.turnCount++;

      return {
        content: turn.getResponseText(),
        messages: this.chat.getHistory(),
        turnResult,
      };
    } catch (error) {
      this.status = 'error';
      throw error;
    }
  }

  /**
   * 发送消息（流式）
   */
  async *sendMessageStream(
    message: string | Message,
    options?: SendMessageOptions,
  ): AsyncGenerator<StreamEvent, SendMessageResult, unknown> {
    this.status = 'processing';

    try {
      // 转换消息格式
      const userMessage: UserMessage =
        typeof message === 'string'
          ? {
              role: 'user',
              parts: [{ type: 'text', text: message }],
              timestamp: Date.now(),
            }
          : (message as UserMessage);

      // 构建请求
      const request = this.contextBuilder.buildChatRequest(
        this.chat.getHistory(),
        options?.systemPrompt || this.config.systemPrompt,
        options?.tools || this.config.tools,
      );

      // 创建 Turn
      const promptId = generateId();
      const turn = new Turn(this.chat, promptId);

      // 执行轮次
      const toolCalls: ToolCall[] = [];
      for await (const event of turn.run(
        {
          ...request,
          messages: [...request.messages, userMessage],
        },
        options?.signal,
      )) {
        yield event;

        // 收集工具调用
        if (
          event.type === 'function_call' &&
          event.value &&
          typeof event.value === 'object'
        ) {
          const call = event.value as ToolCall;
          toolCalls.push(call);
        }
      }

      // 处理工具调用
      if (toolCalls.length > 0) {
        await this.handleToolCalls(toolCalls);
      }

      // 保存会话
      if (this.config.storage) {
        await this.saveSession();
      }

      this.status = 'idle';
      this.turnCount++;

      return {
        content: turn.getResponseText(),
        messages: this.chat.getHistory(),
        turnResult: turn.getResult(),
      };
    } catch (error) {
      this.status = 'error';
      yield {
        type: StreamEventType.ERROR,
        value: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  /**
   * 处理轮次
   */
  private async processTurn(
    turn: Turn,
    request: Parameters<Chat['sendMessageStream']>[0],
  ): Promise<ReturnType<Turn['getResult']>> {
    // 检查轮次限制
    if (this.config.maxTurns && this.turnCount >= this.config.maxTurns) {
      throw new Error('Maximum turns reached');
    }

    // 执行轮次
    const result = turn.getResult();
    for await (const _event of turn.run(request)) {
      // 事件已在 sendMessageStream 中处理
    }

    return result;
  }

  /**
   * 处理工具调用
   */
  private async handleToolCalls(
    toolCalls: ToolCall[],
  ): Promise<void> {
    this.status = 'waiting_tool';

    const results = await this.toolScheduler.schedule(toolCalls, {
      call: toolCalls[0], // 使用第一个调用作为上下文
      agentId: this.sessionId,
      sessionId: this.sessionId,
    });

    // 将工具结果添加到历史
    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];
      const result = results[i];

      this.chat.addMessage({
        role: 'tool',
        parts: [
          {
            type: 'function_response',
            functionResponse: {
              name: call.name,
              response: result.success ? result.result : { error: result.error },
              id: call.id,
            },
          },
        ],
        timestamp: Date.now(),
      });
    }

    this.status = 'processing';
  }

  /**
   * 获取历史记录
   */
  getHistory(): MessageHistory {
    return this.chat.getHistory();
  }

  /**
   * 清除历史
   */
  clearHistory(): void {
    this.chat.clearHistory();
  }

  /**
   * 获取状态
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * 获取配置
   */
  getConfig(): AgentConfig {
    return { ...this.config };
  }

  /**
   * 注册工具
   */
  registerTool(tool: Parameters<ToolRegistryImpl['register']>[0]): void {
    this.toolRegistry.register(tool);
  }

  /**
   * 获取工具注册表
   */
  getToolRegistry(): ToolRegistryImpl {
    return this.toolRegistry;
  }

  /**
   * 保存会话
   */
  private async saveSession(): Promise<void> {
    if (!this.config.storage) return;

    await this.config.storage.saveSession(this.sessionId, {
      id: this.sessionId,
      history: this.chat.getHistory(),
      config: this.chat.getConfig(),
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        agentId: this.sessionId,
      },
    });
  }

  /**
   * 恢复会话
   */
  private async restoreSession(): Promise<void> {
    if (!this.config.storage) return;

    const session = await this.config.storage.restoreSession(this.sessionId);
    if (session) {
      // 恢复历史记录
      this.chat.clearHistory();
      for (const message of session.history) {
        this.chat.addMessage(message);
      }

      // 恢复配置
      this.chat.updateConfig(session.config);
    }
  }
}

