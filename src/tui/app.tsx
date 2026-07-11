import React, { useState, useEffect, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { loadConfig } from '../config/config'
import { Conversation } from '../conversation/conversation'
import { MessageList } from './message-list'
import { InputBar } from './input-bar'
import type { InternalMessage } from '../types'

/**
 * 应用主组件。
 *
 * 提供完整的终端交互界面：
 * - 顶部标题栏显示当前模型名称
 * - 中间消息列表展示对话历史
 * - 底部输入栏支持普通消息和斜杠命令
 * - 上下方向键可滚动浏览历史消息
 *
 * 支持的斜杠命令：
 * - `/model <name>` 切换到指定模型
 * - `/models` 列出所有可用模型
 * - `/help` 显示帮助信息
 *
 * @returns React 元素
 */
export function App() {
  const [messages, setMessages] = useState<InternalMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [scrollOffset, setScrollOffset] = useState(0)
  const [showThinking, setShowThinking] = useState(true)
  const convRef = useRef<Conversation | null>(null)

  // 上下箭头滚动消息历史
  useInput((_input, key) => {
    if (key.upArrow) {
      setScrollOffset(prev => prev + 1)
    }
    if (key.downArrow) {
      setScrollOffset(prev => Math.max(0, prev - 1))
    }
  })

  /** 初始化：加载配置、创建对话实例、处理无模型场景 */
  useEffect(() => {
    const config = loadConfig()
    const conv = new Conversation(config)
    convRef.current = conv

    if (config.models.length === 0) {
      setMessages([{ role: 'system', content: '未找到模型配置。请创建 ~/.config/xike-code/config.json 或 ./.xikerc.json' }])
    } else if (!conv.getActiveModel()) {
      const names = config.models.map(m => m.name).join(', ')
      setMessages([{ role: 'system', content: `可用模型: ${names}。使用 /model <name> 切换` }])
    }
  }, [])

  /**
   * 处理用户提交的普通消息。
   * 将消息加入对话后发起流式请求，逐段更新界面。
   *
   * @param text - 用户输入的消息文本
   */
  const handleSubmit = async (text: string) => {
    const conv = convRef.current
    if (!conv || isStreaming) return

    const activeModel = conv.getActiveModel()
    if (!activeModel) {
      setMessages(prev => [...prev, { role: 'system', content: '没有可用的激活模型，请先使用 /model <name> 切换' }])
      return
    }

    const userMsg: InternalMessage = { role: 'user', content: text }
    conv.addMessage(userMsg)
    setMessages(prev => [...prev, userMsg])

    setScrollOffset(0)
    setIsStreaming(true)
    setStatusText('🤔 思考中...')

    const assistantMsg: InternalMessage = { role: 'assistant', content: '', thinking: '' }
    setMessages(prev => [...prev, assistantMsg])
    // 注意：不把 assistantMsg 加入 conv.messages，由 streamReply() 内部 push 占位消息

    try {
      for await (const event of conv.streamReply()) {
        if (event.type === 'text') {
          setMessages(prev => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: last.content + event.content }
            }
            return updated
          })
        } else if (event.type === 'thinking') {
          setMessages(prev => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last.role === 'assistant') {
              updated[updated.length - 1] = { ...last, thinking: (last.thinking || '') + event.content }
            }
            return updated
          })
        } else if (event.type === 'done') {
          setStatusText('')
        } else if (event.type === 'error') {
          setMessages(prev => prev.slice(0, -1))
          setMessages(prev => [...prev, { role: 'system', content: `错误: ${event.message}` }])
          setStatusText('')
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'system', content: `错误: ${err}` }])
    } finally {
      setIsStreaming(false)
      setStatusText('')
    }
  }

  /**
   * 处理斜杠命令
   *
   * @param cmd - 命令名称
   * @param args - 命令参数
   */
  const handleCommand = (cmd: string, args: string) => {
    const conv = convRef.current
    if (!conv) return

    switch (cmd) {
      case 'model':
        if (!args) {
          setMessages(prev => [...prev, { role: 'system', content: '用法: /model <模型名称>' }])
          return
        }
        if (conv.switchModel(args)) {
          setMessages(prev => [...prev, { role: 'system', content: `已切换到模型: ${args}` }])
        } else {
          setMessages(prev => [...prev, { role: 'system', content: `未找到模型: ${args}。使用 /models 查看可用模型` }])
        }
        break

      case 'models': {
        const models = conv.getModels()
        if (models.length === 0) {
          setMessages(prev => [...prev, { role: 'system', content: '没有配置任何模型' }])
        } else {
          const list = models.map(m => {
            const active = conv.getActiveModel()?.name === m.name ? ' ✓' : ''
            return `  - ${m.name} (${m.provider}/${m.model})${active}`
          }).join('\n')
          setMessages(prev => [...prev, { role: 'system', content: `可用模型:\n${list}` }])
        }
        break
      }

      case 'thinking':
        setShowThinking(prev => {
          const next = !prev
          setMessages(prevMsgs => [...prevMsgs, { role: 'system', content: `思考展示已${next ? '开启' : '关闭'}` }])
          return next
        })
        break

      case 'help':
        setMessages(prev => [...prev, {
          role: 'system',
          content: `可用命令:\n  /model <name>   — 切换到指定模型\n  /models         — 列出所有模型\n  /thinking       — 切换思考过程展示\n  /help           — 显示此帮助`
        }])
        break

      default:
        setMessages(prev => [...prev, { role: 'system', content: `未知命令: /${cmd}。输入 /help 查看可用命令` }])
    }
  }

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="single" paddingX={1}>
        <Text bold>xike code</Text>
        <Text dimColor> — {convRef.current?.getActiveModel()?.name || '未配置'}</Text>
      </Box>

      <Box flexGrow={1} flexDirection="column" paddingX={1} marginY={1}>
        <MessageList messages={messages} isStreaming={isStreaming} scrollOffset={scrollOffset} showThinking={showThinking} />
      </Box>

      {statusText && (
        <Box paddingX={1}>
          <Text dimColor>{statusText}</Text>
        </Box>
      )}

      <Box marginBottom={1}>
        <InputBar onSubmit={handleSubmit} onCommand={handleCommand} disabled={isStreaming} />
      </Box>
    </Box>
  )
}
