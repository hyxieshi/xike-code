import type { Tool } from '../interface'

export const editFileTool: Tool = {
  name: 'edit_file',
  description: '修改文件内容，通过原文唯一匹配替换。如果文件不存在请使用 write_file 创建',
  safety: 'write',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径' },
      oldString: { type: 'string', description: '被替换的原文（必须唯一匹配）' },
      newString: { type: 'string', description: '替换后的新内容' },
    },
    required: ['path', 'oldString', 'newString'],
  },
  async execute(args) {
    const { path, oldString, newString } = args as { path: string; oldString: string; newString: string }
    try {
      const file = Bun.file(path)
      const exists = await file.exists()
      if (!exists) {
        return { success: false, error: `文件不存在: ${path}，请使用 write_file 工具创建新文件` }
      }

      const content = await file.text()
      const matches = content.split(oldString).length - 1

      if (matches === 0) {
        return { success: false, error: `未找到匹配的原文:\n\`\`\`\n${oldString}\n\`\`\`\n请确保原文内容精确匹配文件中的现有内容` }
      }

      if (matches > 1) {
        return { success: false, error: `找到 ${matches} 处匹配，请提供更精确的原文以确保唯一匹配` }
      }

      const newContent = content.replace(oldString, newString)
      await Bun.write(path, newContent)
      return { success: true, data: `文件已修改: ${path}` }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  },
}