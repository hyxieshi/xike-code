/**
 * 单条 SSE 事件的结构
 */
export interface SSEEvent {
  /** 事件类型（对应 "event: " 行） */
  event?: string
  /** 事件数据（对应 "data: " 行） */
  data: string
}

const decoder = new TextDecoder()

/**
 * 解析 Server-Sent Events (SSE) 流，逐条产出事件对象。
 *
 * 遵循 SSE 协议标准，支持：
 * - `event:` 事件类型
 * - `data:` 数据负载
 * - `data: [DONE]` 结束信号
 * - 空行触发当前事件完成
 *
 * @param body - 可读流（fetch Response 的 body）
 * @param signal - 可选的取消信号，触发 abort 时会关闭读取
 * @yields 解析出的 SSEEvent 对象
 */
export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<SSEEvent> {
  const reader = body.getReader()
  let buf = ''
  let current: SSEEvent | null = null

  /** 刷新当前累积的事件并返回 */
  const flush = (): SSEEvent | null => {
    const ev = current
    current = null
    return ev
  }

  /**
   * 处理一行 SSE 文本
   *
   * @param line - 单行文本
   * @returns 如果该行触发事件完成则返回事件，否则返回 null
   */
  const feed = (line: string): SSEEvent | null => {
    if (line === '') return flush()
    if (line.startsWith('event: ')) {
      (current ??= { data: '' }).event = line.slice(7)
      return null
    }
    if (line.startsWith('data: ')) {
      const payload = line.slice(6)
      if (payload === '[DONE]') {
        current = null
        return { data: '[DONE]' }
      }
      if (!current) current = { data: '' }
      current.data = current.data
        ? current.data + '\n' + payload
        : payload
      return null
    }
    return null
  }

  const onAbort = () => reader.cancel().catch(() => {})
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    while (true) {
      if (signal?.aborted) break

      const result = await reader.read()
      if (result.done) {
        buf += decoder.decode()
        break
      }

      buf += decoder.decode(result.value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''

      for (const line of lines) {
        const ev = feed(line)
        if (!ev) continue
        if (ev.data === '[DONE]') return
        yield ev
      }
    }

    if (buf) {
      const ev = feed(buf)
      if (ev && ev.data !== '[DONE]') yield ev
    }

    const ev = flush()
    if (ev) yield ev
  } finally {
    signal?.removeEventListener('abort', onAbort)
    reader.cancel().catch(() => {})
  }
}
