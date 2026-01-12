/**
 * Chat 会话管理
 */

import type {
  Message,
  MessageHistory,
  UserMessage,
  AssistantMessage,
} from '../types/messages';
import type {
  ChatConfig,
  ChatStatus,
  StreamEvent,
  FinishReason,
  UsageMetadata,
} from '../types/chat';
import { StreamEventType } from '../types/chat';
import type { ChatRequest } from '../models/types';
import type { LLMProvider } from '../models/types';

/**
 * Chat 会话管理类
 */
export class Chat {
  private history: MessageHistory = [];
  private status: ChatStatus = 'idle';
  private config: ChatConfig;

  constructor(
    private provider: LLMProvider,
    config?: Partial<ChatConfig>,
  ) {
    this.config = {
      maxHistoryLength: config?.maxHistoryLength || 1000,
      enableHistoryCompression: config?.enableHistoryCompression || false,
      compressionThreshold: config?.compressionThreshold || 0.8,
      ...config,
    };
  }

  /**
   * 获取历史记录
   */
  getHistory(curated = false): MessageHistory {
    if (!curated) {
      return [...this.history];
    }

    // 过滤无效消息
    return this.history.filter((msg) => {
      if (msg.parts.length === 0) return false;
      return msg.parts.some((part) => {
        if (part.type === 'text') return part.text.trim().length > 0;
        return true;
      });
    });
  }

  /**
   * 添加消息到历史
   */
  addMessage(message: Message): void {
    this.history.push(message);
    this.trimHistory();
  }

  /**
   * 添加用户消息
   */
  addUserMessage(text: string): void {
    const message: UserMessage = {
      role: 'user',
      parts: [{ type: 'text', text }],
      timestamp: Date.now(),
    };
    this.addMessage(message);
  }

  /**
   * 添加助手消息
   */
  addAssistantMessage(text: string): void {
    const message: AssistantMessage = {
      role: 'assistant',
      parts: [{ type: 'text', text }],
      timestamp: Date.now(),
    };
    this.addMessage(message);
  }

  /**
   * 清除历史
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * 获取状态
   */
  getStatus(): ChatStatus {
    return this.status;
  }

  /**
   * 设置状态
   */
  setStatus(status: ChatStatus): void {
    this.status = status;
  }

  /**
   * 发送消息流
   */
  async *sendMessageStream(
    request: ChatRequest,
  ): AsyncGenerator<StreamEvent, void, unknown> {
    this.setStatus('processing');

    try {
      // 添加用户消息到历史
      if (request.messages.length > 0) {
        const lastMessage = request.messages[request.messages.length - 1];
        if (lastMessage.role === 'user') {
          this.addMessage(lastMessage);
        }
      }

      // 构建请求（使用当前历史）
      const chatRequest: ChatRequest = {
        ...request,
        messages: this.getHistory(true),
      };

      // 调用 Provider
      let assistantContent = '';
      const toolCalls: Array<{
        name: string;
        args: Record<string, unknown>;
        id?: string;
      }> = [];
      let finishReason: FinishReason | undefined;
      let usageMetadata: UsageMetadata | undefined;

      for await (const chunk of this.provider.streamChat(chatRequest)) {
        // 转换 StreamChunk 为 StreamEvent
        if (chunk.type === 'content' && chunk.content) {
          assistantContent += chunk.content;
          yield {
            type: StreamEventType.CONTENT,
            value: chunk.content,
          };
        }

        if (chunk.type === 'function_call' && chunk.functionCall) {
          toolCalls.push({
            name: chunk.functionCall.name,
            args: chunk.functionCall.args,
            id: chunk.functionCall.id,
          });
          yield {
            type: StreamEventType.FUNCTION_CALL,
            value: chunk.functionCall,
          };
        }

        if (chunk.type === 'finished') {
          finishReason = chunk.finishReason as FinishReason;
          usageMetadata = chunk.usageMetadata;
        }
      }

      // 添加助手响应到历史
      if (assistantContent || toolCalls.length > 0) {
        const assistantMessage: AssistantMessage = {
          role: 'assistant',
          parts: [
            ...(assistantContent ? [{ type: 'text' as const, text: assistantContent }] : []),
            ...toolCalls.map((call) => ({
              type: 'function_call' as const,
              functionCall: call,
            })),
          ],
          timestamp: Date.now(),
        };
        this.addMessage(assistantMessage);
      }

      // 发送完成事件
      yield {
        type: StreamEventType.FINISHED,
        value: {
          reason: finishReason || 'stop',
          usageMetadata,
        },
      };

      this.setStatus('idle');
    } catch (error) {
      this.setStatus('error');
      yield {
        type: StreamEventType.ERROR,
        value: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  /**
   * 修剪历史记录
   */
  private trimHistory(): void {
    if (
      this.config.maxHistoryLength &&
      this.history.length > this.config.maxHistoryLength
    ) {
      const removeCount = this.history.length - this.config.maxHistoryLength;
      this.history.splice(0, removeCount);
    }
  }

  /**
   * 获取配置
   */
  getConfig(): ChatConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ChatConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

