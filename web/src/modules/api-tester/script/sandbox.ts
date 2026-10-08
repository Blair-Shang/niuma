/**
 * Postman 风格脚本。只注入 pm，供用户自己的集合在本机执行。
 * 发送前写变量，发送后记断言。不提供 require / 进程对象。
 */
import type { ApiCheckResult, ApiExchange } from '../types'
import type { ApiVarWrite } from './eval'

export interface ScriptBag {
  environment: Record<string, string>
  globals: Record<string, string>
  collection: Record<string, string>
}

export interface ScriptOutcome {
  writes: ApiVarWrite[]
  checks: ApiCheckResult[]
  error?: string
}

interface SendSpec {
  url?: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface ScriptHooks {
  send?: (spec: SendSpec) => Promise<{ status: number; body: string; headers: Record<string, string> }>
}

/** 执行发送前脚本。空脚本直接返回。 */
export async function runPreRequestScript(
  source: string | undefined,
  bag: ScriptBag,
  hooks?: ScriptHooks,
): Promise<ScriptOutcome> {
  return runScript(source, bag, undefined, hooks)
}

/** 执行测试脚本，断言失败记入 checks。 */
export async function runTestScript(
  source: string | undefined,
  bag: ScriptBag,
  exchange: Pick<ApiExchange, 'status' | 'statusText' | 'body' | 'headers' | 'durationMs'>,
  hooks?: ScriptHooks,
): Promise<ScriptOutcome> {
  return runScript(source, bag, exchange, hooks)
}

async function runScript(
  source: string | undefined,
  bag: ScriptBag,
  exchange: Pick<ApiExchange, 'status' | 'statusText' | 'body' | 'headers' | 'durationMs'> | undefined,
  hooks?: ScriptHooks,
): Promise<ScriptOutcome> {
  const text = source?.trim() ?? ''
  const outcome: ScriptOutcome = { writes: [], checks: [] }
  if (!text) return outcome
  const pm = createPm(bag, outcome, exchange, hooks)
  try {
    const fn = new Function(
      'pm',
      '"use strict"; const window=undefined, self=undefined, globalThis=undefined, fetch=undefined, XMLHttpRequest=undefined, WebSocket=undefined, process=undefined, require=undefined;\nreturn (async () => {\n' +
        text +
        '\n})()',
    ) as (pm: unknown) => Promise<unknown>
    await fn(pm)
  } catch (error) {
    outcome.error = error instanceof Error ? error.message : String(error)
    outcome.checks.push({ ok: false, kind: 'bodyContains', detail: outcome.error })
  }
  return outcome
}

function createPm(
  bag: ScriptBag,
  outcome: ScriptOutcome,
  exchange: Pick<ApiExchange, 'status' | 'statusText' | 'body' | 'headers' | 'durationMs'> | undefined,
  hooks?: ScriptHooks,
) {
  const environment = scopeApi('environment', bag.environment, outcome)
  const globals = scopeApi('global', bag.globals, outcome)
  const collectionVariables = scopeApi('environment', bag.collection, outcome)
  const response = exchange ? responseApi(exchange) : undefined
  return {
    environment,
    globals,
    collectionVariables,
    variables: {
      get: (key: string) => environment.get(key) || collectionVariables.get(key) || globals.get(key),
      replaceIn: (text: string) => replaceVars(text, bag),
    },
    response,
    test: (name: string, fn: () => void) => {
      try {
        fn()
        outcome.checks.push({ ok: true, kind: 'bodyContains', detail: name })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        outcome.checks.push({ ok: false, kind: 'bodyContains', detail: `${name}: ${message}` })
      }
    },
    expect: (actual: unknown) => expectApi(actual),
    sendRequest: async (spec: SendSpec | string) => {
      if (!hooks?.send) throw new Error('pm.sendRequest is unavailable')
      const request = typeof spec === 'string' ? { url: spec } : spec
      const result = await hooks.send(request)
      return {
        code: result.status,
        text: () => result.body,
        json: () => JSON.parse(result.body) as unknown,
      }
    },
  }
}

function scopeApi(
  scope: ApiVarWrite['scope'],
  values: Record<string, string>,
  outcome: ScriptOutcome,
) {
  return {
    get: (key: string) => values[key] ?? '',
    set: (key: string, value: unknown) => {
      const name = key.trim()
      if (!name) return
      const text = value == null ? '' : String(value)
      values[name] = text
      outcome.writes.push({ scope, key: name, value: text })
    },
    unset: (key: string) => {
      delete values[key]
      outcome.writes.push({ scope, key, value: '' })
    },
  }
}

function responseApi(exchange: Pick<ApiExchange, 'status' | 'statusText' | 'body' | 'headers' | 'durationMs'>) {
  const headers = {
    get: (name: string) => {
      const key = name.trim().toLowerCase()
      return exchange.headers.find((row) => row.key.toLowerCase() === key)?.value ?? ''
    },
  }
  return {
    code: exchange.status ?? 0,
    status: exchange.statusText,
    responseTime: exchange.durationMs,
    text: () => exchange.body,
    json: () => JSON.parse(exchange.body) as unknown,
    headers,
    to: {
      have: {
        status: (code: number) => {
          if (exchange.status !== code) throw new Error(`expected status ${code}, got ${exchange.status ?? '-'}`)
        },
        header: (name: string) => {
          if (!headers.get(name)) throw new Error(`missing header ${name}`)
        },
        body: (part: string) => {
          if (!exchange.body.includes(part)) throw new Error(`body missing ${part}`)
        },
      },
    },
  }
}

function expectApi(actual: unknown) {
  const fail = (message: string): never => {
    throw new Error(message)
  }
  return {
    to: {
      equal: (want: unknown) => {
        if (actual !== want) fail(`${String(actual)} !== ${String(want)}`)
      },
      eql: (want: unknown) => {
        if (JSON.stringify(actual) !== JSON.stringify(want)) fail('deep equal failed')
      },
      include: (part: unknown) => {
        if (!String(actual).includes(String(part))) fail(`missing ${String(part)}`)
      },
      be: {
        below: (n: number) => {
          if (!(Number(actual) < n)) fail(`${String(actual)} is not below ${n}`)
        },
        above: (n: number) => {
          if (!(Number(actual) > n)) fail(`${String(actual)} is not above ${n}`)
        },
      },
    },
  }
}

function replaceVars(text: string, bag: ScriptBag): string {
  const values = { ...bag.globals, ...bag.collection, ...bag.environment }
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => values[key.trim()] ?? '')
}
