import type { Tool, ToolSafety } from './interface'

/**
 * 工具注册中心。
 * 集中登记工具，按名称查找，并可将工具列表转为 API 可识别的格式。
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>()

  /**
    * 注册一个工具
    *
    * @param tool - 工具实例
    */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  /**
    * 按名称查找工具
    *
    * @param name - 工具名称
    * @returns 工具实例，未找到返回 undefined
    */
  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  /**
    * 获取所有已注册的工具
    *
    * @returns 工具数组
    */
  getAll(): Tool[] {
    return Array.from(this.tools.values())
  }

  /**
    * 获取指定安全分类的工具
    *
    * @param safety - 安全分类
    * @returns 匹配的工具数组
    */
  getBySafety(safety: ToolSafety): Tool[] {
    return this.getAll().filter(t => t.safety === safety)
  }

  /**
    * 获取所有只读工具
    */
  getReadonlyTools(): Tool[] {
    return this.getBySafety('readonly')
  }

  /**
    * 检查工具是否只读
    *
    * @param name - 工具名称
    * @returns 工具是否存在且为只读
    */
  isReadonly(name: string): boolean {
    const tool = this.tools.get(name)
    return tool ? tool.safety === 'readonly' : false
  }

  /**
    * 转为 Anthropic API 工具格式
    *
    * @param filter - 可选的安全分类过滤
    */
  toAnthropicTools(filter?: ToolSafety): Record<string, unknown>[] {
    const tools = filter ? this.getBySafety(filter) : this.getAll()
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }))
  }

  /**
    * 转为 OpenAI API 工具格式
    *
    * @param filter - 可选的安全分类过滤
    */
  toOpenAITools(filter?: ToolSafety): Record<string, unknown>[] {
    const tools = filter ? this.getBySafety(filter) : this.getAll()
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
  }
}