import type { LLMProvider } from './interface'
import type { InternalMessage, ChatOptions, ModelConfig } from '../types'
import type { StreamEvent } from './events'
import { parseSSEStream } from './sse'
import { debug } from '../logger'

function buildAnthropicContent(msg: InternalMessage): unknown[] {
  if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
    const blocks: unknown[] = []
    if (msg.content) {
      blocks.push({ type: 'text', text: msg.content })
    }
    for (const tc of msg.toolCalls) {
      blocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.args,
      })
    }
    return blocks
  }
  if (msg.role === 'tool') {
    return [
      {
        type: 'tool_result',
        tool_use_id: msg.toolCallId,
        content: msg.content,
      },
    ]
  }
  return [{ type: 'text', text: msg.content }]
}

export class AnthropicProvider implements LLMProvider {
  private config: ModelConfig

  constructor(config: ModelConfig) {
    this.config = config
  }

  prepareMessages(messages: InternalMessage[], tools?: Record<string, unknown>[]): unknown {
    const systemMessages = messages.filter(m => m.role === 'system')
    const nonSystemMessages = messages.filter(m => m.role !== 'system')

    const maxTokens = this.config.thinking ? 8192 : 4096

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: maxTokens,
      messages: nonSystemMessages.map(m => ({
        role: m.role,
        content: buildAnthropicContent(m),
      })),
      stream: true,
    }

    if (tools && tools.length > 0) {
      body.tools = tools
    }

    if (systemMessages.length > 0) {
      body.system = systemMessages.map(m => m.content).join('\n')
    }

    if (this.config.thinking) {
      body.thinking = { type: 'enabled', budget_tokens: 4096 }
    }

    return body
  }

  async *chat(
    messages: InternalMessage[],
    opts: ChatOptions,
  ): AsyncIterable<StreamEvent> {
    try {
      const body = this.prepareMessages(messages, opts.tools) as Record<string, unknown>

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

      let toolCallId = ''
      let toolName = ''
      let toolArgsBuffer = ''

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
          } else if (block?.type === 'tool_use') {
            toolCallId = block.id as string
            toolName = block.name as string
            toolArgsBuffer = ''
            yield { type: 'tool_call_start', id: toolCallId, name: toolName }
            if (block.input) {
              toolArgsBuffer = JSON.stringify(block.input)
            }
          }
        } else if (sse.event === 'content_block_delta') {
          const delta = data.delta as Record<string, string> | undefined
          if (delta?.type === 'thinking_delta') {
            yield { type: 'thinking', content: delta.thinking ?? '' }
          } else if (delta?.type === 'text_delta') {
            yield { type: 'text', content: delta.text ?? '' }
          } else if (delta?.type === 'input_json_delta') {
            const frag = delta.partial_json ?? ''
            toolArgsBuffer += frag
            yield { type: 'tool_call_delta', id: toolCallId, delta: frag }
          }
        } else if (sse.event === 'content_block_stop') {
          if (toolCallId && toolName) {
            let args: Record<string, unknown> = {}
            try {
              args = JSON.parse(toolArgsBuffer)
            } catch {
              args = {}
            }
            yield { type: 'tool_call_done', id: toolCallId, name: toolName, args }
            toolCallId = ''
            toolName = ''
            toolArgsBuffer = ''
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