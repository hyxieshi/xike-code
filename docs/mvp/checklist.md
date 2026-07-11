# xike code Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性

- [ ] T1 项目初始化完成：`bun install` 成功，无依赖错误
- [ ] T2 类型定义完成：所有共享类型可通过编译检查
- [ ] T3 配置加载完成：全局 + 本地 JSON 合并正确，环境变量兜底生效
- [ ] T4 Provider 事件与接口完成：StreamEvent 和 LLMProvider 接口定义正确
- [ ] T5 SSE 解析工具完成：能正确解析模拟的 SSE 数据流
- [ ] T6 Anthropic Provider 完成：消息格式转换正确，事件映射完整
- [ ] T7 OpenAI Provider 完成：消息格式转换正确，事件映射完整
- [ ] T8 Conversation 完成：消息累积、thinking 分离、done 状态管理正确
- [ ] T9 ThinkingBlock 组件完成：thinking 内容以灰色/斜体渲染
- [ ] T10 MessageList 组件完成：按 role 区分渲染各类消息
- [ ] T11 InputBar 组件完成：文本输入和 `/command` 解析正常
- [ ] T12 App + 入口完成：`bun run src/index.tsx` 启动成功
- [ ] T13 示例配置完成：`.xikerc.json` JSON 语法正确

## 编译与类型检查

- [ ] `bunx tsc --noEmit` 通过，无类型错误
- [ ] `bun run src/index.tsx` 启动无运行时错误

## Provider 层

- [ ] `AnthropicProvider.prepareMessages` 正确转换 InternalMessage → Anthropic 格式
  - user/assistant → role 映射正确
  - system 消息按 Anthropic 要求处理
  - thinking 配置开启时请求体含 thinking block
- [ ] `OpenAIProvider.prepareMessages` 正确转换 InternalMessage → OpenAI 格式
  - system/user/assistant → role 映射正确
- [ ] Anthropic 流式事件映射：thinking_delta → StreamEvent.thinking, text_delta → StreamEvent.text
- [ ] OpenAI 流式事件映射：delta.content → StreamEvent.text

## 配置系统

- [ ] 加载全局 `~/.config/xike-code/config.json`（文件不存在时不报错）
- [ ] 加载本地 `./.xikerc.json`（文件不存在时不报错）
- [ ] 本地模型覆盖全局同名模型
- [ ] 环境变量 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 被正确读取
- [ ] `getActiveModel` 返回当前活跃模型

## 对话

- [ ] 用户消息添加到历史后，在后续 API 调用中出现在上下文中
- [ ] 流式回复过程中，text 和 thinking 内容正确累积到 InternalMessage
- [ ] `streamReply` 的 done 事件后，消息标记 finalized
- [ ] `switchModel` 切换后，后续 chat 调用使用新模型

## TUI 界面

- [ ] 启动后显示提示符等待输入
- [ ] 输入文字在输入栏可见
- [ ] 提交后，用户消息出现在消息列表中
- [ ] 流式回复逐字渲染（ink 渐进式 re-render）
- [ ] thinking 内容以灰色/斜体显示
- [ ] assistant 回复以蓝色标签开头
- [ ] 流式回复完成后，输入栏恢复可输入状态

## 命令系统

- [ ] `/model <name>` 切换模型成功，有反馈消息
- [ ] `/models` 列出所有可用模型
- [ ] `/help` 显示命令帮助说明
- [ ] `Ctrl+C` 优雅退出

## 错误处理

- [ ] API key 无效时显示友好错误提示，不崩溃
- [ ] 网络错误时显示友好错误提示，不崩溃
- [ ] 配置不完整（无模型）时启动提示

## 端到端场景

- [ ] **场景 1 - 基本对话：** 启动 xike → 输入"你好" → 看到流式输出回答 → 输入"再说一遍" → 模型正确回应用户之前的问题
- [ ] **场景 2 - 双模型：** 配置两个模型 → 启动 → `/models` 看到两个模型 → `/model <另一个>` 切换 → 提问 → 新模型回答
- [ ] **场景 3 - 配置合并：** 全局 config.json 配一个模型 → 本地 .xikerc.json 配另一个 → 启动后两个模型都可用
