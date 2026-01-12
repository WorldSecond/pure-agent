# IDE 集成深度解析

## 概述

IDE 集成与 IDE（如 VS Code）之间的通信机制，它使 CLI 能够获取 IDE 的上下文信息（打开的文件、光标位置、选中的文本等），并提供原生 diff 功能。本文档详细解析 IDE 集成的工作原理、核心代码，以及如何开发一个改版的 VSCode IDE 来连接。

## IDE 集成架构图

```
┌─────────────────┐
│   IDE (VS Code) │
│                 │
│  ┌───────────┐  │
│  │ Extension │  │
│  │ (Companion)│ │
│  └─────┬─────┘  │
│        │        │
│        │ MCP    │
│        │ HTTP   │
│        ▼        │
│  ┌───────────┐  │
│  │ MCP Server │  │
│  │ (Port X)   │  │
│  └─────┬─────┘  │
└────────┼────────┘
         │
         │ HTTP SSE
         │ Authorization: Bearer <token>
         │
         ▼
┌─────────────────┐
│       │
│                 │
│  ┌───────────┐  │
│  │IdeClient  │  │
│  └─────┬─────┘  │
│        │        │
│        │ 发现   │
│        ▼        │
│  ┌───────────┐  │
│  │ Port File │  │
│  │ (tmpdir)  │  │
│  └───────────┘  │
└─────────────────┘
```

## 核心功能

### 1. 上下文感知 (Context Awareness)

**功能：** CLI 能够获取 IDE 的实时上下文信息

**包含的信息：**
- 打开的文件列表（最多 10 个）
- 当前活动文件
- 光标位置（行号、字符位置）
- 选中的文本（最多 16KB）
- 工作区信任状态

**用途：** 让模型了解用户当前正在编辑什么，提供更相关的响应

### 2. 原生 Diff 功能 (Native Diffing)

**功能：** CLI 可以请求 IDE 打开 diff 视图，显示代码修改建议

**流程：**
1. CLI 调用 `openDiff` 工具
2. IDE 打开 diff 视图
3. 用户可以查看、编辑、接受或拒绝更改
4. IDE 发送通知告知 CLI 结果

**优势：** 用户可以在 IDE 的原生 diff 视图中查看和编辑更改，体验更流畅

## 通信协议

### 1. 传输层：MCP over HTTP

**协议：** Model Context Protocol (MCP) over HTTP Server-Sent Events (SSE)

**端点：** `http://127.0.0.1:<port>/mcp`

**特点：**
- 使用 HTTP SSE 进行双向通信
- 支持会话管理（每个 CLI 实例一个会话）
- 使用 Bearer Token 认证

### 2. 发现机制：Port File

**位置：** `os.tmpdir()/gemini/ide/`

**文件命名：** `gemini-ide-server-${PID}-${PORT}.json`

**文件内容：**
```json
{
  "port": 12345,
  "workspacePath": "/path/to/project1:/path/to/project2",
  "authToken": "a-very-secret-token",
  "ideInfo": {
    "name": "vscode",
    "displayName": "VS Code"
  }
}
```

**发现流程：**
1. CLI 获取 IDE 进程的 PID（通过进程树遍历）
2. 在 `os.tmpdir()/gemini/ide/` 目录查找匹配的文件
3. 读取文件获取端口和认证信息
4. 连接到 MCP 服务器

## 详细实现解析

### 阶段 1: IDE 服务器启动

**位置：** `packages/vscode-ide-companion/src/ide-server.ts`

**核心代码：**

```typescript
export class IDEServer {
  async start(context: vscode.ExtensionContext): Promise<void> {
    // 1. 生成认证 token
    this.authToken = randomUUID();
    
    // 2. 创建 Express 服务器
    const app = express();
    
    // 3. 配置 CORS（只允许无 origin 的请求）
    app.use(cors({
      origin: (origin, callback) => {
        if (!origin) {
          return callback(null, true);
        }
        return callback(new CORSError('Request denied by CORS policy.'), false);
      },
    }));
    
    // 4. 验证 Host 头
    app.use((req, res, next) => {
      const host = req.headers.host || '';
      const allowedHosts = [`localhost:${this.port}`, `127.0.0.1:${this.port}`];
      if (!allowedHosts.includes(host)) {
        return res.status(403).json({ error: 'Invalid Host header' });
      }
      next();
    });
    
    // 5. 验证认证 token
    app.use((req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).send('Unauthorized');
        return;
      }
      const token = authHeader.split(' ')[1];
      if (token !== this.authToken) {
        res.status(401).send('Unauthorized');
        return;
      }
      next();
    });
    
    // 6. 创建 MCP 服务器
    const mcpServer = createMcpServer(this.diffManager, this.log);
    
    // 7. 设置 MCP 端点
    app.post('/mcp', async (req: Request, res: Response) => {
      const sessionId = req.headers[MCP_SESSION_ID_HEADER];
      let transport: StreamableHTTPServerTransport;
      
      if (sessionId && this.transports[sessionId]) {
        // 使用现有会话
        transport = this.transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // 创建新会话
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            this.transports[newSessionId] = transport;
          },
        });
        mcpServer.connect(transport);
      }
      
      await transport.handleRequest(req, res, req.body);
    });
    
    // 8. 启动服务器（监听端口 0，自动分配）
    this.server = app.listen(0, '127.0.0.1', async () => {
      const address = this.server.address();
      this.port = address.port;
      
      // 9. 创建 port file
      const portDir = path.join(tmpdir(), 'gemini', 'ide');
      await fs.mkdir(portDir, { recursive: true });
      const portFile = path.join(
        portDir,
        `gemini-ide-server-${process.ppid}-${this.port}.json`
      );
      
      // 10. 写入 port file
      await writePortAndWorkspace({
        context,
        port: this.port,
        portFile,
        authToken: this.authToken,
        log: this.log,
      });
      
      // 11. 设置环境变量（用于 tie-breaking）
      context.environmentVariableCollection.replace(
        'GEMINI_CLI_IDE_SERVER_PORT',
        this.port.toString()
      );
    });
  }
}
```

**关键步骤：**

1. **生成认证 token**：使用 `randomUUID()` 生成唯一 token
2. **创建 HTTP 服务器**：使用 Express 创建服务器
3. **安全验证**：
   - CORS：只允许无 origin 的请求（防止浏览器访问）
   - Host 验证：只允许 localhost/127.0.0.1
   - Token 验证：验证 Bearer token
4. **MCP 服务器**：创建 MCP 服务器并注册工具
5. **动态端口**：监听端口 0，让系统自动分配
6. **Port File**：创建发现文件，包含端口、工作区路径、token
7. **环境变量**：设置环境变量供 CLI 使用

### 阶段 2: CLI 发现和连接

**位置：** `packages/core/src/ide/ide-client.ts`

**核心代码：**

```typescript
export class IdeClient {
  async connect(options: { logToConsole?: boolean } = {}): Promise<void> {
    // 1. 检测 IDE
    if (!this.currentIde) {
      this.setState(IDEConnectionStatus.Disconnected, 'IDE not supported');
      return;
    }
    
    // 2. 获取连接配置（从 port file）
    this.connectionConfig = await this.getConnectionConfigFromFile();
    this.authToken = this.connectionConfig?.authToken ?? 
                     process.env['GEMINI_CLI_IDE_AUTH_TOKEN'];
    
    // 3. 验证工作区路径
    const workspacePath = this.connectionConfig?.workspacePath ?? 
                          process.env['GEMINI_CLI_IDE_WORKSPACE_PATH'];
    const { isValid, error } = IdeClient.validateWorkspacePath(
      workspacePath,
      process.cwd()
    );
    if (!isValid) {
      this.setState(IDEConnectionStatus.Disconnected, error);
      return;
    }
    
    // 4. 尝试连接（优先使用 port file，然后环境变量）
    if (this.connectionConfig?.port) {
      const connected = await this.establishHttpConnection(
        this.connectionConfig.port
      );
      if (connected) return;
    }
    
    const portFromEnv = this.getPortFromEnv();
    if (portFromEnv) {
      const connected = await this.establishHttpConnection(portFromEnv);
      if (connected) return;
    }
    
    this.setState(IDEConnectionStatus.Disconnected, 'Failed to connect');
  }
  
  private async getConnectionConfigFromFile(): Promise<ConnectionConfig | undefined> {
    // 1. 获取 IDE 进程信息
    if (!this.ideProcessInfo) {
      return undefined;
    }
    
    // 2. 查找 port file 目录
    const portFileDir = path.join(os.tmpdir(), 'gemini', 'ide');
    let portFiles;
    try {
      portFiles = await fs.promises.readdir(portFileDir);
    } catch (e) {
      return undefined;
    }
    
    // 3. 匹配 PID 的文件
    const fileRegex = new RegExp(
      `^gemini-ide-server-${this.ideProcessInfo.pid}-\\d+\\.json$`
    );
    const matchingFiles = portFiles
      .filter((file) => fileRegex.test(file))
      .sort();
    
    if (matchingFiles.length === 0) {
      return undefined;
    }
    
    // 4. 读取所有匹配的文件
    const fileContents = await Promise.all(
      matchingFiles.map((file) =>
        fs.promises.readFile(path.join(portFileDir, file), 'utf8')
      )
    );
    
    // 5. 解析 JSON
    const parsedContents = fileContents.map((content) => {
      try {
        return JSON.parse(content);
      } catch (e) {
        return undefined;
      }
    });
    
    // 6. 验证工作区路径
    const validWorkspaces = parsedContents.filter((content) => {
      if (!content) return false;
      const { isValid } = IdeClient.validateWorkspacePath(
        content.workspacePath,
        process.cwd()
      );
      return isValid;
    });
    
    if (validWorkspaces.length === 0) {
      return undefined;
    }
    
    // 7. 如果只有一个，直接返回
    if (validWorkspaces.length === 1) {
      return validWorkspaces[0];
    }
    
    // 8. 如果有多个，使用环境变量 tie-breaking
    const portFromEnv = this.getPortFromEnv();
    if (portFromEnv) {
      const matchingPort = validWorkspaces.find(
        (content) => String(content.port) === portFromEnv
      );
      if (matchingPort) {
        return matchingPort;
      }
    }
    
    // 9. 返回第一个
    return validWorkspaces[0];
  }
  
  private async establishHttpConnection(port: string): Promise<boolean> {
    try {
      // 1. 创建 MCP 客户端
      this.client = new Client({
        name: 'streamable-http-client',
        version: '1.0.0',
      });
      
      // 2. 创建 HTTP SSE 传输
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://${getIdeServerHost()}:${port}/mcp`),
        {
          fetch: this.createProxyAwareFetch(),
          requestInit: {
            headers: this.authToken
              ? { Authorization: `Bearer ${this.authToken}` }
              : {},
          },
        }
      );
      
      // 3. 连接
      await this.client.connect(transport);
      
      // 4. 注册处理器
      this.registerClientHandlers();
      
      // 5. 发现工具
      await this.discoverTools();
      
      // 6. 设置状态为已连接
      this.setState(IDEConnectionStatus.Connected);
      return true;
    } catch (_error) {
      return false;
    }
  }
}
```

**关键步骤：**

1. **检测 IDE**：检测当前运行的 IDE
2. **查找 Port File**：
   - 获取 IDE 进程 PID
   - 在 `os.tmpdir()/gemini/ide/` 查找匹配的文件
   - 读取并解析 JSON
3. **验证工作区**：确保 CLI 运行在工作区目录内
4. **建立连接**：
   - 创建 MCP 客户端
   - 使用 HTTP SSE 传输
   - 添加认证头
   - 连接并注册处理器
5. **发现工具**：发现可用的工具（openDiff、closeDiff）

### 阶段 3: 上下文更新

**位置：** `packages/vscode-ide-companion/src/open-files-manager.ts` 和 `packages/core/src/ide/ideContext.ts`

**IDE 端（发送上下文）：**

```typescript
// IDE 扩展监听文件变化
this.openFilesManager = new OpenFilesManager(context);
this.openFilesManager.onDidChange(() => {
  this.broadcastIdeContextUpdate();
});

function sendIdeContextUpdateNotification(
  transport: StreamableHTTPServerTransport,
  log: (message: string) => void,
  openFilesManager: OpenFilesManager,
) {
  const ideContext = openFilesManager.state;
  
  const notification = IdeContextNotificationSchema.parse({
    jsonrpc: '2.0',
    method: 'ide/contextUpdate',
    params: ideContext,
  });
  
  transport.send(notification);
}
```

**CLI 端（接收上下文）：**

```typescript
// 注册通知处理器
this.client.setNotificationHandler(
  IdeContextNotificationSchema,
  (notification) => {
    // 存储到 ideContextStore
    ideContextStore.set(notification.params);
    
    // 通知信任状态变化
    const isTrusted = notification.params.workspaceState?.isTrusted;
    if (isTrusted !== undefined) {
      for (const listener of this.trustChangeListeners) {
        listener(isTrusted);
      }
    }
  }
);
```

**上下文处理：**

```typescript
// IdeContextStore 处理上下文
export class IdeContextStore {
  set(newIdeContext: IdeContext): void {
    const { workspaceState } = newIdeContext;
    if (!workspaceState) {
      this.ideContextState = newIdeContext;
      this.notifySubscribers();
      return;
    }
    
    const { openFiles } = workspaceState;
    
    if (openFiles && openFiles.length > 0) {
      // 1. 按时间戳排序（最新的在前）
      openFiles.sort((a, b) => b.timestamp - a.timestamp);
      
      // 2. 只有最新的文件可以是活动的
      const mostRecentFile = openFiles[0];
      if (!mostRecentFile.isActive) {
        openFiles.forEach((file) => {
          file.isActive = false;
          file.cursor = undefined;
          file.selectedText = undefined;
        });
      } else {
        // 3. 确保只有最新文件是活动的
        openFiles.forEach((file, index) => {
          if (index !== 0) {
            file.isActive = false;
            file.cursor = undefined;
            file.selectedText = undefined;
          }
        });
        
        // 4. 截断选中的文本
        if (mostRecentFile.selectedText &&
            mostRecentFile.selectedText.length > IDE_MAX_SELECTED_TEXT_LENGTH) {
          mostRecentFile.selectedText =
            mostRecentFile.selectedText.substring(0, IDE_MAX_SELECTED_TEXT_LENGTH) +
            '... [TRUNCATED]';
        }
      }
      
      // 5. 截断文件列表（最多 10 个）
      if (openFiles.length > IDE_MAX_OPEN_FILES) {
        workspaceState.openFiles = openFiles.slice(0, IDE_MAX_OPEN_FILES);
      }
    }
    
    this.ideContextState = newIdeContext;
    this.notifySubscribers();
  }
}
```

**在运行时使用上下文：**

```typescript
// 在 processTurn 中使用
private getIdeContextParts(forceFullContext: boolean): {
  contextParts: string[];
  newIdeContext: IdeContext | undefined;
} {
  const currentIdeContext = ideContextStore.get();
  if (!currentIdeContext) {
    return { contextParts: [], newIdeContext: undefined };
  }
  
  if (forceFullContext || !this.lastSentIdeContext) {
    // 全量更新：发送完整上下文作为 JSON
    const openFiles = currentIdeContext.workspaceState?.openFiles || [];
    const activeFile = openFiles.find((f) => f.isActive);
    const otherOpenFiles = openFiles
      .filter((f) => !f.isActive)
      .map((f) => f.path);
    
    const contextData: Record<string, unknown> = {};
    if (activeFile) {
      contextData['activeFile'] = {
        path: activeFile.path,
        cursor: activeFile.cursor,
        selectedText: activeFile.selectedText,
      };
    }
    if (otherOpenFiles.length > 0) {
      contextData['otherOpenFiles'] = otherOpenFiles;
    }
    
    const jsonString = JSON.stringify(contextData, null, 2);
    const contextParts = [
      "Here is the user's editor context as a JSON object.",
      '```json',
      jsonString,
      '```',
    ];
    
    return { contextParts, newIdeContext: currentIdeContext };
  } else {
    // 增量更新：只发送变化的部分
    // ... 计算 delta
  }
}
```

### 阶段 4: Diff 功能

**CLI 调用 openDiff：**

```typescript
async openDiff(
  filePath: string,
  newContent: string,
): Promise<DiffUpdateResult> {
  // 1. 获取互斥锁（确保同时只有一个 diff）
  const release = await this.acquireMutex();
  
  const promise = new Promise<DiffUpdateResult>((resolve, reject) => {
    if (!this.client) {
      return reject(new Error('IDE client is not connected.'));
    }
    
    // 2. 存储 resolver
    this.diffResponses.set(filePath, resolve);
    
    // 3. 调用工具
    this.client
      .request(
        {
          method: 'tools/call',
          params: {
            name: 'openDiff',
            arguments: {
              filePath,
              newContent,
            },
          },
        },
        CallToolResultSchema,
        { timeout: IDE_REQUEST_TIMEOUT_MS }
      )
      .then((parsedResultData) => {
        if (parsedResultData.isError) {
          this.diffResponses.delete(filePath);
          reject(new Error('Tool reported an error.'));
        }
      })
      .catch((err) => {
        this.diffResponses.delete(filePath);
        reject(err);
      });
  });
  
  // 4. 确保释放互斥锁
  promise.finally(release);
  return promise;
}
```

**IDE 处理 openDiff：**

```typescript
// 注册 openDiff 工具
server.registerTool(
  'openDiff',
  {
    description: 'Open a diff view to create or modify a file.',
    inputSchema: OpenDiffRequestSchema.shape,
  },
  async ({ filePath, newContent }) => {
    await diffManager.showDiff(filePath, newContent);
    return { content: [] };
  }
);
```

**IDE 发送 diff 结果通知：**

```typescript
// 当用户接受 diff
this.client.setNotificationHandler(
  IdeDiffAcceptedNotificationSchema,
  (notification) => {
    const { filePath, content } = notification.params;
    const resolver = this.diffResponses.get(filePath);
    if (resolver) {
      resolver({ status: 'accepted', content });
      this.diffResponses.delete(filePath);
    }
  }
);

// 当用户拒绝 diff
this.client.setNotificationHandler(
  IdeDiffRejectedNotificationSchema,
  (notification) => {
    const { filePath } = notification.params;
    const resolver = this.diffResponses.get(filePath);
    if (resolver) {
      resolver({ status: 'rejected', content: undefined });
      this.diffResponses.delete(filePath);
    }
  }
);
```

## 如何开发改版 VSCode IDE 连接

### 步骤 1: 创建 IDE 扩展

**1.1 初始化扩展项目**

```bash
npm install -g yo generator-code
yo code
```

**1.2 安装依赖**

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "express": "^4.18.0",
    "cors": "^2.8.5"
  }
}
```

### 步骤 2: 实现 MCP 服务器

**2.1 创建 IDEServer 类**

```typescript
import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'os';

export class IDEServer {
  private server: any;
  private port: number | undefined;
  private authToken: string | undefined;
  private transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};
  
  async start(context: vscode.ExtensionContext): Promise<void> {
    return new Promise((resolve) => {
      this.authToken = randomUUID();
      
      const app = express();
      app.use(express.json({ limit: '10mb' }));
      
      // CORS 配置
      app.use(cors({
        origin: (origin, callback) => {
          if (!origin) {
            return callback(null, true);
          }
          return callback(new Error('Request denied by CORS policy.'), false);
        },
      }));
      
      // 认证中间件
      app.use((req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          res.status(401).send('Unauthorized');
          return;
        }
        const token = authHeader.split(' ')[1];
        if (token !== this.authToken) {
          res.status(401).send('Unauthorized');
          return;
        }
        next();
      });
      
      // 创建 MCP 服务器
      const mcpServer = this.createMcpServer();
      
      // MCP 端点
      app.post('/mcp', async (req, res) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;
        
        if (sessionId && this.transports[sessionId]) {
          transport = this.transports[sessionId];
        } else if (!sessionId && this.isInitializeRequest(req.body)) {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId) => {
              this.transports[newSessionId] = transport;
            },
          });
          mcpServer.connect(transport);
        } else {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request' },
            id: null,
          });
          return;
        }
        
        try {
          await transport.handleRequest(req, res, req.body);
        } catch (error) {
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal server error' },
              id: null,
            });
          }
        }
      });
      
      // 启动服务器
      this.server = app.listen(0, '127.0.0.1', async () => {
        const address = this.server.address();
        this.port = address.port;
        
        // 创建 port file
        await this.writePortFile(context);
        
        // 设置环境变量
        context.environmentVariableCollection.replace(
          'GEMINI_CLI_IDE_SERVER_PORT',
          this.port.toString()
        );
        
        resolve();
      });
    });
  }
  
  private createMcpServer() {
    const server = new McpServer(
      {
        name: 'my-ide-companion-mcp-server',
        version: '1.0.0',
      },
      { capabilities: { logging: {} } }
    );
    
    // 注册 openDiff 工具
    server.registerTool(
      'openDiff',
      {
        description: 'Open a diff view',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
            newContent: { type: 'string' },
          },
          required: ['filePath', 'newContent'],
        },
      },
      async ({ filePath, newContent }) => {
        // 实现 diff 显示逻辑
        // ...
        return { content: [] };
      }
    );
    
    // 注册 closeDiff 工具
    server.registerTool(
      'closeDiff',
      {
        description: 'Close a diff view',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
          },
          required: ['filePath'],
        },
      },
      async ({ filePath }) => {
        // 实现 diff 关闭逻辑
        // ...
        return {
          content: [{ type: 'text', text: JSON.stringify({ content: null }) }],
        };
      }
    );
    
    return server;
  }
  
  private async writePortFile(context: vscode.ExtensionContext): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspacePath =
      workspaceFolders && workspaceFolders.length > 0
        ? workspaceFolders.map((folder) => folder.uri.fsPath).join(path.delimiter)
        : '';
    
    const portDir = path.join(tmpdir(), 'gemini', 'ide');
    await fs.mkdir(portDir, { recursive: true });
    
    const portFile = path.join(
      portDir,
      `gemini-ide-server-${process.ppid}-${this.port}.json`
    );
    
    const content = JSON.stringify({
      port: this.port,
      workspacePath,
      authToken: this.authToken,
      ideInfo: {
        name: 'my-ide',
        displayName: 'My IDE',
      },
    });
    
    await fs.writeFile(portFile, content);
    await fs.chmod(portFile, 0o600);
  }
  
  private isInitializeRequest(body: any): boolean {
    return body && body.method === 'initialize';
  }
  
  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server.close(() => resolve());
      });
    }
  }
}
```

**2.2 实现上下文更新**

```typescript
import { OpenFilesManager } from './open-files-manager';

export class IDEServer {
  private openFilesManager: OpenFilesManager | undefined;
  
  async start(context: vscode.ExtensionContext): Promise<void> {
    // ...
    
    // 创建 OpenFilesManager
    this.openFilesManager = new OpenFilesManager(context);
    
    // 监听文件变化
    this.openFilesManager.onDidChange(() => {
      this.broadcastIdeContextUpdate();
    });
    
    // ...
  }
  
  private broadcastIdeContextUpdate() {
    if (!this.openFilesManager) {
      return;
    }
    
    const ideContext = this.openFilesManager.state;
    
    const notification = {
      jsonrpc: '2.0',
      method: 'ide/contextUpdate',
      params: ideContext,
    };
    
    for (const transport of Object.values(this.transports)) {
      transport.send(notification);
    }
  }
}
```

**2.3 实现 OpenFilesManager**

```typescript
import * as vscode from 'vscode';
import { IdeContext, File } from '@google/gemini-cli-core/src/ide/types.js';

export class OpenFilesManager {
  private state: IdeContext = {};
  private onDidChangeEmitter = new vscode.EventEmitter<void>();
  
  constructor(context: vscode.ExtensionContext) {
    // 监听文件打开
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        this.updateFile(doc);
        this.onDidChangeEmitter.fire();
      })
    );
    
    // 监听文件关闭
    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.removeFile(doc);
        this.onDidChangeEmitter.fire();
      })
    );
    
    // 监听活动编辑器变化
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.updateFile(editor.document);
          this.onDidChangeEmitter.fire();
        }
      })
    );
    
    // 监听选择变化
    context.subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        this.updateSelection(event.textEditor);
        this.onDidChangeEmitter.fire();
      })
    );
    
    // 初始化当前打开的文件
    vscode.workspace.textDocuments.forEach((doc) => {
      this.updateFile(doc);
    });
    
    if (vscode.window.activeTextEditor) {
      this.updateFile(vscode.window.activeTextEditor.document);
    }
  }
  
  private updateFile(doc: vscode.TextDocument) {
    if (!doc.uri.fsPath) {
      return; // 跳过虚拟文件
    }
    
    if (!this.state.workspaceState) {
      this.state.workspaceState = {};
    }
    if (!this.state.workspaceState.openFiles) {
      this.state.workspaceState.openFiles = [];
    }
    
    const file: File = {
      path: doc.uri.fsPath,
      timestamp: Date.now(),
      isActive: doc === vscode.window.activeTextEditor?.document,
    };
    
    if (file.isActive && vscode.window.activeTextEditor) {
      const editor = vscode.window.activeTextEditor;
      const selection = editor.selection;
      
      file.cursor = {
        line: selection.active.line + 1, // 1-based
        character: selection.active.character + 1, // 1-based
      };
      
      if (!selection.isEmpty) {
        file.selectedText = doc.getText(selection);
      }
    }
    
    // 更新或添加文件
    const index = this.state.workspaceState.openFiles.findIndex(
      (f) => f.path === file.path
    );
    if (index >= 0) {
      this.state.workspaceState.openFiles[index] = file;
    } else {
      this.state.workspaceState.openFiles.push(file);
    }
  }
  
  private removeFile(doc: vscode.TextDocument) {
    if (!this.state.workspaceState?.openFiles) {
      return;
    }
    
    this.state.workspaceState.openFiles = this.state.workspaceState.openFiles.filter(
      (f) => f.path !== doc.uri.fsPath
    );
  }
  
  private updateSelection(editor: vscode.TextEditor) {
    if (!this.state.workspaceState?.openFiles) {
      return;
    }
    
    const file = this.state.workspaceState.openFiles.find(
      (f) => f.path === editor.document.uri.fsPath
    );
    
    if (file) {
      const selection = editor.selection;
      file.cursor = {
        line: selection.active.line + 1,
        character: selection.active.character + 1,
      };
      
      if (!selection.isEmpty) {
        file.selectedText = editor.document.getText(selection);
      } else {
        file.selectedText = undefined;
      }
    }
  }
  
  onDidChange(listener: () => void): vscode.Disposable {
    return this.onDidChangeEmitter.event(listener);
  }
}
```

### 步骤 3: 实现 Diff 功能

**3.1 创建 DiffManager**

```typescript
import * as vscode from 'vscode';
import { IdeDiffAcceptedNotificationSchema, IdeDiffRejectedNotificationSchema } from '@google/gemini-cli-core/src/ide/types.js';

export class DiffManager {
  private diffViews = new Map<string, vscode.TextEditor>();
  private transport: StreamableHTTPServerTransport | undefined;
  
  constructor(private log: (message: string) => void) {}
  
  setTransport(transport: StreamableHTTPServerTransport) {
    this.transport = transport;
  }
  
  async showDiff(filePath: string, newContent: string): Promise<void> {
    const uri = vscode.Uri.file(filePath);
    
    // 读取当前文件内容
    let originalContent = '';
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      originalContent = doc.getText();
    } catch (e) {
      // 文件不存在，创建新文件
    }
    
    // 创建临时文件用于 diff
    const tempUri = vscode.Uri.parse(`gemini-diff:${filePath}`);
    
    // 注册文本内容提供者
    const provider = new DiffContentProvider(newContent);
    vscode.workspace.registerTextDocumentContentProvider('gemini-diff', provider);
    
    // 打开 diff 视图
    await vscode.commands.executeCommand(
      'vscode.diff',
      uri,
      tempUri,
      `${path.basename(filePath)} ()`
    );
    
    // 监听 diff 视图关闭
    const disposable = vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === 'gemini-diff' && doc.uri.path === filePath) {
        this.rejectDiff(filePath);
        disposable.dispose();
      }
    });
  }
  
  async acceptDiff(filePath: string): Promise<void> {
    // 获取 diff 视图中的内容
    const tempUri = vscode.Uri.parse(`gemini-diff:${filePath}`);
    const doc = await vscode.workspace.openTextDocument(tempUri);
    const content = doc.getText();
    
    // 写入文件
    const uri = vscode.Uri.file(filePath);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    
    // 关闭 diff 视图
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    
    // 发送接受通知
    if (this.transport) {
      const notification = IdeDiffAcceptedNotificationSchema.parse({
        jsonrpc: '2.0',
        method: 'ide/diffAccepted',
        params: { filePath, content },
      });
      this.transport.send(notification);
    }
  }
  
  async rejectDiff(filePath: string): Promise<void> {
    // 关闭 diff 视图
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    
    // 发送拒绝通知
    if (this.transport) {
      const notification = IdeDiffRejectedNotificationSchema.parse({
        jsonrpc: '2.0',
        method: 'ide/diffRejected',
        params: { filePath },
      });
      this.transport.send(notification);
    }
  }
}

class DiffContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private content: string) {}
  
  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.content;
  }
}
```

### 步骤 4: 激活扩展

**4.1 在 extension.ts 中激活**

```typescript
import * as vscode from 'vscode';
import { IDEServer } from './ide-server';
import { DiffManager } from './diff-manager';

let ideServer: IDEServer;
let diffManager: DiffManager;

export async function activate(context: vscode.ExtensionContext) {
  diffManager = new DiffManager((msg) => console.log(msg));
  ideServer = new IDEServer((msg) => console.log(msg), diffManager);
  
  try {
    await ideServer.start(context);
    console.log('IDE server started');
  } catch (err) {
    console.error('Failed to start IDE server:', err);
  }
  
  context.subscriptions.push({
    dispose: async () => {
      await ideServer.stop();
    },
  });
}

export async function deactivate(): Promise<void> {
  if (ideServer) {
    await ideServer.stop();
  }
}
```

## 关键代码位置总结

| 功能 | CLI 端代码位置 | IDE 端代码位置 |
|------|---------------|---------------|
| IDE 客户端 | `packages/core/src/ide/ide-client.ts` | - |
| IDE 上下文存储 | `packages/core/src/ide/ideContext.ts` | - |
| 上下文使用 | `packages/core/src/core/client.ts:339` | - |
| IDE 服务器 | - | `packages/vscode-ide-companion/src/ide-server.ts` |
| 文件管理 | - | `packages/vscode-ide-companion/src/open-files-manager.ts` |
| Diff 管理 | `packages/core/src/ide/ide-client.ts:232` | `packages/vscode-ide-companion/src/diff-manager.ts` |
| 类型定义 | `packages/core/src/ide/types.ts` | - |

## 测试连接

**1. 启动 IDE 扩展**

在 VS Code 中按 F5 启动扩展开发主机

**2. 运行 CLI**

```bash
cd /path/to/workspace
gemini
```

**3. 检查连接状态**

在 CLI 中运行：
```
/ide status
```

**4. 测试上下文**

打开一个文件，移动光标，选择文本，CLI 应该能够获取这些信息。

**5. 测试 Diff**

让 CLI 修改一个文件，应该会打开 diff 视图。

## 常见问题

### 1. 连接失败

**原因：**
- Port file 不存在
- 工作区路径不匹配
- 认证 token 不匹配

**解决：**
- 检查 port file 是否存在
- 确保 CLI 运行在工作区目录内
- 检查认证 token

### 2. 上下文不更新

**原因：**
- 通知未发送
- 文件路径不正确

**解决：**
- 检查 OpenFilesManager 是否正确监听事件
- 确保文件路径是绝对路径

### 3. Diff 不工作

**原因：**
- 工具未注册
- 通知未发送

**解决：**
- 检查工具是否正确注册
- 确保在用户操作后发送通知

## 总结

IDE 集成通过以下机制实现：

1. **发现机制**：Port file 在临时目录，包含端口和认证信息
2. **通信协议**：MCP over HTTP SSE，支持双向通信
3. **上下文更新**：IDE 发送通知，CLI 接收并存储
4. **Diff 功能**：CLI 调用工具，IDE 显示 diff，用户操作后发送通知

开发改版 VSCode IDE 的关键步骤：

1. 创建 MCP 服务器
2. 实现 Port File 机制
3. 实现上下文更新
4. 实现 Diff 功能
5. 注册工具和通知

遵循 [IDE Companion Spec](./ide-integration/ide-companion-spec.md) 规范，任何 IDE 都可以实现与  的集成。

