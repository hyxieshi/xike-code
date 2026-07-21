import type { Tool } from '../interface'

export const grepTool: Tool = {
  name: 'grep',
  description: '使用 ripgrep 在文件内容中搜索正则表达式',
  safety: 'readonly',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '搜索的正则表达式' },
      path: { type: 'string', description: '搜索目录（可选，默认当前目录）' },
      include: { type: 'string', description: '文件类型过滤，如 *.ts（可选）' },
    },
    required: ['pattern'],
  },
  async execute(args, options) {
    const { pattern, path, include } = args as { pattern: string; path?: string; include?: string }
    try {
      const rgArgs = ['--with-filename', '--line-number', '--color', 'never', pattern]
      if (include) {
        rgArgs.push('--glob', include)
      }
      rgArgs.push(path || '.')

      const proc = Bun.spawn(['rg', ...rgArgs], {
        stdout: 'pipe',
        stderr: 'pipe',
        signal: options?.signal,
      })

      const exited = await proc.exited
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()

      if (exited === 0 || exited === 1) {
        return { success: true, data: stdout }
      }
      return { success: false, error: stderr || `rg 退出码: ${exited}` }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  },
}