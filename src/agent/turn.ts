/**
 * Turn 轮次管理
 */

import type { Chat } from './chat';
import type {
  StreamEvent,
  TurnResult,
  FinishReason,
} from '../types/chat';
import { StreamEventType } from '../types/chat';
import type { ChatRequest } from '../models/types';
import type { ToolCall } from '../types/tools';

/**
 * Turn 轮次管理类
 */
export class Turn {
  private responseText = '';
  private toolCalls: ToolCall[] = [];
  private finishReason?: FinishReason;
  private usageMetadata?: TurnResult['usageMetadata'];

  constructor(
    private chat: Chat,
    private promptId: string,
  ) {}

  /**
   * 运行轮次
   */
  async *run(
    request: ChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent, TurnResult, unknown> {
    try {
      const stream = this.chat.sendMessageStream(request);

      for await (const event of stream) {
        if (signal?.aborted) {
          yield {
            type: StreamEventType.ERROR,
            value: 'User cancelled',
          };
          return this.getResult();
        }

        // 处理内容事件
        if (event.type === StreamEventType.CONTENT && typeof event.value === 'string') {
          this.responseText += event.value;
        }

        // 处理函数调用事件
        if (event.type === StreamEventType.FUNCTION_CALL && event.value) {
          const call = event.value as {
            name: string;
            args: Record<string, unknown>;
            id?: string;
          };
          this.toolCalls.push({
            name: call.name,
            args: call.args,
            id: call.id,
          });
        }

        // 处理完成事件
        if (event.type === StreamEventType.FINISHED && event.value) {
          const finished = event.value as {
            reason: FinishReason;
            usageMetadata?: TurnResult['usageMetadata'];
          };
          this.finishReason = finished.reason;
          this.usageMetadata = finished.usageMetadata;
        }

        yield event;
      }

      return this.getResult();
    } catch (error) {
      yield {
        type: StreamEventType.ERROR,
        value: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  /**
   * 获取响应文本
   */
  getResponseText(): string {
    return this.responseText;
  }

  /**
   * 获取待处理的工具调用
   */
  getPendingToolCalls(): ToolCall[] {
    return [...this.toolCalls];
  }

  /**
   * 获取完成原因
   */
  getFinishReason(): FinishReason | undefined {
    return this.finishReason;
  }

  /**
   * 获取轮次结果
   */
  getResult(): TurnResult {
    return {
      messages: this.chat.getHistory(),
      finishReason: this.finishReason,
      usageMetadata: this.usageMetadata,
      toolCalls: this.toolCalls.length > 0 ? this.toolCalls : undefined,
    };
  }

  /**
   * 获取 Prompt ID
   */
  getPromptId(): string {
    return this.promptId;
  }
}

