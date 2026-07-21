import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { loadConfig } from '../config/config'
import { Conversation } from '../conversation/conversation'
import { MessageList } from './message-list'
import { InputBar } from './input-bar'
import { createDefaultRegistry } from '../tool'
import { AgentLoop, AgentCancelledError } from '../agent'
import type { InternalMessage } from '../types'
import type { StreamEvent } from '../provider/events'

export function App() {
  const [messages, setMessages] = useState<InternalMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [scrollOffset, setScrollOffset] = useState(0)
  const [showThinking, setShowThinking] = useState(true)
  const convRef = useRef<Conversation | null>(null)
  const agentRef = useRef<AgentLoop | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const exitCountRef = useRef(0)

  useInput((_input, key) => {
    if (key.escape) {
      if (abortRef.current && isStreaming) {
        abortRef.current.abort()
        setStatusText('⏹ 已中断')
      }
      return
    }

    if (key.ctrl && _input === 'c') {
      if (isStreaming) {
        abortRef.current?.abort()
        setStatusText('⏹ 已中断')
        exitCountRef.current = 0
        return
      }
      exitCountRef.current++
      if (exitCountRef.current >= 2) {
        process.exit(0)
      }
      setMessages(prev => [...prev, { role: 'system', content: '再按一次 Ctrl+C 退出程序' }])
      setTimeout(() => { exitCountRef.current = 0 }, 2000)
      return
    }

    if (key.upArrow) {
      setScrollOffset(prev => prev + 1)
    }
    if (key.downArrow) {
      setScrollOffset(prev => Math.max(0, prev - 1))
    }
  })

  useEffect(() => {
    const config = loadConfig()
    const toolRegistry = createDefaultRegistry()
    const conv = new Conversation(config, toolRegistry)
    const agent = new AgentLoop(conv, toolRegistry)
    convRef.current = conv
    agentRef.current = agent

    if (config.models.length === 0) {
      setMessages([{ role: 'system', content: '未找到模型配置。请创建 ~/.config/xike-code/config.json 或 ./.xikerc.json' }])
    } else if (!conv.getActiveModel()) {
      const names = config.models.map(m => m.name).join(', ')
      setMessages([{ role: 'system', content: `可用模型: ${names}。使用 /model <name> 切换` }])
    }
  }, [])

  const handleToolResult = useCallback((event: StreamEvent) => {
    if (event.type !== 'tool_result') return
    const summary = event.output.length > 200 ? event.output.slice(0, 200) + '...' : event.output
    setMessages(prev => [...prev, { role: 'system', content: `📎 ${event.name} 执行${event.success ? '成功' : '失败'}: ${summary}` }])
  }, [])

  const handleSubmit = async (text: string) => {
    const conv = convRef.current
    const agent = agentRef.current
    if (!conv || !agent || isStreaming) return

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

    const abortController = new AbortController()
    abortRef.current = abortController

    const assistantMsg: InternalMessage = { role: 'assistant', content: '', thinking: '' }
    setMessages(prev => [...prev, assistantMsg])

    let hasContent = false
    let toolCallsAccumulated = 0

    try {
      for await (const event of agent.execute(abortController.signal)) {
        switch (event.type) {
          case 'text':
            hasContent = true
            setMessages(prev => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last.role === 'assistant') {
                updated[updated.length - 1] = { ...last, content: last.content + event.content }
              } else {
                updated.push({ role: 'assistant', content: event.content })
              }
              return updated
            })
            break

          case 'thinking':
            setMessages(prev => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last.role === 'assistant') {
                updated[updated.length - 1] = { ...last, thinking: (last.thinking || '') + event.content }
              } else {
                updated.push({ role: 'assistant', content: '', thinking: event.content })
              }
              return updated
            })
            break

          case 'tool_call_start':
            setStatusText(`🔧 正在使用 ${event.name}...`)
            break

          case 'tool_call_done':
            toolCallsAccumulated++
            setMessages(prev => [...prev, { role: 'system', content: `🔧 调用工具: ${event.name}` }])
            setStatusText(`⚙️ 执行 ${event.name}...`)
            break

          case 'tool_result':
            handleToolResult(event)
            break

          case 'token_usage':
            setStatusText(`📊 Token: ${event.usage.input} in / ${event.usage.output} out`)
            break

          case 'progress':
            if (event.status === 'reasoning') {
              setStatusText(`🤔 第 ${event.round} 轮推理中...`)
            } else if (event.status === 'executing') {
              setStatusText(`⚙️ 第 ${event.round} 轮，执行 ${event.totalToolCalls} 个工具...`)
            } else if (event.status === 'planning') {
              setStatusText(`📋 规划中...`)
            }
            break

          case 'agent_done':
            if (event.reason === 'complete') {
              if (!hasContent && toolCallsAccumulated > 0) {
                setStatusText('✅ 任务完成')
              } else {
                setStatusText('')
              }
            } else if (event.reason === 'cancelled') {
              setStatusText('⏹ 已取消')
            } else if (event.reason === 'max_iterations') {
              setMessages(prev => [...prev, { role: 'system', content: `⚠️ ${event.message || '已达到最大迭代轮次'}` }])
              setStatusText('⛔ 已达上限')
            } else if (event.reason === 'unknown_tool') {
              setMessages(prev => [...prev, { role: 'system', content: `⚠️ ${event.message || '模型连续调用未知工具'}` }])
              setStatusText('⛔ 未知工具')
            } else if (event.reason === 'error') {
              setMessages(prev => [...prev, { role: 'system', content: `错误: ${event.message}` }])
              setStatusText('')
            }
            break

          case 'done':
            break

          case 'error':
            setMessages(prev => prev.slice(0, -1))
            setMessages(prev => [...prev, { role: 'system', content: `错误: ${event.message}` }])
            setStatusText('')
            break
        }
      }
    } catch (err) {
      if (err instanceof AgentCancelledError) {
        setStatusText('⏹ 已取消')
      } else {
        setMessages(prev => [...prev, { role: 'system', content: `错误: ${err}` }])
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }

  const handleCommand = (cmd: string, args: string) => {
    const conv = convRef.current
    const agent = agentRef.current
    if (!conv || !agent) return

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

      case 'plan':
        agent.setMode('plan')
        setMessages(prev => [...prev, { role: 'system', content: '📋 已切换到规划模式。仅开放只读工具，你可以开始探索并制定计划。' }])
        break

      case 'do': {
        const planText = agent.getPlanText()
        agent.setMode('do')
        setMessages(prev => [...prev, { role: 'system', content: planText
          ? '🚀 已切换到执行模式，携带之前的计划开始执行。'
          : '🚀 已切换到执行模式，所有工具已开放。' }])
        break
      }

      case 'cancel':
        if (abortRef.current) {
          abortRef.current.abort()
          setStatusText('⏹ 已中断')
        } else {
          setMessages(prev => [...prev, { role: 'system', content: '没有正在执行的任务' }])
        }
        break

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
          content: `可用命令:\n  /model <name>   — 切换到指定模型\n  /models         — 列出所有模型\n  /plan           — 进入规划模式\n  /do             — 进入执行模式\n  /cancel         — 中断当前任务\n  /thinking       — 切换思考过程展示\n  /help           — 显示此帮助\n\n快捷键:\n  Esc             — 中断当前任务\n  Ctrl+C          — 退出（按两次）\n  ↑/↓             — 滚动消息`,
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
        {agentRef.current && (
          <Text dimColor> [{agentRef.current.getMode() === 'plan' ? '规划' : '执行'}]</Text>
        )}
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