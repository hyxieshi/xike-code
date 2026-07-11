import { Text } from 'ink'
import React from 'react'

/**
 * ThinkingBlock 组件的属性
 */
interface ThinkingBlockProps {
  /** 模型的思考/推理文本 */
  content: string
}

/**
 * 用于显示 AI 模型思考过程（thinking）的 UI 组件。
 *
 * 以灰色斜体样式展示模型的思维链文本。
 * 如果 content 为空字符串则不渲染任何内容。
 *
 * @param props - 组件属性
 * @returns React 元素，或 content 为空时返回 null
 */
export function ThinkingBlock({ content }: ThinkingBlockProps) {
  if (!content) return null

  return (
    <Text dimColor italic>
      💭 {content}
    </Text>
  )
}
