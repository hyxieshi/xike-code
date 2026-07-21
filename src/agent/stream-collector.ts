import type { StreamEvent, TokenUsage } from '../provider/events'
import type { InternalMessage, ToolCall } from '../types'

/**
 * 累积的完整回复数据，供循环决策使用
 */
export interface AccumulatedResponse {
  content: string
  thinking?: string
  toolCalls: ToolCall[]
  tokenUsage?: TokenUsage
}

/**
 * 流式收集器。
 *
 * 双路设计：
 * 1. 实时推送：通过 onEvent 回调把事件透传给外部（UI 的 for await）
 * 2. 累积存储：攒出完整响应供 AgentLoop 判断下一步
 */
export class StreamCollector {
  private content = ''
  private thinking = ''
  private toolCalls: ToolCall[] = []
  private currentToolCall: { id: string; name: string; args: string } | null = null
  private tokenUsage: TokenUsage | undefined
  private done = false
  private error: string | null = null

  constructor(
    private onEvent?: (event: StreamEvent) => void,
  ) {}

  push(event: StreamEvent): void {
    switch (event.type) {
      case 'text':
        this.content += event.content
        break
      case 'thinking':
        this.thinking += event.content
        break
      case 'tool_call_start':
        this.currentToolCall = { id: event.id, name: event.name, args: '' }
        break
      case 'tool_call_delta':
        if (this.currentToolCall && this.currentToolCall.id === event.id) {
          this.currentToolCall.args += event.delta
        }
        break
      case 'tool_call_done':
        if (this.currentToolCall) {
          this.toolCalls.push({
            id: event.id,
            name: event.name,
            args: event.args,
          })
          this.currentToolCall = null
        }
        break
      case 'token_usage':
        this.tokenUsage = event.usage
        break
      case 'done':
        this.done = true
        break
      case 'error':
        this.error = event.message
        break
    }

    this.onEvent?.(event)
  }

  getAccumulated(): AccumulatedResponse {
    return {
      content: this.content,
      thinking: this.thinking || undefined,
      toolCalls: this.toolCalls,
      tokenUsage: this.tokenUsage,
    }
  }

  isDone(): boolean {
    return this.done
  }

  getError(): string | null {
    return this.error
  }

  reset(): void {
    this.content = ''
    this.thinking = ''
    this.toolCalls = []
    this.currentToolCall = null
    this.tokenUsage = undefined
    this.done = false
    this.error = null
  }
}