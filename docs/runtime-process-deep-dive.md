# 运行时过程深度解析

## 概述

运行时过程是 Gemini CLI 在初始化完成后，处理用户输入、与模型交互、执行工具调用并管理多轮对话的核心流程。本文档详细解析从用户输入到最终响应的完整运行时机制。

## 运行时流程图

```
用户输入
  ↓
sendMessageStream(request, signal, prompt_id)
  ├─ 重置轮次状态
  ├─ 触发 BeforeAgent Hook
  └─ 调用 processTurn()
  ↓
processTurn()
  ├─ 检查会话轮次限制
  ├─ 检查上下文窗口溢出
  ├─ 尝试压缩聊天历史
  ├─ 添加 IDE 上下文（如果启用）
  ├─ 检测循环
  ├─ 模型路由决策
  ├─ 创建 Turn 实例
  └─ 调用 Turn.run()
  ↓
Turn.run()
  ├─ 调用 GeminiChat.sendMessageStream()
  ├─ 处理流式响应
  ├─ 提取文本内容
  ├─ 提取工具调用
  ├─ 提取思考内容
  └─ 返回事件流
  ↓
GeminiChat.sendMessageStream()
  ├─ 记录用户消息
  ├─ 添加到历史记录
  ├─ 构建请求内容
  ├─ 调用 API（带重试）
  ├─ 处理流式响应
  └─ 返回 StreamEvent
  ↓
工具调用处理（如果有）
  ├─ 调度工具调用 (CoreToolScheduler)
  ├─ 验证工具调用
  ├─ 请求用户确认（如果需要）
  ├─ 执行工具 (ToolExecutor)
  ├─ 处理工具结果
  └─ 返回工具响应
  ↓
工具响应发送回模型
  ├─ 转换为 functionResponse
  ├─ 添加到历史记录
  └─ 继续下一轮（如果需要）
  ↓
响应完成
  ├─ 检查下一个说话者
  ├─ 自动继续（如果需要）
  └─ 返回最终结果
```

## 详细步骤解析

### 阶段 1: 用户输入处理

**入口：** `GeminiClient.sendMessageStream()`

**位置：** `packages/core/src/core/client.ts:738`

**函数签名：**
```typescript
async *sendMessageStream(
  request: PartListUnion,
  signal: AbortSignal,
  prompt_id: string,
  turns: number = MAX_TURNS,
  isInvalidStreamRetry: boolean = false,
): AsyncGenerator<ServerGeminiStreamEvent, Turn>
```

**初始处理：**

```738:788:packages/core/src/core/client.ts
  async *sendMessageStream(
    request: PartListUnion,
    signal: AbortSignal,
    prompt_id: string,
    turns: number = MAX_TURNS,
    isInvalidStreamRetry: boolean = false,
  ): AsyncGenerator<ServerGeminiStreamEvent, Turn> {
    if (!isInvalidStreamRetry) {
      this.config.resetTurn();
    }

    const hooksEnabled = this.config.getEnableHooks();
    const messageBus = this.config.getMessageBus();

    if (this.lastPromptId !== prompt_id) {
      this.loopDetector.reset(prompt_id);
      this.hookStateMap.delete(this.lastPromptId);
      this.lastPromptId = prompt_id;
      this.currentSequenceModel = null;
    }

    if (hooksEnabled && messageBus) {
      const hookResult = await this.fireBeforeAgentHookSafe(
        messageBus,
        request,
        prompt_id,
      );
      if (hookResult) {
        if (
          'type' in hookResult &&
          hookResult.type === GeminiEventType.AgentExecutionStopped
        ) {
          // Add user message to history before returning so it's kept in the transcript
          this.getChat().addHistory(createUserContent(request));
          yield hookResult;
          return new Turn(this.getChat(), prompt_id);
        } else if (
          'type' in hookResult &&
          hookResult.type === GeminiEventType.AgentExecutionBlocked
        ) {
          yield hookResult;
          return new Turn(this.getChat(), prompt_id);
        } else if ('additionalContext' in hookResult) {
          const additionalContext = hookResult.additionalContext;
          if (additionalContext) {
            const requestArray = Array.isArray(request) ? request : [request];
            request = [...requestArray, { text: additionalContext }];
          }
        }
      }
    }

    const boundedTurns = Math.min(turns, MAX_TURNS);
    let turn = new Turn(this.getChat(), prompt_id);

    try {
      turn = yield* this.processTurn(
        request,
        signal,
        prompt_id,
        boundedTurns,
        isInvalidStreamRetry,
      );
```

**关键步骤：**

1. **重置轮次状态**：如果不是重试，重置配置的轮次状态
2. **Prompt ID 管理**：如果 prompt_id 改变，重置循环检测器和 Hook 状态
3. **BeforeAgent Hook**：如果启用 Hook，触发 BeforeAgent 事件
   - 可能停止执行
   - 可能阻止执行
   - 可能添加额外上下文
4. **创建 Turn 实例**：创建新的轮次管理对象
5. **调用 processTurn**：处理实际的轮次逻辑

### 阶段 2: 轮次处理 (processTurn)

**位置：** `packages/core/src/core/client.ts:517`

**核心逻辑：**

```517:736:packages/core/src/core/client.ts
  private async *processTurn(
    request: PartListUnion,
    signal: AbortSignal,
    prompt_id: string,
    boundedTurns: number,
    isInvalidStreamRetry: boolean,
  ): AsyncGenerator<ServerGeminiStreamEvent, Turn> {
    // Re-initialize turn (it was empty before if in loop, or new instance)
    let turn = new Turn(this.getChat(), prompt_id);

    this.sessionTurnCount++;
    if (
      this.config.getMaxSessionTurns() > 0 &&
      this.sessionTurnCount > this.config.getMaxSessionTurns()
    ) {
      yield { type: GeminiEventType.MaxSessionTurns };
      return turn;
    }

    if (!boundedTurns) {
      return turn;
    }

    // Check for context window overflow
    const modelForLimitCheck = this._getActiveModelForCurrentTurn();

    // Estimate tokens. For text-only requests, we estimate based on character length.
    // For requests with non-text parts (like images, tools), we use the countTokens API.
    const estimatedRequestTokenCount = await calculateRequestTokenCount(
      request,
      this.getContentGeneratorOrFail(),
      modelForLimitCheck,
    );

    const remainingTokenCount =
      tokenLimit(modelForLimitCheck) - this.getChat().getLastPromptTokenCount();

    if (estimatedRequestTokenCount > remainingTokenCount * 0.95) {
      yield {
        type: GeminiEventType.ContextWindowWillOverflow,
        value: { estimatedRequestTokenCount, remainingTokenCount },
      };
      return turn;
    }

    const compressed = await this.tryCompressChat(prompt_id, false);

    if (compressed.compressionStatus === CompressionStatus.COMPRESSED) {
      yield { type: GeminiEventType.ChatCompressed, value: compressed };
    }

    // Prevent context updates from being sent while a tool call is
    // waiting for a response. The Gemini API requires that a functionResponse
    // part from the user immediately follows a functionCall part from the model
    // in the conversation history . The IDE context is not discarded; it will
    // be included in the next regular message sent to the model.
    const history = this.getHistory();
    const lastMessage =
      history.length > 0 ? history[history.length - 1] : undefined;
    const hasPendingToolCall =
      !!lastMessage &&
      lastMessage.role === 'model' &&
      (lastMessage.parts?.some((p) => 'functionCall' in p) || false);

    if (this.config.getIdeMode() && !hasPendingToolCall) {
      const { contextParts, newIdeContext } = this.getIdeContextParts(
        this.forceFullIdeContext || history.length === 0,
      );
      if (contextParts.length > 0) {
        this.getChat().addHistory({
          role: 'user',
          parts: [{ text: contextParts.join('\n') }],
        });
      }
      this.lastSentIdeContext = newIdeContext;
      this.forceFullIdeContext = false;
    }

    // Re-initialize turn with fresh history
    turn = new Turn(this.getChat(), prompt_id);

    const controller = new AbortController();
    const linkedSignal = AbortSignal.any([signal, controller.signal]);

    const loopDetected = await this.loopDetector.turnStarted(signal);
    if (loopDetected) {
      yield { type: GeminiEventType.LoopDetected };
      return turn;
    }

    const routingContext: RoutingContext = {
      history: this.getChat().getHistory(/*curated=*/ true),
      request,
      signal,
      requestedModel: this.config.getModel(),
    };

    let modelToUse: string;

    // Determine Model (Stickiness vs. Routing)
    if (this.currentSequenceModel) {
      modelToUse = this.currentSequenceModel;
    } else {
      const router = this.config.getModelRouterService();
      const decision = await router.route(routingContext);
      modelToUse = decision.model;
    }

    // availability logic
    const modelConfigKey: ModelConfigKey = { model: modelToUse };
    const { model: finalModel } = applyModelSelection(
      this.config,
      modelConfigKey,
      { consumeAttempt: false },
    );
    modelToUse = finalModel;

    this.currentSequenceModel = modelToUse;
    yield { type: GeminiEventType.ModelInfo, value: modelToUse };

    const resultStream = turn.run(modelConfigKey, request, linkedSignal);
    let isError = false;
    let isInvalidStream = false;

    for await (const event of resultStream) {
      if (this.loopDetector.addAndCheck(event)) {
        yield { type: GeminiEventType.LoopDetected };
        controller.abort();
        return turn;
      }
      yield event;

      this.updateTelemetryTokenCount();

      if (event.type === GeminiEventType.InvalidStream) {
        isInvalidStream = true;
      }
      if (event.type === GeminiEventType.Error) {
        isError = true;
      }
    }

    if (isError) {
      return turn;
    }

    // Update cumulative response in hook state
    // We do this immediately after the stream finishes for THIS turn.
    const hooksEnabled = this.config.getEnableHooks();
    if (hooksEnabled) {
      const responseText = turn.getResponseText() || '';
      const hookState = this.hookStateMap.get(prompt_id);
      if (hookState && responseText) {
        // Append with newline if not empty
        hookState.cumulativeResponse = hookState.cumulativeResponse
          ? `${hookState.cumulativeResponse}\n${responseText}`
          : responseText;
      }
    }

    if (isInvalidStream) {
      if (this.config.getContinueOnFailedApiCall()) {
        if (isInvalidStreamRetry) {
          logContentRetryFailure(
            this.config,
            new ContentRetryFailureEvent(
              4,
              'FAILED_AFTER_PROMPT_INJECTION',
              modelToUse,
            ),
          );
          return turn;
        }
        const nextRequest = [{ text: 'System: Please continue.' }];
        // Recursive call - update turn with result
        turn = yield* this.sendMessageStream(
          nextRequest,
          signal,
          prompt_id,
          boundedTurns - 1,
          true,
        );
        return turn;
      }
    }

    if (!turn.pendingToolCalls.length && signal && !signal.aborted) {
      if (
        !this.config.getQuotaErrorOccurred() &&
        !this.config.getSkipNextSpeakerCheck()
      ) {
        const nextSpeakerCheck = await checkNextSpeaker(
          this.getChat(),
          this.config.getBaseLlmClient(),
          signal,
          prompt_id,
        );
        logNextSpeakerCheck(
          this.config,
          new NextSpeakerCheckEvent(
            prompt_id,
            turn.finishReason?.toString() || '',
            nextSpeakerCheck?.next_speaker || '',
          ),
        );
        if (nextSpeakerCheck?.next_speaker === 'model') {
          const nextRequest = [{ text: 'Please continue.' }];
          turn = yield* this.sendMessageStream(
            nextRequest,
            signal,
            prompt_id,
            boundedTurns - 1,
            // isInvalidStreamRetry is false
          );
          return turn;
        }
      }
    }
    return turn;
  }
```

**关键步骤：**

1. **会话轮次检查**：检查是否超过最大轮次限制
2. **Token 估算**：估算请求的 token 数量
3. **上下文窗口检查**：检查是否会溢出（95% 阈值）
4. **历史压缩**：如果历史过长，尝试压缩
5. **IDE 上下文**：如果启用 IDE 模式且没有待处理的工具调用，添加 IDE 上下文
6. **循环检测**：检测是否进入循环
7. **模型路由**：决定使用哪个模型
8. **执行 Turn.run()**：运行实际的轮次
9. **处理事件流**：处理返回的事件
10. **无效流重试**：如果流无效，自动重试
11. **下一个说话者检查**：检查模型是否应该继续说话

### 阶段 3: Turn.run() - 执行轮次

**位置：** `packages/core/src/core/turn.ts:242`

**核心逻辑：**

```242:387:packages/core/src/core/turn.ts
  async *run(
    modelConfigKey: ModelConfigKey,
    req: PartListUnion,
    signal: AbortSignal,
  ): AsyncGenerator<ServerGeminiStreamEvent> {
    try {
      // Note: This assumes `sendMessageStream` yields events like
      // { type: StreamEventType.RETRY } or { type: StreamEventType.CHUNK, value: GenerateContentResponse }
      const responseStream = await this.chat.sendMessageStream(
        modelConfigKey,
        req,
        this.prompt_id,
        signal,
      );

      for await (const streamEvent of responseStream) {
        if (signal?.aborted) {
          yield { type: GeminiEventType.UserCancelled };
          return;
        }

        // Handle the new RETRY event
        if (streamEvent.type === 'retry') {
          yield { type: GeminiEventType.Retry };
          continue; // Skip to the next event in the stream
        }

        if (streamEvent.type === 'agent_execution_stopped') {
          yield {
            type: GeminiEventType.AgentExecutionStopped,
            value: { reason: streamEvent.reason },
          };
          return;
        }

        if (streamEvent.type === 'agent_execution_blocked') {
          yield {
            type: GeminiEventType.AgentExecutionBlocked,
            value: { reason: streamEvent.reason },
          };
          continue;
        }

        // Assuming other events are chunks with a `value` property
        const resp = streamEvent.value;
        if (!resp) continue; // Skip if there's no response body

        this.debugResponses.push(resp);

        const traceId = resp.responseId;

        const thoughtPart = resp.candidates?.[0]?.content?.parts?.[0];
        if (thoughtPart?.thought) {
          const thought = parseThought(thoughtPart.text ?? '');
          yield {
            type: GeminiEventType.Thought,
            value: thought,
            traceId,
          };
          continue;
        }

        const text = getResponseText(resp);
        if (text) {
          yield { type: GeminiEventType.Content, value: text, traceId };
        }

        // Handle function calls (requesting tool execution)
        const functionCalls = resp.functionCalls ?? [];
        for (const fnCall of functionCalls) {
          const event = this.handlePendingFunctionCall(fnCall, traceId);
          if (event) {
            yield event;
          }
        }

        for (const citation of getCitations(resp)) {
          this.pendingCitations.add(citation);
        }

        // Check if response was truncated or stopped for various reasons
        const finishReason = resp.candidates?.[0]?.finishReason;

        // This is the key change: Only yield 'Finished' if there is a finishReason.
        if (finishReason) {
          if (this.pendingCitations.size > 0) {
            yield {
              type: GeminiEventType.Citation,
              value: `Citations:\n${[...this.pendingCitations].sort().join('\n')}`,
            };
            this.pendingCitations.clear();
          }

          this.finishReason = finishReason;
          yield {
            type: GeminiEventType.Finished,
            value: {
              reason: finishReason,
              usageMetadata: resp.usageMetadata,
            },
          };
        }
      }
    } catch (e) {
      // ... 错误处理
    }
  }
```

**处理的事件类型：**

1. **RETRY**：重试事件
2. **AGENT_EXECUTION_STOPPED**：代理执行停止
3. **AGENT_EXECUTION_BLOCKED**：代理执行被阻止
4. **CHUNK**：响应块
   - **Thought**：思考内容
   - **Content**：文本内容
   - **FunctionCall**：工具调用请求
   - **Citation**：引用
5. **FINISHED**：完成事件

### 阶段 4: GeminiChat.sendMessageStream() - API 调用

**位置：** `packages/core/src/core/geminiChat.ts:287`

**核心逻辑：**

```287:432:packages/core/src/core/geminiChat.ts
  async sendMessageStream(
    modelConfigKey: ModelConfigKey,
    message: PartListUnion,
    prompt_id: string,
    signal: AbortSignal,
  ): Promise<AsyncGenerator<StreamEvent>> {
    await this.sendPromise;

    let streamDoneResolver: () => void;
    const streamDonePromise = new Promise<void>((resolve) => {
      streamDoneResolver = resolve;
    });
    this.sendPromise = streamDonePromise;

    const userContent = createUserContent(message);
    const { model } =
      this.config.modelConfigService.getResolvedConfig(modelConfigKey);

    // Record user input - capture complete message with all parts (text, files, images, etc.)
    // but skip recording function responses (tool call results) as they should be stored in tool call records
    if (!isFunctionResponse(userContent)) {
      const userMessage = Array.isArray(message) ? message : [message];
      const userMessageContent = partListUnionToString(toParts(userMessage));
      this.chatRecordingService.recordMessage({
        model,
        type: 'user',
        content: userMessageContent,
      });
    }

    // Add user content to history ONCE before any attempts.
    this.history.push(userContent);
    const requestContents = this.getHistory(true);

    const streamWithRetries = async function* (
      this: GeminiChat,
    ): AsyncGenerator<StreamEvent, void, void> {
      try {
        let lastError: unknown = new Error('Request failed after all retries.');

        const maxAttempts = INVALID_CONTENT_RETRY_OPTIONS.maxAttempts;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          let isConnectionPhase = true;
          try {
            if (attempt > 0) {
              yield { type: StreamEventType.RETRY };
            }

            // If this is a retry, update the key with the new context.
            const currentConfigKey =
              attempt > 0
                ? { ...modelConfigKey, isRetry: true }
                : modelConfigKey;

            isConnectionPhase = true;
            const stream = await this.makeApiCallAndProcessStream(
              currentConfigKey,
              requestContents,
              prompt_id,
              signal,
            );
            isConnectionPhase = false;
            for await (const chunk of stream) {
              yield { type: StreamEventType.CHUNK, value: chunk };
            }

            lastError = null;
            break;
          } catch (error) {
            // ... 错误处理和重试逻辑
          }
        }

        if (lastError) {
          // ... 处理最终错误
        }
      } finally {
        streamDoneResolver!();
      }
    };

    return streamWithRetries.call(this);
  }
```

**关键步骤：**

1. **等待前一个请求**：确保前一个请求完成
2. **记录用户消息**：记录到会话历史
3. **添加到历史**：将用户内容添加到历史记录
4. **获取精选历史**：获取用于发送的历史记录
5. **重试机制**：带重试的流式生成器
6. **API 调用**：调用 `makeApiCallAndProcessStream()`
7. **流式处理**：处理返回的流式响应

### 阶段 5: 流式响应处理

**位置：** `packages/core/src/core/geminiChat.ts:768`

**processStreamResponse() 方法：**

```768:900:packages/core/src/core/geminiChat.ts
  private async *processStreamResponse(
    model: string,
    streamResponse: AsyncGenerator<GenerateContentResponse>,
    originalRequest: GenerateContentParameters,
  ): AsyncGenerator<GenerateContentResponse> {
    const modelResponseParts: Part[] = [];

    let hasToolCall = false;
    let finishReason: FinishReason | undefined;

    for await (const chunk of streamResponse) {
      const candidateWithReason = chunk?.candidates?.find(
        (candidate) => candidate.finishReason,
      );
      if (candidateWithReason) {
        finishReason = candidateWithReason.finishReason as FinishReason;
      }

      if (isValidResponse(chunk)) {
        const content = chunk.candidates?.[0]?.content;
        if (content?.parts) {
          if (content.parts.some((part) => part.thought)) {
            // Record thoughts
            this.recordThoughtFromContent(content);
          }
          if (content.parts.some((part) => part.functionCall)) {
            hasToolCall = true;
          }

          modelResponseParts.push(
            ...content.parts.filter((part) => !part.thought),
          );
        }
      }

      // Record token usage if this chunk has usageMetadata
      if (chunk.usageMetadata) {
        this.chatRecordingService.recordMessageTokens(chunk.usageMetadata);
        if (chunk.usageMetadata.promptTokenCount !== undefined) {
          this.lastPromptTokenCount = chunk.usageMetadata.promptTokenCount;
        }
      }

      // Fire AfterModel hook through MessageBus (only if hooks are enabled)
      const hooksEnabled = this.config.getEnableHooks();
      const messageBus = this.config.getMessageBus();
      if (hooksEnabled && messageBus && originalRequest && chunk) {
        // ... Hook 处理
      }

      yield chunk;
    }

    // Stream validation logic: A stream is considered successful if:
    // 1. There's a tool call OR
    // 2. A not MALFORMED_FUNCTION_CALL finish reason and a non-mepty resp
    //
    // We throw an error only when there's no tool call AND:
    // - No finish reason, OR
    // - MALFORMED_FUNCTION_CALL finish reason OR
    // - Empty response text (e.g., only thoughts with no actual content)
    if (!hasToolCall) {
      if (!finishReason) {
        throw new InvalidStreamError(
          'Model stream ended without a finish reason.',
          'NO_FINISH_REASON',
        );
      }
      if (finishReason === FinishReason.MALFORMED_FUNCTION_CALL) {
        throw new InvalidStreamError(
          'Model stream ended with malformed function call.',
          'MALFORMED_FUNCTION_CALL',
        );
      }
      if (!responseText) {
        throw new InvalidStreamError(
          'Model stream ended with empty response text.',
          'NO_RESPONSE_TEXT',
        );
      }
    }

    this.history.push({ role: 'model', parts: consolidatedParts });
  }
```

**处理内容：**

1. **收集响应部分**：收集所有响应块
2. **记录思考**：如果包含思考内容，记录到会话
3. **检测工具调用**：检测是否有工具调用
4. **记录 Token 使用**：记录 token 使用情况
5. **触发 AfterModel Hook**：如果启用 Hook
6. **验证响应**：验证响应是否有效
7. **添加到历史**：将模型响应添加到历史记录

### 阶段 6: 工具调用处理

#### 6.1 工具调用调度 (CoreToolScheduler)

**位置：** `packages/core/src/core/coreToolScheduler.ts:397`

**schedule() 方法：**

```397:437:packages/core/src/core/coreToolScheduler.ts
  schedule(
    request: ToolCallRequestInfo | ToolCallRequestInfo[],
    signal: AbortSignal,
  ): Promise<void> {
    return runInDevTraceSpan(
      { name: 'schedule' },
      async ({ metadata: spanMetadata }) => {
        spanMetadata.input = request;
        if (this.isRunning() || this.isScheduling) {
          return new Promise((resolve, reject) => {
            const abortHandler = () => {
              // Find and remove the request from the queue
              const index = this.requestQueue.findIndex(
                (item) => item.request === request,
              );
              if (index > -1) {
                this.requestQueue.splice(index, 1);
                reject(new Error('Tool call cancelled while in queue.'));
              }
            };

            signal.addEventListener('abort', abortHandler, { once: true });

            this.requestQueue.push({
              request,
              signal,
              resolve: () => {
                signal.removeEventListener('abort', abortHandler);
                resolve();
              },
              reject: (reason?: Error) => {
                signal.removeEventListener('abort', abortHandler);
                reject(reason);
              },
            });
          });
        }
        return this._schedule(request, signal);
      },
    );
  }
```

**调度流程：**

1. **检查运行状态**：如果正在运行或调度中，加入队列
2. **队列管理**：管理工具调用请求队列
3. **执行调度**：调用 `_schedule()` 执行实际调度

#### 6.2 工具执行 (ToolExecutor)

**位置：** `packages/core/src/scheduler/tool-executor.ts:44`

**execute() 方法：**

```44:155:packages/core/src/scheduler/tool-executor.ts
  async execute(context: ToolExecutionContext): Promise<CompletedToolCall> {
    const { call, signal, outputUpdateHandler, onUpdateToolCall } = context;

    const tool = this.config.getToolRegistry().getTool(call.name);
    if (!tool) {
      return this.createErrorResult(
        call,
        new Error(`Tool "${call.name}" not found`),
        ToolErrorType.TOOL_NOT_FOUND,
      );
    }

    const messageBus = this.config.getMessageBus();

    return runInDevTraceSpan(
      {
        name: tool.name,
        attributes: { type: 'tool-call' },
      },
      async ({ metadata: spanMetadata }) => {
        spanMetadata.input = { request };

        try {
          let promise: Promise<ToolResult>;
          if (invocation instanceof ShellToolInvocation) {
            const setPidCallback = (pid: number) => {
              const executingCall: ExecutingToolCall = {
                ...call,
                status: 'executing',
                tool,
                invocation,
                pid,
                startTime: 'startTime' in call ? call.startTime : undefined,
              };
              onUpdateToolCall(executingCall);
            };
            promise = executeToolWithHooks(
              invocation,
              toolName,
              signal,
              messageBus,
              hooksEnabled,
              tool,
              liveOutputCallback,
              shellExecutionConfig,
              setPidCallback,
              this.config,
            );
          } else {
            promise = executeToolWithHooks(
              invocation,
              toolName,
              signal,
              messageBus,
              hooksEnabled,
              tool,
              liveOutputCallback,
              shellExecutionConfig,
              undefined,
              this.config,
            );
          }

          const toolResult: ToolResult = await promise;
          spanMetadata.output = toolResult;

          if (signal.aborted) {
            return this.createCancelledResult(
              call,
              'User cancelled tool execution.',
            );
          } else if (toolResult.error === undefined) {
            return await this.createSuccessResult(call, toolResult);
          } else {
            return this.createErrorResult(
              call,
              new Error(toolResult.error.message),
              toolResult.error.type,
            );
          }
        } catch (error) {
          // ... 错误处理
        }
      },
    );
  }
```

**执行流程：**

1. **获取工具**：从工具注册表获取工具
2. **构建调用**：构建工具调用对象
3. **执行工具**：调用 `executeToolWithHooks()`
4. **处理结果**：
   - 成功：创建成功结果
   - 错误：创建错误结果
   - 取消：创建取消结果

#### 6.3 工具调用状态管理

**状态转换：**

```
validating → scheduled → awaiting_approval → executing → success/error/cancelled
```

**状态说明：**

- **validating**：验证工具调用参数
- **scheduled**：已调度，等待执行
- **awaiting_approval**：等待用户确认
- **executing**：正在执行
- **success**：执行成功
- **error**：执行失败
- **cancelled**：用户取消

### 阶段 7: 工具响应返回

**工具响应格式：**

```typescript
{
  role: 'user',
  parts: [{
    functionResponse: {
      id: callId,
      name: toolName,
      response: result | { error: errorMessage }
    }
  }]
}
```

**返回流程：**

1. **工具执行完成**：工具执行完成，获得结果
2. **转换为 functionResponse**：将结果转换为 functionResponse 格式
3. **添加到历史**：添加到对话历史
4. **发送回模型**：作为用户消息发送回模型
5. **继续对话**：模型处理工具结果，继续对话

### 阶段 8: 多轮对话管理

**自动继续机制：**

```703:734:packages/core/src/core/client.ts
    if (!turn.pendingToolCalls.length && signal && !signal.aborted) {
      if (
        !this.config.getQuotaErrorOccurred() &&
        !this.config.getSkipNextSpeakerCheck()
      ) {
        const nextSpeakerCheck = await checkNextSpeaker(
          this.getChat(),
          this.config.getBaseLlmClient(),
          signal,
          prompt_id,
        );
        logNextSpeakerCheck(
          this.config,
          new NextSpeakerCheckEvent(
            prompt_id,
            turn.finishReason?.toString() || '',
            nextSpeakerCheck?.next_speaker || '',
          ),
        );
        if (nextSpeakerCheck?.next_speaker === 'model') {
          const nextRequest = [{ text: 'Please continue.' }];
          turn = yield* this.sendMessageStream(
            nextRequest,
            signal,
            prompt_id,
            boundedTurns - 1,
            // isInvalidStreamRetry is false
          );
          return turn;
        }
      }
    }
```

**下一个说话者检查：**

- 使用独立的模型调用检查谁应该继续说话
- 如果模型应该继续，自动发送 "Please continue." 消息
- 实现无缝的多轮对话

## 完整运行时流程图

```
用户输入 "帮我修复这个bug"
  ↓
GeminiClient.sendMessageStream()
  ├─ 重置轮次状态
  ├─ 触发 BeforeAgent Hook
  └─ processTurn()
  ↓
processTurn()
  ├─ 检查会话轮次限制 ✓
  ├─ 估算 Token 数量 ✓
  ├─ 检查上下文窗口 ✓
  ├─ 尝试压缩历史（如果需要）
  ├─ 添加 IDE 上下文（如果启用）
  ├─ 检测循环 ✓
  ├─ 模型路由决策 → gemini-2.0-flash
  └─ Turn.run()
  ↓
Turn.run()
  └─ GeminiChat.sendMessageStream()
  ↓
GeminiChat.sendMessageStream()
  ├─ 记录用户消息
  ├─ 添加到历史
  ├─ 构建请求（系统提示词 + 历史 + 工具定义）
  ├─ 调用 Gemini API（流式）
  └─ 处理流式响应
  ↓
流式响应处理
  ├─ 接收响应块
  ├─ 提取文本内容 → yield Content 事件
  ├─ 提取工具调用 → yield ToolCallRequest 事件
  ├─ 提取思考内容 → yield Thought 事件
  └─ 完成 → yield Finished 事件
  ↓
工具调用处理（如果有）
  ├─ CoreToolScheduler.schedule()
  ├─ 验证工具调用
  ├─ 请求用户确认（如果需要）
  ├─ ToolExecutor.execute()
  │   ├─ 获取工具实例
  │   ├─ 构建调用对象
  │   ├─ 执行工具（带 Hook）
  │   └─ 返回结果
  └─ 转换为 functionResponse
  ↓
工具响应发送回模型
  ├─ 添加到历史（functionResponse）
  └─ 继续下一轮（自动）
  ↓
模型处理工具结果
  ├─ 分析结果
  ├─ 生成响应
  └─ 可能调用更多工具
  ↓
响应完成
  ├─ 检查下一个说话者
  ├─ 如果模型应该继续 → 自动发送 "Please continue."
  └─ 返回最终结果
```

## 关键代码位置总结

| 功能 | 代码位置 | 行号范围 |
|------|---------|---------|
| 发送消息流入口 | `packages/core/src/core/client.ts` | 738-857 |
| 轮次处理 | `packages/core/src/core/client.ts` | 517-736 |
| Turn 执行 | `packages/core/src/core/turn.ts` | 242-387 |
| API 调用 | `packages/core/src/core/geminiChat.ts` | 287-432 |
| 流式响应处理 | `packages/core/src/core/geminiChat.ts` | 768-900 |
| 工具调用调度 | `packages/core/src/core/coreToolScheduler.ts` | 397-437 |
| 工具执行 | `packages/core/src/scheduler/tool-executor.ts` | 44-155 |
| 工具调用处理 | `packages/core/src/core/turn.ts` | 389-412 |

## 设计特点

### 1. 流式处理

- **异步生成器**：使用 `AsyncGenerator` 实现流式处理
- **增量处理**：逐块处理响应，不等待完整响应
- **实时反馈**：用户可以实时看到响应

### 2. 错误处理和重试

- **自动重试**：网络错误和无效内容自动重试
- **重试限制**：最多重试 2 次
- **错误分类**：区分可重试和不可重试错误

### 3. 工具调用管理

- **状态机**：工具调用使用状态机管理
- **队列机制**：工具调用可以排队执行
- **并行执行**：独立的工具调用可以并行执行

### 4. 上下文管理

- **历史压缩**：当历史过长时自动压缩
- **Token 管理**：实时跟踪 token 使用
- **IDE 上下文**：增量更新 IDE 上下文

### 5. 多轮对话

- **自动继续**：检测模型是否应该继续说话
- **轮次限制**：防止无限循环
- **循环检测**：检测并防止循环

## 实际使用示例

### 示例 1: 简单文本查询

```typescript
// 用户输入
const request = [{ text: '解释一下这个函数的作用' }];

// 发送消息
const stream = await client.sendMessageStream(
  request,
  signal,
  promptId
);

// 处理响应
for await (const event of stream) {
  if (event.type === GeminiEventType.Content) {
    console.log(event.value); // 实时输出文本
  }
  if (event.type === GeminiEventType.Finished) {
    console.log('完成');
  }
}
```

### 示例 2: 带工具调用的查询

```typescript
// 用户输入
const request = [{ text: '读取 package.json 文件' }];

// 发送消息
const stream = await client.sendMessageStream(
  request,
  signal,
  promptId
);

// 处理响应
for await (const event of stream) {
  if (event.type === GeminiEventType.Content) {
    console.log(event.value);
  }
  if (event.type === GeminiEventType.ToolCallRequest) {
    // 工具调用请求
    const toolCall = event.value;
    console.log(`工具调用: ${toolCall.name}`);
    
    // 工具会自动执行，结果会发送回模型
  }
  if (event.type === GeminiEventType.Finished) {
    console.log('完成');
  }
}
```

### 示例 3: 多轮对话

```typescript
// 第一轮
const stream1 = await client.sendMessageStream(
  [{ text: '创建一个新文件' }],
  signal,
  promptId
);
// ... 处理响应，可能包含工具调用

// 工具执行后，模型自动继续
// 系统会自动发送 "Please continue." 如果检测到模型应该继续
```

## 调试技巧

### 1. 查看事件流

```typescript
for await (const event of stream) {
  console.log('Event type:', event.type);
  console.log('Event value:', event.value);
}
```

### 2. 查看历史记录

```typescript
const history = client.getHistory();
console.log('History:', JSON.stringify(history, null, 2));
```

### 3. 查看工具调用状态

```typescript
const turn = await stream.next();
console.log('Pending tool calls:', turn.value.pendingToolCalls);
```

### 4. 启用调试模式

```typescript
// 设置环境变量
process.env.DEBUG = '1';

// 或使用配置
config.setDebugMode(true);
```

## 性能优化

### 1. 并行工具调用

- 独立的工具调用可以并行执行
- 使用 `Promise.all()` 并行处理

### 2. 流式处理

- 不等待完整响应
- 实时处理和显示

### 3. 历史压缩

- 当历史过长时自动压缩
- 减少 token 消耗

### 4. Token 管理

- 实时跟踪 token 使用
- 防止上下文窗口溢出

## 总结

运行时过程是 Gemini CLI 的核心执行流程，它：

1. **流式处理**：实时处理响应，提供即时反馈
2. **工具调用管理**：完善的状态管理和执行机制
3. **错误处理**：自动重试和错误恢复
4. **多轮对话**：智能的对话管理和自动继续
5. **性能优化**：并行处理、历史压缩、Token 管理

这种设计使得运行时过程既能高效处理请求，又能提供流畅的用户体验。

