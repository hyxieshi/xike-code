import type { Conversation } from '../conversation/conversation'
import type { ToolRegistry, Tool } from '../tool'
import type { StreamEvent } from '../provider/events'
import type { InternalMessage, ToolCall } from '../types'
import { StreamCollector } from './stream-collector'
import { debug } from '../logger'

export type AgentMode = 'plan' | 'do'

export interface AgentConfig {
  /** 普通模式最大迭代轮次（LLM 调用次数） */
  maxIterations: number
  /** Plan 模式最大迭代轮次 */
  planMaxIterations: number
  /** 连续未知工具阈值 */
  unknownToolThreshold: number
}

const DEFAULT_CONFIG: AgentConfig = {
  maxIterations: 50,
  planMaxIterations: 10,
  unknownToolThreshold: 3,
}

export class AgentCancelledError extends Error {
  constructor() {
    super('用户取消了操作')
    this.name = 'AgentCancelledError'
  }
}

export class AgentLoop {
  private conversation: Conversation
  private toolRegistry: ToolRegistry
  private mode: AgentMode = 'do'
  private config: AgentConfig
  private planText: string = ''
  private consecutiveUnknownTools = 0

  /** 计划模式下注入的系统提醒 */
  private static PLAN_SYSTEM_PROMPT =
    '你处于规划模式。你可以读取文件、搜索代码、探索目录结构，但不允许修改任何文件或执行命令。请先充分了解项目现状，然后输出一份清晰的实施计划。计划完成后，请明确声明「计划完成」。'

  constructor(
    conversation: Conversation,
    toolRegistry: ToolRegistry,
    config?: Partial<AgentConfig>,
  ) {
    this.conversation = conversation
    this.toolRegistry = toolRegistry
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  setMode(mode: AgentMode, planText?: string): void {
    this.mode = mode
    if (mode === 'do' && planText) {
      this.planText = planText
    }
  }

  getMode(): AgentMode {
    return this.mode
  }

  getPlanText(): string {
    return this.planText
  }

  /**
   * 执行完整 Agent 循环，产出事件流供 UI 消费。
   *
   * 停止条件：
   * 1. 自然完成——模型回复不含工具调用
   * 2. 迭代上限——达到 maxIterations
   * 3. 用户取消——AbortSignal 触发
   * 4. 连续未知工具——连续 3 轮调不存在的工具
   * 5. 流出错——LLM 流返回 error 事件
   */
  async *execute(signal?: AbortSignal): AsyncIterable<StreamEvent> {
    const maxIter = this.mode === 'plan' ? this.config.planMaxIterations : this.config.maxIterations
    this.consecutiveUnknownTools = 0

    if (this.mode === 'plan') {
      this.conversation.addMessage({ role: 'system', content: AgentLoop.PLAN_SYSTEM_PROMPT })
    }

    if (this.mode === 'do' && this.planText) {
      this.conversation.addMessage({
        role: 'system',
        content: `以下是之前制定的计划，请按此执行：\n\n${this.planText}`,
      })
    }

    for (let round = 0; round < maxIter; round++) {
      if (signal?.aborted) {
        yield { type: 'agent_done', reason: 'cancelled', message: '用户取消了操作' }
        return
      }

      yield { type: 'progress', round: round + 1, totalToolCalls: 0, status: 'reasoning' }

      debug(`Agent round ${round + 1}/${maxIter}, mode: ${this.mode}`)

      const collector = new StreamCollector()

      try {
        for await (const event of this.conversation.streamReply({ signal })) {
          collector.push(event)
          yield event
        }
      } catch (err) {
        const message = (err as Error).message
        yield { type: 'error', message: `LLM 流错误: ${message}` }
        yield { type: 'agent_done', reason: 'error', message }
        return
      }

      const accumulated = collector.getAccumulated()

      const streamError = collector.getError()
      if (streamError) {
        yield { type: 'error', message: streamError }
        yield { type: 'agent_done', reason: 'error', message: streamError }
        return
      }

      if (accumulated.toolCalls.length === 0) {
        yield { type: 'progress', round: round + 1, totalToolCalls: 0, status: 'done' }
        yield { type: 'agent_done', reason: 'complete' }
        return
      }

      const toolCalls = accumulated.toolCalls

      yield { type: 'progress', round: round + 1, totalToolCalls: toolCalls.length, status: 'executing' }

      const unknownCount = this.countUnknownTools(toolCalls)
      const hasKnownTools = unknownCount < toolCalls.length

      if (hasKnownTools) {
        this.consecutiveUnknownTools = 0
      } else {
        this.consecutiveUnknownTools++
        debug(`Consecutive unknown tools: ${this.consecutiveUnknownTools}/${this.config.unknownToolThreshold}`)
        if (this.consecutiveUnknownTools >= this.config.unknownToolThreshold) {
          const errMsg = `模型连续 ${this.config.unknownToolThreshold} 轮请求不存在的工具，已停止`
          this.conversation.addMessage({ role: 'system', content: errMsg })
          yield { type: 'error', message: errMsg }
          yield { type: 'agent_done', reason: 'unknown_tool', message: errMsg }
          return
        }
      }

      const results = await this.executeToolCalls(toolCalls, signal)

      for (const result of results) {
        if (result.type !== 'tool_result') continue
        this.conversation.addMessage({
          role: 'tool',
          content: result.output,
          toolCallId: result.id,
          toolName: result.name,
        })
        yield result
      }

      const nextPlaceholder: InternalMessage = { role: 'assistant', content: '', thinking: undefined }
      this.conversation.addMessage(nextPlaceholder)
    }

    yield { type: 'agent_done', reason: 'max_iterations', message: `已达到最大迭代轮次（${maxIter}）` }
  }

  /**
   * 按安全性分批执行工具调用。
   *
   * 规则：连续 readonly 调用合并为并发批，write/command 单独串行，
   * 整体保持原始调用顺序。
   */
  private async executeToolCalls(
    toolCalls: ToolCall[],
    signal?: AbortSignal,
  ): Promise<StreamEvent[]> {
    const results: (StreamEvent | null)[] = new Array(toolCalls.length).fill(null)

    let i = 0
    while (i < toolCalls.length) {
      const tc = toolCalls[i]
      const tool = this.toolRegistry.get(tc.name)

      if (!tool) {
        const errMsg = `未找到工具: ${tc.name}`
        results[i] = { type: 'tool_result', id: tc.id, name: tc.name, success: false, output: errMsg }
        i++
        continue
      }

      if (this.mode === 'plan' && tool.safety !== 'readonly') {
        const errMsg = `规划模式下不允许执行 ${tool.safety} 工具: ${tc.name}`
        results[i] = { type: 'tool_result', id: tc.id, name: tc.name, success: false, output: errMsg }
        i++
        continue
      }

      if (tool.safety === 'readonly') {
        const batchStart = i
        while (i < toolCalls.length) {
          const nextTool = this.toolRegistry.get(toolCalls[i].name)
          if (!nextTool || nextTool.safety !== 'readonly') break
          i++
        }
        const batch = toolCalls.slice(batchStart, i)
        const batchResults = await this.executeBatchConcurrently(batch, signal)
        for (let j = 0; j < batch.length; j++) {
          results[batchStart + j] = batchResults[j]
        }
      } else {
        results[i] = await this.executeSingleTool(tool, tc, signal)
        i++
      }
    }

    return results as StreamEvent[]
  }

  private async executeBatchConcurrently(
    batch: ToolCall[],
    signal?: AbortSignal,
  ): Promise<StreamEvent[]> {
    debug(`Executing batch of ${batch.length} readonly tools concurrently`)
    const promises = batch.map(async (tc) => {
      const tool = this.toolRegistry.get(tc.name)!
      return this.executeSingleTool(tool, tc, signal)
    })
    return Promise.all(promises)
  }

  private async executeSingleTool(
    tool: Tool,
    tc: ToolCall,
    signal?: AbortSignal,
  ): Promise<StreamEvent> {
    try {
      const result = await tool.execute(tc.args, { signal })
      const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      return { type: 'tool_result', id: tc.id, name: tc.name, success: true, output }
    } catch (err) {
      const errMsg = (err as Error).message
      return { type: 'tool_result', id: tc.id, name: tc.name, success: false, output: errMsg }
    }
  }

  private countUnknownTools(toolCalls: ToolCall[]): number {
    let count = 0
    for (const tc of toolCalls) {
      if (!this.toolRegistry.get(tc.name)) {
        count++
      }
    }
    return count
  }
}