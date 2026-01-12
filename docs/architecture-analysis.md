# Gemini CLI 架构分析文档

## 项目概述

Gemini CLI 是一个开源的 AI 代理工具，将 Google Gemini 模型的能力直接带到终端。项目采用模块化架构，主要分为 CLI 前端和 Core 后端两个核心包。

## 整体架构

### 核心包结构

```
gemini-cli/
├── packages/
│   ├── cli/          # 用户界面层（前端）
│   ├── core/         # 核心逻辑层（后端）
│   ├── a2a-server/   # Agent-to-Agent 服务器
│   └── test-utils/   # 测试工具
```

### 主要组件

1. **CLI Package (`packages/cli`)**
   - 负责用户交互界面
   - 处理用户输入和命令解析
   - 管理历史记录和显示渲染
   - 处理主题和 UI 定制
   - 管理 CLI 配置设置

2. **Core Package (`packages/core`)**
   - 作为后端核心引擎
   - 与 Gemini API 通信
   - 管理提示词构建和会话状态
   - 注册和执行工具
   - 处理上下文构建（重点）

3. **Tools (`packages/core/src/tools/`)**
   - 扩展模型能力的工具模块
   - 文件系统操作、Shell 命令、Web 获取等

## 上下文构建架构（核心部分）

上下文构建是 Gemini CLI 的核心功能，它负责将各种信息源整合成模型可以理解的完整上下文。

### 上下文构建流程图

```
用户输入
  ↓
GeminiClient.startChat()
  ↓
┌─────────────────────────────────────┐
│  1. 系统提示词构建                    │
│     getCoreSystemPrompt()            │
│     ├─ 基础提示词模板                │
│     ├─ 工具定义                      │
│     └─ 用户内存 (GEMINI.md)          │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│  2. 环境上下文构建                    │
│     getEnvironmentContext()         │
│     ├─ 日期和操作系统信息             │
│     ├─ 工作目录结构                  │
│     └─ 环境内存                      │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│  3. 初始历史记录构建                  │
│     getInitialChatHistory()         │
│     ├─ 环境上下文                    │
│     └─ 额外历史记录                  │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│  4. GeminiChat 初始化                │
│     new GeminiChat()                │
│     ├─ systemInstruction            │
│     ├─ tools                        │
│     └─ history                      │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│  5. 运行时上下文更新                  │
│     processTurn()                   │
│     ├─ IDE 上下文（增量/全量）       │
│     ├─ 对话历史管理                  │
│     └─ 工具调用结果                  │
└─────────────────────────────────────┘
```

### 上下文构建的关键组件

#### 1. 系统提示词构建 (`packages/core/src/core/prompts.ts`)

**核心函数：`getCoreSystemPrompt()`**

```typescript
export function getCoreSystemPrompt(
  config: Config,
  userMemory?: string,
): string
```

**构建内容：**
- **基础提示词模板**：包含核心指令、工作流程、工具使用指南
- **工具定义**：从 `ToolRegistry` 获取所有可用工具的函数声明
- **用户内存**：从 GEMINI.md 文件加载的上下文信息
- **技能系统**：可用的 Agent Skills
- **模型特定变体**：根据使用的模型（如 Gemini 3）调整提示词

**关键代码位置：**
```80:418:packages/core/src/core/prompts.ts
export function getCoreSystemPrompt(
  config: Config,
  userMemory?: string,
): string {
  // ... 系统提示词构建逻辑
}
```

#### 2. 环境上下文构建 (`packages/core/src/utils/environmentContext.ts`)

**核心函数：`getEnvironmentContext()`**

```typescript
export async function getEnvironmentContext(config: Config): Promise<Part[]>
```

**构建内容：**
- **日期信息**：当前日期（本地化格式）
- **操作系统**：平台信息（Windows/Linux/macOS）
- **工作目录**：当前工作目录和文件夹结构
- **临时目录**：项目临时目录路径
- **环境内存**：从配置获取的环境相关内存

**目录结构获取：**
```18:46:packages/core/src/utils/environmentContext.ts
export async function getDirectoryContextString(
  config: Config,
): Promise<string> {
  const workspaceContext = config.getWorkspaceContext();
  const workspaceDirectories = workspaceContext.getDirectories();

  const folderStructures = await Promise.all(
    workspaceDirectories.map((dir) =>
      getFolderStructure(dir, {
        fileService: config.getFileService(),
      }),
    ),
  );

  const folderStructure = folderStructures.join('\n');

  let workingDirPreamble: string;
  if (workspaceDirectories.length === 1) {
    workingDirPreamble = `I'm currently working in the directory: ${workspaceDirectories[0]}`;
  } else {
    const dirList = workspaceDirectories.map((dir) => `  - ${dir}`).join('\n');
    workingDirPreamble = `I'm currently working in the following directories:\n${dirList}`;
  }

  return `${workingDirPreamble}
Here is the folder structure of the current working directories:

${folderStructure}`;
}
```

#### 3. 内存文件加载 (`packages/core/src/utils/memoryDiscovery.ts`)

**核心函数：`loadServerHierarchicalMemory()`**

**分层加载机制：**

1. **全局上下文文件**
   - 位置：`~/.gemini/GEMINI.md`
   - 作用域：所有项目的默认指令

2. **项目根目录和祖先目录**
   - 从当前工作目录向上搜索到项目根（.git 目录）或用户主目录
   - 作用域：整个项目或项目的一部分

3. **子目录上下文文件**
   - 在当前工作目录下方扫描（最多 200 个目录，可配置）
   - 作用域：特定组件或模块的指令

**加载逻辑：**
```474:549:packages/core/src/utils/memoryDiscovery.ts
export async function loadServerHierarchicalMemory(
  currentWorkingDirectory: string,
  includeDirectoriesToReadGemini: readonly string[],
  debugMode: boolean,
  fileService: FileDiscoveryService,
  extensionLoader: ExtensionLoader,
  folderTrust: boolean,
  importFormat: 'flat' | 'tree' = 'tree',
  fileFilteringOptions?: FileFilteringOptions,
  maxDirs: number = 200,
): Promise<LoadServerHierarchicalMemoryResponse> {
  // ... 分层加载逻辑
}
```

#### 4. 对话历史管理 (`packages/core/src/core/geminiChat.ts`)

**核心类：`GeminiChat`**

**历史记录管理：**
- **完整历史**：保存所有对话轮次
- **精选历史**：过滤无效内容后的历史（`extractCuratedHistory`）
- **历史验证**：确保历史记录格式正确（`validateHistory`）

**关键方法：**
```236:256:packages/core/src/core/geminiChat.ts
export class GeminiChat {
  constructor(
    private readonly config: Config,
    private systemInstruction: string = '',
    private tools: Tool[] = [],
    private history: Content[] = [],
    resumedSessionData?: ResumedSessionData,
  ) {
    validateHistory(history);
    this.chatRecordingService = new ChatRecordingService(config);
    this.chatRecordingService.initialize(resumedSessionData);
    this.lastPromptTokenCount = estimateTokenCountSync(
      this.history.flatMap((c) => c.parts || []),
    );
  }
```

#### 5. IDE 上下文集成 (`packages/core/src/core/client.ts`)

**核心方法：`getIdeContextParts()`**

**功能：**
- **全量上下文**：首次发送或强制刷新时发送完整的 IDE 状态
- **增量更新**：后续只发送变化的部分（文件打开/关闭、光标移动、选择变化）

**实现逻辑：**
```339:505:packages/core/src/core/client.ts
  private getIdeContextParts(forceFullContext: boolean): {
    contextParts: string[];
    newIdeContext: IdeContext | undefined;
  } {
    const currentIdeContext = ideContextStore.get();
    if (!currentIdeContext) {
      return { contextParts: [], newIdeContext: undefined };
    }

    if (forceFullContext || !this.lastSentIdeContext) {
      // 发送完整上下文作为 JSON
      // ...
    } else {
      // 计算并发送增量作为 JSON
      // ...
    }
  }
```

#### 6. 工具定义集成

**工具注册流程：**
```303:337:packages/core/src/core/client.ts
  async startChat(
    extraHistory?: Content[],
    resumedSessionData?: ResumedSessionData,
  ): Promise<GeminiChat> {
    this.forceFullIdeContext = true;
    this.hasFailedCompressionAttempt = false;

    const toolRegistry = this.config.getToolRegistry();
    const toolDeclarations = toolRegistry.getFunctionDeclarations();
    const tools: Tool[] = [{ functionDeclarations: toolDeclarations }];

    const history = await getInitialChatHistory(this.config, extraHistory);

    try {
      const systemMemory = this.config.isJitContextEnabled()
        ? this.config.getGlobalMemory()
        : this.config.getUserMemory();
      const systemInstruction = getCoreSystemPrompt(this.config, systemMemory);
      return new GeminiChat(
        this.config,
        systemInstruction,
        tools,
        history,
        resumedSessionData,
      );
    } catch (error) {
      // ... 错误处理
    }
  }
```

### 上下文构建的数据流

```
┌─────────────────────────────────────────────────────────────┐
│                    上下文数据源                               │
├─────────────────────────────────────────────────────────────┤
│ 1. 系统提示词                                                │
│    - 基础指令模板                                            │
│    - 工具使用指南                                            │
│    - 工作流程说明                                            │
│                                                              │
│ 2. 用户内存 (GEMINI.md)                                      │
│    - 全局: ~/.gemini/GEMINI.md                              │
│    - 项目: 项目根目录及祖先目录                              │
│    - 本地: 子目录中的 GEMINI.md                              │
│                                                              │
│ 3. 环境上下文                                                │
│    - 日期、操作系统                                          │
│    - 工作目录结构                                            │
│    - 临时目录路径                                            │
│                                                              │
│ 4. IDE 上下文（可选）                                        │
│    - 打开的文件                                              │
│    - 活动文件光标位置                                        │
│    - 选中的文本                                              │
│                                                              │
│ 5. 对话历史                                                  │
│    - 用户消息                                                │
│    - 模型响应                                                │
│    - 工具调用和结果                                          │
│                                                              │
│ 6. 工具定义                                                  │
│    - 内置工具（文件操作、Shell、搜索等）                     │
│    - MCP 服务器工具                                          │
│    - 扩展工具                                                │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                  上下文组装层                                 │
├─────────────────────────────────────────────────────────────┤
│ getCoreSystemPrompt()                                        │
│   ├─ 合并系统提示词和用户内存                                │
│   └─ 生成最终系统指令                                        │
│                                                              │
│ getEnvironmentContext()                                      │
│   ├─ 获取目录结构                                            │
│   └─ 格式化环境信息                                          │
│                                                              │
│ getInitialChatHistory()                                      │
│   ├─ 组合环境上下文                                          │
│   └─ 添加额外历史记录                                        │
│                                                              │
│ GeminiChat 初始化                                            │
│   ├─ systemInstruction                                       │
│   ├─ tools                                                    │
│   └─ history                                                  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                   运行时上下文更新                            │
├─────────────────────────────────────────────────────────────┤
│ processTurn()                                                │
│   ├─ 添加 IDE 上下文（增量/全量）                            │
│   ├─ 更新对话历史                                            │
│   ├─ 处理工具调用结果                                        │
│   └─ 管理历史压缩（如需要）                                  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                   发送到 Gemini API                          │
├─────────────────────────────────────────────────────────────┤
│ - System Instruction                                         │
│ - Tools                                                      │
│ - History (Content[])                                       │
│ - Current Request                                            │
└─────────────────────────────────────────────────────────────┘
```

### 关键设计模式

#### 1. 分层上下文加载

**实现位置：** `packages/core/src/utils/memoryDiscovery.ts`

**特点：**
- 从通用到特定的加载顺序
- 支持继承和覆盖机制
- 自动发现和加载 GEMINI.md 文件

#### 2. 增量上下文更新

**实现位置：** `packages/core/src/core/client.ts`

**特点：**
- IDE 上下文使用增量更新减少 token 消耗
- 首次发送全量，后续只发送变化
- 智能检测文件打开/关闭、光标移动等变化

#### 3. 历史记录精选

**实现位置：** `packages/core/src/core/geminiChat.ts`

**特点：**
- 过滤无效或空内容
- 确保历史记录格式正确
- 支持历史压缩以节省 token

#### 4. 工具动态注册

**实现位置：** `packages/core/src/config/config.ts`

**特点：**
- 运行时注册工具
- 支持内置工具、MCP 工具、扩展工具
- 工具定义自动转换为 FunctionDeclaration

### 上下文构建的关键文件

| 文件路径 | 职责 |
|---------|------|
| `packages/core/src/core/prompts.ts` | 系统提示词构建 |
| `packages/core/src/utils/environmentContext.ts` | 环境上下文构建 |
| `packages/core/src/utils/memoryDiscovery.ts` | 内存文件发现和加载 |
| `packages/core/src/core/geminiChat.ts` | 对话历史管理 |
| `packages/core/src/core/client.ts` | 客户端上下文协调 |
| `packages/core/src/utils/getFolderStructure.ts` | 目录结构获取 |
| `packages/core/src/safety/context-builder.ts` | 安全检查上下文构建 |

### 上下文构建的优化策略

#### 1. Token 管理

- **历史压缩**：当历史记录过长时自动压缩
- **增量更新**：IDE 上下文使用增量而非全量
- **Token 估算**：实时估算 token 使用量

#### 2. 性能优化

- **并行加载**：目录结构并行获取
- **缓存机制**：缓存目录结构和文件内容
- **懒加载**：按需加载上下文组件

#### 3. 内存管理

- **分层加载**：只加载必要的上下文层级
- **文件过滤**：尊重 .gitignore 和 .geminiignore
- **限制范围**：限制搜索深度和文件数量

## 学习要点总结

### 1. 上下文构建的核心思想

- **分层设计**：从全局到局部，从通用到特定
- **增量更新**：减少重复传输，提高效率
- **动态组合**：根据配置和运行时状态动态构建

### 2. 关键技术实现

- **文件发现**：BFS 搜索算法查找 GEMINI.md 文件
- **历史管理**：精选和验证机制确保历史记录质量
- **工具集成**：统一的工具注册和执行机制

### 3. 设计模式应用

- **Builder 模式**：ContextBuilder 构建安全检查上下文
- **Registry 模式**：ToolRegistry 管理工具注册
- **Strategy 模式**：不同的上下文加载策略

### 4. 最佳实践

- **错误处理**：完善的错误处理和重试机制
- **可配置性**：丰富的配置选项支持定制
- **可扩展性**：插件化的工具和扩展系统

## 相关文档

- [架构概览](./architecture.md)
- [系统提示词构建深度解析](./system-prompt-deep-dive.md) - **详细解析系统提示词构建机制**
- [环境上下文构建深度解析](./environment-context-deep-dive.md) - **详细解析环境上下文构建机制**
- [环境上下文更新机制](./environment-context-update-mechanism.md) - **详细解析环境上下文何时更新、如何更新**
- [初始历史记录构建深度解析](./initial-history-deep-dive.md) - **详细解析初始历史记录构建机制**
- [初始化过程深度解析](./initialization-deep-dive.md) - **详细解析初始化过程机制**
- [运行时过程深度解析](./runtime-process-deep-dive.md) - **详细解析运行时过程机制**
- [IDE 集成深度解析](./ide-integration-deep-dive.md) - **详细解析 IDE 集成机制，包括如何开发改版 VSCode IDE 连接**
- [关键组件总结](./key-components-summary.md) - **Hook 系统、策略引擎、历史压缩、IDE 集成、模型路由、循环检测、MessageBus 等关键组件**
- [GEMINI.md 文档](./cli/gemini-md.md)
- [配置指南](./get-started/configuration.md)
- [工具 API](./core/tools-api.md)

