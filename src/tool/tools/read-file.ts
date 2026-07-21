import type { Tool } from '../interface'

export const readFileTool: Tool = {
  name: 'read_file',
  description: '读取文件内容，支持指定行范围',
  safety: 'readonly',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径' },
      offset: { type: 'number', description: '起始行号（从 1 开始，可选）' },
      limit: { type: 'number', description: '读取行数（可选）' },
    },
    required: ['path'],
  },
  async execute(args) {
    const { path, offset, limit } = args as { path: string; offset?: number; limit?: number }
    try {
      const file = Bun.file(path)
      const exists = await file.exists()
      if (!exists) {
        return { success: false, error: `文件不存在: ${path}` }
      }
      const text = await file.text()
      const lines = text.split('\n')

      if (offset !== undefined) {
        const start = Math.max(0, (offset as number) - 1)
        const end = limit !== undefined ? start + (limit as number) : undefined
        const selected = lines.slice(start, end)
        return { success: true, data: selected.join('\n') }
      }

      if (limit !== undefined) {
        const selected = lines.slice(0, limit as number)
        return { success: true, data: selected.join('\n') }
      }

      return { success: true, data: text }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  },
}