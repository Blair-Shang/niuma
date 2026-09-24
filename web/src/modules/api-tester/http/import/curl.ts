/**
 * 把一条 curl 收成 ApiRequest。
 * 覆盖调试台常见写法：-X / -H / -d / --data-urlencode / -F / -u / -G / --json。
 * 不执行命令，也不展开 $变量。
 */
import type { ApiAuth, ApiBodyMode, ApiKvRow, ApiMethod, ApiRequest } from '../../types'
import { defaultAuth } from '../../utils/collection-io'
import { importedRequest, kv } from './request'

const HTTP_METHODS = new Set<ApiMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])

const VALUE_LONG = new Set([
  '--request',
  '--header',
  '--data',
  '--data-raw',
  '--data-binary',
  '--data-ascii',
  '--data-urlencode',
  '--user',
  '--url',
  '--user-agent',
  '--referer',
  '--output',
  '--proxy',
  '--max-time',
  '--connect-timeout',
  '--retry',
  '--form',
  '--json',
])

const BOOL_LONG = new Set([
  '--get',
  '--head',
  '--insecure',
  '--location',
  '--silent',
  '--show-error',
  '--verbose',
  '--no-buffer',
  '--compressed',
  '--http1.1',
  '--http2',
  '--netrc',
  '--fail',
  '--globoff',
])

const SHORT_VALUE = new Set(['X', 'H', 'd', 'u', 'A', 'e', 'o', 'x', 'm', 'F'])
const SHORT_BOOL = new Set(['G', 'I', 'k', 'L', 's', 'S', 'v', 'N', 'f', 'g', 'n'])

/** 按 shell 引号切开；支持续行、单引号、双引号和 bash 的 '\''。 */
export function tokenizeShell(input: string): string[] {
  const src = input.replace(/\\\r?\n/g, '')
  const tokens: string[] = []
  let i = 0
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i]!)) i += 1
    if (i >= src.length) break
    if (src[i] === '#') {
      while (i < src.length && src[i] !== '\n') i += 1
      continue
    }
    let buf = ''
    let quote: '"' | "'" | null = null
    let started = false
    while (i < src.length) {
      const ch = src[i]!
      started = true
      if (quote === "'") {
        if (ch === "'" && src.slice(i, i + 4) === `'\\''`) {
          buf += "'"
          i += 4
          continue
        }
        if (ch === "'") {
          quote = null
          i += 1
          continue
        }
        buf += ch
        i += 1
        continue
      }
      if (quote === '"') {
        if (ch === '\\' && i + 1 < src.length) {
          const next = src[i + 1]!
          if ('"\\$`'.includes(next) || next === '\n') {
            if (next !== '\n') buf += next
            i += 2
            continue
          }
        }
        if (ch === '"') {
          quote = null
          i += 1
          continue
        }
        buf += ch
        i += 1
        continue
      }
      if (ch === "'" || ch === '"') {
        quote = ch
        i += 1
        continue
      }
      if (ch === '\\' && i + 1 < src.length) {
        buf += src[i + 1]
        i += 2
        continue
      }
      if (/\s/.test(ch)) break
      buf += ch
      i += 1
    }
    if (started) tokens.push(buf)
  }
  return tokens
}

function isShortBoolCluster(token: string): boolean {
  if (token.length < 3 || token[0] !== '-') return false
  for (let i = 1; i < token.length; i += 1) {
    if (!SHORT_BOOL.has(token[i]!)) return false
  }
  return true
}

function looksLikeUrl(token: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(token) || token.startsWith('{{')
}

function decodeQueryComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

function splitUrlQuery(raw: string): { url: string; params: ApiKvRow[] } {
  const hash = raw.indexOf('#')
  const withoutHash = hash >= 0 ? raw.slice(0, hash) : raw
  const q = withoutHash.indexOf('?')
  if (q < 0) return { url: withoutHash, params: [] }
  const params: ApiKvRow[] = []
  const query = withoutHash.slice(q + 1)
  if (query) {
    for (const part of query.split('&')) {
      if (!part) continue
      const eq = part.indexOf('=')
      const key = decodeQueryComponent(eq < 0 ? part : part.slice(0, eq))
      const value = eq < 0 ? '' : decodeQueryComponent(part.slice(eq + 1))
      if (key) params.push(kv(key, value))
    }
  }
  return { url: withoutHash.slice(0, q), params }
}

function headerLookup(headers: { key: string; value: string }[], name: string): string | undefined {
  const hit = headers.find((row) => row.key.toLowerCase() === name)
  return hit?.value
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function parsePairs(body: string): ApiKvRow[] {
  const rows: ApiKvRow[] = []
  for (const part of body.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const key = decodeQueryComponent(eq < 0 ? part : part.slice(0, eq))
    const value = eq < 0 ? '' : decodeQueryComponent(part.slice(eq + 1))
    if (key) rows.push(kv(key, value))
  }
  return rows
}

function decodeBasic(value: string): { username: string; password: string } | null {
  try {
    const binary = atob(value.trim())
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    const decoded = new TextDecoder().decode(bytes)
    const idx = decoded.indexOf(':')
    if (idx < 0) return { username: decoded, password: '' }
    return { username: decoded.slice(0, idx), password: decoded.slice(idx + 1) }
  } catch {
    return null
  }
}

function captureAuthorization(headers: { key: string; value: string }[], fallback: ApiAuth): ApiAuth {
  const index = headers.findIndex((row) => row.key.toLowerCase() === 'authorization')
  if (index < 0) return fallback
  const value = headers[index]!.value.trim()
  const bearer = /^Bearer\s+(\S.*)$/i.exec(value)
  if (bearer) {
    headers.splice(index, 1)
    return { type: 'bearer', bearer: { token: bearer[1]!.trim() } }
  }
  const basic = /^Basic\s+(\S+)$/i.exec(value)
  if (basic) {
    const decoded = decodeBasic(basic[1]!)
    if (decoded) {
      headers.splice(index, 1)
      return { type: 'basic', basic: decoded }
    }
  }
  return fallback
}

function nameFromUrl(url: string): string {
  const path = url.split('?')[0] ?? url
  const parts = path.split('/').filter((part) => part && !part.includes('://'))
  const last = parts[parts.length - 1]
  if (!last || last.includes('{{') || last.includes(':')) return 'curl'
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

function takeValue(tokens: string[], index: number, inline: string | undefined): { value: string; next: number } | null {
  if (inline !== undefined) return { value: inline, next: index }
  const value = tokens[index]
  if (value === undefined) return null
  return { value, next: index + 1 }
}

/**
 * 解析 curl。没有 URL 时返回 null。
 * Authorization 收进 auth，避免和发送时再写一遍 Header。
 */
export function parseCurl(input: string): ApiRequest | null {
  const tokens = tokenizeShell(input.trim())
  if (tokens.length === 0) return null
  let index = 0
  const head = tokens[0]?.toLowerCase()
  if (head === 'curl' || head === 'curl.exe') index = 1

  let explicit = ''
  let url = ''
  const headers: { key: string; value: string }[] = []
  const dataParts: string[] = []
  const urlencoded: { key: string; value: string }[] = []
  const form: { key: string; value: string }[] = []
  let user = ''
  let forceGet = false
  let headOnly = false
  let jsonFlag = false

  while (index < tokens.length) {
    const token = tokens[index]!
    if (token === '--') {
      const next = tokens[index + 1]
      if (next && !url) url = next
      break
    }
    if (!token.startsWith('-') || token === '-') {
      if (!url) url = token
      index += 1
      continue
    }

    let flag = token
    let inline: string | undefined
    if (token.startsWith('--')) {
      const eq = token.indexOf('=')
      if (eq > 2) {
        flag = token.slice(0, eq)
        inline = token.slice(eq + 1)
      }
    } else if (/^-[A-Za-z]/.test(token) && token.length > 2) {
      const letter = token[1]!
      if (SHORT_VALUE.has(letter)) {
        flag = `-${letter}`
        inline = token.slice(2)
      } else if (isShortBoolCluster(token)) {
        for (const ch of token.slice(1)) {
          if (ch === 'G') forceGet = true
          if (ch === 'I') headOnly = true
        }
        index += 1
        continue
      }
    }

    const long = flag.startsWith('--')
    const short = flag.length === 2 ? flag[1]! : ''
    const takesValue = long ? VALUE_LONG.has(flag) : SHORT_VALUE.has(short)
    const isBool = long ? BOOL_LONG.has(flag) : SHORT_BOOL.has(short)

    if (isBool && inline === undefined) {
      if (flag === '-G' || flag === '--get') forceGet = true
      if (flag === '-I' || flag === '--head') headOnly = true
      index += 1
      continue
    }

    if (!takesValue) {
      const next = tokens[index + 1]
      if (inline === undefined && next && !next.startsWith('-') && !looksLikeUrl(next)) {
        index += 2
        continue
      }
      index += 1
      continue
    }

    const taken = takeValue(tokens, inline === undefined ? index + 1 : index, inline)
    if (!taken) break
    index = inline === undefined ? taken.next : index + 1
    const value = taken.value

    if (flag === '-X' || flag === '--request') explicit = value
    else if (flag === '-H' || flag === '--header') {
      const colon = value.indexOf(':')
      if (colon > 0) headers.push({ key: value.slice(0, colon).trim(), value: value.slice(colon + 1).trim() })
    } else if (flag === '--data-urlencode') {
      const eq = value.indexOf('=')
      if (eq > 0) urlencoded.push({ key: value.slice(0, eq), value: value.slice(eq + 1) })
      else dataParts.push(value)
    } else if (flag === '-F' || flag === '--form') {
      const eq = value.indexOf('=')
      if (eq > 0) form.push({ key: value.slice(0, eq), value: value.slice(eq + 1) })
    } else if (flag === '-d' || flag === '--data' || flag === '--data-raw' || flag === '--data-binary' || flag === '--data-ascii') {
      dataParts.push(value)
    } else if (flag === '--json') {
      jsonFlag = true
      dataParts.push(value)
    } else if (flag === '-u' || flag === '--user') user = value
    else if (flag === '--url') url = value
    else if (flag === '-A' || flag === '--user-agent') headers.push({ key: 'User-Agent', value })
    else if (flag === '-e' || flag === '--referer') headers.push({ key: 'Referer', value })
  }

  if (!url) return null
  const split = splitUrlQuery(url)
  const params = [...split.params]

  let auth = captureAuthorization(headers, defaultAuth())
  if (auth.type === 'none' && user) {
    const colon = user.indexOf(':')
    auth = {
      type: 'basic',
      basic: {
        username: colon < 0 ? user : user.slice(0, colon),
        password: colon < 0 ? '' : user.slice(colon + 1),
      },
    }
  }

  const contentType = (headerLookup(headers, 'content-type') ?? '').toLowerCase()
  const joined = dataParts.join('&')
  let method = explicit.toUpperCase()
  let bodyMode: ApiBodyMode = 'none'
  let body = ''
  let bodyForm: ApiKvRow[] = []

  if (forceGet && (urlencoded.length > 0 || joined)) {
    for (const row of urlencoded) params.push(kv(row.key, row.value))
    if (joined) {
      for (const row of parsePairs(joined)) params.push(row)
    }
  } else if (form.length > 0) {
    bodyMode = 'form'
    bodyForm = form.map((row) => kv(row.key, row.value))
  } else if (urlencoded.length > 0) {
    bodyMode = 'urlencoded'
    bodyForm = urlencoded.map((row) => kv(row.key, row.value))
    if (joined) bodyForm.push(...parsePairs(joined))
  } else if (joined) {
    if (jsonFlag || contentType.includes('json') || looksLikeJson(joined)) {
      bodyMode = 'json'
      body = joined
    } else if (contentType.includes('text/plain')) {
      bodyMode = 'text'
      body = joined
    } else if (!contentType || contentType.includes('x-www-form-urlencoded')) {
      const pairs = parsePairs(joined)
      if (pairs.length > 0 && joined.includes('=')) {
        bodyMode = 'urlencoded'
        bodyForm = pairs
      } else {
        bodyMode = 'raw'
        body = joined
      }
    } else {
      bodyMode = 'raw'
      body = joined
    }
  }

  if (!HTTP_METHODS.has(method as ApiMethod)) {
    if (headOnly) method = 'HEAD'
    else if (bodyMode !== 'none') method = 'POST'
    else method = 'GET'
  }

  return importedRequest({
    name: nameFromUrl(split.url),
    method: method as ApiMethod,
    url: split.url,
    params,
    headers: headers.map((row) => kv(row.key, row.value)),
    auth,
    bodyMode,
    body,
    bodyForm,
  })
}
