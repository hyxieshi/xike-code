import type { InternalMessage } from '../types'

/**
 * 流式事件类型。
 * 在 AI 模型回复过程中，通过此联合类型逐段推送数据。
 *
 * - `text`: 文本内容片段
 * - `thinking`: 模型思考/推理过程片段
 * - `done`: 回复结束
 * - `error`: 发生错误
 */
export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
