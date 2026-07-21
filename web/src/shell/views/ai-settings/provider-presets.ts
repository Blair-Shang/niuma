import type { AiProviderKind } from '@/api/types/ai'

/**
 * 市面主流 LLM 接入预设（优先 OpenAI 兼容 /chat/completions）。
 *
 * 选择预设后自动填充名称、协议类型、Base URL、默认模型与推荐模型列表。
 * 密钥仍由用户自行填写，不入库明文。
 */
export interface AiProviderPreset {
  /** 稳定标识，用于下拉 value。 */
  id: string
  /** 展示名。 */
  label: string
  /** 写入 nm_ai_provider.provider_name 的默认名。 */
  defaultName: string
  /** Bridge / 后端协议类型。 */
  kind: AiProviderKind
  /**
   * 默认 Base URL；空字符串表示后端用 kind 默认（如 OpenAI 官方）。
   * 一般填到 /v1，由后端再拼 /chat/completions。
   */
  baseUrl: string
  /** 默认模型 code。 */
  defaultModel: string
  /** 推荐模型，供下拉快速选择。 */
  models: readonly string[]
  /** 简短说明（可选）。 */
  hintKey?: string
  /** 是否通常不需要 API Key（如本机 Ollama）。 */
  apiKeyOptional?: boolean
}

/** 自定义 / 手动填写。 */
export const AI_PROVIDER_PRESET_CUSTOM = 'custom'

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    defaultName: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3-mini', 'o4-mini'],
  },
  {
    id: 'azure_openai',
    label: 'Azure OpenAI',
    defaultName: 'Azure OpenAI',
    kind: 'azure_openai',
    baseUrl: '',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'],
    hintKey: 'settings.aiProvidersPresetHintAzure',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultName: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    defaultName: 'Moonshot',
    kind: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k2.5',
    models: ['kimi-k2.5', 'kimi-k2-turbo-preview', 'moonshot-v1-128k', 'moonshot-v1-32k'],
    hintKey: 'settings.aiProvidersPresetHintMoonshot',
  },
  {
    id: 'qwen',
    label: '通义千问 (DashScope)',
    defaultName: '通义千问',
    kind: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long', 'qwq-plus'],
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    defaultName: '智谱 GLM',
    kind: 'openai',
    // 智谱兼容端点不以 /v1 结尾，填完整 chat 路径以免被后端再拼 /v1。
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    defaultModel: 'glm-4-plus',
    models: ['glm-4-plus', 'glm-4-flash', 'glm-4-air', 'glm-z1-flash'],
  },
  {
    id: 'volcengine',
    label: '火山方舟 / 豆包',
    defaultName: '火山方舟',
    kind: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    defaultModel: '',
    models: [],
    hintKey: 'settings.aiProvidersPresetHintVolcengine',
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow 硅基流动',
    defaultName: 'SiliconFlow',
    kind: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    models: [
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen2.5-72B-Instruct',
      'THUDM/GLM-4-9B-0414',
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultName: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o',
    models: [
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'anthropic/claude-sonnet-4',
      'google/gemini-2.5-pro',
      'deepseek/deepseek-chat',
    ],
    hintKey: 'settings.aiProvidersPresetHintOpenRouter',
  },
  {
    id: 'groq',
    label: 'Groq',
    defaultName: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen/qwen3-32b', 'openai/gpt-oss-120b'],
  },
  {
    id: 'gemini',
    label: 'Google Gemini (OpenAI 兼容)',
    defaultName: 'Google Gemini',
    kind: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    defaultName: 'MiniMax',
    kind: 'openai',
    baseUrl: 'https://api.minimaxi.com/v1',
    defaultModel: 'MiniMax-Text-01',
    models: ['MiniMax-Text-01', 'abab6.5s-chat'],
  },
  {
    id: 'stepfun',
    label: '阶跃星辰 StepFun',
    defaultName: '阶跃星辰',
    kind: 'openai',
    baseUrl: 'https://api.stepfun.com/v1',
    defaultModel: 'step-2-mini',
    models: ['step-2-mini', 'step-1-8k', 'step-1-32k', 'step-1-128k', 'step-1-256k'],
  },
  {
    id: 'yi',
    label: '零一万物 Yi',
    defaultName: '零一万物',
    kind: 'openai',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    defaultModel: 'yi-lightning',
    models: ['yi-lightning', 'yi-large', 'yi-medium', 'yi-spark'],
  },
  {
    id: 'baichuan',
    label: '百川 Baichuan',
    defaultName: '百川',
    kind: 'openai',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    defaultModel: 'Baichuan4-Turbo',
    models: ['Baichuan4-Turbo', 'Baichuan4', 'Baichuan3-Turbo'],
  },
  {
    id: 'ollama',
    label: 'Ollama (本机)',
    defaultName: 'Ollama',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'llama3.2',
    models: ['llama3.2', 'llama3.1', 'qwen2.5', 'deepseek-r1', 'mistral', 'gemma3'],
    apiKeyOptional: true,
    hintKey: 'settings.aiProvidersPresetHintOllama',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (本机)',
    defaultName: 'LM Studio',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    defaultModel: '',
    models: [],
    apiKeyOptional: true,
    hintKey: 'settings.aiProvidersPresetHintLocal',
  },
  {
    id: AI_PROVIDER_PRESET_CUSTOM,
    label: '自定义 / OpenAI 兼容',
    defaultName: '',
    kind: 'custom',
    baseUrl: '',
    defaultModel: '',
    models: [],
    hintKey: 'settings.aiProvidersPresetHintCustom',
  },
]

/** 按 id 查找预设。 */
export function findAiProviderPreset(id: string): AiProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((p) => p.id === id)
}

/**
 * 根据已保存的 baseUrl / kind / 名称尝试匹配预设（用于编辑回显）。
 */
export function matchAiProviderPreset(input: {
  baseUrl?: string
  providerKind?: string
  providerName?: string
}): string {
  const url = (input.baseUrl ?? '').trim().replace(/\/+$/, '')
  const name = (input.providerName ?? '').trim().toLowerCase()

  if (url) {
    const normalize = (u: string) => {
      let out = u
      while (out.endsWith('/')) {
        out = out.slice(0, -1)
      }
      const suffix = '/chat/completions'
      if (out.toLowerCase().endsWith(suffix)) {
        out = out.slice(0, -suffix.length)
      }
      return out
    }
    const normalized = normalize(url)
    const byUrl = AI_PROVIDER_PRESETS.find((p) => {
      if (!p.baseUrl || p.id === AI_PROVIDER_PRESET_CUSTOM) {
        return false
      }
      const presetUrl = normalize(p.baseUrl)
      return (
        normalized === presetUrl ||
        normalized.startsWith(presetUrl) ||
        presetUrl.startsWith(normalized)
      )
    })
    if (byUrl) {
      return byUrl.id
    }
  }

  if (name) {
    const byName = AI_PROVIDER_PRESETS.find(
      (p) => p.id !== AI_PROVIDER_PRESET_CUSTOM && (name.includes(p.id) || p.defaultName.toLowerCase() === name),
    )
    if (byName) {
      return byName.id
    }
  }

  if (input.providerKind === 'ollama') {
    return 'ollama'
  }
  if (input.providerKind === 'azure_openai') {
    return 'azure_openai'
  }

  return AI_PROVIDER_PRESET_CUSTOM
}
