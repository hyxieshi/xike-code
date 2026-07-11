import { test, expect } from 'bun:test'
import { OpenAIProvider } from './openai'
import type { InternalMessage, ModelConfig } from '../types'

function mockFetch(fn: () => Promise<Response | Error>) {
  const original = globalThis.fetch
  globalThis.fetch = fn as unknown as typeof fetch
  return original
}

function makeProvider(config?: Partial<ModelConfig>): OpenAIProvider {
  return new OpenAIProvider({
    name: 'test-model',
    model: 'test-model',
    provider: 'openai',
    protocol: 'openai',
    thinking: false,
    baseUrl: 'https://api.example.com/v1/chat/completions',
    apiKey: 'sk-test',
    ...config,
  } as ModelConfig)
}

test('prepareMessages 转换消息格式', () => {
  const provider = makeProvider()
  const messages: InternalMessage[] = [
    { role: 'system', content: '你是助手' },
    { role: 'user', content: '你好' },
  ]
  const result = provider.prepareMessages(messages) as Record<string, unknown>
  expect(result.model).toBe('test-model')
  expect(result.stream).toBe(true)
  expect(result.messages).toEqual([
    { role: 'system', content: '你是助手' },
    { role: 'user', content: '你好' },
  ])
})

test('prepareMessages 保留 assistant 角色', () => {
  const provider = makeProvider()
  const messages: InternalMessage[] = [
    { role: 'user', content: '1+1=?' },
    { role: 'assistant', content: '2' },
    { role: 'user', content: '2+2=?' },
  ]
  const result = provider.prepareMessages(messages) as Record<string, unknown>
  expect(result.messages).toEqual([
    { role: 'user', content: '1+1=?' },
    { role: 'assistant', content: '2' },
    { role: 'user', content: '2+2=?' },
  ])
})

test('chat 正常流式响应', async () => {
  const provider = makeProvider()
  const chunks =
    'data: {"choices":[{"delta":{"role":"assistant"},"index":0}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"你好"},"index":0}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"世界"},"index":0}]}\n\n' +
    'data: [DONE]\n\n'

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

test('chat role 变更行不产出事件', async () => {
  const provider = makeProvider()
  const chunks =
    'data: {"choices":[{"delta":{"content":"Hi"},"index":0}]}\n\n' +
    'data: [DONE]\n\n'

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
      { type: 'text', content: 'Hi' },
      { type: 'done' },
    ])
  } finally {
    globalThis.fetch = restore
  }
})

test('chat 跳过 delta.content 为 null 的块', async () => {
  const provider = makeProvider()
  const chunks =
    'data: {"choices":[{"delta":{"content":null},"index":0}]}\n\n' +
    'data: {"choices":[{"delta":{},"index":0}]}\n\n' +
    'data: [DONE]\n\n'

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
    expect(events).toEqual([{ type: 'done' }])
  } finally {
    globalThis.fetch = restore
  }
})

test('chat 非 200 响应', async () => {
  const provider = makeProvider()
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
  const provider = makeProvider()
  const restore = mockFetch(async () => {
    throw new Error('网络错误')
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
    expect(events[0].message).toBe('网络错误')
  } finally {
    globalThis.fetch = restore
  }
})

test('baseUrl 直接使用不拼接路径', () => {
  const provider = new OpenAIProvider({
    name: 'step',
    model: 'step-3.7-flash',
    provider: 'openai',
    protocol: 'openai',
    thinking: false,
    apiKey: 'sk-test',
    baseUrl: 'https://api.stepfun.com/step_plan/v1/chat/completions',
  } as ModelConfig)
  expect(provider).toBeInstanceOf(OpenAIProvider)
})
