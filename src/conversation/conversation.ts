import type { InternalMessage, ModelConfig, AppConfig, ChatOptions } from '../types'
import type { StreamEvent } from '../provider/events'
import type { LLMProvider } from '../provider/interface'
import type { ToolRegistry } from '../tool/registry'
import { AnthropicProvider } from '../provider/anthropic'
import { OpenAIProvider } from '../provider/openai'
import { getActiveModel } from '../config/config'
import { debug } from '../logger'

export class Conversation {
  messages: InternalMessage[] = []
  private config: AppConfig
  private provider: LLMProvider
  private activeModel: ModelConfig | null
  private toolRegistry?: ToolRegistry

  constructor(config: AppConfig, toolRegistry?: ToolRegistry) {
    this.config = config
    this.toolRegistry = toolRegistry
    this.activeModel = getActiveModel(config)
    this.provider = this.activeModel ? this.createProvider(this.activeModel) : this.createNullProvider()
  }

  private createNullProvider(): LLMProvider {
    return {
      prepareMessages() { return [] },
      async *chat(): AsyncIterable<StreamEvent> {
        yield { type: 'error', message: '没有可用的模型，请先配置' }
      },
    }
  }

  private createProvider(model: ModelConfig | null): LLMProvider {
    if (!model) {
      throw new Error('没有可用的模型，请先配置')
    }
    switch (model.provider) {
      case 'anthropic':
        return new AnthropicProvider(model)
      case 'openai':
        return new OpenAIProvider(model)
      default:
        throw new Error(`不支持的模型协议: ${model.provider}`)
    }
  }

  addMessage(msg: InternalMessage): void {
    this.messages.push(msg)
  }

  /**
   * 单轮 LLM 流式回复（不递归调工具）。
   * 返回的 yield 事件包含模型文本和工具调用声明，
   * 由外部 AgentLoop 负责执行工具并继续循环。
   */
  async *streamReply(opts?: ChatOptions): AsyncIterable<StreamEvent> {
    if (!this.activeModel) {
      yield { type: 'error', message: '没有可用的模型，请先配置' }
      return
    }

    const placeholder: InternalMessage = { role: 'assistant', content: '', thinking: undefined }
    this.messages.push(placeholder)

    debug('Streaming single round, messages:', this.messages.length)
    try {
      const chatOpts: ChatOptions = { ...opts }
      if (this.toolRegistry) {
        chatOpts.tools = this.getToolDefinitions()
      }

      let hasToolCalls = false

      for await (const event of this.provider.chat(this.messages, chatOpts)) {
        debug('Stream event:', event.type)
        switch (event.type) {
          case 'text':
            placeholder.content += event.content
            break
          case 'thinking':
            placeholder.thinking = (placeholder.thinking ?? '') + event.content
            break
          case 'tool_call_done':
            hasToolCalls = true
            break
        }
        yield event
      }

      if (hasToolCalls && placeholder.toolCalls === undefined) {
        placeholder.toolCalls = []
      }
    } catch (err) {
      const message = (err as Error).message
      this.messages.pop()
      yield { type: 'error', message }
    }
  }

  private getToolDefinitions(): Record<string, unknown>[] {
    if (!this.toolRegistry || !this.activeModel) return []
    if (this.activeModel.provider === 'anthropic') {
      return this.toolRegistry.toAnthropicTools()
    }
    return this.toolRegistry.toOpenAITools()
  }

  switchModel(name: string): boolean {
    const model = this.config.models.find((m) => m.name === name)
    if (!model) return false
    try {
      this.provider = this.createProvider(model)
      this.activeModel = model
      debug('Switched to model:', name)
      return true
    } catch {
      return false
    }
  }

  getModels(): ModelConfig[] {
    return this.config.models
  }

  getActiveModel(): ModelConfig | null {
    return this.activeModel
  }
}