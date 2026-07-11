import type { InternalMessage, ModelConfig, AppConfig, ChatOptions } from '../types'
import type { StreamEvent } from '../provider/events'
import type { LLMProvider } from '../provider/interface'
import { AnthropicProvider } from '../provider/anthropic'
import { OpenAIProvider } from '../provider/openai'
import { getActiveModel } from '../config/config'
import { debug } from '../logger'

/**
 * 对话管理类。
 * 维护消息历史、管理当前激活的 AI 模型、驱动流式回复。
 */
export class Conversation {
  /** 当前对话的消息列表 */
  messages: InternalMessage[] = []
  /** 应用配置 */
  private config: AppConfig
  /** 当前使用的 LLM 提供商实例 */
  private provider: LLMProvider
  /** 当前激活的模型配置 */
  private activeModel: ModelConfig | null

  /**
   * @param config - 应用配置，从中读取激活的模型并初始化提供商
   */
  constructor(config: AppConfig) {
    this.config = config
    this.activeModel = getActiveModel(config)
    this.provider = this.activeModel ? this.createProvider(this.activeModel) : this.createNullProvider()
  }

  /**
   * 创建一个空的提供商实例，用于无可用模型时的占位
   *
   * @returns 始终返回 error 事件的占位提供商
   */
  private createNullProvider(): LLMProvider {
    return {
      prepareMessages() { return [] },
      async *chat(): AsyncIterable<StreamEvent> {
        yield { type: 'error', message: '没有可用的模型，请先配置' }
      },
    }
  }

  /**
   * 根据模型配置创建对应的 LLM 提供商实例
   *
   * @param model - 模型配置（如果为 null 会抛出异常）
   * @returns LLM 提供商实例
   * @throws 当模型为 null 或 provider 不支持时抛出错误
   */
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

  /**
   * 向对话中追加一条消息
   *
   * @param msg - 要添加的消息
   */
  addMessage(msg: InternalMessage): void {
    this.messages.push(msg)
  }

  /**
   * 流式获取 AI 回复。
   * 会自动在消息列表末尾添加一个占位的 assistant 消息，并在收到回复事件时增量更新。
   * 如果发生错误，会自动移除占位消息。
   *
   * @param opts - 可选请求选项
   * @yields 流式事件（text 事件会自动累积到最后一条 assistant 消息中）
   */
  async *streamReply(opts?: ChatOptions): AsyncIterable<StreamEvent> {
    if (!this.activeModel) {
      yield { type: 'error', message: '没有可用的模型，请先配置' }
      return
    }

    const placeholder: InternalMessage = { role: 'assistant', content: '', thinking: undefined }
    this.messages.push(placeholder)

    debug('Streaming reply, messages:', this.messages.length)
    try {
      for await (const event of this.provider.chat(this.messages, opts ?? {})) {
        switch (event.type) {
          case 'text':
            placeholder.content += event.content
            break
          case 'thinking':
            placeholder.thinking = (placeholder.thinking ?? '') + event.content
            break
        }
        yield event
      }
      debug('Stream reply done')
    } catch (err) {
      const message = (err as Error).message
      this.messages.pop()
      yield { type: 'error', message }
    }
  }

  /**
   * 切换到指定名称的模型
   *
   * @param name - 模型名称（需在配置中存在）
   * @returns 切换成功返回 true，未找到模型返回 false
   */
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

  /**
   * 获取所有可用模型的列表
   *
   * @returns 模型配置数组
   */
  getModels(): ModelConfig[] {
    return this.config.models
  }

  /**
   * 获取当前激活的模型
   *
   * @returns 当前模型配置，无可激活模型时返回 null
   */
  getActiveModel(): ModelConfig | null {
    return this.activeModel
  }
}
