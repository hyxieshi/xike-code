import type { LLMProvider } from './interface'
import type { InternalMessage, ChatOptions, ModelConfig } from '../types'
import type { StreamEvent } from './events'
import { parseSSEStream } from './sse'
import { debug } from '../logger'

/** OpenAI 流式响应中单个 choice 的数据结构 */
interface OpenAIChoice {
  /** 增量内容 */
  delta: {
    /** 角色信息（通常只在首块出现） */
    role?: string
    /** 文本内容增量 */
    content?: string
  }
  /** choice 序号 */
  index: number
}

/** OpenAI 流式响应中的单个数据块 */
interface OpenAIChunk {
  /** choice 列表 */
  choices?: OpenAIChoice[]
}

/**
 * OpenAI 兼容 API 的 LLM 提供商实现。
 * 适用于 OpenAI 原生接口以及所有兼容 OpenAI 格式的第三方 API（如 Groq、DeepSeek 等）。
 */
export class OpenAIProvider implements LLMProvider {
  /** 模型配置 */
  private config: ModelConfig

  /**
   * @param config - 模型配置，需包含 provider 为 'openai'
   */
  constructor(config: ModelConfig) {
    this.config = config
  }

  /**
   * 将内部消息格式转换为 OpenAI Chat Completions API 请求体
   *
   * @param messages - 内部消息列表
   * @returns OpenAI API 兼容的请求体对象
   */
  prepareMessages(messages: InternalMessage[]): unknown {
    return {
      model: this.config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    }
  }

  /**
   * 发起流式聊天请求，逐段产出 StreamEvent
   *
   * 使用 SSE 解析器逐块读取 OpenAI 格式的流式响应，
   * 从每个 chunk 的 `choices[0].delta.content` 中提取文本增量。
   *
   * @param messages - 消息列表
   * @param opts - 请求选项（如取消信号）
   * @yields 流式事件（text / done / error）
   */
  async *chat(
    messages: InternalMessage[],
    opts: ChatOptions,
  ): AsyncIterable<StreamEvent> {
    const body = this.prepareMessages(messages)

    let response: Response
    debug('OpenAI request:', { model: this.config.model, baseUrl: this.config.baseUrl, messagesCount: messages.length })
    try {
      response = await fetch(this.config.baseUrl!, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      })
    } catch (e) {
      debug('OpenAI error:', e)
      yield { type: 'error', message: (e as Error).message }
      return
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      yield {
        type: 'error',
        message: `${response.statusText}: ${text}`,
      }
      return
    }

    if (!response.body) {
      yield { type: 'error', message: '响应体为空' }
      return
    }

    try {
      for await (const ev of parseSSEStream(response.body, opts.signal)) {
        let chunk: OpenAIChunk
        try {
          chunk = JSON.parse(ev.data)
        } catch {
          continue
        }
        const choice = chunk.choices?.[0]
        if (!choice) continue
        const content = choice.delta?.content
        if (content == null) continue
        yield { type: 'text', content }
      }
      yield { type: 'done' }
    } catch (e) {
      debug('OpenAI error:', e)
      yield { type: 'error', message: (e as Error).message }
    }
  }
}
