import type { LLMProvider } from './interface'
import type { InternalMessage, ChatOptions, ModelConfig } from '../types'
import type { StreamEvent } from './events'
import { parseSSEStream } from './sse'
import { debug } from '../logger'

interface OpenAIChoice {
  delta: {
    role?: string
    content?: string
    tool_calls?: {
      index: number
      id?: string
      type?: string
      function?: {
        name?: string
        arguments?: string
      }
    }[]
  }
  index: number
  finish_reason?: string | null
}

interface OpenAIChunk {
  choices?: OpenAIChoice[]
}

export class OpenAIProvider implements LLMProvider {
  private config: ModelConfig

  constructor(config: ModelConfig) {
    this.config = config
  }

  prepareMessages(messages: InternalMessage[], tools?: Record<string, unknown>[]): unknown {
    const apiMessages = messages.map((m) => {
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          })),
        }
      }
      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: m.toolCallId,
          content: m.content,
        }
      }
      return {
        role: m.role,
        content: m.content,
      }
    })

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: apiMessages,
      stream: true,
    }

    if (tools && tools.length > 0) {
      body.tools = tools
    }

    return body
  }

  async *chat(
    messages: InternalMessage[],
    opts: ChatOptions,
  ): AsyncIterable<StreamEvent> {
    const body = this.prepareMessages(messages, opts.tools)

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
      const toolCallAccumulators = new Map<number, {
        id: string
        name: string
        argsBuffer: string
      }>()

      for await (const ev of parseSSEStream(response.body, opts.signal)) {
        debug('OpenAI raw SSE:', ev.data)
        let chunk: OpenAIChunk
        try {
          chunk = JSON.parse(ev.data)
        } catch {
          continue
        }
        const choice = chunk.choices?.[0]
        if (!choice) {
          debug('OpenAI no choice in chunk:', ev.data)
          continue
        }

        const delta = choice.delta

        const textContent = delta?.content
        if (textContent) {
          yield { type: 'text', content: textContent }
        }

        const reasoningContent = (delta as Record<string, unknown>)?.reasoning as string | undefined
        if (reasoningContent) {
          yield { type: 'thinking', content: reasoningContent }
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index
            let acc = toolCallAccumulators.get(idx)
            if (!acc) {
              acc = { id: tc.id ?? '', name: '', argsBuffer: '' }
              toolCallAccumulators.set(idx, acc)
            }
            if (tc.id) acc.id = tc.id
            if (tc.function?.name) {
              acc.name = tc.function.name
              yield { type: 'tool_call_start', id: acc.id, name: acc.name }
            }
            if (tc.function?.arguments) {
              acc.argsBuffer += tc.function.arguments
              yield { type: 'tool_call_delta', id: acc.id, delta: tc.function.arguments }
            }
          }
        }

        if (choice.finish_reason === 'tool_calls') {
          debug('OpenAI finish_reason: tool_calls, accumulating', toolCallAccumulators.size, 'tools')
          for (const [idx, acc] of toolCallAccumulators) {
            let args: Record<string, unknown> = {}
            try {
              args = JSON.parse(acc.argsBuffer)
            } catch {
              args = {}
            }
            yield { type: 'tool_call_done', id: acc.id, name: acc.name, args }
          }
          toolCallAccumulators.clear()
        } else if (choice.finish_reason) {
          debug('OpenAI finish_reason:', choice.finish_reason)
        }
      }
      debug('OpenAI stream done, toolCalls accumulated:', toolCallAccumulators.size)
      yield { type: 'done' }
    } catch (e) {
      debug('OpenAI error:', e)
      yield { type: 'error', message: (e as Error).message }
    }
  }
}