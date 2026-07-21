import type { Tool } from '../interface'

export const globTool: Tool = {
  name: 'glob',
  description: '按 glob 模式查找文件',
  safety: 'readonly',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'glob 模式，如 **/*.ts' },
      path: { type: 'string', description: '搜索目录（可选，默认当前目录）' },
    },
    required: ['pattern'],
  },
  async execute(args) {
    const { pattern, path } = args as { pattern: string; path?: string }
    try {
      const cwd = path || '.'
      const glob = new Bun.Glob(pattern)
      const results: string[] = []
      for await (const entry of glob.scan({ cwd, absolute: true })) {
        results.push(entry)
      }
      return { success: true, data: results }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  },
}