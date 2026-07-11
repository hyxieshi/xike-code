import type { LLMProvider } from './interface'
import type { InternalMessage, ChatOptions, ModelConfig } from '../types'
import type { StreamEvent } from './events'
import { parseSSEStream } from './sse'
import { debug } from '../logger'

/**
 * Anthropic Claude API 的 LLM 提供商实现。
 * 支持消息流式输出和 thinking（思维链）模式。
 */
export class AnthropicProvider implements LLMProvider {
  /** 模型配置 */
  private config: ModelConfig

  /**
   * @param config - 模型配置，需包含 provider 为 'anthropic'
   */
  constructor(config: ModelConfig) {
    this.config = config
  }

  /**
   * 将内部消息格式转换为 Anthropic API 请求体
   *
   * - 系统消息会被提取到 `system` 顶层字段
   * - 非系统消息放入 `messages` 数组
   * - 如果配置了 thinking 模式，会自动添加 thinking 配置块
   *
   * @param messages - 内部消息列表
   * @returns Anthropic API 兼容的请求体对象
   */
  prepareMessages(messages: InternalMessage[]): unknown {
    const systemMessages = messages.filter(m => m.role === 'system')
    const nonSystemMessages = messages.filter(m => m.role !== 'system')

    const maxTokens = this.config.thinking ? 8192 : 4096

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: maxTokens,
      messages: nonSystemMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    }

    if (systemMessages.length > 0) {
      body.system = systemMessages.map(m => m.content).join('\n')
    }

    if (this.config.thinking) {
      body.thinking = { type: 'enabled', budget_tokens: 4096 }
    }

    return body
  }

  /**
   * 发起流式聊天请求，逐段产出 StreamEvent
   *
   * 支持的事件：
   * - `content_block_start` → 初始块（thinking 或 text）
   * - `content_block_delta` → 增量块（thinking_delta 或 text_delta）
   * - `message_stop` → 结束
   *
   * @param messages - 消息列表
   * @param opts - 请求选项（如取消信号）
   * @yields 流式事件（text / thinking / done / error）
   */
  async *chat(
    messages: InternalMessage[],
    opts: ChatOptions,
  ): AsyncIterable<StreamEvent> {
    try {
      const body = this.prepareMessages(messages) as Record<string, unknown>

      let baseUrl = this.config.baseUrl || 'https://api.anthropic.com'
      if (!baseUrl.endsWith('/v1/messages')) {
        baseUrl = baseUrl.replace(/\/+$/, '') + '/v1/messages'
      }

      debug('Anthropic request:', { model: this.config.model, baseUrl, messagesCount: messages.length })
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      })

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '')
        debug('Anthropic error:', response.status, response.statusText)
        yield { type: 'error', message: `${response.statusText}: ${errorBody}` }
        return
      }

      for await (const sse of parseSSEStream(response.body!, opts.signal)) {
        if (sse.data === '[DONE]') continue

        let data: Record<string, unknown>
        try {
          data = JSON.parse(sse.data)
        } catch {
          continue
        }

        if (sse.event === 'content_block_start') {
          const block = data.content_block as Record<string, string> | undefined
          if (block?.type === 'thinking') {
            yield { type: 'thinking', content: block.thinking ?? '' }
          } else if (block?.type === 'text') {
            yield { type: 'text', content: block.text ?? '' }
          }
        } else if (sse.event === 'content_block_delta') {
          const delta = data.delta as Record<string, string> | undefined
          if (delta?.type === 'thinking_delta') {
            yield { type: 'thinking', content: delta.thinking ?? '' }
          } else if (delta?.type === 'text_delta') {
            yield { type: 'text', content: delta.text ?? '' }
          }
        } else if (sse.event === 'message_stop') {
          yield { type: 'done' }
          return
        }
      }
    } catch (err) {
      debug('Anthropic error:', err)
      yield { type: 'error', message: (err as Error).message }
    }
  }
}
