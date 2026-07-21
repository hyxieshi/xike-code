import type { Tool } from '../interface'

export const writeFileTool: Tool = {
  name: 'write_file',
  description: '写入新文件。如果文件已存在则返回错误，请使用 edit_file 修改已有文件',
  safety: 'write',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径' },
      content: { type: 'string', description: '文件内容' },
    },
    required: ['path', 'content'],
  },
  async execute(args) {
    const { path, content } = args as { path: string; content: string }
    try {
      const file = Bun.file(path)
      const exists = await file.exists()
      if (exists) {
        return { success: false, error: `文件已存在: ${path}，请使用 edit_file 工具修改已有文件` }
      }
      await Bun.write(path, content)
      return { success: true, data: `文件已创建: ${path}` }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  },
}