import type { InternalMessage, ChatOptions } from '../types'
import type { StreamEvent } from './events'

/**
 * LLM 提供商的通用接口。
 * 所有 AI 模型提供商（Anthropic、OpenAI 等）需实现此接口以接入系统。
 */
export interface LLMProvider {
  /**
   * 将内部消息格式转换为对应提供商所需的请求体格式
   *
   * @param messages - 内部消息列表
   * @returns 提供商定制的请求数据结构
   */
  prepareMessages(messages: InternalMessage[]): unknown

  /**
   * 发起流式聊天请求，逐段返回事件
   *
   * @param messages - 消息列表
   * @param opts - 请求选项（如取消信号）
   * @returns 异步可迭代对象，每次 yield 一个 StreamEvent
   */
  chat(messages: InternalMessage[], opts: ChatOptions): AsyncIterable<StreamEvent>
}
