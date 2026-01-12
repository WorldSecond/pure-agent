# 初始化过程深度解析

## 概述

初始化过程是 Gemini CLI 启动时的核心流程，它负责加载配置、初始化服务、建立连接，为后续的交互做好准备。本文档详细解析从程序入口到完全就绪的完整初始化机制。

## 初始化流程图

```
程序启动 (main)
  ↓
1. 基础设置加载
  ├─ 加载设置文件 (loadSettings)
  ├─ 加载受信任文件夹配置
  └─ 清理检查点
  ↓
2. 参数解析
  ├─ 解析命令行参数
  └─ 验证参数组合
  ↓
3. 配置创建 (loadCliConfig)
  ├─ 创建 FileDiscoveryService
  ├─ 加载扩展
  ├─ 加载内存文件 (GEMINI.md)
  ├─ 创建 Config 对象
  └─ 返回部分配置
  ↓
4. 认证处理
  ├─ 验证认证方法
  └─ 刷新认证 (refreshAuth)
  ↓
5. 沙箱处理 (可选)
  ├─ 加载沙箱配置
  └─ 进入沙箱环境
  ↓
6. Config 初始化 (config.initialize)
  ├─ 初始化文件服务
  ├─ 初始化 Git 服务 (如果启用)
  ├─ 创建注册表 (Prompt, Resource, Agent)
  ├─ 创建工具注册表
  ├─ 初始化 MCP 客户端
  ├─ 启动扩展
  ├─ 发现技能
  ├─ 初始化 Hook 系统
  ├─ 初始化上下文管理器 (如果启用)
  └─ 初始化 GeminiClient
  ↓
7. 应用初始化 (initializeApp)
  ├─ 执行初始认证
  ├─ 验证主题
  ├─ 记录配置日志
  └─ 连接 IDE 客户端 (如果启用)
  ↓
8. GeminiClient 初始化
  ├─ 启动聊天会话 (startChat)
  └─ 更新遥测 token 计数
  ↓
初始化完成
```

## 详细步骤解析

### 阶段 1: 程序入口和基础设置

**位置：** `packages/cli/src/gemini.tsx:285`

**main() 函数：**

```285:340:packages/cli/src/gemini.tsx
export async function main() {
  const cliStartupHandle = startupProfiler.start('cli_startup');
  const cleanupStdio = patchStdio();
  registerSyncCleanup(() => {
    // This is needed to ensure we don't lose any buffered output.
    initializeOutputListenersAndFlush();
    cleanupStdio();
  });

  setupUnhandledRejectionHandler();
  const loadSettingsHandle = startupProfiler.start('load_settings');
  const settings = loadSettings();
  loadSettingsHandle?.end();

  // Report settings errors once during startup
  settings.errors.forEach((error) => {
    coreEvents.emitFeedback('warning', error.message);
  });

  const trustedFolders = loadTrustedFolders();
  trustedFolders.errors.forEach((error: TrustedFoldersError) => {
    coreEvents.emitFeedback(
      'warning',
      `Error in ${error.path}: ${error.message}`,
    );
  });

  await cleanupCheckpoints();

  const parseArgsHandle = startupProfiler.start('parse_arguments');
  const argv = await parseArguments(settings.merged);
  parseArgsHandle?.end();
```

**关键步骤：**

1. **性能分析器启动**：开始跟踪启动时间
2. **标准输入输出补丁**：设置清理函数
3. **未处理拒绝处理器**：捕获未处理的 Promise 拒绝
4. **加载设置**：从多个位置加载设置文件
   - 系统默认设置
   - 用户设置 (`~/.gemini/settings.json`)
   - 工作区设置 (`.gemini/settings.json`)
5. **加载受信任文件夹**：加载文件夹信任配置
6. **清理检查点**：清理旧的检查点文件
7. **解析参数**：解析命令行参数

### 阶段 2: 配置创建

**位置：** `packages/cli/src/config/config.ts:397`

**loadCliConfig() 函数：**

**步骤 1: 准备配置参数**

```397:455:packages/cli/src/config/config.ts
export async function loadCliConfig(
  settings: Settings,
  sessionId: string,
  argv: CliArgs,
  options: LoadCliConfigOptions = {},
): Promise<Config> {
  const { cwd = process.cwd(), projectHooks } = options;
  const debugMode = isDebugMode(argv);

  const loadedSettings = loadSettings(cwd);

  if (argv.sandbox) {
    process.env['GEMINI_SANDBOX'] = 'true';
  }

  const memoryImportFormat = settings.context?.importFormat || 'tree';

  const ideMode = settings.ide?.enabled ?? false;

  const folderTrust = settings.security?.folderTrust?.enabled ?? false;
  const trustedFolder = isWorkspaceTrusted(settings)?.isTrusted ?? false;

  // Set the context filename in the server's memoryTool module BEFORE loading memory
  // TODO(b/343434939): This is a bit of a hack. The contextFileName should ideally be passed
  // directly to the Config constructor in core, and have core handle setGeminiMdFilename.
  // However, loadHierarchicalGeminiMemory is called *before* createServerConfig.
  if (settings.context?.fileName) {
    setServerGeminiMdFilename(settings.context.fileName);
  } else {
    // Reset to default if not provided in settings.
    setServerGeminiMdFilename(getCurrentGeminiMdFilename());
  }

  const fileService = new FileDiscoveryService(cwd);

  const memoryFileFiltering = {
    ...DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
    ...settings.context?.fileFiltering,
  };

  const fileFiltering = {
    ...DEFAULT_FILE_FILTERING_OPTIONS,
    ...settings.context?.fileFiltering,
  };

  const includeDirectories = (settings.context?.includeDirectories || [])
    .map(resolvePath)
    .concat((argv.includeDirectories || []).map(resolvePath));

  const extensionManager = new ExtensionManager({
    settings,
    requestConsent: requestConsentNonInteractive,
    requestSetting: promptForSetting,
    workspaceDir: cwd,
    enabledExtensionOverrides: argv.extensions,
    eventEmitter: appEvents as EventEmitter<ExtensionEvents>,
  });
  await extensionManager.loadExtensions();
```

**步骤 2: 加载内存文件**

```456:478:packages/cli/src/config/config.ts
  const experimentalJitContext = settings.experimental?.jitContext ?? false;

  let memoryContent = '';
  let fileCount = 0;
  let filePaths: string[] = [];

  if (!experimentalJitContext) {
    // Call the (now wrapper) loadHierarchicalGeminiMemory which calls the server's version
    const result = await loadServerHierarchicalMemory(
      cwd,
      [],
      debugMode,
      fileService,
      extensionManager,
      trustedFolder,
      memoryImportFormat,
      memoryFileFiltering,
      settings.context?.discoveryMaxDirs,
    );
    memoryContent = result.memoryContent;
    fileCount = result.fileCount;
    filePaths = result.filePaths;
  }
```

**步骤 3: 确定批准模式**

```480:535:packages/cli/src/config/config.ts
  const question = argv.promptInteractive || argv.prompt || '';

  // Determine approval mode with backward compatibility
  let approvalMode: ApprovalMode;
  if (argv.approvalMode) {
    // New --approval-mode flag takes precedence
    switch (argv.approvalMode) {
      case 'yolo':
        approvalMode = ApprovalMode.YOLO;
        break;
      case 'auto_edit':
        approvalMode = ApprovalMode.AUTO_EDIT;
        break;
      case 'default':
        approvalMode = ApprovalMode.DEFAULT;
        break;
      default:
        throw new Error(
          `Invalid approval mode: ${argv.approvalMode}. Valid values are: yolo, auto_edit, default`,
        );
    }
  } else {
    // Fallback to legacy --yolo flag behavior
    approvalMode =
      argv.yolo || false ? ApprovalMode.YOLO : ApprovalMode.DEFAULT;
  }

  // Override approval mode if disableYoloMode is set.
  if (settings.security?.disableYoloMode || settings.admin?.secureModeEnabled) {
    if (approvalMode === ApprovalMode.YOLO) {
      if (settings.admin?.secureModeEnabled) {
        debugLogger.error(
          'YOLO mode is disabled by "secureModeEnabled" setting.',
        );
      } else {
        debugLogger.error(
          'YOLO mode is disabled by the "disableYolo" setting.',
        );
      }
      throw new FatalConfigError(
        'Cannot start in YOLO mode since it is disabled by your admin',
      );
    }
  } else if (approvalMode === ApprovalMode.YOLO) {
    debugLogger.warn(
      'YOLO mode is enabled. All tool calls will be automatically approved.',
    );
  }

  // Force approval mode to default if the folder is not trusted.
  if (!trustedFolder && approvalMode !== ApprovalMode.DEFAULT) {
    debugLogger.warn(
      `Approval mode overridden to "default" because the current folder is not trusted.`,
    );
    approvalMode = ApprovalMode.DEFAULT;
  }
```

**步骤 4: 创建 Config 对象**

```641:754:packages/cli/src/config/config.ts
  return new Config({
    sessionId,
    embeddingModel: DEFAULT_GEMINI_EMBEDDING_MODEL,
    sandbox: sandboxConfig,
    targetDir: cwd,
    includeDirectories,
    loadMemoryFromIncludeDirectories:
      settings.context?.loadMemoryFromIncludeDirectories || false,
    debugMode,
    question,
    previewFeatures: settings.general?.previewFeatures,

    coreTools: settings.tools?.core || undefined,
    allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
    policyEngineConfig,
    excludeTools,
    toolDiscoveryCommand: settings.tools?.discoveryCommand,
    toolCallCommand: settings.tools?.callCommand,
    mcpServerCommand: mcpEnabled ? settings.mcp?.serverCommand : undefined,
    mcpServers: mcpEnabled ? settings.mcpServers : {},
    mcpEnabled,
    extensionsEnabled,
    allowedMcpServers: mcpEnabled
      ? (argv.allowedMcpServerNames ?? settings.mcp?.allowed)
      : undefined,
    blockedMcpServers: mcpEnabled
      ? argv.allowedMcpServerNames
        ? undefined
        : settings.mcp?.excluded
      : undefined,
    blockedEnvironmentVariables:
      settings.security?.environmentVariableRedaction?.blocked,
    enableEnvironmentVariableRedaction:
      settings.security?.environmentVariableRedaction?.enabled,
    userMemory: memoryContent,
    geminiMdFileCount: fileCount,
    geminiMdFilePaths: filePaths,
    approvalMode,
    disableYoloMode:
      settings.security?.disableYoloMode || settings.admin?.secureModeEnabled,
    showMemoryUsage: settings.ui?.showMemoryUsage || false,
    accessibility: {
      ...settings.ui?.accessibility,
      screenReader,
    },
    telemetry: telemetrySettings,
    // ... 更多配置参数
  });
```

### 阶段 3: Config 构造函数

**位置：** `packages/core/src/config/config.ts:503`

**构造函数职责：**

```503:713:packages/core/src/config/config.ts
  constructor(params: ConfigParameters) {
    this.sessionId = params.sessionId;
    this.embeddingModel =
      params.embeddingModel ?? DEFAULT_GEMINI_EMBEDDING_MODEL;
    this.fileSystemService = new StandardFileSystemService();
    this.sandbox = params.sandbox;
    this.targetDir = path.resolve(params.targetDir);
    this.folderTrust = params.folderTrust ?? false;
    this.workspaceContext = new WorkspaceContext(this.targetDir, []);
    this.pendingIncludeDirectories = params.includeDirectories ?? [];
    this.debugMode = params.debugMode;
    this.question = params.question;

    // ... 设置所有配置属性

    this.storage = new Storage(this.targetDir);
    this.fileExclusions = new FileExclusions(this);
    this.eventEmitter = params.eventEmitter;
    this.policyEngine = new PolicyEngine({
      ...params.policyEngineConfig,
      approvalMode:
        params.approvalMode ?? params.policyEngineConfig?.approvalMode,
    });
    this.messageBus = new MessageBus(this.policyEngine, this.debugMode);
    this.skillManager = new SkillManager();

    // ... 更多初始化

    if (this.telemetrySettings.enabled) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      initializeTelemetry(this);
    }

    const proxy = this.getProxy();
    if (proxy) {
      try {
        setGlobalProxy(proxy);
      } catch (error) {
        coreEvents.emitFeedback(
          'error',
          'Invalid proxy configuration detected. Check debug drawer for more details (F12)',
          error,
        );
      }
    }
    this.geminiClient = new GeminiClient(this);
    this.modelRouterService = new ModelRouterService(this);

    // ... 模型配置服务初始化

    this.modelConfigService = new ModelConfigService(
      modelConfigServiceConfig ?? DEFAULT_MODEL_CONFIGS,
    );
  }
```

**关键初始化：**

1. **基础属性设置**：会话 ID、模型、目录等
2. **服务创建**：
   - `FileSystemService`：文件系统服务
   - `WorkspaceContext`：工作区上下文
   - `Storage`：存储服务
   - `PolicyEngine`：策略引擎
   - `MessageBus`：消息总线
   - `SkillManager`：技能管理器
3. **客户端创建**：
   - `GeminiClient`：Gemini 客户端
   - `ModelRouterService`：模型路由服务
4. **遥测初始化**：如果启用
5. **代理设置**：如果配置了代理

### 阶段 4: Config.initialize() - 异步初始化

**位置：** `packages/core/src/config/config.ts:718`

**这是最重要的初始化阶段：**

```718:778:packages/core/src/config/config.ts
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw Error('Config was already initialized');
    }
    this.initialized = true;

    // Initialize centralized FileDiscoveryService
    const discoverToolsHandle = startupProfiler.start('discover_tools');
    this.getFileService();
    if (this.getCheckpointingEnabled()) {
      await this.getGitService();
    }
    this.promptRegistry = new PromptRegistry();
    this.resourceRegistry = new ResourceRegistry();

    this.agentRegistry = new AgentRegistry(this);
    await this.agentRegistry.initialize();

    this.toolRegistry = await this.createToolRegistry();
    discoverToolsHandle?.end();
    this.mcpClientManager = new McpClientManager(
      this.toolRegistry,
      this,
      this.eventEmitter,
    );
    const initMcpHandle = startupProfiler.start('initialize_mcp_clients');
    await Promise.all([
      await this.mcpClientManager.startConfiguredMcpServers(),
      await this.getExtensionLoader().start(this),
    ]);
    initMcpHandle?.end();

    // Discover skills if enabled
    if (this.skillsSupport) {
      await this.getSkillManager().discoverSkills(
        this.storage,
        this.getExtensions(),
      );
      this.getSkillManager().setDisabledSkills(this.disabledSkills);

      // Re-register ActivateSkillTool to update its schema with the discovered enabled skill enums
      if (this.getSkillManager().getSkills().length > 0) {
        this.getToolRegistry().registerTool(
          new ActivateSkillTool(this, this.messageBus),
        );
      }
    }

    // Initialize hook system if enabled
    if (this.getEnableHooks()) {
      this.hookSystem = new HookSystem(this);
      await this.hookSystem.initialize();
    }

    if (this.experimentalJitContext) {
      this.contextManager = new ContextManager(this);
      await this.contextManager.refresh();
    }

    await this.geminiClient.initialize();
  }
```

**初始化步骤详解：**

#### 4.1 文件服务初始化

```typescript
this.getFileService();
```

- 创建或获取 `FileDiscoveryService`
- 用于文件发现和过滤

#### 4.2 Git 服务初始化（如果启用）

```typescript
if (this.getCheckpointingEnabled()) {
  await this.getGitService();
}
```

- 创建 `GitService` 实例
- 初始化 Git 仓库连接
- 用于检查点功能

#### 4.3 注册表创建

```typescript
this.promptRegistry = new PromptRegistry();
this.resourceRegistry = new ResourceRegistry();
this.agentRegistry = new AgentRegistry(this);
await this.agentRegistry.initialize();
```

- **PromptRegistry**：提示词注册表
- **ResourceRegistry**：资源注册表
- **AgentRegistry**：代理注册表（需要异步初始化）

#### 4.4 工具注册表创建

```typescript
this.toolRegistry = await this.createToolRegistry();
```

**createToolRegistry() 流程：**

1. 创建 `ToolRegistry` 实例
2. 注册核心工具（文件操作、Shell、搜索等）
3. 注册代理工具（CodebaseInvestigator 等）
4. 应用工具过滤（allowed/excluded）
5. 返回注册表

#### 4.5 MCP 客户端和扩展初始化

```typescript
this.mcpClientManager = new McpClientManager(
  this.toolRegistry,
  this,
  this.eventEmitter,
);
await Promise.all([
  await this.mcpClientManager.startConfiguredMcpServers(),
  await this.getExtensionLoader().start(this),
]);
```

**并行初始化：**

- **MCP 服务器**：启动配置的 MCP 服务器
- **扩展加载器**：启动扩展系统

#### 4.6 技能发现（如果启用）

```typescript
if (this.skillsSupport) {
  await this.getSkillManager().discoverSkills(
    this.storage,
    this.getExtensions(),
  );
  this.getSkillManager().setDisabledSkills(this.disabledSkills);

  if (this.getSkillManager().getSkills().length > 0) {
    this.getToolRegistry().registerTool(
      new ActivateSkillTool(this, this.messageBus),
    );
  }
}
```

- 从存储和扩展中发现技能
- 设置禁用的技能
- 如果有技能，注册 `ActivateSkillTool`

#### 4.7 Hook 系统初始化（如果启用）

```typescript
if (this.getEnableHooks()) {
  this.hookSystem = new HookSystem(this);
  await this.hookSystem.initialize();
}
```

- 创建 `HookSystem` 实例
- 加载和初始化钩子

#### 4.8 上下文管理器初始化（如果启用 JIT）

```typescript
if (this.experimentalJitContext) {
  this.contextManager = new ContextManager(this);
  await this.contextManager.refresh();
}
```

- 创建 `ContextManager` 实例
- 刷新内存（加载全局和环境内存）

#### 4.9 GeminiClient 初始化

```typescript
await this.geminiClient.initialize();
```

### 阶段 5: GeminiClient.initialize()

**位置：** `packages/core/src/core/client.ts:209`

```209:212:packages/core/src/core/client.ts
  async initialize() {
    this.chat = await this.startChat();
    this.updateTelemetryTokenCount();
  }
```

**startChat() 调用：**

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
      await reportError(
        error,
        'Error initializing Gemini chat session.',
        history,
        'startChat',
      );
      throw new Error(`Failed to initialize chat: ${getErrorMessage(error)}`);
    }
  }
```

**关键步骤：**

1. **重置状态**：设置 IDE 上下文和压缩标志
2. **获取工具定义**：从工具注册表获取所有工具
3. **构建初始历史**：调用 `getInitialChatHistory()`
4. **构建系统提示词**：调用 `getCoreSystemPrompt()`
5. **创建 GeminiChat**：传入所有必要参数

### 阶段 6: 应用初始化

**位置：** `packages/cli/src/core/initializer.ts:35`

```35:67:packages/cli/src/core/initializer.ts
export async function initializeApp(
  config: Config,
  settings: LoadedSettings,
): Promise<InitializationResult> {
  const authHandle = startupProfiler.start('authenticate');
  const authError = await performInitialAuth(
    config,
    settings.merged.security?.auth?.selectedType,
  );
  authHandle?.end();
  const themeError = validateTheme(settings);

  const shouldOpenAuthDialog =
    settings.merged.security?.auth?.selectedType === undefined || !!authError;

  logCliConfiguration(
    config,
    new StartSessionEvent(config, config.getToolRegistry()),
  );

  if (config.getIdeMode()) {
    const ideClient = await IdeClient.getInstance();
    await ideClient.connect();
    logIdeConnection(config, new IdeConnectionEvent(IdeConnectionType.START));
  }

  return {
    authError,
    themeError,
    shouldOpenAuthDialog,
    geminiMdFileCount: config.getGeminiMdFileCount(),
  };
}
```

**关键步骤：**

1. **初始认证**：执行认证流程
2. **主题验证**：验证主题配置
3. **配置日志**：记录配置信息
4. **IDE 连接**：如果启用 IDE 模式，连接 IDE 客户端

## 初始化顺序总结

### 同步初始化（构造函数）

1. 基础属性设置
2. 服务实例创建（Storage, PolicyEngine, MessageBus 等）
3. GeminiClient 创建（但未初始化）
4. ModelRouterService 创建
5. ModelConfigService 创建
6. 遥测初始化（如果启用）
7. 代理设置（如果配置）

### 异步初始化（initialize()）

1. **文件服务**：`getFileService()`
2. **Git 服务**（如果启用）：`getGitService()`
3. **注册表**：PromptRegistry, ResourceRegistry, AgentRegistry
4. **工具注册表**：`createToolRegistry()`
5. **MCP 和扩展**：并行启动
6. **技能发现**（如果启用）
7. **Hook 系统**（如果启用）
8. **上下文管理器**（如果启用 JIT）
9. **GeminiClient**：`geminiClient.initialize()`

## 关键代码位置总结

| 功能 | 代码位置 | 行号范围 |
|------|---------|---------|
| 程序入口 | `packages/cli/src/gemini.tsx` | 285 |
| 加载设置 | `packages/cli/src/config/settings.ts` | 448 |
| 配置创建 | `packages/cli/src/config/config.ts` | 397-754 |
| Config 构造函数 | `packages/core/src/config/config.ts` | 503-713 |
| Config 初始化 | `packages/core/src/config/config.ts` | 718-778 |
| GeminiClient 构造函数 | `packages/core/src/core/client.ts` | 97-101 |
| GeminiClient 初始化 | `packages/core/src/core/client.ts` | 209-212 |
| startChat | `packages/core/src/core/client.ts` | 303-337 |
| 应用初始化 | `packages/cli/src/core/initializer.ts` | 35-67 |

## 初始化依赖关系

```
Config 构造函数
  ├─ 创建基础服务（同步）
  │   ├─ Storage
  │   ├─ PolicyEngine
  │   ├─ MessageBus
  │   └─ SkillManager
  ├─ 创建客户端（同步，未初始化）
  │   ├─ GeminiClient
  │   └─ ModelRouterService
  └─ 创建配置服务（同步）
      └─ ModelConfigService

Config.initialize() (异步)
  ├─ 文件服务
  ├─ Git 服务（可选）
  ├─ 注册表
  │   ├─ PromptRegistry
  │   ├─ ResourceRegistry
  │   └─ AgentRegistry
  ├─ 工具注册表
  │   └─ createToolRegistry()
  ├─ MCP 和扩展（并行）
  │   ├─ McpClientManager
  │   └─ ExtensionLoader
  ├─ 技能发现（可选）
  ├─ Hook 系统（可选）
  ├─ 上下文管理器（可选）
  └─ GeminiClient.initialize()
      └─ startChat()
          ├─ 构建工具定义
          ├─ 构建初始历史
          ├─ 构建系统提示词
          └─ 创建 GeminiChat
```

## 设计特点

### 1. 两阶段初始化

- **构造函数**：同步初始化，创建对象和基础服务
- **initialize()**：异步初始化，执行需要 I/O 的操作

### 2. 依赖管理

- **明确依赖顺序**：确保依赖的服务先初始化
- **并行初始化**：MCP 和扩展并行启动，提高性能

### 3. 错误处理

- **验证检查**：在初始化前验证配置
- **错误报告**：记录和报告初始化错误
- **优雅降级**：某些功能失败不影响整体启动

### 4. 性能优化

- **性能分析**：使用 `startupProfiler` 跟踪初始化时间
- **延迟加载**：某些服务按需创建
- **并行处理**：独立操作并行执行

### 5. 可扩展性

- **插件系统**：扩展和 MCP 服务器可动态加载
- **技能系统**：技能可动态发现和注册
- **Hook 系统**：可插入自定义逻辑

## 实际使用示例

### 示例 1: 标准初始化

```typescript
// 1. 加载设置
const settings = loadSettings();

// 2. 解析参数
const argv = await parseArguments(settings.merged);

// 3. 创建配置
const config = await loadCliConfig(settings, sessionId, argv);

// 4. 认证
await config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);

// 5. 初始化配置
await config.initialize();

// 6. 应用初始化
const initResult = await initializeApp(config, settings);
```

### 示例 2: 启用 JIT 上下文

```typescript
const config = await loadCliConfig(settings, sessionId, argv, {
  experimentalJitContext: true,
});

await config.initialize();
// ContextManager 会自动初始化并刷新内存
```

### 示例 3: 启用 Hook 系统

```typescript
const config = await loadCliConfig(settings, sessionId, argv, {
  enableHooks: true,
  hooks: {
    beforeAgent: './hooks/before-agent.js',
  },
});

await config.initialize();
// HookSystem 会自动初始化并加载钩子
```

## 调试技巧

### 1. 查看初始化时间

```typescript
// 性能分析器会自动记录各个阶段的耗时
startupProfiler.flush(config);
```

### 2. 检查初始化状态

```typescript
if (config.isInitialized()) {
  console.log('Config is initialized');
} else {
  console.log('Config is not initialized');
}
```

### 3. 查看已注册的工具

```typescript
const toolRegistry = config.getToolRegistry();
console.log('Registered tools:', toolRegistry.getAllToolNames());
```

### 4. 查看已加载的扩展

```typescript
const extensions = config.getExtensions();
console.log('Loaded extensions:', extensions.map(e => e.name));
```

## 常见问题

### 1. 初始化失败

**原因：**
- 认证失败
- 工具注册失败
- MCP 服务器启动失败

**解决：**
- 检查认证配置
- 查看错误日志
- 验证工具配置

### 2. 初始化缓慢

**原因：**
- 大量工具注册
- MCP 服务器启动慢
- 内存文件加载慢

**解决：**
- 减少工具数量
- 优化 MCP 服务器
- 减少内存文件数量

### 3. 工具未注册

**原因：**
- 工具被排除
- 工具注册失败
- 配置错误

**解决：**
- 检查 `excludeTools` 配置
- 查看工具注册日志
- 验证工具配置

## 总结

初始化过程是 Gemini CLI 的核心流程，它：

1. **分阶段初始化**：同步和异步分离，确保依赖正确
2. **并行处理**：独立操作并行执行，提高性能
3. **错误处理**：完善的错误处理和报告机制
4. **可扩展性**：支持扩展、MCP、技能、Hook 等
5. **性能优化**：性能分析和延迟加载

这种设计使得初始化过程既能快速启动，又能灵活扩展。

