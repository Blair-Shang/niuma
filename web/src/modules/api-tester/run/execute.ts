import type { ApiCheckResult, ApiExchange, ApiRequest } from '../types'

export interface RunItem {
  requestId: string
  name: string
  method: string
  iteration: number
  ok: boolean
  status: number | null
  durationMs: number
  error?: string
  checks: ApiCheckResult[]
}

export interface RunReport {
  total: number
  passed: number
  failed: number
  stopped: boolean
  items: RunItem[]
}

/** 按轮次顺序发送。间隔可被 signal 打断。 */
export async function runSequential(opts: {
  requests: readonly ApiRequest[]
  iterations: number
  thinkTimeMs: number
  signal: AbortSignal
  send: (req: ApiRequest, iteration: number) => Promise<ApiExchange>
}): Promise<RunReport> {
  const iterations = Math.max(1, Math.floor(opts.iterations) || 1)
  const report: RunReport = { total: 0, passed: 0, failed: 0, stopped: false, items: [] }
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    for (let index = 0; index < opts.requests.length; index += 1) {
      if (opts.signal.aborted) {
        report.stopped = true
        return report
      }
      const req = opts.requests[index]!
      let exchange: ApiExchange
      try {
        exchange = await opts.send(req, iteration)
      } catch (error) {
        if (opts.signal.aborted || isAbort(error)) {
          report.stopped = true
          return report
        }
        const message = error instanceof Error ? error.message : String(error)
        push(report, {
          requestId: req.id,
          name: req.name,
          method: req.method,
          iteration,
          ok: false,
          status: null,
          durationMs: 0,
          error: message,
          checks: [],
        })
        continue
      }
      push(report, {
        requestId: req.id,
        name: req.name,
        method: req.method,
        iteration,
        ok: exchange.ok && !(exchange.checks ?? []).some((item) => !item.ok),
        status: exchange.status,
        durationMs: exchange.durationMs,
        error: exchange.error,
        checks: exchange.checks ?? [],
      })
      if (opts.signal.aborted) {
        report.stopped = true
        return report
      }
      const last = index === opts.requests.length - 1 && iteration === iterations
      if (!last && opts.thinkTimeMs > 0) {
        try {
          await wait(opts.thinkTimeMs, opts.signal)
        } catch {
          report.stopped = true
          return report
        }
      }
    }
  }
  return report
}

/** 多个 worker 各跑一轮顺序集合。数据行按轮次循环，不写回环境。 */
export async function runWorkers(opts: {
  requests: readonly ApiRequest[]
  iterations: number
  concurrency: number
  thinkTimeMs: number
  dataRows?: readonly Record<string, string>[]
  signal: AbortSignal
  send: (req: ApiRequest, iteration: number, data?: Record<string, string>) => Promise<ApiExchange>
}): Promise<RunReport> {
  const workers = Math.min(32, Math.max(1, Math.floor(opts.concurrency) || 1))
  const rows = opts.dataRows ?? []
  const parts = await Promise.all(Array.from({ length: workers }, () => runSequential({
    requests: opts.requests,
    iterations: opts.iterations,
    thinkTimeMs: opts.thinkTimeMs,
    signal: opts.signal,
    send: (req, iteration) => opts.send(req, iteration, rows.length ? rows[(iteration - 1) % rows.length] : undefined),
  })))
  const report: RunReport = { total: 0, passed: 0, failed: 0, stopped: false, items: [] }
  for (const part of parts) {
    report.total += part.total
    report.passed += part.passed
    report.failed += part.failed
    report.stopped = report.stopped || part.stopped
    report.items.push(...part.items)
  }
  return report
}

function push(report: RunReport, item: RunItem): void {
  report.items.push(item)
  report.total += 1
  if (item.ok) report.passed += 1
  else report.failed += 1
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
