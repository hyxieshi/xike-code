import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/**
 * 是否开启调试模式，由环境变量 `DEBUG=true` 或 `DEBUG=1` 控制
 */
const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1'

/**
 * 调试日志文件路径：~/.xike-code/debug.log
 */
const LOG_FILE = join(homedir(), '.xike-code', 'debug.log')

/**
 * 确保日志目录存在，仅在首次写入时创建
 */
let logDirInitialized = false
function ensureLogDir() {
  if (logDirInitialized) return
  try {
    mkdirSync(join(homedir(), '.xike-code'), { recursive: true })
  } catch { /* 忽略目录创建失败 */ }
  logDirInitialized = true
}

/**
 * 输出调试日志（仅 DEBUG 模式下生效）。
 * 日志写入 ~/.xike-code/debug.log，不输出到终端。
 *
 * @param args - 任意数量的日志参数
 */
export function debug(...args: unknown[]) {
  if (!DEBUG) return
  ensureLogDir()
  const line = `[${new Date().toISOString()}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`
  try {
    appendFileSync(LOG_FILE, line)
  } catch { /* 忽略写入失败 */ }
}

/**
 * 输出普通日志（始终生效）。
 * 日志写入 ~/.xike-code/debug.log，不输出到终端。
 *
 * @param args - 任意数量的日志参数
 */
export function log(...args: unknown[]) {
  ensureLogDir()
  const line = `[${new Date().toISOString()}] [xike] ${args.map(a => String(a)).join(' ')}\n`
  try {
    appendFileSync(LOG_FILE, line)
  } catch { /* 忽略写入失败 */ }
}
