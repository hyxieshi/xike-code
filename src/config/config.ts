import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { AppConfig, ModelConfig } from '../types'

/** 全局配置文件路径：~/.config/xike-code/config.json */
const GLOBAL_CONFIG_PATH = join(homedir(), '.config', 'xike-code', 'config.json')
/** 项目级配置文件路径：项目根目录下的 .xikerc.json */
const LOCAL_CONFIG_FILE = '.xikerc.json'

/**
 * 读取并解析指定路径的 JSON 文件
 *
 * @param path - 文件绝对路径
 * @returns 解析后的对象，文件不存在或解析失败时返回 null
 */
function readJSONFile(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * 加载应用配置。
 * 优先级：项目级配置（.xikerc.json）覆盖全局配置（~/.config/xike-code/config.json），
 * 同一模型名称的项目级配置会合并到全局配置之上。
 * 如果模型未配置 apiKey，会尝试从环境变量（ANTHROPIC_API_KEY / OPENAI_API_KEY）读取。
 *
 * @returns 合并后的应用配置
 */
export function loadConfig(): AppConfig {
  const globalData = readJSONFile(GLOBAL_CONFIG_PATH)
  const localData = readJSONFile(LOCAL_CONFIG_FILE)

  const result: AppConfig = {
    models: [],
    activeModel: undefined,
  }

  if (globalData?.models) {
    result.models = globalData.models as ModelConfig[]
  }
  if (globalData?.activeModel) {
    result.activeModel = globalData.activeModel as string
  }

  if (localData) {
    if (Array.isArray(localData.models)) {
      const localModels = localData.models as ModelConfig[]
      const map = new Map<string, ModelConfig>()

      for (const m of result.models) {
        map.set(m.name, { ...m })
      }
      for (const m of localModels) {
        map.set(m.name, { ...m })
      }

      result.models = Array.from(map.values())
    }

    if (localData.activeModel) {
      result.activeModel = localData.activeModel as string
    }
  }

  result.models = result.models.map((m) => {
    if (m.apiKey) return m
    if (m.provider === 'anthropic') {
      const key = process.env.ANTHROPIC_API_KEY
      return key ? { ...m, apiKey: key } : m
    }
    if (m.provider === 'openai') {
      const key = process.env.OPENAI_API_KEY
      return key ? { ...m, apiKey: key } : m
    }
    return m
  })

  return result
}

/**
 * 从配置中获取当前激活的模型
 *
 * @param config - 应用配置
 * @returns 激活的模型配置，如果没有激活模型则返回配置中的第一个模型，都不可用时返回 null
 */
export function getActiveModel(config: AppConfig): ModelConfig | null {
  if (!config.activeModel) return config.models[0] ?? null
  return config.models.find((m) => m.name === config.activeModel) ?? null
}
