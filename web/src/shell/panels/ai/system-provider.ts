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

/** 登录后按云端目录同步本机系统 Provider；失败时静默（离线 / 未开通）。 */
export async function ensureSystemAiProvider(accessToken: string): Promise<boolean> {
  if (!accessToken.trim()) {
    return false
  }
  const catalog = await fetchAiCatalog(accessToken)
  const models = (catalog.models ?? [])
    .map((m) => ({
      code: (m.code || '').trim(),
      label: (m.label || m.code || '').trim(),
    }))
    .filter((m) => m.code)
  await aiApi.ensureSystemProvider({
    enabled: Boolean(catalog.enabled),
    baseUrl: `${cloudApiBase()}/api/v1/ai/v1`,
    providerName: catalog.providerName?.trim() || 'NiuMa',
    defaultModelCode: catalog.defaultModel?.trim() || models[0]?.code || '',
    models,
  })
  return Boolean(catalog.enabled)
}

export function systemProviderOf(providers: AiProvider[]): AiProvider | null {
  return providers.find((p) => isSystemAiProvider(p) && p.recordStatus !== 'disabled') ?? null
}
