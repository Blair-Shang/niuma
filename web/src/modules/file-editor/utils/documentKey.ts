import type { FileOpenSpec } from '@/api/types/file-editor'
import { fileProviderRegistry } from '@/modules/file-editor/providers/registry'

/** 文档去重键：同一 provider + 同一 canonical context 视为同一文件 */
export function documentKeyForSpec(spec: FileOpenSpec): string {
  const provider = fileProviderRegistry.get(spec.provider)
  if (!provider) {
    return `${spec.provider}:${JSON.stringify(spec.context)}`
  }
  return `${spec.provider}:${provider.canonicalKey(spec.context)}`
}
