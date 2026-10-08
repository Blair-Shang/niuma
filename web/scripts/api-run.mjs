#!/usr/bin/env node
/**
 * 本机集合运行，不连云端。
 * node web/scripts/api-run.mjs <集合.json> [--env 环境.json] [--data 数据.csv|json] [--iteration 1] [--delay 0]
 *
 * 集合可以是牛马导出（kind: niuma.api-collection）或 Postman Collection v2。
 * Digest / AWS / NTLM / gRPC 仍走桌面里的发送，这里只跑 HTTP。
 */
import { readFileSync } from 'node:fs'
import { argv, exit } from 'node:process'

const args = argv.slice(2)
const file = args.find((item) => !item.startsWith('--'))
const flags = readFlags(args)
if (!file || flags.help) {
  console.log('用法: node web/scripts/api-run.mjs <集合.json> [--env 环境.json] [--data 数据文件] [--iteration 1] [--delay 0]')
  exit(file ? 0 : 1)
}

const env = flags.env ? readEnv(readJson(flags.env)) : {}
const rows = flags.data ? parseData(readFileSync(flags.data, 'utf8')) : []
const iterations = Math.max(1, Number(flags.iteration) || (rows.length > 1 ? rows.length : 1))
const delay = Math.max(0, Number(flags.delay) || 0)
const requests = flatten(readJson(file))
if (!requests.length) {
  console.error('集合里没有可运行的 HTTP 请求')
  exit(1)
}

let failed = 0
for (let i = 0; i < iterations; i += 1) {
  const bag = { environment: { ...env, ...(rows.length ? rows[i % rows.length] : {}) }, globals: {}, collection: {} }
  for (const req of requests) {
    const label = `${req.method} ${req.name}`
    try {
      const pre = await runScript(req.preRequestScript, bag)
      if (pre.error) throw new Error(pre.error)
      const sent = await sendHttp(req, bag)
      const test = await runScript(req.testScript, bag, sent)
      const bad = test.checks.filter((item) => !item.ok)
      if (test.error || bad.length || sent.status >= 400) {
        failed += 1
        console.log(`FAIL  ${label}  ${sent.status}  ${bad.map((item) => item.detail).join('; ') || test.error || sent.statusText}`)
      } else {
        console.log(`PASS  ${label}  ${sent.status}  ${sent.durationMs}ms`)
      }
    } catch (error) {
      failed += 1
      console.log(`FAIL  ${label}  ${error instanceof Error ? error.message : String(error)}`)
    }
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
  }
}
console.log(failed ? `失败 ${failed}` : `通过 ${iterations * requests.length}`)
exit(failed ? 1 : 0)

function readFlags(list) {
  const out = {}
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = list[i + 1]
    if (!next || next.startsWith('--')) out[key] = true
    else {
      out[key] = next
      i += 1
    }
  }
  return out
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readEnv(root) {
  const out = {}
  if (Array.isArray(root.values)) {
    for (const row of root.values) {
      if (!row || row.enabled === false || !row.key) continue
      out[String(row.key)] = row.value == null ? '' : String(row.value)
    }
    return out
  }
  const vars = root.vars && typeof root.vars === 'object' ? root.vars : root
  for (const [key, value] of Object.entries(vars)) {
    if (value != null && typeof value !== 'object') out[key] = String(value)
  }
  return out
}

function parseData(text) {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    const rows = JSON.parse(trimmed)
    return Array.isArray(rows) ? rows.map((row) => stringifyRow(row)) : []
  }
  const lines = trimmed.split(/\r?\n/).filter(Boolean)
  const headers = splitCsv(lines[0] ?? '')
  return lines.slice(1).map((line) => {
    const cells = splitCsv(line)
    const row = {}
    headers.forEach((key, index) => {
      if (key) row[key] = cells[index] ?? ''
    })
    return row
  })
}

function splitCsv(line) {
  return line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''))
}

function stringifyRow(row) {
  const out = {}
  if (!row || typeof row !== 'object') return out
  for (const [key, value] of Object.entries(row)) out[key] = value == null ? '' : String(value)
  return out
}

function flatten(root) {
  if (root?.kind === 'niuma.api-collection' && Array.isArray(root.folders)) {
    return root.folders.flatMap((folder) => (folder.requests ?? []).map((req) => fromNiuma(req)).filter(Boolean))
  }
  if (Array.isArray(root?.item)) return walkPostman(root.item)
  throw new Error('无法识别集合：需要牛马集合或 Postman Collection v2')
}

function fromNiuma(req) {
  const method = String(req.method || 'GET').toUpperCase()
  if (['TCP', 'UDP', 'WS', 'GRPC'].includes(method)) return null
  return {
    name: req.name || req.url || method,
    method,
    url: req.url || '',
    headers: (req.headers ?? []).filter((row) => row.enabled !== false && row.key).map((row) => [row.key, row.value ?? '']),
    body: req.body ?? '',
    auth: req.auth ?? { type: 'none' },
    preRequestScript: req.preRequestScript || '',
    testScript: req.testScript || '',
  }
}

function walkPostman(items) {
  const out = []
  for (const item of items ?? []) {
    if (Array.isArray(item.item)) out.push(...walkPostman(item.item))
    else if (item.request) out.push(fromPostman(item))
  }
  return out
}

function fromPostman(item) {
  const request = typeof item.request === 'string' ? { url: item.request, method: 'GET' } : item.request
  const method = String(request.method || 'GET').toUpperCase()
  const headers = (request.header ?? []).filter((row) => !row.disabled && row.key).map((row) => [row.key, row.value ?? ''])
  return {
    name: item.name || urlText(request.url),
    method,
    url: urlText(request.url),
    headers,
    body: request.body?.raw ?? '',
    auth: postmanAuth(request.auth),
    preRequestScript: scriptText(item.event, 'prerequest'),
    testScript: scriptText(item.event, 'test'),
  }
}

function urlText(url) {
  if (!url) return ''
  if (typeof url === 'string') return url
  return url.raw || ''
}

function scriptText(events, listen) {
  const found = (events ?? []).find((item) => item.listen === listen)
  const exec = found?.script?.exec
  return Array.isArray(exec) ? exec.join('\n') : typeof exec === 'string' ? exec : ''
}

function postmanAuth(auth) {
  if (!auth || auth.type === 'noauth') return { type: 'none' }
  const fields = Object.fromEntries((auth[auth.type] ?? []).map((row) => [row.key, row.value ?? '']))
  if (auth.type === 'bearer') return { type: 'bearer', token: fields.token || '' }
  if (auth.type === 'basic') return { type: 'basic', username: fields.username || '', password: fields.password || '' }
  if (auth.type === 'apikey') return { type: 'apikey', key: fields.key || '', value: fields.value || '', in: fields.in || 'header' }
  return { type: auth.type || 'none' }
}

function fill(text, bag) {
  const values = { ...bag.globals, ...bag.collection, ...bag.environment }
  return String(text ?? '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => values[key.trim()] ?? '')
}

async function sendHttp(req, bag) {
  const headers = new Headers(req.headers.map(([key, value]) => [key, fill(value, bag)]))
  const auth = req.auth
  if (auth.type === 'bearer' && auth.token) headers.set('Authorization', `Bearer ${fill(auth.token, bag)}`)
  if (auth.type === 'basic') {
    const raw = `${fill(auth.username || '', bag)}:${fill(auth.password || '', bag)}`
    headers.set('Authorization', `Basic ${Buffer.from(raw).toString('base64')}`)
  }
  if (auth.type === 'apikey' && auth.in !== 'query' && auth.key) headers.set(auth.key, fill(auth.value || '', bag))
  let url = fill(req.url, bag)
  if (auth.type === 'apikey' && auth.in === 'query' && auth.key) {
    const join = url.includes('?') ? '&' : '?'
    url += `${join}${encodeURIComponent(auth.key)}=${encodeURIComponent(fill(auth.value || '', bag))}`
  }
  const started = Date.now()
  const response = await fetch(url, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : fill(req.body, bag),
  })
  const body = await response.text()
  return {
    status: response.status,
    statusText: response.statusText,
    body,
    durationMs: Date.now() - started,
    headers: [...response.headers.entries()].map(([key, value]) => ({ key, value })),
  }
}

async function runScript(source, bag, exchange) {
  const text = String(source || '').trim()
  const outcome = { checks: [], error: '' }
  if (!text) return outcome
  const pm = createPm(bag, outcome, exchange)
  try {
    const fn = new Function(
      'pm',
      '"use strict"; const window=undefined, fetch=undefined, process=undefined, require=undefined;\nreturn (async () => {\n' + text + '\n})()',
    )
    await fn(pm)
  } catch (error) {
    outcome.error = error instanceof Error ? error.message : String(error)
    outcome.checks.push({ ok: false, detail: outcome.error })
  }
  return outcome
}

function createPm(bag, outcome, exchange) {
  const environment = scopeApi(bag.environment)
  const globals = scopeApi(bag.globals)
  const collectionVariables = scopeApi(bag.collection)
  return {
    environment,
    globals,
    collectionVariables,
    variables: {
      get: (key) => environment.get(key) || collectionVariables.get(key) || globals.get(key),
      replaceIn: (text) => fill(text, bag),
    },
    response: exchange ? responseApi(exchange) : undefined,
    test: (name, fn) => {
      try {
        fn()
        outcome.checks.push({ ok: true, detail: name })
      } catch (error) {
        outcome.checks.push({ ok: false, detail: `${name}: ${error instanceof Error ? error.message : String(error)}` })
      }
    },
    expect: expectApi,
  }
}

function scopeApi(values) {
  return {
    get: (key) => values[key] ?? '',
    set: (key, value) => {
      if (String(key || '').trim()) values[String(key).trim()] = value == null ? '' : String(value)
    },
  }
}

function responseApi(exchange) {
  const headers = {
    get: (name) => exchange.headers.find((row) => row.key.toLowerCase() === String(name).toLowerCase())?.value ?? '',
  }
  return {
    code: exchange.status,
    text: () => exchange.body,
    json: () => JSON.parse(exchange.body),
    headers,
    to: {
      have: {
        status: (code) => {
          if (exchange.status !== code) throw new Error(`expected status ${code}, got ${exchange.status}`)
        },
        header: (name) => {
          if (!headers.get(name)) throw new Error(`missing header ${name}`)
        },
        body: (part) => {
          if (!exchange.body.includes(part)) throw new Error(`body missing ${part}`)
        },
      },
    },
  }
}

function expectApi(actual) {
  const fail = (message) => {
    throw new Error(message)
  }
  return {
    to: {
      equal: (want) => {
        if (actual !== want) fail(`${String(actual)} !== ${String(want)}`)
      },
      eql: (want) => {
        if (JSON.stringify(actual) !== JSON.stringify(want)) fail('deep equal failed')
      },
      include: (part) => {
        if (!String(actual).includes(String(part))) fail(`missing ${String(part)}`)
      },
    },
  }
}
