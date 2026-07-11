#!/usr/bin/env node
import React from 'react'
import { render } from 'ink'
import { App } from './tui/app'

// 启动前清屏，避免历史输出干扰 TUI 界面
console.clear()
render(<App />)
