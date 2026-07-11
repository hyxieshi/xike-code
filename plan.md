# xike code Plan

## 架构概览

```
┌──────────────────────────────────────────────────────┐
│  TUI (ink + React)                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────┐ │
│  │ App      │  │ Message  │  │ Thinking │  │Input │ │
│  │ (根组件)  │  │ List     │  │ Block    │  │Bar   │ │
│  └────┬─────┘  └──────────┘  └──────────┘  └──┬───┘ │
│       │                                       │      │
│       └──────────────┬────────────────────────┘      │
├──────────────────────┴───────────────────────────────┤
│  Conversation (消息历史管理 + 编排)                     │
├──────────────────────┬───────────────────────────────┤
│  Provider Layer                                       │
│  ┌───────────┐  ┌────────────┐  ┌───────────────┐    │
│  │ StreamEvent│  │ Anthropic  │  │ OpenAI        │    │
│  │ (统一事件)  │  │ Adapter    │  │ Adapter       │    │
│  └───────────┘  └────────────┘  └───────────────┘    │
├───────────────────────────────────────────────────────┤
│  Config (全局 ~/.config/... + 本地 ./.xikerc.json)     │
└───────────────────────────────────────────────────────┘
```

核心思想：上层（TUI、Conversation）只依赖 `StreamEvent` 和 `InternalMessage` 两套内部类型。

**消息双轨制：**
```
API 格式 ←→ Provider (消息转换) ←→ InternalMessage ←→ UI 渲染 / UI 输入
```
- Conversation 全程操作 `InternalMessage[]`（rich, 可扩展）
- Provider 在内部将 `InternalMessage[]` 转换为该 API 要求的格式
- TUI 渲染 `InternalMessage`，用户输入也先转为 `InternalMessage`

新增 Provider 只需实现 `LLMProvider` 接口（含消息转换 + 流式对话）。

## 核心数据结构

### StreamEvent — 统一流式事件

```typescript
// 上层唯一依赖的事件类型
type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
```

### InternalMessage — 内部消息（上层统一使用）

```typescript
// Conversation、TUI 等所有上层模块只操作这个类型
// 后续可扩展 role: 'tool'、toolCallId、metadata 等字段
interface InternalMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  thinking?: string  // 思考过程（仅 assistant 消息，来自 Anthropic）
}
```

### ModelConfig — 模型配置

```typescript
interface ModelConfig {
  name: string
  provider: 'anthropic' | 'openai'
  protocol: 'anthropic' | 'openai'
  model: string
  baseUrl: string
  apiKey: string
  thinking: boolean
}
```

### AppConfig — 应用配置

```typescript
interface AppConfig {
  models: ModelConfig[]
  activeModel: string
}
```

## 模块设计

### Config — `src/config/config.ts`

**职责：** 加载并合并全局和本地 JSON 配置。

- 全局路径：`~/.config/xike-code/config.json`
- 本地路径：`./.xikerc.json`（CWD）
- 合并策略：本地 models 按 `name` 覆盖全局同名模型；本地 `activeModel` 覆盖全局值
- 缺少 API key 时从环境变量 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 兜底
- 配置不存在时返回空配置（以 `MISSING_API_KEY` 作为占位符值，提示用户）

### Provider 层 — `src/provider/`

```
src/provider/
├── events.ts      ← StreamEvent 类型定义（所有上层唯一依赖）
├── interface.ts   ← LLMProvider 接口
├── anthropic.ts   ← Anthropic 协议适配器
└── openai.ts      ← OpenAI 协议适配器
```

**LLMProvider 接口：**

```typescript
interface LLMProvider {
  // InternalMessage → 本 Provider 的 API 请求体格式
  prepareMessages(messages: InternalMessage[]): unknown
  // 流式对话（接收 InternalMessage，返回 StreamEvent）
  chat(messages: InternalMessage[], opts: ChatOptions): AsyncIterable<StreamEvent>
}
```

**Anthropic Adapter：**
- 请求：`POST {baseUrl}/v1/messages`
- 请求体中的 `messages` 格式按 Anthropic 规范组装
- 原生 SSE 事件 → StreamEvent 映射：
  - `content_block_start` + `content_block_delta`（`delta.type === 'thinking_delta'`） → `{ type: 'thinking', content }`
  - `content_block_delta`（`delta.type === 'text_delta'`） → `{ type: 'text', content }`
  - `message_stop` → `{ type: 'done' }`
  - 异常 → `{ type: 'error', message }`

**OpenAI Adapter：**
- 请求：`POST {baseUrl}/v1/chat/completions`（`stream: true`）
- 请求体中的 `messages` 格式按 OpenAI 规范组装
- 原生 SSE 事件 → StreamEvent 映射：
  - `data: { choices: [{ delta: { content } }] }` → `{ type: 'text', content }`
  - `data: [DONE]` → `{ type: 'done' }`
  - 异常 → `{ type: 'error', message }`

**SSE 解析：** 两个 Adapter 共享一个简单的行解析器，按行处理 `event:` 和 `data:` 前缀。

### Conversation — `src/conversation/conversation.ts`

**职责：** 消息历史的容器 + 与 Provider 的编排层。

```
Conversation
  ├── config: AppConfig
  ├── provider: LLMProvider  (由 activeModel 决定实例化哪个)
  ├── messages: InternalMessage[]  ← 全程使用内部消息格式
  │
  ├── addMessage(msg: InternalMessage) → void
  ├── streamReply() → AsyncIterable<StreamEvent>
  │     内部自动处理：
  │       1. 创建空 assistant InternalMessage 占位
  │       2. 消费 provider.chat(contextMessages) 的 StreamEvent
  │       3. 累积 thinking/content 到 InternalMessage
  │       4. streamReply 完成时标记 done
  ├── switchModel(name) → void
  └── getContextMessages() → InternalMessage[]
      (返回历史，Provider.prepareMessages 会在内部转为 API 格式)
```

### TUI — `src/tui/`

```
src/tui/
├── app.tsx              # App 根组件
├── message-list.tsx     # 消息列表渲染
├── thinking-block.tsx   # thinking 样式组件
└── input-bar.tsx        # 输入栏 + /命令解析
```

**App 组件（app.tsx）：**
- 状态：`messages[]`、`isStreaming`、`models[]`、`activeModel`
- 渲染 MessageList + InputBar
- 用户提交 → 调用 Conversation.addMessage + streamReply
- 流式事件逐步更新状态 → ink 渐进式 re-render

**MessageList（message-list.tsx）：**
- 按顺序渲染所有消息
- 用户消息：`<UserText>` 标签 + 内容
- 助手消息：如果有 thinking，先渲染 `<ThinkingBlock>`（灰色/斜体），再渲染正常内容

**ThinkingBlock（thinking-block.tsx）：**
- 用 `dimColor` 和 `italic` 样式渲染 thinking 内容
- 前缀添加 `🧠 Thinking...` 标签

**InputBar（input-bar.tsx）：**
- 单行文本输入
- 检测 `/` 开头：
  - `/model <name>` — 切换模型
  - `/models` — 列出可用模型
  - `/help` — 显示命令列表
- 非命令 → 作为 LLM 输入提交

## 模块交互

```
用户输入 "用 Python 写个快排"
    │
    ▼
InputBar — 检测非命令
    │
    ▼
App 组件：
  1. addMessage({ role: 'user', content: '用 Python 写个快排' })  ← InternalMessage
  2. setStreaming(true)
  3. await streamReply()
        │
        ▼
     Conversation.streamReply()
       │
       ├─ 内部: Provider.chat(contextMessages)
       │     ├─ prepareMessages(contextMessages)  ← InternalMessage[] → API 格式
       │     └─ fetch + SSE 解析 → StreamEvent
       │
       │     ▼  (AsyncIterable<StreamEvent>)
      │
      ├── { type: 'thinking', content: '用户需要...' }
      │     → App: 追加到当前 assistant msg.thinking
      │     → ink re-render ThinkingBlock
      │
      ├── { type: 'text', content: '以下是快排实现...' }
      │     → App: 追加到当前 assistant msg.content
      │     → ink re-render 正常文本
      │
      ├── { type: 'done' }
      │     → setStreaming(false), 开启下一轮输入
      │
      └── { type: 'error', message: 'API Error' }
            → 显示错误，用户可重试
```

## 文件组织

```
xike-code/
├── package.json
├── tsconfig.json
├── .xikerc.json                  # 示例本地配置
├── spec.md
├── src/
│   ├── index.tsx                  # 入口：启动 ink 渲染
│   ├── types/
│   │   └── index.ts               # InternalMessage、ModelConfig、AppConfig
│   ├── config/
│   │   └── config.ts              # 加载 & 合并 JSON 配置
│   ├── provider/
│   │   ├── events.ts              # StreamEvent 类型
│   │   ├── interface.ts           # LLMProvider 接口
│   │   ├── anthropic.ts           # Anthropic 适配器
│   │   └── openai.ts              # OpenAI 适配器
│   ├── conversation/
│   │   └── conversation.ts        # 消息历史 + 编排（操作 InternalMessage[]）
│   └── tui/
│       ├── app.tsx                # App 根组件
│       ├── message-list.tsx       # 消息列表
│       ├── thinking-block.tsx     # thinking 样式
│       └── input-bar.tsx          # 输入栏
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 运行时 | Bun | 内置 TS 支持、test runner、快速启动 |
| TUI 框架 | ink | React 组件化渲染，天然支持流式状态更新 |
| Provider 事件 | 统一 StreamEvent | 上层只依赖内部事件，Provider 做协议适配 |
| API 调用方式 | raw fetch (Bun native) | 零 SDK 依赖，完整流式控制 |
| 配置格式 | JSON | 用户指定，merge 策略简单 |
| SSE 解析 | 手写 parser | 轻量，两个协议共用核心逻辑 |
| 消息模型 | 双轨制（Internal ↔ API） | InternalMessage 持有丰富 role，Provider 负责格式转换，上层无感知 |
| 消息历史 | 内存存储 | MVP 不做持久化 |
