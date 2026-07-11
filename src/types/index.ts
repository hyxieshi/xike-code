/**
 * 支持的 AI 模型提供商类型
 * - `anthropic`: Anthropic Claude 系列模型
 * - `openai`: OpenAI 兼容接口模型
 */
export type ModelProvider = 'anthropic' | 'openai'

/**
 * 内部消息结构，用于对话系统流转
 */
export interface InternalMessage {
  /** 消息角色：system（系统指令）、user（用户）、assistant（助手回复） */
  role: 'system' | 'user' | 'assistant'
  /** 消息文本内容 */
  content: string
  /** 模型的思考/推理过程文本（仅支持思维链的模型会填充此字段） */
  thinking?: string
}

/**
 * 聊天请求的额外选项
 */
export interface ChatOptions {
  /** 可选的 AbortSignal，用于中断请求 */
  signal?: AbortSignal
}

/**
 * 单个 AI 模型的配置
 */
export interface ModelConfig {
  /** 模型显示名称 */
  name: string
  /** 模型所属提供商 */
  provider: ModelProvider
  /** API 密钥（可选，可通过环境变量注入） */
  apiKey?: string
  /** API 基础 URL（可选，用于代理或自托管场景） */
  baseUrl?: string
  /** 其他扩展字段 */
  [key: string]: unknown
}

/**
 * 应用全局配置
 */
export interface AppConfig {
  /** 模型列表 */
  models: ModelConfig[]
  /** 当前激活的模型名称 */
  activeModel?: string
}

/**
 * 配置文件原始结构（与 AppConfig 结构一致，但所有字段可选）
 */
export interface ConfigFile {
  models?: ModelConfig[]
  activeModel?: string
}
