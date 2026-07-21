/**
 * 工具安全分类。
 * - `readonly`: 只读操作（读文件、搜索等），可并发执行
 * - `write`: 写入操作（写文件、编辑文件等），需串行执行
 * - `command`: 命令执行（运行 shell 命令等），需串行执行
 */
export type ToolSafety = 'readonly' | 'write' | 'command'

/**
 * 工具接口。
 * 所有具体工具需实现此接口，包含名称、描述、安全分类、参数 Schema 和执行方法。
 */
export interface Tool {
  /** 工具名称（snake_case） */
  name: string
  /** 工具描述，供模型理解何时调用 */
  description: string
  /** 工具安全分类 */
  safety: ToolSafety
  /** 参数 JSON Schema */
  parameters: Record<string, unknown>
  /**
    * 执行工具
    *
    * @param args - 工具参数
    * @param options - 可选选项（如取消信号）
    * @returns 执行结果
    */
  execute(args: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>
}