import type { InternalMessage } from '../types'

/**
 * 估算一条消息在终端中占用的行数（包含角色标签行）。
 *
 * @param msg - 内部消息
 * @param columns - 终端列数
 * @returns 估算行数
 */
export function estimateMessageLines(msg: InternalMessage, columns: number): number {
  const width = Math.max(1, columns - 4)
  const contentLines = msg.content.split('\n').reduce((sum, line) => {
    return sum + Math.max(1, Math.ceil(line.length / width))
  }, 0)
  const thinkingLines = msg.thinking
    ? msg.thinking.split('\n').reduce((sum, line) => {
        return sum + Math.max(1, Math.ceil(line.length / width))
      }, 0)
    : 0
  return 1 + contentLines + thinkingLines
}


