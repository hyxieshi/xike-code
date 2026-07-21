import { test, expect, mock } from 'bun:test'
import { Conversation } from './conversation'
import { ToolRegistry } from '../tool/registry'
import type { Tool } from '../tool/interface'
import type { AppConfig, InternalMessage } from '../types'

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    models: [
      { name: 'gpt-4', model: 'gpt-4', provider: 'openai', protocol: 'openai', thinking: false, baseUrl: 'https://api.openai.com/v1/chat/completions', apiKey: 'sk-test' },
      { name: 'claude', model: 'claude-sonnet-4', provider: 'anthropic', protocol: 'anthropic', thinking: false, baseUrl: 'https://api.anthropic.com', apiKey: 'sk-test' },
    ],
    ...overrides,
  }
}

test('constructor: 初始化空消息列表', () => {
  const conv = new Conversation(createConfig())
  expect(conv.messages).toEqual([])
})

test('addMessage: 累积消息', () => {
  const conv = new Conversation(createConfig())
  const msg: InternalMessage = { role: 'user', content: '你好' }
  conv.addMessage(msg)
  expect(conv.messages).toHaveLength(1)
  expect(conv.messages[0]).toBe(msg)
})

test('addMessage: 多条消息按顺序累积', () => {
  const conv = new Conversation(createConfig())
  conv.addMessage({ role: 'user', content: '你好' })
  conv.addMessage({ role: 'assistant', content: '你好！' })
  conv.addMessage({ role: 'user', content: '1+1=?' })
  expect(conv.messages).toHaveLength(3)
  expect(conv.messages[1].content).toBe('你好！')
})

test('getModels: 返回配置中的所有模型', () => {
  const conv = new Conversation(createConfig())
  expect(conv.getModels()).toHaveLength(2)
  expect(conv.getModels()[0].name).toBe('gpt-4')
})

test('getActiveModel: 返回当前活动的模型', () => {
  const config = createConfig({ activeModel: 'claude' })
  const conv = new Conversation(config)
  expect(conv.getActiveModel()).not.toBeNull()
  expect(conv.getActiveModel()!.name).toBe('claude')
})

test('getActiveModel: 未设置 activeModel 时取第一个', () => {
  const config = createConfig({ activeModel: undefined })
  const conv = new Conversation(config)
  expect(conv.getActiveModel()!.name).toBe('gpt-4')
})

test('getActiveModel: 模型列表为空时返回 null', () => {
  const conv = new Conversation(createConfig({ models: [] }))
  expect(conv.getActiveModel()).toBeNull()
})

test('switchModel: 切换到存在的模型', () => {
  const conv = new Conversation(createConfig())
  const result = conv.switchModel('claude')
  expect(result).toBe(true)
  expect(conv.getActiveModel()!.name).toBe('claude')
})

test('switchModel: 切换到不存在的模型返回 false', () => {
  const conv = new Conversation(createConfig())
  const result = conv.switchModel('nonexistent')
  expect(result).toBe(false)
  expect(conv.getActiveModel()!.name).toBe('gpt-4')
})

test('streamReply: activeModel 为 null 时 yield error', async () => {
  const config = createConfig({ models: [], activeModel: undefined })
  const conv = new Conversation(config)
  const events: any[] = []
  for await (const ev of conv.streamReply()) {
    events.push(ev)
  }
  expect(events).toHaveLength(1)
  expect(events[0].type).toBe('error')
  expect(events[0].message).toBe('没有可用的模型，请先配置')
})

test('streamReply: activeModel 为 null 时不移除消息', async () => {
  const config = createConfig({ models: [], activeModel: undefined })
  const conv = new Conversation(config)
  conv.addMessage({ role: 'user', content: 'hi' })
  for await (const _ of conv.streamReply()) {
    // 不消费也会走完
  }
  expect(conv.messages).toHaveLength(1)
})

test('streamReply: 工具调用流程（单轮，不自动执行）', async () => {
  const config = createConfig({ activeModel: 'gpt-4' })
  const registry = new ToolRegistry()
  const mockTool: Tool = {
    name: 'test_tool',
    description: '测试工具',
    safety: 'readonly',
    parameters: { type: 'object', properties: {} },
    async execute() {
      return '工具执行结果'
    },
  }
  registry.register(mockTool)
  const conv = new Conversation(config, registry)

  const originalFetch = globalThis.fetch
  let callCount = 0
  globalThis.fetch = ((...args: unknown[]) => {
    callCount++
    const body = callCount === 1
      ? 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"test_tool","arguments":"{}"}}]},"index":0,"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'
      : 'data: {"choices":[{"delta":{"content":"工具已执行完成"},"index":0}]}\n\ndata: [DONE]\n\n'
    return Promise.resolve(new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
  }) as unknown as typeof fetch

  try {
    conv.addMessage({ role: 'user', content: '帮我查一下' })
    const events: any[] = []
    for await (const ev of conv.streamReply()) {
      events.push(ev)
    }

    // 单轮调用，不自动执行工具
    expect(callCount).toBe(1)
    expect(events.some(e => e.type === 'tool_call_done')).toBe(true)
    // streamReply 不再自动执行工具，所以没有 tool_result
    expect(events.some(e => e.type === 'tool_result')).toBe(false)

    // 验证占位消息的 toolCalls 被标记
    const assistantMsg = conv.messages.find(m => m.role === 'assistant' && m.toolCalls !== undefined)
    expect(assistantMsg).toBeDefined()
    expect(assistantMsg!.toolCalls).toEqual([])
  } finally {
    globalThis.fetch = originalFetch
  }
})
