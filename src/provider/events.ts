import type { InternalMessage } from '../types'
import type { ToolSafety } from '../tool/interface'

/**
 * Token 用量信息
 */
export interface TokenUsage {
  /** 输入 token 数 */
  input: number
  /** 输出 token 数 */
  output: number
}

/**
 * 流式事件类型。
 * 在 AI 模型回复过程中，通过此联合类型逐段推送数据。
 *
 * - `text`: 文本内容片段
 * - `thinking`: 模型思考/推理过程片段
 * - `tool_call_start`: 工具调用开始（含 id 和工具名）
 * - `tool_call_delta`: 工具调用参数 JSON 碎片
 * - `tool_call_done`: 工具调用参数完整就绪
 * - `tool_result`: 工具执行结果
 * - `token_usage`: 本轮 LLM 调用的 token 用量
 * - `progress`: Agent Loop 进度信息
 * - `agent_done`: Agent Loop 结束
 * - `done`: 单次 LLM 回复结束
 * - `error`: 发生错误
 */
export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; delta: string }
  | { type: 'tool_call_done'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; success: boolean; output: string }
  | { type: 'token_usage'; usage: TokenUsage }
  | { type: 'progress'; round: number; totalToolCalls: number; status: 'reasoning' | 'executing' | 'planning' | 'done' }
  | { type: 'agent_done'; reason: 'complete' | 'max_iterations' | 'cancelled' | 'unknown_tool' | 'error'; message?: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
