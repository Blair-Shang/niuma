import type { RsSelectOption, RsSelectOptions } from '@niuma/ui'
import type { AiProvider } from '@/api/types/ai'

const MODEL_KEY_SEP = '::'

export function encodeModelKey(providerId: string, modelCode: string): string {
  return `${providerId}${MODEL_KEY_SEP}${modelCode}`
}

export function decodeModelKey(key: string): { providerId: string; modelCode: string } | null {
  const idx = key.indexOf(MODEL_KEY_SEP)
  if (idx <= 0) {
    return null
  }
  const providerId = key.slice(0, idx)
  const modelCode = key.slice(idx + MODEL_KEY_SEP.length)
  if (!providerId || !modelCode) {
    return null
  }
  return { providerId, modelCode }
}

/** 选项/触发器文案：`名称 · 模型`（同一服务商下会挂多个模型）。 */
export function formatModelOptionLabel(providerName: string, modelCode: string): string {
  const name = providerName.trim()
  const model = modelCode.trim()
  if (name && model) {
    return `${name} · ${model}`
  }
  return model || name
}

/** 某 Provider 下可选模型（含 defaultModelCode 兜底）。 */
export function modelsForProvider(p: AiProvider): Array<{ modelCode: string }> {
  const seen = new Set<string>()
  const list: Array<{ modelCode: string }> = []
  for (const m of p.models ?? []) {
    const code = m.modelCode?.trim()
    if (!code || seen.has(code)) {
      continue
    }
    seen.add(code)
    list.push({ modelCode: code })
  }
  const fallback = p.defaultModelCode?.trim()
  if (fallback && !seen.has(fallback)) {
    list.unshift({ modelCode: fallback })
  }
  return list
}

/**
 * 统一模型选项：value = `providerId::modelCode`，
 * 文案为「名称 · 模型」。
 */
export function buildModelSelectOptions(
  providers: AiProvider[],
  selectedProviderId: string,
  selectedModelCode: string,
): RsSelectOptions {
  if (!providers.length) {
    return []
  }

  const options: RsSelectOption[] = []
  for (const p of providers) {
    for (const m of modelsForProvider(p)) {
      options.push({
        value: encodeModelKey(p.providerId, m.modelCode),
        label: formatModelOptionLabel(p.providerName, m.modelCode),
      })
    }
  }

  const currentKey =
    selectedProviderId && selectedModelCode
      ? encodeModelKey(selectedProviderId, selectedModelCode)
      : ''
  if (currentKey && !options.some((o) => o.value === currentKey)) {
    const providerName =
      providers.find((p) => p.providerId === selectedProviderId)?.providerName ?? ''
    options.push({
      value: currentKey,
      label: formatModelOptionLabel(providerName, selectedModelCode),
    })
  }

  return options
}
