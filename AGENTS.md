# xike code - AGENTS.md

## 语言与风格
- 中文回复、中文注释、中文提交信息
- 术语/库名保留英文（`stdin`、`stdout`、`token` 等）
- 所有 export 的函数、接口、类型要有 JSDoc 注释

## 运行时与工具链
- **Runtime**: Bun（不是 Node.js）。直接运行 `bun run src/index.tsx`，无构建步骤
- **测试**: `bun test`（Bun 内置，用 `bun:test` 而非 Jest/Vitest）
- **类型检查**: `tsc --noEmit`（packages.json 中有 `typecheck` script）
- **依赖**: `ink@^5`（React for CLI）+ `react@^18`
- **TS 配置**: `"types": ["bun-types"]`, `"moduleResolution": "bundler"`, `jsx: react-jsx`

## 架构要点
```
src/index.tsx (入口, ink render)
  └─ src/tui/app.tsx (App 组件, 状态管理)
       ├─ src/tui/message-list.tsx (消息列表+滚动)
       │    └─ src/tui/thinking-block.tsx (thinking 展开/收缩)
       └─ src/tui/input-bar.tsx (输入栏, 方向键透传给外层)
  └─ src/conversation/conversation.ts (对话管理)
       └─ src/provider/ (LLMProvider 接口 + Anthropic/OpenAI 适配器)
            ├─ interface.ts (LLMProvider 接口)
            ├─ events.ts (StreamEvent 联合类型)
            ├─ sse.ts (SSE 流解析器)
            ├─ anthropic.ts
            └─ openai.ts
  └─ src/config/config.ts (配置加载, 全局+本地合并)
  └─ src/logger.ts (DEBUG=true 写 ~/.xike-code/debug.log)
```

- **Provider 层**: `LLMProvider` 接口定义 `prepareMessages()` + `chat()`。Anthropic 和 OpenAI 适配器各自将 `InternalMessage` 转为 API 格式，并将 SSE 事件映射为统一的 `StreamEvent`
- **配置**: 全局 `~/.config/xike-code/config.json` + 项目 `.xikerc.json`（本地按模型名覆盖全局）。API 键可注入环境变量 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`
- **TUI 滚动**: 上下箭头控制 `scrollOffset`，根据终端宽高估算消息行数，只渲染可见部分
- **Thinking 块**: per-message `thinkingExpandedMap: Record<number, boolean>`，思考中自动展开，完成后自动收缩；鼠标点击消息区域切换最后一条 thinking 的展开状态
- **鼠标点击**: 使用 SGR 终端鼠标追踪协议，`useMouseClick` hook 解析 `\x1b[<buttons;x;yM` 序列。仅粗略按行号判断（非元素级精确命中）
- **Debug**: `DEBUG=true bun run src/index.tsx`，日志写入 `~/.xike-code/debug.log`（含时间戳），不输出到终端

## 测试
- 36 个测试，4 个文件（provider sse/openai/anthropic + conversation），全部通过
- 运行：`bun test`（无需额外脚本）
- Mock 模式：用 `mockFetch` 辅助函数替换 `globalThis.fetch`（因为 Bun 的 `typeof fetch` 含 `preconnect` 属性）

## 命令
| 用途 | 命令 |
|---|---|
| 启动 | `bun run src/index.tsx` |
| 调试 | `DEBUG=true bun run src/index.tsx` |
| 类型检查 | `bun run typecheck` 或 `tsc --noEmit` |
| 测试 | `bun test` |

## 约定
- 提交信息用中文，遵循 conventional commits：`类型: 中文描述`
- `.xikerc.json` 被 gitignore（含 API 密钥），不在 PR 中包含
- MVP 范围：无 tool use、MCP、持久化历史、Agent 功能
