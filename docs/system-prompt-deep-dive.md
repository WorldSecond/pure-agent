# 系统提示词构建深度解析

## 概述

系统提示词（System Prompt）最重要的组件之一，它定义了 AI 代理的行为准则、工作流程和操作规范。本文档详细解析 `getCoreSystemPrompt()` 函数的实现机制。

## 核心函数

**位置：** `packages/core/src/core/prompts.ts`

**函数签名：**
```typescript
export function getCoreSystemPrompt(
  config: Config,
  userMemory?: string,
): string
```

## 函数调用链

```
GeminiClient.startChat()
  ↓
getCoreSystemPrompt(config, systemMemory)
  ↓
GeminiChat(systemInstruction, tools, history)
```

**关键调用位置：**
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

## 构建流程详解

### 阶段 1: 自定义系统提示词检查

**代码位置：** `packages/core/src/core/prompts.ts:84-106`

**功能：** 检查是否使用自定义系统提示词文件

```typescript
// 检查环境变量 GEMINI_SYSTEM_MD
let systemMdEnabled = false;
let systemMdPath = path.resolve(path.join(GEMINI_DIR, 'system.md'));
const systemMdResolution = resolvePathFromEnv(
  process.env['GEMINI_SYSTEM_MD'],
);

if (systemMdResolution.value && !systemMdResolution.isDisabled) {
  systemMdEnabled = true;
  if (!systemMdResolution.isSwitch) {
    systemMdPath = systemMdResolution.value;
  }
  // 如果启用但文件不存在，抛出错误
  if (!fs.existsSync(systemMdPath)) {
    throw new Error(`missing system prompt file '${systemMdPath}'`);
  }
}
```

**环境变量支持：**
- `GEMINI_SYSTEM_MD=true` 或 `GEMINI_SYSTEM_MD=1`：使用默认路径 `~/.gemini/system.md`
- `GEMINI_SYSTEM_MD=/path/to/custom.md`：使用自定义路径
- `GEMINI_SYSTEM_MD=false` 或 `GEMINI_SYSTEM_MD=0`：禁用自定义，使用内置提示词

**如果启用自定义文件：**
```typescript
if (systemMdEnabled) {
  basePrompt = fs.readFileSync(systemMdPath, 'utf8');
  // 直接返回文件内容，跳过所有内置提示词构建
}
```

### 阶段 2: 运行时配置检测

**代码位置：** `packages/core/src/core/prompts.ts:108-131`

**功能：** 检测模型类型、工具可用性、交互模式等

```typescript
// 1. 检测模型类型
const desiredModel = resolveModel(
  config.getActiveModel(),
  config.getPreviewFeatures(),
);
const isGemini3 = isPreviewModel(desiredModel);

// 2. 根据模型类型添加特定指令
const mandatesVariant = isGemini3
  ? `
- **Explain Before Acting:** Never call tools in silence. You MUST provide a concise, one-sentence explanation of your intent or strategy immediately before executing tool calls. This is essential for transparency, especially when confirming a request or answering a question. Silence is only acceptable for repetitive, low-level discovery operations (e.g., sequential file reads) where narration would be noisy.`
  : ``;

// 3. 检测工具可用性
const enableCodebaseInvestigator = config
  .getToolRegistry()
  .getAllToolNames()
  .includes(CodebaseInvestigatorAgent.name);

const enableWriteTodosTool = config
  .getToolRegistry()
  .getAllToolNames()
  .includes(WriteTodosTool.Name);

// 4. 检测交互模式
const interactiveMode = config.isInteractive();

// 5. 获取可用技能
const skills = config.getSkillManager().getSkills();
```

**关键点：**
- 根据模型版本（Gemini 3）添加特定行为要求
- 根据可用工具动态调整工作流程
- 交互模式影响提示词内容（是否允许询问用户）

### 阶段 3: 技能系统集成

**代码位置：** `packages/core/src/core/prompts.ts:133-155`

**功能：** 如果有可用技能，生成技能列表提示

```typescript
const skills = config.getSkillManager().getSkills();
let skillsPrompt = '';
if (skills.length > 0) {
  const skillsXml = skills
    .map(
      (skill) => `  <skill>
    <name>${skill.name}</name>
    <description>${skill.description}</description>
    <location>${skill.location}</location>
  </skill>`,
    )
    .join('\n');

  skillsPrompt = `
# Available Agent Skills

You have access to the following specialized skills. To activate a skill and receive its detailed instructions, you can call the \`${ACTIVATE_SKILL_TOOL_NAME}\` tool with the skill's name.

<available_skills>
${skillsXml}
</available_skills>
`;
}
```

### 阶段 4: 提示词配置对象构建

**代码位置：** `packages/core/src/core/prompts.ts:161-359`

**功能：** 构建包含所有提示词部分的配置对象

#### 4.1 Preamble（前言）

```typescript
preamble: `You are ${interactiveMode ? 'an interactive ' : 'a non-interactive '}CLI agent specializing in software engineering tasks. Your primary goal is to help users safely and efficiently, adhering strictly to the following instructions and utilizing your available tools.`,
```

**作用：** 定义代理的基本身份和角色

#### 4.2 Core Mandates（核心指令）

**代码位置：** `packages/core/src/core/prompts.ts:163-186`

**包含内容：**
- **Conventions（约定）**：严格遵循项目约定
- **Libraries/Frameworks（库/框架）**：不假设库可用，需验证
- **Style & Structure（风格和结构）**：模仿现有代码风格
- **Idiomatic Changes（惯用更改）**：确保更改自然集成
- **Comments（注释）**：谨慎添加注释，关注"为什么"而非"是什么"
- **Proactiveness（主动性）**：彻底完成请求，包括添加测试
- **Confirm Ambiguity/Expansion（确认模糊/扩展）**：交互模式下确认超出范围的操作
- **Explaining Changes（解释更改）**：完成后不提供摘要（除非被要求）
- **Do Not revert changes（不撤销更改）**：除非用户要求或出错
- **Skill Guidance（技能指导）**：如果启用了技能系统
- **Explain Before Acting（行动前解释）**：Gemini 3 模型特有
- **Continue the work（继续工作）**：非交互模式下的指令

**关键代码片段：**
```163:186:packages/core/src/core/prompts.ts
      coreMandates: `
# Core Mandates

- **Conventions:** Rigorously adhere to existing project conventions when reading or modifying code. Analyze surrounding code, tests, and configuration first.
- **Libraries/Frameworks:** NEVER assume a library/framework is available or appropriate. Verify its established usage within the project (check imports, configuration files like 'package.json', 'Cargo.toml', 'requirements.txt', 'build.gradle', etc., or observe neighboring files) before employing it.
- **Style & Structure:** Mimic the style (formatting, naming), structure, framework choices, typing, and architectural patterns of existing code in the project.
- **Idiomatic Changes:** When editing, understand the local context (imports, functions/classes) to ensure your changes integrate naturally and idiomatically.
- **Comments:** Add code comments sparingly. Focus on *why* something is done, especially for complex logic, rather than *what* is done. Only add high-value comments if necessary for clarity or if requested by the user. Do not edit comments that are separate from the code you are changing. *NEVER* talk to the user or describe your changes through comments.
- **Proactiveness:** Fulfill the user's request thoroughly. When adding features or fixing bugs, this includes adding tests to ensure quality. Consider all created files, especially tests, to be permanent artifacts unless the user says otherwise.
- ${interactiveMode ? `**Confirm Ambiguity/Expansion:** Do not take significant actions beyond the clear scope of the request without confirming with the user. If asked *how* to do something, explain first, don't just do it.` : `**Handle Ambiguity/Expansion:** Do not take significant actions beyond the clear scope of the request.`}
- **Explaining Changes:** After completing a code modification or file operation *do not* provide summaries unless asked.
- **Do Not revert changes:** Do not revert changes to the codebase unless asked to do so by the user. Only revert changes made by you if they have resulted in an error or if the user has explicitly asked you to revert the changes.${
        skills.length > 0
          ? `
- **Skill Guidance:** Once a skill is activated via \`${ACTIVATE_SKILL_TOOL_NAME}\`, its instructions and resources are returned wrapped in \`<activated_skill>\` tags. You MUST treat the content within \`<instructions>\` as expert procedural guidance, prioritizing these specialized rules and workflows over your general defaults for the duration of the task. You may utilize any listed \`<available_resources>\` as needed. Follow this expert guidance strictly while continuing to uphold your core safety and security standards.`
          : ''
      }${mandatesVariant}${
        !interactiveMode
          ? `
  - **Continue the work** You are not to interact with the user. Do your best to complete the task at hand, using your best judgement and avoid asking user for any additional information.`
          : ''
      }

${config.getAgentRegistry().getDirectoryContext()}${skillsPrompt}`,
```

#### 4.3 Primary Workflows（主要工作流程）

**代码位置：** `packages/core/src/core/prompts.ts:187-248`

**根据工具可用性选择不同版本：**

1. **基础版本** (`primaryWorkflows_prefix`)：标准工作流程
2. **Codebase Investigator 版本** (`primaryWorkflows_prefix_ci`)：启用代码库调查工具
3. **Write Todos 版本** (`primaryWorkflows_todo`)：启用待办事项工具
4. **完整版本** (`primaryWorkflows_prefix_ci_todo`)：同时启用两个工具

**工作流程步骤：**

**软件工程任务：**
1. **Understand（理解）**：使用搜索工具理解代码库
2. **Plan（计划）**：制定基于理解的计划
3. **Implement（实现）**：使用工具执行计划
4. **Verify (Tests)（验证-测试）**：运行测试验证
5. **Verify (Standards)（验证-标准）**：运行构建、lint、类型检查
6. **Finalize（完成）**：任务完成

**新应用开发：**
1. **Understand Requirements（理解需求）**
2. **Propose Plan（提出计划）**
3. **User Approval（用户批准）**（仅交互模式）
4. **Implementation（实现）**
5. **Verify（验证）**
6. **Solicit Feedback（征求反馈）**（仅交互模式）

**关键代码：**
```187:248:packages/core/src/core/prompts.ts
      primaryWorkflows_prefix: `
# Primary Workflows

## Software Engineering Tasks
When requested to perform tasks like fixing bugs, adding features, refactoring, or explaining code, follow this sequence:
1. **Understand:** Think about the user's request and the relevant codebase context. Use '${GREP_TOOL_NAME}' and '${GLOB_TOOL_NAME}' search tools extensively (in parallel if independent) to understand file structures, existing code patterns, and conventions.
Use '${READ_FILE_TOOL_NAME}' to understand context and validate any assumptions you may have. If you need to read multiple files, you should make multiple parallel calls to '${READ_FILE_TOOL_NAME}'.
2. **Plan:** Build a coherent and grounded (based on the understanding in step 1) plan for how you intend to resolve the user's task. Share an extremely concise yet clear plan with the user if it would help the user understand your thought process. As part of the plan, you should use an iterative development process that includes writing unit tests to verify your changes. Use output logs or debug statements as part of this process to arrive at a solution.`,
```

#### 4.4 Operational Guidelines（操作指南）

**代码位置：** `packages/core/src/core/prompts.ts:249-306`

**包含内容：**

1. **Shell 工具输出效率**（如果启用）：
   - 使用静默标志减少输出
   - 重定向输出到临时文件
   - 使用 grep/tail/head 检查结果

2. **Tone and Style（语调和风格）**：
   - 简洁直接
   - 最小输出（少于 3 行）
   - 清晰优先于简洁
   - 无闲聊
   - 使用 GitHub Markdown

3. **Security and Safety Rules（安全和安全规则）**：
   - 解释关键命令
   - 安全优先

4. **Tool Usage（工具使用）**：
   - 并行执行独立工具调用
   - 使用 Shell 工具运行命令
   - 后台进程处理
   - 交互式命令处理
   - 使用 Memory 工具记住用户偏好

#### 4.5 Sandbox（沙箱）

**代码位置：** `packages/core/src/core/prompts.ts:307-329`

**根据沙箱类型添加不同说明：**
- macOS Seatbelt
- 通用沙箱
- 非沙箱环境

#### 4.6 Git（Git 仓库）

**代码位置：** `packages/core/src/core/prompts.ts:330-355`

**如果当前目录是 Git 仓库，添加 Git 相关指令：**
- 提交前检查状态
- 查看差异
- 查看最近提交
- 提议提交消息
- 确认提交成功
- 不推送除非明确要求

#### 4.7 Final Reminder（最终提醒）

**代码位置：** `packages/core/src/core/prompts.ts:356-359`

```typescript
finalReminder: `
# Final Reminder
Your core function is efficient and safe assistance. Balance extreme conciseness with the crucial need for clarity, especially regarding safety and potential system modifications. Always prioritize user control and project conventions. Never make assumptions about the contents of files; instead use '${READ_FILE_TOOL_NAME}' to ensure you aren't making broad assumptions. Finally, you are an agent - please keep going until the user's query is completely resolved.`,
```

### 阶段 5: 提示词部分排序和过滤

**代码位置：** `packages/core/src/core/prompts.ts:361-391`

**功能：** 根据配置决定包含哪些部分，并按顺序组装

```typescript
// 1. 定义基础顺序
const orderedPrompts: Array<keyof typeof promptConfig> = [
  'preamble',
  'coreMandates',
];

// 2. 根据工具可用性选择工作流程版本
if (enableCodebaseInvestigator && enableWriteTodosTool) {
  orderedPrompts.push('primaryWorkflows_prefix_ci_todo');
} else if (enableCodebaseInvestigator) {
  orderedPrompts.push('primaryWorkflows_prefix_ci');
} else if (enableWriteTodosTool) {
  orderedPrompts.push('primaryWorkflows_todo');
} else {
  orderedPrompts.push('primaryWorkflows_prefix');
}

// 3. 添加固定部分
orderedPrompts.push(
  'primaryWorkflows_suffix',
  'operationalGuidelines',
  'sandbox',
  'git',
  'finalReminder',
);

// 4. 通过环境变量过滤禁用的部分
const enabledPrompts = orderedPrompts.filter((key) => {
  const envVar = process.env[`GEMINI_PROMPT_${key.toUpperCase()}`];
  const lowerEnvVar = envVar?.trim().toLowerCase();
  return lowerEnvVar !== '0' && lowerEnvVar !== 'false';
});

// 5. 组装最终提示词
basePrompt = enabledPrompts.map((key) => promptConfig[key]).join('\n');
```

**环境变量控制：**
- `GEMINI_PROMPT_PREAMBLE=0`：禁用前言
- `GEMINI_PROMPT_COREMANDATES=false`：禁用核心指令
- 等等...

### 阶段 6: 可选导出到文件

**代码位置：** `packages/core/src/core/prompts.ts:394-408`

**功能：** 如果设置了 `GEMINI_WRITE_SYSTEM_MD`，将构建的提示词写入文件

```typescript
const writeSystemMdResolution = resolvePathFromEnv(
  process.env['GEMINI_WRITE_SYSTEM_MD'],
);

if (writeSystemMdResolution.value && !writeSystemMdResolution.isDisabled) {
  const writePath = writeSystemMdResolution.isSwitch
    ? systemMdPath
    : writeSystemMdResolution.value;

  fs.mkdirSync(path.dirname(writePath), { recursive: true });
  fs.writeFileSync(writePath, basePrompt);
}
```

**用途：** 调试和审查实际使用的系统提示词

### 阶段 7: 附加用户内存

**代码位置：** `packages/core/src/core/prompts.ts:410-417`

**功能：** 将用户内存（GEMINI.md 内容）附加到系统提示词末尾

```typescript
basePrompt = basePrompt.trim();

const memorySuffix =
  userMemory && userMemory.trim().length > 0
    ? `\n\n---\n\n${userMemory.trim()}`
    : '';

return `${basePrompt}${memorySuffix}`;
```

**格式：**
```
[基础提示词内容]

---

[用户内存内容]
```

## 完整构建流程图

```
开始 getCoreSystemPrompt()
  ↓
检查 GEMINI_SYSTEM_MD 环境变量
  ↓
┌─────────────────────────┐
│ 是否启用自定义文件？      │
└─────────────────────────┘
  │                    │
 是                    否
  │                    │
  ↓                    ↓
读取自定义文件        检测运行时配置
  │                    ├─ 模型类型
  │                    ├─ 工具可用性
  │                    ├─ 交互模式
  │                    └─ 可用技能
  │                    ↓
  │                   构建提示词配置对象
  │                    ├─ preamble
  │                    ├─ coreMandates
  │                    ├─ primaryWorkflows (4种变体)
  │                    ├─ operationalGuidelines
  │                    ├─ sandbox
  │                    ├─ git
  │                    └─ finalReminder
  │                    ↓
  │                   排序和过滤提示词部分
  │                    ├─ 根据工具选择工作流程版本
  │                    ├─ 按顺序添加固定部分
  │                    └─ 过滤环境变量禁用的部分
  │                    ↓
  │                   组装基础提示词
  │                    ↓
  │                   检查 GEMINI_WRITE_SYSTEM_MD
  │                    ↓
  │                   可选：写入文件
  │                    ↓
  └────────────────────┘
  ↓
附加用户内存（userMemory）
  ↓
返回最终系统提示词
```

## 关键代码位置总结

| 功能 | 代码位置 | 行号范围 |
|------|---------|---------|
| 函数入口 | `packages/core/src/core/prompts.ts` | 80-418 |
| 自定义文件检查 | `packages/core/src/core/prompts.ts` | 84-106 |
| 运行时配置检测 | `packages/core/src/core/prompts.ts` | 108-131 |
| 技能系统集成 | `packages/core/src/core/prompts.ts` | 133-155 |
| 提示词配置对象 | `packages/core/src/core/prompts.ts` | 161-359 |
| 部分排序和过滤 | `packages/core/src/core/prompts.ts` | 361-391 |
| 导出到文件 | `packages/core/src/core/prompts.ts` | 394-408 |
| 附加用户内存 | `packages/core/src/core/prompts.ts` | 410-417 |
| 调用位置 | `packages/core/src/core/client.ts` | 299, 320 |

## 设计特点

### 1. 模块化设计

每个提示词部分都是独立的配置项，可以：
- 单独启用/禁用
- 根据条件选择不同版本
- 动态调整内容

### 2. 条件化构建

根据以下条件动态调整：
- **模型类型**：Gemini 3 有特殊要求
- **工具可用性**：不同工具组合使用不同工作流程
- **交互模式**：交互/非交互模式内容不同
- **环境状态**：Git 仓库、沙箱环境等

### 3. 可扩展性

- **技能系统**：动态添加技能列表
- **环境变量控制**：通过环境变量禁用部分
- **自定义覆盖**：完全自定义系统提示词

### 4. 用户定制

- **用户内存**：通过 GEMINI.md 文件添加项目特定指令
- **自定义系统提示词**：完全替换默认提示词
- **部分禁用**：选择性禁用不需要的部分

## 实际使用示例

### 示例 1: 标准交互模式

```typescript
const config = {
  isInteractive: () => true,
  getActiveModel: () => 'gemini-2.0-flash',
  // ...
};

const userMemory = `
# 项目特定指令
- 使用 TypeScript 严格模式
- 所有函数必须有 JSDoc 注释
`;

const systemPrompt = getCoreSystemPrompt(config, userMemory);
// 结果：包含交互模式指令，附加用户内存
```

### 示例 2: 非交互模式 + Codebase Investigator

```typescript
const config = {
  isInteractive: () => false,
  getToolRegistry: () => ({
    getAllToolNames: () => ['codebase_investigator', ...]
  }),
  // ...
};

const systemPrompt = getCoreSystemPrompt(config);
// 结果：使用 primaryWorkflows_prefix_ci 版本，包含非交互模式指令
```

### 示例 3: 自定义系统提示词

```bash
# 设置环境变量
export GEMINI_SYSTEM_MD=/path/to/custom-system.md

# 运行 CLI
gemini
```

```typescript
// 函数会直接读取文件内容，跳过所有内置构建逻辑
const systemPrompt = getCoreSystemPrompt(config);
// 结果：完全使用自定义文件内容
```

## 调试技巧

### 1. 导出系统提示词

```bash
export GEMINI_WRITE_SYSTEM_MD=/tmp/system-prompt.md
gemini
# 查看 /tmp/system-prompt.md 查看实际使用的提示词
```

### 2. 禁用特定部分

```bash
export GEMINI_PROMPT_GIT=0  # 禁用 Git 部分
export GEMINI_PROMPT_SANDBOX=false  # 禁用沙箱部分
gemini
```

### 3. 查看用户内存

使用 `/memory show` 命令查看加载的用户内存内容

## 总结

`getCoreSystemPrompt()` 函数是一个高度模块化和可配置的系统提示词构建器，它：

1. **支持完全自定义**：可以通过文件完全替换
2. **动态适应环境**：根据模型、工具、模式等调整内容
3. **模块化设计**：各部分独立，可选择性启用
4. **用户可扩展**：通过 GEMINI.md 添加项目特定指令
5. **易于调试**：支持导出和部分禁用

这种设计使得系统提示词既能提供强大的默认行为，又能灵活适应不同使用场景和用户需求。

