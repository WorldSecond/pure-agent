# 环境上下文更新机制深度解析

## 概述

环境上下文在初始化时获取，但当用户工程目录结构或环境发生变化时，系统有多个机制来更新上下文。本文档详细解析环境上下文的更新时机、更新方式和核心代码。

## 关键发现

### 1. 环境上下文的实时性

**重要特性：** `getEnvironmentContext()` 函数**每次调用时都是实时获取**的，不会缓存结果。

```typescript
export async function getEnvironmentContext(config: Config): Promise<Part[]> {
  // 每次调用都重新获取当前日期
  const today = new Date().toLocaleDateString(...);
  
  // 每次调用都重新获取操作系统
  const platform = process.platform;
  
  // 每次调用都重新读取目录结构
  const directoryContext = await getDirectoryContextString(config);
  
  // 每次调用都重新获取临时目录
  const tempDir = config.storage.getProjectTempDir();
  
  // 获取环境内存（可能缓存，但可以刷新）
  const environmentMemory = config.getEnvironmentMemory();
  
  // 组装上下文
  return [{ text: context }];
}
```

**这意味着：** 只要重新调用 `getEnvironmentContext()`，就能获取最新的环境信息。

## 环境上下文更新时机

### 时机 1: 新会话启动 (startChat)

**触发条件：** 每次调用 `GeminiClient.startChat()`

**代码位置：** `packages/core/src/core/client.ts:303`

```typescript
async startChat(
  extraHistory?: Content[],
  resumedSessionData?: ResumedSessionData,
): Promise<GeminiChat> {
  // ...
  const history = await getInitialChatHistory(this.config, extraHistory);
  // getInitialChatHistory 内部调用 getEnvironmentContext()
  // 此时会重新获取最新的环境上下文
  // ...
}
```

**调用场景：**

1. **初始化时**：
   ```typescript
   // packages/core/src/core/client.ts:209
   async initialize() {
     this.chat = await this.startChat(); // 获取初始环境上下文
   }
   ```

2. **恢复会话时**：
   ```typescript
   // packages/core/src/core/client.ts:261
   async resumeChat(history: Content[], resumedSessionData?: ResumedSessionData) {
     this.chat = await this.startChat(history, resumedSessionData);
     // 恢复会话时也会重新获取环境上下文
   }
   ```

3. **压缩后重建聊天时**：
   ```typescript
   // packages/core/src/core/client.ts:954
   async tryCompressChat(prompt_id: string, force: boolean = false) {
     // ...
     if (info.compressionStatus === CompressionStatus.COMPRESSED) {
       if (newHistory) {
         this.chat = await this.startChat(newHistory, resumedData);
         // 压缩后重建聊天，会重新获取环境上下文
       }
     }
   }
   ```

**更新内容：**
- ✅ 日期（自动更新为当前日期）
- ✅ 目录结构（重新读取文件系统）
- ✅ 临时目录（重新获取）
- ✅ 环境内存（从缓存获取，但可以刷新）

### 时机 2: 手动刷新内存（如果启用 JIT Context）

**触发条件：** 用户手动刷新或系统自动刷新

**代码位置：** `packages/core/src/services/contextManager.ts:29`

```typescript
export class ContextManager {
  /**
   * Refreshes the memory by reloading global and environment memory.
   */
  async refresh(): Promise<void> {
    this.loadedPaths.clear();
    await this.loadGlobalMemory();
    await this.loadEnvironmentMemory(); // 重新加载环境内存
    this.emitMemoryChanged();
  }
  
  private async loadEnvironmentMemory(): Promise<void> {
    const result = await loadEnvironmentMemory(
      [...this.config.getWorkspaceContext().getDirectories()],
      this.config.getExtensionLoader(),
      this.config.getDebugMode(),
    );
    // 重新加载 GEMINI.md 文件
    // ...
    this.environmentMemory = [envMemory, mcpInstructions.trimStart()]
      .filter(Boolean)
      .join('\n\n');
  }
}
```

**调用场景：**

1. **手动刷新（通过命令）**：
   ```typescript
   // packages/cli/src/ui/commands/memoryCommand.ts
   // 用户可以使用 /memory refresh 命令
   ```

2. **系统自动刷新**：
   - 当工作区目录变化时
   - 当检测到 GEMINI.md 文件变化时

**更新内容：**
- ✅ 环境内存（GEMINI.md 文件内容）
- ✅ MCP 指令
- ❌ 目录结构（不会自动更新，需要重新 startChat）

### 时机 3: 工作区目录变化

**触发条件：** 工作区目录被添加或修改

**代码位置：** `packages/core/src/utils/workspaceContext.ts:71`

```typescript
export class WorkspaceContext {
  private onDirectoriesChangedListeners = new Set<() => void>();
  
  addDirectory(directory: string): void {
    const resolved = this.resolveAndValidateDir(directory);
    if (this.directories.has(resolved)) {
      return;
    }
    this.directories.add(resolved);
    this.notifyDirectoriesChanged(); // 通知监听器
  }
  
  private notifyDirectoriesChanged() {
    for (const listener of [...this.onDirectoriesChangedListeners]) {
      try {
        listener(); // 调用所有监听器
      } catch (e) {
        // 错误处理
      }
    }
  }
}
```

**监听器注册：**

```typescript
// packages/core/src/tools/mcp-client.ts:1370
let unlistenDirectories: Unsubscribe | undefined =
  workspaceContext.onDirectoriesChanged(async () => {
    try {
      await mcpClient.notification({
        method: 'notifications/roots/list_changed',
      });
      // 通知 MCP 服务器工作区目录变化
    } catch (_) {
      unlistenDirectories?.();
      unlistenDirectories = undefined;
    }
  });
```

**更新内容：**
- ✅ 工作区目录列表（实时更新）
- ❌ 目录结构（不会自动更新，需要重新 startChat）
- ✅ MCP 服务器通知（通知目录变化）

### 时机 4: 手动刷新内存（非 JIT 模式）

**触发条件：** 用户使用 `/memory refresh` 命令

**代码位置：** `packages/cli/src/ui/commands/memoryCommand.ts`

```typescript
// 刷新内存文件
export async function refreshMemory(config: Config): Promise<void> {
  await refreshServerHierarchicalMemory(config);
  // 这会重新加载所有 GEMINI.md 文件
}
```

**更新内容：**
- ✅ 环境内存（GEMINI.md 文件内容）
- ✅ MCP 指令
- ❌ 目录结构（不会自动更新，需要重新 startChat）

## 目录结构更新的限制

### 问题：目录结构不会自动更新

**原因：** 目录结构是在 `getInitialChatHistory()` 中获取的，而 `getInitialChatHistory()` 只在 `startChat()` 时调用。

**当前行为：**
- 目录结构只在会话启动时获取一次
- 会话运行期间，即使文件系统发生变化，目录结构也不会自动更新
- 需要重新启动会话才能获取新的目录结构

### 解决方案：重新启动会话

**方式 1: 手动重启会话**

用户可以通过以下方式重新启动会话：
- 退出 CLI 并重新启动
- 使用 `/new` 命令（如果支持）
- 使用 `/reset` 命令（如果支持）

**方式 2: 压缩后重建**

当历史压缩触发时，会重建聊天会话：

```typescript
async tryCompressChat(prompt_id: string, force: boolean = false) {
  // ...
  if (info.compressionStatus === CompressionStatus.COMPRESSED) {
    if (newHistory) {
      this.chat = await this.startChat(newHistory, resumedData);
      // 此时会重新获取环境上下文，包括最新的目录结构
    }
  }
}
```

## 环境内存更新机制

### 1. 环境内存的获取

**代码位置：** `packages/core/src/config/config.ts`

```typescript
getEnvironmentMemory(): string {
  if (this.experimentalJitContext) {
    // JIT 模式：从 ContextManager 获取
    return this.contextManager?.getEnvironmentMemory() || '';
  } else {
    // 非 JIT 模式：从配置中获取（初始化时加载）
    return this.userMemory || '';
  }
}
```

### 2. JIT 模式的自动刷新

**如果启用 JIT Context：**

```typescript
// ContextManager 可以刷新环境内存
async refresh(): Promise<void> {
  this.loadedPaths.clear();
  await this.loadGlobalMemory();
  await this.loadEnvironmentMemory(); // 重新加载
  this.emitMemoryChanged();
}
```

**刷新时机：**
- 手动调用 `contextManager.refresh()`
- 工作区目录变化时（如果配置了监听）

### 3. 非 JIT 模式的手动刷新

**如果未启用 JIT Context：**

```typescript
// 需要手动刷新
export async function refreshServerHierarchicalMemory(config: Config) {
  const result = await loadServerHierarchicalMemory(
    config.getWorkingDir(),
    config.shouldLoadMemoryFromIncludeDirectories()
      ? config.getWorkspaceContext().getDirectories()
      : [],
    // ... 其他参数
  );
  // 更新配置中的内存
  config.setUserMemory(finalMemory);
  config.setGeminiMdFileCount(result.fileCount);
  config.setGeminiMdFilePaths(result.filePaths);
}
```

## 完整更新流程图

```
用户操作（创建/删除文件/目录）
  ↓
文件系统变化
  ↓
┌─────────────────────────────────────┐
│ 环境上下文更新机制                  │
├─────────────────────────────────────┤
│                                     │
│ 1. 目录结构更新                     │
│    ├─ ❌ 不会自动更新               │
│    └─ ✅ 需要重新 startChat()       │
│                                     │
│ 2. 环境内存更新（JIT 模式）         │
│    ├─ ✅ ContextManager.refresh()  │
│    └─ ✅ 自动检测变化               │
│                                     │
│ 3. 环境内存更新（非 JIT 模式）      │
│    ├─ ✅ /memory refresh 命令      │
│    └─ ✅ refreshServerHierarchicalMemory() │
│                                     │
│ 4. 工作区目录更新                   │
│    ├─ ✅ WorkspaceContext.addDirectory() │
│    └─ ✅ 通知 MCP 服务器            │
│                                     │
└─────────────────────────────────────┘
  ↓
下次 startChat() 时获取最新上下文
```

## 实际更新示例

### 示例 1: 创建新文件后

**场景：** 用户在工程中创建了新文件 `src/new-file.ts`

**当前行为：**
1. 文件系统已更新
2. 目录结构**不会自动更新**（仍在历史记录中）
3. 下次 `startChat()` 时会获取新的目录结构

**如何立即更新：**
- 等待下次会话启动
- 或手动触发压缩（如果接近 token 限制）

### 示例 2: 添加新的 GEMINI.md 文件

**场景：** 用户在子目录中添加了新的 `GEMINI.md` 文件

**JIT 模式：**
```typescript
// 可以手动刷新
await config.getContextManager()?.refresh();
// 环境内存会立即更新
```

**非 JIT 模式：**
```typescript
// 需要手动刷新
await refreshServerHierarchicalMemory(config);
// 或使用命令
// /memory refresh
```

### 示例 3: 添加新的工作区目录

**场景：** 用户添加了新的包含目录

**代码：**
```typescript
// 添加目录
config.getWorkspaceContext().addDirectory('/path/to/new/dir');
// 这会触发 onDirectoriesChanged 事件
// MCP 服务器会被通知
// 但目录结构不会自动更新，需要重新 startChat()
```

## 关键代码位置总结

| 功能 | 代码位置 | 更新时机 |
|------|---------|---------|
| 环境上下文获取 | `packages/core/src/utils/environmentContext.ts:55` | 每次 `startChat()` |
| 目录结构获取 | `packages/core/src/utils/environmentContext.ts:18` | 每次 `startChat()` |
| 环境内存获取（JIT） | `packages/core/src/services/contextManager.ts:45` | `refresh()` 时 |
| 环境内存获取（非 JIT） | `packages/core/src/config/config.ts` | `refreshServerHierarchicalMemory()` 时 |
| 工作区目录变化 | `packages/core/src/utils/workspaceContext.ts:71` | `addDirectory()` 时 |
| 内存刷新命令 | `packages/cli/src/ui/commands/memoryCommand.ts` | 用户命令时 |

## 设计考虑

### 1. 为什么目录结构不自动更新？

**原因：**
- 目录结构读取是**昂贵的操作**（需要遍历文件系统）
- 频繁更新会消耗大量资源
- 目录结构变化通常不需要立即反映到模型中

**权衡：**
- ✅ 性能：避免频繁的文件系统操作
- ❌ 实时性：目录结构可能不是最新的

### 2. 为什么环境内存可以刷新？

**原因：**
- 环境内存（GEMINI.md）变化可能包含重要的指令更新
- 内存文件数量相对较少，刷新成本较低
- 用户可能需要立即应用新的指令

**权衡：**
- ✅ 灵活性：可以及时更新指令
- ✅ 性能：刷新成本可接受

### 3. 为什么工作区目录变化会通知？

**原因：**
- MCP 服务器需要知道工作区变化
- 通知成本低（只是发送消息）
- 有助于 MCP 服务器更新其状态

## 最佳实践

### 1. 对于目录结构变化

**如果目录结构发生重大变化：**
- 考虑重新启动会话
- 或等待自动压缩触发（会重建会话）

**如果只是小变化：**
- 可以继续使用当前会话
- 模型可以通过工具调用了解新文件

### 2. 对于 GEMINI.md 文件变化

**JIT 模式：**
- 使用 `contextManager.refresh()` 刷新
- 或等待系统自动检测

**非 JIT 模式：**
- 使用 `/memory refresh` 命令
- 或重新启动会话

### 3. 对于工作区目录变化

**添加新目录：**
- 使用 `workspaceContext.addDirectory()`
- MCP 服务器会自动收到通知
- 目录结构会在下次 `startChat()` 时更新

## 总结

环境上下文的更新机制：

1. **实时获取**：`getEnvironmentContext()` 每次调用都重新获取
2. **更新时机**：
   - ✅ 每次 `startChat()` 时（目录结构、日期等）
   - ✅ 手动刷新时（环境内存）
   - ✅ 工作区变化时（工作区目录列表）
3. **更新限制**：
   - ❌ 目录结构不会在会话运行期间自动更新
   - ✅ 环境内存可以通过刷新更新
   - ✅ 工作区目录变化会实时通知

**关键点：** 环境上下文是**按需获取**的，不是缓存的。只要重新调用 `getEnvironmentContext()`，就能获取最新的环境信息。目录结构更新需要重新启动会话（通过 `startChat()`），而环境内存可以通过刷新机制更新。

