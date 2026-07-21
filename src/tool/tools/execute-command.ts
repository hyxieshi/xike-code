import type { Tool } from '../interface'

export const executeCommandTool: Tool = {
  name: 'execute_command',
  description: '执行 shell 命令并返回输出结果',
  safety: 'command',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的命令' },
      timeout: { type: 'number', description: '超时时间（毫秒，默认 30000）' },
    },
    required: ['command'],
  },
  async execute(args, options) {
    const { command, timeout } = args as { command: string; timeout?: number }
    const ms = timeout ?? 30000

    try {
      const proc = Bun.spawn(['bash', '-c', command], {
        stdout: 'pipe',
        stderr: 'pipe',
        signal: options?.signal,
      })

      const abort = new AbortController()
      const timer = setTimeout(() => abort.abort(), ms)

      if (options?.signal) {
        options.signal.addEventListener('abort', () => abort.abort(), { once: true })
      }

      try {
        const exited = await proc.exited
        clearTimeout(timer)

        if (abort.signal.aborted) {
          proc.kill()
          return { success: false, error: `命令执行超时（${ms}ms）: ${command}` }
        }

        const stdout = await new Response(proc.stdout).text()
        const stderr = await new Response(proc.stderr).text()

        return {
          success: exited === 0,
          data: {
            stdout,
            stderr,
            exitCode: exited,
          },
        }
      } catch {
        clearTimeout(timer)
        proc.kill()
        return { success: false, error: `命令执行失败: ${command}` }
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  },
}