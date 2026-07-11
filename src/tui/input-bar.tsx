import { Box, Text, useInput } from 'ink'
import React, { useState } from 'react'

/**
 * InputBar 组件的属性
 */
interface InputBarProps {
  /** 提交普通消息时的回调 */
  onSubmit: (text: string) => void
  /** 输入以 / 开头的命令时的回调 */
  onCommand: (cmd: string, args: string) => void
  /** 是否禁用输入（如正在流式回复时） */
  disabled?: boolean
}

/**
 * 底部输入栏组件。
 *
 * 支持普通文本输入和斜杠命令（如 /model, /help）。
 * 当 disabled 为 true 时忽略所有键盘输入。
 * 方向键会被透传给外层组件处理滚动。
 *
 * @param props - 组件属性
 * @returns React 元素
 */
export function InputBar({ onSubmit, onCommand, disabled = false }: InputBarProps) {
  const [input, setInput] = useState('')

  /**
   * 处理提交操作：判断输入是普通消息还是斜杠命令
   *
   * @param text - 用户输入的原始文本
   */
  const handleSubmit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(/\s+/)
      const cmd = parts[0]
      const args = parts.slice(1).join(' ')
      onCommand(cmd, args)
    } else {
      onSubmit(trimmed)
    }

    setInput('')
  }

  useInput((_input, key) => {
    if (disabled) return
    // 忽略方向键（留给外层滚动）
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return
    // 忽略 Ctrl+ 组合键（留给外层处理快捷键）
    if (key.ctrl) return

    if (key.return) {
      handleSubmit(input)
      return
    }

    if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1))
      return
    }

    setInput(prev => prev + _input)
  })

  return (
    <Box borderStyle="single" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">{'>'}</Text>
      <Text>{' '}{input}{disabled ? '' : <Text dimColor>▌</Text>}</Text>
    </Box>
  )
}
