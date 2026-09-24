/**
 * 外来导入共用的请求 / 文件夹骨架。适配器只填字段，id 在这里生成。
 */
import { createId } from '@/utils/id'
import type { ApiAuth, ApiBodyMode, ApiFolder, ApiKvRow, ApiMethod, ApiRequest } from '../../types'
import { defaultAuth, emptyKinds, emptyVars, uniqueName } from '../../utils/collection-io'
import { newKvRow } from '../../utils/format'

export function asImportText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function importedRequest(partial: {
  name: string
  method?: ApiMethod
  url?: string
  params?: ApiKvRow[]
  headers?: ApiKvRow[]
  auth?: ApiAuth
  bodyMode?: ApiBodyMode
  body?: string
  bodyForm?: ApiKvRow[]
}): ApiRequest {
  return {
    id: createId('req'),
    name: partial.name.trim() || 'Request',
    method: partial.method ?? 'GET',
    url: partial.url ?? '',
    params: partial.params ?? [],
    headers: partial.headers ?? [],
    auth: partial.auth ?? defaultAuth(),
    bodyMode: partial.bodyMode ?? 'none',
    body: partial.body ?? '',
    bodyForm: partial.bodyForm ?? [],
  }
}

export function importedFolder(
  name: string,
  parentId: string | null,
  requests: ApiRequest[] = [],
  vars: Record<string, string> = emptyVars(),
): ApiFolder {
  return {
    id: createId('folder'),
    name: name.trim() || 'Folder',
    parentId,
    vars: { ...vars },
    kinds: emptyKinds(),
    requests,
  }
}

/** 同一文件夹里重名请求加序号，避免树上看成同一条。 */
export function dedupeRequestNames(requests: ApiRequest[]): void {
  const seen: string[] = []
  for (const req of requests) {
    req.name = uniqueName(req.name, seen)
    seen.push(req.name)
  }
}

export function kv(key: string, value: string, enabled = true): ApiKvRow {
  return newKvRow(key, value, enabled)
}
