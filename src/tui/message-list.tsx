import { Box, Text, useStdout } from 'ink'
import React, { useMemo } from 'react'
import type { InternalMessage } from '../types'
import { ThinkingBlock } from './thinking-block'
import { estimateMessageLines } from './layout'

/**
 * MessageList 组件的属性
 */
interface MessageListProps {
  /** 要显示的消息列表 */
  messages: InternalMessage[]
  /** 是否正在流式接收回复 */
  isStreaming?: boolean
  /** 垂直滚动偏移量（行数） */
  scrollOffset: number
  /** 是否展示思考过程 */
  showThinking: boolean
}

/**
 * 消息列表组件。
 *
 * 根据终端窗口大小自动计算每条消息所占行数，
 * 并结合 scrollOffset 实现消息历史的平滑滚动。
 * 消息按角色分颜色显示：用户（绿色）、助手（蓝色）、系统（灰色）。
 *
 * @param props - 组件属性
 * @returns React 元素
 */
export function MessageList({ messages, isStreaming, scrollOffset, showThinking }: MessageListProps) {
  const { stdout } = useStdout()
  const columns = stdout.columns || 80
  const rows = stdout.rows || 24

  /**
   * 估算每条消息在终端中占用的行数
   *
   * @param msg - 内部消息
   * @returns 估算行数（包含角色标签行）
   */
  const estimateLines = (msg: InternalMessage): number =>
    estimateMessageLines(msg, columns)

  /**
   * 根据 scrollOffset 计算可见消息列表
   * 从被滚动裁剪后的位置开始截取消息
   */
  const visibleMessages = useMemo(() => {
    if (messages.length === 0) return messages

    const lineEstimates = messages.map(estimateLines)
    const totalLines = lineEstimates.reduce((a, b) => a + b, 0)
    const availableRows = Math.max(1, rows - 5)
    const maxScroll = Math.max(0, totalLines - availableRows)
    const effectiveScroll = Math.min(scrollOffset, maxScroll)
    const linesToSkip = Math.max(0, maxScroll - effectiveScroll)

    let startIdx = 0
    let skipped = 0
    for (let i = 0; i < messages.length; i++) {
      if (skipped + lineEstimates[i] > linesToSkip) {
        startIdx = i
        break
      }
      skipped += lineEstimates[i]
    }

    return messages.slice(startIdx)
  }, [messages, scrollOffset, columns, rows])

  return (
    <Box flexDirection="column" overflow="hidden" flexGrow={1}>
      {visibleMessages.map((msg, i) => {
        const msgIdx = messages.indexOf(msg)
        const isLast = msgIdx === messages.length - 1
        return (
        <Box key={msgIdx} flexDirection="column" marginBottom={1}>
          {msg.role === 'user' && (
            <Text color="green">You: {msg.content}</Text>
          )}
          {msg.role === 'assistant' && (
            <>
              <Text color="blue">Assistant:</Text>
              {msg.thinking && showThinking && <ThinkingBlock content={msg.thinking} />}
              {msg.content ? <Text>{msg.content}</Text> : (
                isLast && isStreaming ? null : <Text dimColor>(no response)</Text>
              )}
            </>
          )}
          {msg.role === 'system' && (
            <Text dimColor>System: {msg.content}</Text>
          )}
        </Box>
        )
      })}
    </Box>
  )
}
