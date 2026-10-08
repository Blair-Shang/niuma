/**
 * 文件夹树 → Postman Collection v2.1。环境不写进集合，脚本写回 event。
 */
import type { ApiAuth, ApiFolder, ApiRequest } from '../../types'

const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

/** 导出可再导入 Postman 的集合 JSON。 */
export function exportPostmanCollection(folders: readonly ApiFolder[], name: string): string {
  const roots = folders.filter((folder) => !folder.parentId || !folders.some((item) => item.id === folder.parentId))
  const infoName = name.trim() || roots[0]?.name || 'NiuMa'
  const collection = {
    info: {
      name: infoName,
      schema: SCHEMA,
    },
    item: roots.map((folder) => folderItem(folder, folders)),
  }
  return JSON.stringify(collection, null, 2)
}

function folderItem(folder: ApiFolder, all: readonly ApiFolder[]): Record<string, unknown> {
  const children = all.filter((item) => item.parentId === folder.id)
  const items = [
    ...folder.requests.map(requestItem),
    ...children.map((child) => folderItem(child, all)),
  ]
  const item: Record<string, unknown> = { name: folder.name, item: items }
  const variable = Object.entries(folder.vars).map(([key, value]) => ({ key, value }))
  if (variable.length) item.variable = variable
  return item
}

function requestItem(req: ApiRequest): Record<string, unknown> {
  const item: Record<string, unknown> = {
    name: req.name,
    request: {
      method: req.method === 'GRPC' ? 'POST' : req.method,
      header: req.headers.filter((row) => row.key.trim()).map((row) => ({
        key: row.key,
        value: row.value,
        disabled: row.enabled === false,
      })),
      url: req.url,
      auth: authOf(req.auth),
      body: bodyOf(req),
    },
  }
  const event = eventsOf(req)
  if (event.length) item.event = event
  return item
}

function eventsOf(req: ApiRequest): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  if (req.preRequestScript?.trim()) {
    out.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: req.preRequestScript.split('\n') } })
  }
  if (req.testScript?.trim()) {
    out.push({ listen: 'test', script: { type: 'text/javascript', exec: req.testScript.split('\n') } })
  }
  return out
}

function authOf(auth: ApiAuth): Record<string, unknown> {
  if (auth.type === 'bearer') return { type: 'bearer', bearer: [{ key: 'token', value: auth.bearer?.token ?? '', type: 'string' }] }
  if (auth.type === 'basic') {
    return {
      type: 'basic',
      basic: [
        { key: 'username', value: auth.basic?.username ?? '', type: 'string' },
        { key: 'password', value: auth.basic?.password ?? '', type: 'string' },
      ],
    }
  }
  if (auth.type === 'apikey') {
    return {
      type: 'apikey',
      apikey: [
        { key: 'key', value: auth.apiKey?.key ?? '', type: 'string' },
        { key: 'value', value: auth.apiKey?.value ?? '', type: 'string' },
        { key: 'in', value: auth.apiKey?.in ?? 'header', type: 'string' },
      ],
    }
  }
  if (auth.type === 'digest') {
    return {
      type: 'digest',
      digest: [
        { key: 'username', value: auth.digest?.username ?? '', type: 'string' },
        { key: 'password', value: auth.digest?.password ?? '', type: 'string' },
      ],
    }
  }
  if (auth.type === 'ntlm') {
    return {
      type: 'ntlm',
      ntlm: [
        { key: 'username', value: auth.ntlm?.username ?? '', type: 'string' },
        { key: 'password', value: auth.ntlm?.password ?? '', type: 'string' },
        { key: 'domain', value: auth.ntlm?.domain ?? '', type: 'string' },
      ],
    }
  }
  if (auth.type === 'awsv4' && auth.awsv4) {
    return {
      type: 'awsv4',
      awsv4: [
        { key: 'accessKey', value: auth.awsv4.accessKey, type: 'string' },
        { key: 'secretKey', value: auth.awsv4.secretKey, type: 'string' },
        { key: 'region', value: auth.awsv4.region, type: 'string' },
        { key: 'service', value: auth.awsv4.service, type: 'string' },
        { key: 'sessionToken', value: auth.awsv4.sessionToken, type: 'string' },
      ],
    }
  }
  if (auth.type === 'oauth2') return { type: 'oauth2', oauth2: [{ key: 'accessToken', value: auth.oauth2?.accessToken ?? '', type: 'string' }] }
  return { type: 'noauth' }
}

function bodyOf(req: ApiRequest): Record<string, unknown> | undefined {
  if (req.bodyMode === 'none') return undefined
  if (req.bodyMode === 'urlencoded') {
    return {
      mode: 'urlencoded',
      urlencoded: (req.bodyForm ?? []).map((row) => ({ key: row.key, value: row.value, disabled: row.enabled === false })),
    }
  }
  if (req.bodyMode === 'form') {
    return {
      mode: 'formdata',
      formdata: (req.bodyForm ?? []).map((row) => ({
        key: row.key,
        value: row.filePath ? undefined : row.value,
        src: row.filePath,
        type: row.filePath ? 'file' : 'text',
        disabled: row.enabled === false,
      })),
    }
  }
  if (req.bodyMode === 'graphql' && req.graphql) {
    return { mode: 'graphql', graphql: { query: req.graphql.query, variables: req.graphql.variables } }
  }
  return { mode: 'raw', raw: req.body, options: { raw: { language: req.bodyMode === 'json' ? 'json' : 'text' } } }
}
