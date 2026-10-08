/**
 * 按语言生成可粘贴的请求代码。变量已按当前环境展开。
 */
import { i18n } from '@/locale'
import type { ApiBodyMode, ApiEnvironment, ApiRequest } from '../../types'
import type { ApiVariableScope } from '../../utils/folder-tree'
import { GraphQLBodyError } from '../graphql/body'
import { buildCurl } from './curl'
import { applyMessageHeaders, titleHttpHeader } from './http-wire'
import { interpolateVariables, resolveRequest } from './request-resolve'

export const SNIPPET_LANGS = ['curl', 'javascript', 'python', 'go', 'java', 'php', 'csharp'] as const

export type SnippetLang = (typeof SNIPPET_LANGS)[number]

const EDITOR_LANG: Record<SnippetLang, string> = {
  curl: 'shell',
  javascript: 'javascript',
  python: 'python',
  go: 'go',
  java: 'java',
  php: 'plaintext',
  csharp: 'plaintext',
}

export function snippetEditorLanguage(lang: SnippetLang): string {
  return EDITOR_LANG[lang]
}

/** 生成一种语言的请求代码。 */
export function buildSnippet(
  lang: SnippetLang,
  req: ApiRequest,
  env: ApiEnvironment | undefined,
  scope?: ApiVariableScope,
): string {
  try {
    return renderSnippet(lang, req, env, scope)
  } catch (error) {
    if (error instanceof GraphQLBodyError) return String(i18n.global.t('modules.api.graphqlVariables'))
    throw error
  }
}

function renderSnippet(
  lang: SnippetLang,
  req: ApiRequest,
  env: ApiEnvironment | undefined,
  scope?: ApiVariableScope,
): string {
  if (lang === 'curl') return buildCurl(req, env, scope)
  const prepared = prepare(req, env, scope)
  if (lang === 'javascript') return renderJavaScript(prepared)
  if (lang === 'python') return renderPython(prepared)
  if (lang === 'go') return renderGo(prepared)
  if (lang === 'java') return renderJava(prepared)
  if (lang === 'php') return renderPhp(prepared)
  return renderCSharp(prepared)
}

interface Prepared {
  method: string
  url: string
  headers: { name: string; value: string }[]
  body: string
  bodyMode: ApiBodyMode
  fields: { key: string; value: string }[]
  json: unknown | undefined
}

function prepare(req: ApiRequest, env: ApiEnvironment | undefined, scope?: ApiVariableScope): Prepared {
  const resolved = resolveRequest(req, env, scope)
  const fields =
    req.bodyMode === 'form' || req.bodyMode === 'urlencoded'
      ? (req.bodyForm ?? [])
          .filter((row) => row.enabled && row.key.trim())
          .map((row) => ({ key: row.key.trim(), value: interpolateVariables(row.value, resolved.values) }))
      : []
  const headers = [...applyMessageHeaders(req.method, resolved.body, resolved.headers).entries()]
    .filter(([key]) => {
      const rebuilt = req.bodyMode === 'form' || req.bodyMode === 'urlencoded'
      return !(rebuilt && key === 'content-length')
    })
    .map(([key, value]) => ({
      name: titleHttpHeader(key),
      value,
    }))
  let json: unknown | undefined
  if ((req.bodyMode === 'json' || req.bodyMode === 'graphql') && resolved.body) {
    try {
      json = JSON.parse(resolved.body) as unknown
    } catch {
      json = undefined
    }
  }
  return {
    method: req.method,
    url: resolved.url,
    headers,
    body: resolved.body,
    bodyMode: req.bodyMode === 'graphql' ? 'json' : req.bodyMode,
    fields,
    json,
  }
}

function hasBody(prepared: Prepared): boolean {
  if (prepared.method === 'GET' || prepared.method === 'HEAD') return false
  if (prepared.bodyMode === 'form' || prepared.bodyMode === 'urlencoded') return prepared.fields.length > 0
  return prepared.body.length > 0
}

function dq(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`
}

function pyString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function pythonLiteral(value: unknown, indent: number): string {
  const pad = ' '.repeat(indent)
  const inner = ' '.repeat(indent + 4)
  if (value === null) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None'
  if (typeof value === 'string') return pyString(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[\n${value.map((item) => `${inner}${pythonLiteral(item, indent + 4)}`).join(',\n')}\n${pad}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    return `{\n${entries.map(([key, item]) => `${inner}${pyString(key)}: ${pythonLiteral(item, indent + 4)}`).join(',\n')}\n${pad}}`
  }
  return 'None'
}

function withoutContentType(headers: Prepared['headers']): Prepared['headers'] {
  return headers.filter((header) => header.name.toLowerCase() !== 'content-type')
}

function headerBlock(headers: Prepared['headers'], quote: (value: string) => string, indent: string): string {
  if (headers.length === 0) return ''
  return headers.map((header) => `${indent}${quote(header.name)}: ${quote(header.value)},`).join('\n')
}

function renderJavaScript(prepared: Prepared): string {
  const lines: string[] = []
  const dropType = prepared.bodyMode === 'form' || prepared.bodyMode === 'urlencoded'
  const headers = dropType ? withoutContentType(prepared.headers) : prepared.headers
  if (prepared.bodyMode === 'form' && hasBody(prepared)) {
    lines.push('const form = new FormData();')
    for (const field of prepared.fields) lines.push(`form.append(${dq(field.key)}, ${dq(field.value)});`)
  } else if (prepared.bodyMode === 'urlencoded' && hasBody(prepared)) {
    lines.push('const form = new URLSearchParams();')
    for (const field of prepared.fields) lines.push(`form.append(${dq(field.key)}, ${dq(field.value)});`)
  }
  lines.push('const response = await fetch(', `  ${dq(prepared.url)},`, '  {', `    method: ${dq(prepared.method)},`)
  if (headers.length > 0) {
    lines.push('    headers: {', headerBlock(headers, dq, '      '), '    },')
  }
  if (hasBody(prepared)) {
    if (prepared.bodyMode === 'form' || prepared.bodyMode === 'urlencoded') {
      lines.push('    body: form,')
    } else if (prepared.json !== undefined) {
      lines.push(`    body: JSON.stringify(${JSON.stringify(prepared.json, null, 2).replace(/\n/g, '\n    ')}),`)
    } else {
      lines.push(`    body: ${dq(prepared.body)},`)
    }
  }
  lines.push('  },', ');')
  return lines.join('\n')
}

function renderPython(prepared: Prepared): string {
  const lines = ['import requests', '', 'response = requests.request(']
  lines.push(`    ${pyString(prepared.method)},`)
  lines.push(`    ${pyString(prepared.url)},`)
  const pyHeaders =
    prepared.bodyMode === 'json' || prepared.bodyMode === 'form' || prepared.bodyMode === 'urlencoded'
      ? withoutContentType(prepared.headers)
      : prepared.headers
  if (pyHeaders.length > 0) {
    lines.push('    headers={')
    lines.push(headerBlock(pyHeaders, pyString, '        '))
    lines.push('    },')
  }
  if (hasBody(prepared)) {
    if (prepared.bodyMode === 'json' && prepared.json !== undefined) {
      lines.push(`    json=${pythonLiteral(prepared.json, 4)},`)
    } else if (prepared.bodyMode === 'form' || prepared.bodyMode === 'urlencoded') {
      const key = prepared.bodyMode === 'form' ? 'files' : 'data'
      lines.push(`    ${key}={`)
      for (const field of prepared.fields) {
        const value = prepared.bodyMode === 'form' ? `(None, ${pyString(field.value)})` : pyString(field.value)
        lines.push(`        ${pyString(field.key)}: ${value},`)
      }
      lines.push('    },')
    } else {
      lines.push(`    data=${pyString(prepared.body)},`)
    }
  }
  lines.push(')')
  return lines.join('\n')
}

function renderGo(prepared: Prepared): string {
  const form = prepared.bodyMode === 'form' && hasBody(prepared)
  const imports = ['"net/http"']
  if (form) imports.push('"bytes"', '"mime/multipart"')
  else if (hasBody(prepared)) imports.push('"strings"')
  imports.sort()
  const lines = ['package main', '', 'import (', ...imports.map((item) => `\t${item}`), ')', '', 'func main() {']
  const headers = form ? withoutContentType(prepared.headers) : prepared.headers
  if (form) {
    lines.push('\tvar body bytes.Buffer')
    lines.push('\twriter := multipart.NewWriter(&body)')
    for (const field of prepared.fields) {
      lines.push(`\t_ = writer.WriteField(${dq(field.key)}, ${dq(field.value)})`)
    }
    lines.push('\t_ = writer.Close()')
    lines.push(`\treq, _ := http.NewRequest(${dq(prepared.method)}, ${dq(prepared.url)}, &body)`)
    lines.push('\treq.Header.Set("Content-Type", writer.FormDataContentType())')
  } else if (prepared.bodyMode === 'urlencoded' && hasBody(prepared)) {
    const encoded = prepared.fields.map((field) => `${encodeURIComponent(field.key)}=${encodeURIComponent(field.value)}`).join('&')
    lines.push(`\treq, _ := http.NewRequest(${dq(prepared.method)}, ${dq(prepared.url)}, strings.NewReader(${dq(encoded)}))`)
  } else if (hasBody(prepared)) {
    lines.push(`\treq, _ := http.NewRequest(${dq(prepared.method)}, ${dq(prepared.url)}, strings.NewReader(${dq(prepared.body)}))`)
  } else {
    lines.push(`\treq, _ := http.NewRequest(${dq(prepared.method)}, ${dq(prepared.url)}, nil)`)
  }
  for (const header of headers) {
    lines.push(`\treq.Header.Set(${dq(header.name)}, ${dq(header.value)})`)
  }
  lines.push('\tres, _ := http.DefaultClient.Do(req)')
  lines.push('\tdefer res.Body.Close()')
  lines.push('}')
  return lines.join('\n')
}

function renderJava(prepared: Prepared): string {
  const lines = [
    'HttpRequest request = HttpRequest.newBuilder()',
    `    .uri(URI.create(${dq(prepared.url)}))`,
  ]
  for (const header of prepared.headers) {
    lines.push(`    .header(${dq(header.name)}, ${dq(header.value)})`)
  }
  if (!hasBody(prepared)) {
    lines.push(`    .method(${dq(prepared.method)}, HttpRequest.BodyPublishers.noBody())`)
  } else if (prepared.bodyMode === 'urlencoded') {
    const encoded = prepared.fields.map((field) => `${encodeURIComponent(field.key)}=${encodeURIComponent(field.value)}`).join('&')
    lines.push(`    .method(${dq(prepared.method)}, HttpRequest.BodyPublishers.ofString(${dq(encoded)}))`)
  } else {
    lines.push(`    .method(${dq(prepared.method)}, HttpRequest.BodyPublishers.ofString(${dq(prepared.body)}))`)
  }
  lines.push('    .build();')
  return lines.join('\n')
}

function renderPhp(prepared: Prepared): string {
  const lines = [`$ch = curl_init(${phpString(prepared.url)});`, 'curl_setopt_array($ch, [']
  if (prepared.method !== 'GET') {
    lines.push(`    CURLOPT_CUSTOMREQUEST => ${phpString(prepared.method)},`)
  }
  const phpHeaders =
    prepared.bodyMode === 'form' || prepared.bodyMode === 'urlencoded'
      ? withoutContentType(prepared.headers)
      : prepared.headers
  if (phpHeaders.length > 0) {
    lines.push('    CURLOPT_HTTPHEADER => [')
    for (const header of phpHeaders) {
      lines.push(`        ${phpString(`${header.name}: ${header.value}`)},`)
    }
    lines.push('    ],')
  }
  if (hasBody(prepared)) {
    if (prepared.bodyMode === 'form' || prepared.bodyMode === 'urlencoded') {
      lines.push('    CURLOPT_POSTFIELDS => [')
      for (const field of prepared.fields) {
        lines.push(`        ${phpString(field.key)} => ${phpString(field.value)},`)
      }
      lines.push('    ],')
    } else {
      lines.push(`    CURLOPT_POSTFIELDS => ${phpString(prepared.body)},`)
    }
  }
  lines.push(']);', '$response = curl_exec($ch);', 'curl_close($ch);')
  return lines.join('\n')
}

function phpString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function renderCSharp(prepared: Prepared): string {
  const lines = [
    'using var client = new HttpClient();',
    `using var request = new HttpRequestMessage(new HttpMethod(${dq(prepared.method)}), ${dq(prepared.url)});`,
  ]
  const csHeaders =
    prepared.bodyMode === 'json' || prepared.bodyMode === 'form' || prepared.bodyMode === 'urlencoded'
      ? withoutContentType(prepared.headers)
      : prepared.headers
  for (const header of csHeaders) {
    lines.push(`request.Headers.TryAddWithoutValidation(${dq(header.name)}, ${dq(header.value)});`)
  }
  if (hasBody(prepared)) {
    if (prepared.bodyMode === 'json') {
      lines.push(`request.Content = new StringContent(${dq(prepared.body)}, Encoding.UTF8, "application/json");`)
    } else if (prepared.bodyMode === 'urlencoded') {
      lines.push('request.Content = new FormUrlEncodedContent(new Dictionary<string, string> {')
      for (const field of prepared.fields) {
        lines.push(`    [${dq(field.key)}] = ${dq(field.value)},`)
      }
      lines.push('});')
    } else if (prepared.bodyMode === 'form') {
      lines.push('var form = new MultipartFormDataContent();')
      for (const field of prepared.fields) {
        lines.push(`form.Add(new StringContent(${dq(field.value)}), ${dq(field.key)});`)
      }
      lines.push('request.Content = form;')
    } else {
      lines.push(`request.Content = new StringContent(${dq(prepared.body)});`)
    }
  }
  lines.push('var response = await client.SendAsync(request);')
  return lines.join('\n')
}
