/**
 * 导入入口：NiuMa 集合、Postman v2、OpenAPI 3。读完再交给 mergeImported。
 */
import type { ApiFolder } from '../../types'
import { COLLECTION_KIND, parseCollection } from '../../utils/collection-io'
import { importOpenApi, isOpenApiDocument } from './openapi'
import { importPostman, isPostmanCollection } from './postman'

export type ImportedCollection = {
  folders: ApiFolder[]
  source: 'niuma' | 'postman' | 'openapi'
}

export function parseImportedCollection(text: string): ImportedCollection | { error: 'invalid' | 'unsupported' } {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) return { error: 'invalid' }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed) as unknown
  } catch {
    return { error: 'invalid' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'invalid' }
  const root = parsed as Record<string, unknown>
  if (root.kind === COLLECTION_KIND) {
    const result = parseCollection(trimmed)
    if ('error' in result) return { error: 'invalid' }
    return { folders: result.folders, source: 'niuma' }
  }
  if (isOpenApiDocument(root)) {
    const folders = importOpenApi(root)
    if (!folders) return { error: 'invalid' }
    return { folders, source: 'openapi' }
  }
  if (isPostmanCollection(root)) {
    const folders = importPostman(root)
    if (!folders) return { error: 'invalid' }
    return { folders, source: 'postman' }
  }
  return { error: 'unsupported' }
}
