import { ToolRegistry } from './registry'
import { readFileTool } from './tools/read-file'
import { writeFileTool } from './tools/write-file'
import { editFileTool } from './tools/edit-file'
import { executeCommandTool } from './tools/execute-command'
import { globTool } from './tools/glob'
import { grepTool } from './tools/grep'

export * from './interface'
export * from './registry'

/**
 * 创建默认工具注册中心，注册全部六个核心工具
 */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register(readFileTool)
  registry.register(writeFileTool)
  registry.register(editFileTool)
  registry.register(executeCommandTool)
  registry.register(globTool)
  registry.register(grepTool)
  return registry
}