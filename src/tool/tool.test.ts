import { test, expect, beforeAll, afterAll } from 'bun:test'
import { ToolRegistry } from './registry'
import { readFileTool } from './tools/read-file'
import { writeFileTool } from './tools/write-file'
import { editFileTool } from './tools/edit-file'
import { executeCommandTool } from './tools/execute-command'
import { globTool } from './tools/glob'
import { grepTool } from './tools/grep'

const tmpDir = '/tmp/xike-code-tool-test'

beforeAll(async () => {
  await Bun.write(`${tmpDir}/hello.txt`, 'hello world\nline 2\nline 3\n')
  await Bun.write(`${tmpDir}/multi-match.txt`, 'foo\nbar\nfoo\nbaz')
})

afterAll(async () => {
  await Bun.spawn(['rm', '-rf', tmpDir]).exited
})

test('ToolRegistry: 注册和查找', () => {
  const reg = new ToolRegistry()
  reg.register(readFileTool)
  expect(reg.get('read_file')).toBe(readFileTool)
  expect(reg.get('nonexistent')).toBeUndefined()
})

test('ToolRegistry: getAll 返回所有注册工具', () => {
  const reg = new ToolRegistry()
  reg.register(readFileTool)
  reg.register(writeFileTool)
  expect(reg.getAll()).toHaveLength(2)
})

test('ToolRegistry: toAnthropicTools 格式', () => {
  const reg = new ToolRegistry()
  reg.register(readFileTool)
  const tools = reg.toAnthropicTools()
  expect(tools[0]).toHaveProperty('name')
  expect(tools[0]).toHaveProperty('description')
  expect(tools[0]).toHaveProperty('input_schema')
})

test('ToolRegistry: toOpenAITools 格式', () => {
  const reg = new ToolRegistry()
  reg.register(readFileTool)
  const tools = reg.toOpenAITools()
  expect(tools[0]).toHaveProperty('type', 'function')
  expect(tools[0].function).toHaveProperty('name')
  expect(tools[0].function).toHaveProperty('parameters')
})

test('read_file: 读取现有文件', async () => {
  const result = await readFileTool.execute({ path: `${tmpDir}/hello.txt` }) as any
  expect(result.success).toBe(true)
  expect(result.data).toBe('hello world\nline 2\nline 3\n')
})

test('read_file: 读取不存在的文件', async () => {
  const result = await readFileTool.execute({ path: '/nonexistent/file.txt' }) as any
  expect(result.success).toBe(false)
  expect(result.error).toContain('不存在')
})

test('read_file: 指定行范围', async () => {
  const result = await readFileTool.execute({ path: `${tmpDir}/hello.txt`, offset: 1, limit: 2 }) as any
  expect(result.success).toBe(true)
  expect(result.data).toBe('hello world\nline 2')
})

test('write_file: 写入新文件', async () => {
  const path = `${tmpDir}/new-test.txt`
  const result = await writeFileTool.execute({ path, content: 'new content' }) as any
  expect(result.success).toBe(true)
  const content = await Bun.file(path).text()
  expect(content).toBe('new content')
})

test('write_file: 写入已存在文件返回错误', async () => {
  const result = await writeFileTool.execute({ path: `${tmpDir}/hello.txt`, content: 'overwrite' }) as any
  expect(result.success).toBe(false)
  expect(result.error).toContain('文件已存在')
  expect(result.error).toContain('edit_file')
})

test('edit_file: 精确替换', async () => {
  const path = `${tmpDir}/edit-test.txt`
  await Bun.write(path, 'old content')
  const result = await editFileTool.execute({ path, oldString: 'old content', newString: 'new content' }) as any
  expect(result.success).toBe(true)
  const content = await Bun.file(path).text()
  expect(content).toBe('new content')
})

test('edit_file: 编辑不存在的文件返回错误', async () => {
  const result = await editFileTool.execute({ path: '/nonexistent/file.txt', oldString: 'old', newString: 'new' }) as any
  expect(result.success).toBe(false)
  expect(result.error).toContain('文件不存在')
  expect(result.error).toContain('write_file')
})

test('edit_file: 匹配不到返回错误', async () => {
  const result = await editFileTool.execute({ path: `${tmpDir}/hello.txt`, oldString: 'nonexistent string', newString: 'replacement' }) as any
  expect(result.success).toBe(false)
  expect(result.error).toContain('未找到匹配')
})

test('edit_file: 匹配多次返回错误', async () => {
  const result = await editFileTool.execute({ path: `${tmpDir}/multi-match.txt`, oldString: 'foo', newString: 'bar' }) as any
  expect(result.success).toBe(false)
  expect(result.error).toContain('2 处匹配')
})

test('execute_command: 成功执行命令', async () => {
  const result = await executeCommandTool.execute({ command: 'echo "hello from bun"' }) as any
  expect(result.success).toBe(true)
  expect(result.data.stdout).toContain('hello from bun')
})

test('execute_command: 命令失败', async () => {
  const result = await executeCommandTool.execute({ command: 'exit 1' }) as any
  expect(result.success).toBe(false)
})

test('glob: 按模式查找文件', async () => {
  const result = await globTool.execute({ pattern: '*.txt', path: tmpDir }) as any
  expect(result.success).toBe(true)
  expect(result.data.length).toBeGreaterThanOrEqual(1)
})

test('grep: 搜索文件内容', async () => {
  const result = await grepTool.execute({ pattern: 'hello', path: tmpDir }) as any
  // rg 未安装时不报错，只检查工具有响应
  if (result.success) {
    expect(result.data).toContain('hello')
  } else {
    expect(result.error).toBeTruthy()
  }
})