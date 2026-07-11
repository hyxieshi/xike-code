import { test, expect } from 'bun:test'
import { AnthropicProvider } from './anthropic'
import type { ModelConfig, InternalMessage } from '../types'

function mockFetch(fn: (...args: unknown[]) => Promise<Response | Error>) {
  const original = globalThis.fetch
  globalThis.fetch = fn as unknown as typeof fetch
  return original
}

function createProvider(overrides: Partial<ModelConfig> = {}): AnthropicProvider {
  return new AnthropicProvider({
    name: 'my-claude',
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    protocol: 'anthropic',
    thinking: false,
    baseUrl: 'https://api.anthropic.com',
    apiKey: '',
    ...overrides,
  })
}

test('prepareMessages: 基本 user/assistant 消息转换', () => {
  const provider = createProvider()
  const messages: InternalMessage[] = [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好！有什么可以帮你的？' },
  ]
  const result = provider.prepareMessages(messages) as Record<string, unknown>

  expect(result.model).toBe('claude-sonnet-4-20250514')
  expect(result.max_tokens).toBe(4096)
  expect(result.stream).toBe(true)
  expect(result.messages).toEqual([
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好！有什么可以帮你的？' },
  ])
  expect(result.system).toBeUndefined()
})

test('prepareMessages: system 消息放到顶级 system 字段', () => {
  const provider = createProvider()
  const messages: InternalMessage[] = [
    { role: 'system', content: '你是 Claude' },
    { role: 'user', content: '你是谁' },
  ]
  const result = provider.prepareMessages(messages) as Record<string, unknown>

  expect(result.system).toBe('你是 Claude')
  expect(result.messages).toEqual([
    { role: 'user', content: '你是谁' },
  ])
})

test('prepareMessages: 多条 system 消息用换行拼接', () => {
  const provider = createProvider()
  const messages: InternalMessage[] = [
    { role: 'system', content: '你是 Claude' },
    { role: 'system', content: '用中文回答' },
    { role: 'user', content: 'hi' },
  ]
  const result = provider.prepareMessages(messages) as Record<string, unknown>

  expect(result.system).toBe('你是 Claude\n用中文回答')
})

test('prepareMessages: thinking 开启时添加 thinking 字段', () => {
  const provider = createProvider({ thinking: true })
  const messages: InternalMessage[] = [
    { role: 'user', content: '1+1=?' },
  ]
  const result = provider.prepareMessages(messages) as Record<string, unknown>

  expect(result.max_tokens).toBe(8192)
  expect(result.thinking).toEqual({
    type: 'enabled',
    budget_tokens: 4096,
  })
})

test('chat 正常流式响应（text 块）', async () => {
  const provider = createProvider()
  const chunks =
    'event: content_block_start\n' +
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"你好"}}\n\n' +
    'event: content_block_delta\n' +
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"世界"}}\n\n' +
    'event: message_stop\n' +
    'data: {"type":"message_stop"}\n\n'

  const restore = mockFetch(async () =>
    new Response(chunks, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }),
  )

  try {
    const events: { type: string; content?: string }[] = []
    for await (const ev of provider.chat(
      [{ role: 'user', content: 'hi' }],
      {},
    )) {
      events.push(ev)
    }
    expect(events).toEqual([
      { type: 'text', content: '你好' },
      { type: 'text', content: '世界' },
      { type: 'done' },
    ])
  } finally {
    globalThis.fetch = restore
  }
})

test('chat thinking + text 流式响应', async () => {
  const provider = createProvider({ thinking: true })
  const chunks =
    'event: content_block_start\n' +
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"思考中..."}}\n\n' +
    'event: content_block_delta\n' +
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"继续思考"}}\n\n' +
    'event: content_block_stop\n' +
    'data: {"type":"content_block_stop","index":0}\n\n' +
    'event: content_block_start\n' +
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":"答案是"}}\n\n' +
    'event: content_block_delta\n' +
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"42"}}\n\n' +
    'event: message_stop\n' +
    'data: {"type":"message_stop"}\n\n'

  const restore = mockFetch(async () =>
    new Response(chunks, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }),
  )

  try {
    const events: { type: string; content?: string }[] = []
    for await (const ev of provider.chat(
      [{ role: 'user', content: 'hi' }],
      {},
    )) {
      events.push(ev)
    }
    expect(events).toEqual([
      { type: 'thinking', content: '思考中...' },
      { type: 'thinking', content: '继续思考' },
      { type: 'text', content: '答案是' },
      { type: 'text', content: '42' },
      { type: 'done' },
    ])
  } finally {
    globalThis.fetch = restore
  }
})

test('chat 非 200 响应', async () => {
  const provider = createProvider()
  const restore = mockFetch(async () =>
    new Response('Unauthorized', {
      status: 401,
      statusText: 'Unauthorized',
    }),
  )

  try {
    const events: { type: string; message?: string }[] = []
    for await (const ev of provider.chat(
      [{ role: 'user', content: 'hi' }],
      {},
    )) {
      events.push(ev)
    }
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('error')
    expect(events[0].message).toContain('Unauthorized')
  } finally {
    globalThis.fetch = restore
  }
})

test('chat 网络错误', async () => {
  const provider = createProvider()
  const restore = mockFetch(async () => {
    throw new Error('网络连接失败')
  })

  try {
    const events: { type: string; message?: string }[] = []
    for await (const ev of provider.chat(
      [{ role: 'user', content: 'hi' }],
      {},
    )) {
      events.push(ev)
    }
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('error')
    expect(events[0].message).toBe('网络连接失败')
  } finally {
    globalThis.fetch = restore
  }
})

test('prepareMessages: 空消息列表', () => {
  const provider = createProvider()
  const result = provider.prepareMessages([]) as Record<string, unknown>

  expect(result.messages).toEqual([])
  expect(result.system).toBeUndefined()
})
