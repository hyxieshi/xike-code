# xike code Spec

## 背景

项目目前只有 README 和 AGENTS.md，是一张白纸。目标是构建一个终端 AI 编程助手 xike code，对标 Claude Code。

## 目标

- 实现可交互的终端 TUI，用户输入问题，LLM 流式逐字输出回答
- 支持多轮对话（消息历史上下文）
- 抽象 Provider 层，同时支持 Anthropic 和 OpenAI 两种协议
- 支持 Anthropic 的 thinking 模式
- 通过 JSON 配置文件管理模型参数

## 功能需求

- **F1 - 交互式 TUI：** 终端启动后进入交互界面，显示提示符等待用户输入。用户输入问题后，LLM 流式返回内容逐字输出到终端。支持 `Ctrl+C` 退出、清屏等基本终端操作。
- **F2 - Provider 抽象层：** 定义统一的 `LLMProvider` 接口，包含 `chat(messages, stream)` 方法。Anthropic 和 OpenAI 各自实现该接口，内部处理协议差异（请求格式、认证、流式解析）。方便后续扩展其他 Provider。
- **F3 - Thinking 模式支持：** 对于支持 thinking 的模型（主要是 Anthropic Claude），在流式响应中区分 thinking 内容和最终回答。thinking 内容以特殊样式展示（灰色/斜体）。
- **F4 - 多轮对话：** 自动维护消息历史，每次请求携带之前的对话上下文。支持在会话中继续追问。
- **F5 - 模型配置系统：** 从全局 `~/.config/xike-code/config.json` 和本地 `./.xikerc.json` 合并读取配置，本地覆盖全局。
- **F6 - 模型切换：** 支持在运行中通过命令 `/model` 切换当前使用的模型，`/models` 列出可用模型。

### 模型配置格式

```json
{
  "models": [
    {
      "name": "my-claude",
      "provider": "anthropic",
      "protocol": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "baseUrl": "https://api.anthropic.com",
      "apiKey": "sk-ant-xxx",
      "thinking": true
    }
  ],
  "activeModel": "my-claude"
}
```

## 非功能需求

- **N1 - 流式逐字输出：** LLM 返回的 token 到达后立即渲染到终端，不等待完整响应。
- **N2 - 会话级消息历史：** 消息历史在会话期间持续维护，退出后清空（不做持久化）。
- **N3 - 错误处理：** API 调用失败时给出友好提示，不崩溃。

## 不做的事（MVP 范围外）

- Tool use / Function calling
- MCP 服务器集成
- Agent / 多 Agent 协作
- 技能（Skills）系统
- 对话历史持久化
- 文件编辑、代码搜索等文件系统操作
- 项目管理

## 验收标准

- **AC1：** 启动 `xike` → 显示提示符 → 输入"你好" → 看到流式输出回答
- **AC2：** 配置 Anthropic 模型后提问 → 回答正常流式返回
- **AC3：** 配置 OpenAI 模型后提问 → 回答正常流式返回
- **AC4：** 模型开启 thinking → 先显示思考过程（灰色/斜体），再显示最终回答
- **AC5：** 连续提问 → 上下文正确保持（如"刚才我说了什么？"能正确回答）
- **AC6：** 输入 `/model` → 列出可用模型，可切换
- **AC7：** 全局 config.json + 本地 .xikerc.json → 本地配置正确覆盖全局
