# Pure Agent

一个纯 AI Agent 框架，专注于核心 Agent 能力，不包含 UI、文件系统等额外内容，可在任意 JavaScript 环境中使用。

## 特性

### 核心能力

- **Agent** - 核心 Agent 实现，支持自主决策和任务执行
- **SubAgent** - 子 Agent 支持，实现 Agent 间的协作和任务分解
- **Tools** - 工具系统
  - 本地工具支持
  - MCP (Model Context Protocol) 工具集成
- **工具权限控制** - 细粒度的工具访问权限管理

### 可扩展能力

- **模型配置** - 灵活的模型配置和管理
- **日志记录** - 完整的日志记录系统
- **成本追踪和分析** - 详细的成本统计和分析功能

## 快速开始

```javascript
import { Agent } from 'pure-agent';

// 创建 Agent 实例
const agent = new Agent({
  model: 'gpt-4',
  tools: ['tool1', 'tool2'],
});

// 执行任务
const result = await agent.run('帮我分析这个数据');
```

## 项目结构

```
pure-agent/
├── src/
│   ├── agent/          # Agent 核心实现
│   ├── subagent/       # SubAgent 实现
│   ├── tools/          # 工具系统
│   ├── permissions/    # 权限控制
│   ├── models/         # 模型配置
│   ├── logging/        # 日志记录
│   └── cost/           # 成本追踪
├── tests/              # 测试文件
├── README.md
└── architecture.md     # 架构文档
```

## 使用场景

- 自动化任务处理
- 智能决策系统
- 多 Agent 协作场景
- 需要细粒度权限控制的 Agent 应用

## 开发

```bash
# 克隆项目
git clone <repository-url>

# 安装依赖
npm install

# 运行测试
npm test

# 构建项目
npm run build
```

## 文档

详细文档请参考 [architecture.md](./architecture.md)

## 许可证

[MIT License](LICENSE)

## 贡献

欢迎提交 Issue 和 Pull Request！
