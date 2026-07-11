# xike code Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `package.json` | 项目依赖与脚本 |
| 新建 | `tsconfig.json` | TypeScript 编译配置 |
| 新建 | `.xikerc.json` | 示例本地模型配置 |
| 新建 | `src/types/index.ts` | InternalMessage、ModelConfig、AppConfig |
| 新建 | `src/config/config.ts` | JSON 配置加载与合并 |
| 新建 | `src/provider/events.ts` | StreamEvent 类型 |
| 新建 | `src/provider/interface.ts` | LLMProvider 接口 |
| 新建 | `src/provider/sse.ts` | SSE 行解析工具 |
| 新建 | `src/provider/anthropic.ts` | Anthropic 适配器 |
| 新建 | `src/provider/openai.ts` | OpenAI 适配器 |
| 新建 | `src/conversation/conversation.ts` | 对话编排（操作 InternalMessage[]） |
| 新建 | `src/tui/thinking-block.tsx` | thinking 灰色/斜体组件 |
| 新建 | `src/tui/message-list.tsx` | 消息列表渲染 |
| 新建 | `src/tui/input-bar.tsx` | 输入栏 + /命令解析 |
| 新建 | `src/tui/app.tsx` | App 根组件 |
| 新建 | `src/index.tsx` | 入口，启动 ink |

## T1: 项目初始化

**文件：** `package.json`, `tsconfig.json`
**依赖：** 无
**步骤：**
1. 创建 `package.json`，使用 Bun 作为包管理器
2. 依赖：`ink`、`react`（ink 依赖）、`@types/react`
3. 配置 `tsconfig.json`，目标 ES2022，JSX 设为 `react-jsx`
4. 配置脚本：`"start": "bun run src/index.tsx"`
5. 创建 `.gitignore`（node_modules, .xikerc.json 等）

**验证：** `bun install` 安装成功无错误

## T2: 共享类型定义

**文件：** `src/types/index.ts`
**依赖：** T1
**步骤：**
1. 定义 `InternalMessage` 接口（role: system/user/assistant, content, thinking?）
2. 定义 `ModelConfig` 接口（name, provider, protocol, model, baseUrl, apiKey, thinking）
3. 定义 `AppConfig` 接口（models: ModelConfig[], activeModel?）
4. 定义 `ChatOptions` 接口（signal?: AbortSignal）

**验证：** `bun run tsconfig.json` 类型检查通过（或用 `bunx tsc --noEmit`）

## T3: 配置加载模块

**文件：** `src/config/config.ts`
**依赖：** T2
**步骤：**
1. 实现 `loadConfig(): AppConfig` 函数
2. 读取全局 `~/.config/xike-code/config.json`（不存在则忽略）
3. 读取本地 `./.xikerc.json`（不存在则忽略）
4. 合并逻辑：本地 models 按 name 覆盖全局同名 model；activeModel 取本地值（如有）
5. API key 缺失时从环境变量 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 兜底（分别对应 provider 类型）
6. 导出 `getActiveModel(config): ModelConfig | null` 辅助函数

**验证：**
1. 写测试：全局 + 本地配置合并，本地覆盖全局
2. 环境变量兜底测试

## T4: Provider 事件与接口

**文件：** `src/provider/events.ts`, `src/provider/interface.ts`
**依赖：** T2
**步骤：**
1. `events.ts` 定义 `StreamEvent` 联合类型
2. `interface.ts` 定义 `LLMProvider` 接口（prepareMessages, chat）
3. `chat` 方法接收 `InternalMessage[]`，返回 `AsyncIterable<StreamEvent>`

**验证：** `bunx tsc --noEmit` 类型检查通过

## T5: SSE 解析工具

**文件：** `src/provider/sse.ts`
**依赖：** T1
**步骤：**
1. 实现 `parseSSEStream(body: ReadableStream): AsyncIterable<{event?: string, data: string}>`
2. 按行分割，解析 `event:` 和 `data:` 前缀
3. 处理多行 data 和 `[DONE]` 终止信号
4. 用 `AbortSignal` 支持取消

**验证：** 写测试，用模拟 SSE 数据验证解析正确

## T6: Anthropic Provider

**文件：** `src/provider/anthropic.ts`
**依赖：** T4, T5
**步骤：**
1. 实现 `AnthropicProvider implements LLMProvider`
2. `prepareMessages`：将 `InternalMessage[]` 转为 Anthropic messages 格式
3. `chat`：构建请求 → fetch POST → parseSSEStream → 映射 StreamEvent
   - `thinking_delta` → `{ type: 'thinking', content }`
   - `text_delta` → `{ type: 'text', content }`
   - `message_stop` → `{ type: 'done' }`
4. 请求头：`x-api-key`, `anthropic-version: 2023-06-01`
5. `thinking` 配置开启时，请求体包含 `thinking: { type: 'enabled', budget_tokens: 4096 }`
6. 错误处理：非 200 响应 → `{ type: 'error', message }`

**验证：** 用 mock fetch 验证消息格式转换和事件映射

## T7: OpenAI Provider

**文件：** `src/provider/openai.ts`
**依赖：** T4, T5
**步骤：**
1. 实现 `OpenAIProvider implements LLMProvider`
2. `prepareMessages`：将 `InternalMessage[]` 转为 OpenAI messages 格式（system 映射为 role: system）
3. `chat`：构建请求 → fetch POST → parseSSEStream → 映射 StreamEvent
   - `choices[0].delta.content` → `{ type: 'text', content }`
   - `[DONE]` → `{ type: 'done' }`
4. 请求头：`Authorization: Bearer {apiKey}`
5. 错误处理：非 200 响应 → `{ type: 'error', message }`

**验证：** 用 mock fetch 验证消息格式转换和事件映射

## T8: 对话编排

**文件：** `src/conversation/conversation.ts`
**依赖：** T3, T4, T6, T7
**步骤：**
1. 实现 `Conversation` 类
2. 构造时接收 `AppConfig`，根据 `activeModel` 自动实例化对应的 Provider
3. `addMessage(msg: InternalMessage): void` 追加到 `messages[]`
4. `streamReply(): AsyncIterable<StreamEvent>`：
   - 创建空 assistant InternalMessage 占位加入 `messages[]`
   - 调用 `provider.chat(messages)` 消费 StreamEvent
   - 累积 text 到 `content`，thinking 到 `thinking`
   - `done` 事件时 finalized 该消息
   - yield 每个事件给调用方
5. `switchModel(name: string): boolean` 切换模型并重建 Provider
6. `getModels(): ModelConfig[]` 返回可用模型列表
7. `getActiveModel(): ModelConfig | null`

**验证：** 写测试验证消息累积、thinking 分离、done 后状态正确

## T9: Thinking 块组件

**文件：** `src/tui/thinking-block.tsx`
**依赖：** T1
**步骤：**
1. 创建 React 组件 `<ThinkingBlock content: string>` 用 ink 的 `<Text>` 组件
2. 样式：`dimColor`（灰色） + `italic`（斜体）
3. 前缀显示 `🤔` 图标
4. 组件在 content 为空时不渲染

**验证：** `bunx tsc --noEmit` 类型检查通过

## T10: 消息列表组件

**文件：** `src/tui/message-list.tsx`
**依赖：** T2, T9
**步骤：**
1. 创建 `<MessageList messages: InternalMessage[]>` 组件
2. 遍历 messages，按 role 区分渲染：
   - `user`: `<Text color="green">You: </Text>` + content
   - `assistant`: `<Text color="blue">Assistant: </Text>` + 如果有 thinking 渲染 `<ThinkingBlock>` + content
   - `system`: `<Text dimColor>System: </Text>` + content
3. 用 `<Box flexDirection="column">` 垂直排列

**验证：** `bunx tsc --noEmit` 类型检查通过

## T11: 输入栏组件

**文件：** `src/tui/input-bar.tsx`
**依赖：** T8
**步骤：**
1. 创建 `<InputBar onSubmit: (text: string) => void, onCommand: (cmd: string, args: string) => void>` 组件
2. 使用 ink 的 `<TextInput>` 或手动管理 stdin 输入
3. 回车提交，检测首字符 `/`：
   - `/model <name>` → 调用 onCommand('model', name)
   - `/models` → 调用 onCommand('models', '')
   - `/help` → 调用 onCommand('help', '')
   - 其他 → 调用 onSubmit(text)
4. 禁用端回显（ink 默认处理）

**验证：** 手动启动验证输入和命令解析

## T12: App 根组件 + 入口

**文件：** `src/tui/app.tsx`, `src/index.tsx`
**依赖：** T8, T10, T11
**步骤：**
1. `App.tsx`：
   - 创建 `<App>` 组件，使用 `useState` 管理 `messages[]`、`isStreaming`、`activeModel`
   - 初始化时调用 `loadConfig()` 创建 `Conversation` 实例
   - `onSubmit(text)`：
     - addMessage user → setStreaming(true) → for await streamReply() → 更新 messages
   - `onCommand` 处理 `/model`、`/models`、`/help`：
     - `/model <name>` → conversation.switchModel(name)，显示切换结果
     - `/models` → 在 messages 中插入一条展示可用列表
     - `/help` → 在 messages 中插入帮助信息
   - 流式更新时用 `useEffect` + callback 或直接修改 state 触发重渲染
2. `index.tsx`：
   - `import { render } from 'ink'`
   - `render(<App />)`
3. 处理 `Ctrl+C`：监听 stdin 的 SIGINT 或使用 ink 内置退出

**验证：** `bun run src/index.tsx` 启动成功，能看到界面

## T13: 示例配置文件

**文件：** `.xikerc.json`
**依赖：** 无
**步骤：**
1. 创建 `.xikerc.json`，包含两个示例模型（一个 Anthropic，一个 OpenAI）
2. 用占位符填写 apiKey（如 `"your-api-key-here"`）

**验证：** JSON 语法正确

## 执行顺序

```
T1 (项目初始化)
  │
  ▼
T2 (类型定义)
  │
  ├───────────────────────┐
  ▼                       ▼
T3 (配置加载)          T4 (Provider 事件+接口)
                         │
                         ▼
                      T5 (SSE 解析)
                         │
                    ┌────┴────┐
                    ▼         ▼
                T6 (Anthropic)  T7 (OpenAI)
                    │         │
                    └────┬────┘
                         ▼
                      T8 (Conversation)
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
      T9 (Thinking)  T10 (MsgList)  T11 (InputBar)
          │              │              │
          └──────────────┼──────────────┘
                         ▼
                    T12 (App + Entry)
                         │
                         ▼
                    T13 (.xikerc.json)
```
