import { test, expect } from 'bun:test'
import { parseSSEStream } from './sse'

test('解析基本 SSE 事件', async () => {
  const body = new Response('data: hello\n\n').body!

  const events = await collect(parseSSEStream(body))
  expect(events).toEqual([{ data: 'hello' }])
})

test('解析 event + data', async () => {
  const body = new Response('event: message\ndata: hello\n\n').body!

  const events = await collect(parseSSEStream(body))
  expect(events).toEqual([{ event: 'message', data: 'hello' }])
})

test('解析多个事件', async () => {
  const body = new Response(
    'data: first\n\n' +
    'data: second\n\n'
  ).body!

  const events = await collect(parseSSEStream(body))
  expect(events).toEqual([
    { data: 'first' },
    { data: 'second' },
  ])
})

test('多行 data 以换行拼接', async () => {
  const body = new Response('data: line1\ndata: line2\n\n').body!

  const events = await collect(parseSSEStream(body))
  expect(events).toEqual([{ data: 'line1\nline2' }])
})

test('data: [DONE] 终止解析', async () => {
  const body = new Response(
    'data: first\n\n' +
    'data: [DONE]\n\n' +
    'data: ignored\n\n'
  ).body!

  const events = await collect(parseSSEStream(body))
  expect(events).toEqual([{ data: 'first' }])
})

test('AbortSignal 取消', async () => {
  const controller = new AbortController()
  const body = new Response('data: hello\n\n').body!

  controller.abort()
  const events = await collect(parseSSEStream(body, controller.signal))
  expect(events).toEqual([])
})

test('大块数据跨 chunk', async () => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: hel'))
      controller.enqueue(encoder.encode('lo\n\n'))
      controller.close()
    },
  })

  const events = await collect(parseSSEStream(stream))
  expect(events).toEqual([{ data: 'hello' }])
})

async function collect(
  iter: AsyncIterable<{ event?: string; data: string }>,
): Promise<{ event?: string; data: string }[]> {
  const result: { event?: string; data: string }[] = []
  for await (const ev of iter) result.push(ev)
  return result
}
