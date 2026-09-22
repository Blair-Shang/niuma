import { aiApi } from '@/api/ai'
import { cloudApiBase } from '@/api/cloud/client'
import { fetchAiCatalog } from '@/api/cloud/ai'
import type { AiProvider } from '@/api/types/ai'

/** 云端系统模型在本机 SQLite 中的稳定主键。 */
export const SYSTEM_AI_PROVIDER_ID = 'niuma-system'

export function isSystemAiProvider(input: {
  providerId?: string
  providerOptions?: unknown
}): boolean {
  if (input.providerId === SYSTEM_AI_PROVIDER_ID) {
    return true
  }
  const raw = input.providerOptions
  if (!raw) {
    return false
  }
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return false
    }
  }
  return Boolean(obj && typeof obj === 'object' && (obj as { system?: boolean }).system)
}

/**
 * 系统模型只取云端目录。目录里没有的编码（包括仍写在默认型号上的旧模型）不写入本机。
 * 目录为空就返回空，本机系统模型会被清掉。用户自己添加的服务商不走这里。
 */
export function systemModelsFromCatalog(catalog: {
  models?: Array<{ code?: string; label?: string }>
}): Array<{ code: string; label: string }> {
  return (catalog.models ?? [])
    .map((m) => ({
      code: (m.code || '').trim(),
      label: (m.label || m.code || '').trim(),
    }))
    .filter((m) => m.code)
}

/** 默认型号必须落在目录里；目录已删掉的型号不再当作系统默认。 */
export function systemDefaultFromCatalog(
  catalog: { defaultModel?: string },
  models: Array<{ code: string }>,
): string {
  const requested = catalog.defaultModel?.trim() || ''
  if (requested && models.some((m) => m.code === requested)) {
    return requested
  }
  return models[0]?.code || ''
}

/** 登录后按云端目录同步本机系统 Provider；失败时静默（离线 / 未开通）。 */
export async function ensureSystemAiProvider(accessToken: string): Promise<boolean> {
  if (!accessToken.trim()) {
    return false
  }
  const catalog = await fetchAiCatalog(accessToken)
  const models = systemModelsFromCatalog(catalog)
  await aiApi.ensureSystemProvider({
    enabled: Boolean(catalog.enabled),
    baseUrl: `${cloudApiBase()}/api/v1/ai/v1`,
    providerName: catalog.providerName?.trim() || 'NiuMa',
    defaultModelCode: systemDefaultFromCatalog(catalog, models),
    models,
  })
  return Boolean(catalog.enabled)
}

export function systemProviderOf(providers: AiProvider[]): AiProvider | null {
  return providers.find((p) => isSystemAiProvider(p) && p.recordStatus !== 'disabled') ?? null
}
