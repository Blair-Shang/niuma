/**
 * 浏览器 JS 堆监控工具。
 *
 * - 默认：仅 `import.meta.env.DEV` 开启
 * - 生产临时打开：`localStorage.setItem('nm.memoryMonitor', '1')` 后刷新
 * - 快速关闭：`localStorage.removeItem('nm.memoryMonitor')`，或构建时勿设 `VITE_MEMORY_MONITOR`
 * - 构建开关：`VITE_MEMORY_MONITOR=true`（与 DEV / localStorage 任一即可）
 *
 * 禁用时 `snapshot` / `log` / `mark` 均为空操作，便于业务侧常驻调用。
 */

export type JsHeapSnapshot = {
  usedMB: number
  totalMB: number
  usedBytes: number
  totalBytes: number
  limitMB: number | null
}

const STORAGE_KEY = 'nm.memoryMonitor'

type PerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize: number
    totalJSHeapSize: number
    jsHeapSizeLimit?: number
  }
}

function roundMB(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10
}

function readStorageEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function envFlagEnabled(): boolean {
  return import.meta.env.VITE_MEMORY_MONITOR === 'true' || import.meta.env.VITE_MEMORY_MONITOR === '1'
}

/** 当前是否启用监控（可被运行时改写 localStorage 后于下次读生效） */
export function isMemoryMonitorEnabled(): boolean {
  return Boolean(import.meta.env.DEV || envFlagEnabled() || readStorageEnabled())
}

/** 运行时打开（生产排障）；刷新后仍生效直至 disable */
export function enableMemoryMonitor(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, '1')
  } catch {
    /* ignore */
  }
}

/** 运行时关闭 */
export function disableMemoryMonitor(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export class MemoryMonitor {
  readonly scope: string

  constructor(scope: string) {
    this.scope = scope
  }

  get enabled(): boolean {
    return isMemoryMonitorEnabled()
  }

  /** 读取 Chromium `performance.memory`；不可用或已禁用时返回 null */
  snapshot(): JsHeapSnapshot | null {
    if (!this.enabled) return null
    const mem = (performance as PerformanceWithMemory).memory
    if (!mem) return null
    return {
      usedBytes: mem.usedJSHeapSize,
      totalBytes: mem.totalJSHeapSize,
      usedMB: roundMB(mem.usedJSHeapSize),
      totalMB: roundMB(mem.totalJSHeapSize),
      limitMB: mem.jsHeapSizeLimit != null ? roundMB(mem.jsHeapSizeLimit) : null,
    }
  }

  /**
   * 打一条带堆快照的 info 日志。禁用时立即返回，不拼接 payload。
   * @param label 事件名，如 `result`
   * @param payload 可为对象，或返回对象的惰性工厂（禁用时工厂不执行）
   */
  log(label: string, payload?: Record<string, unknown> | (() => Record<string, unknown>)): void {
    if (!this.enabled) return
    const data = typeof payload === 'function' ? payload() : (payload ?? {})
    console.info(`[${this.scope}] ${label}`, {
      ...data,
      jsHeap: this.snapshot(),
    })
  }

  /** 仅记录堆差值：先 `const end = mon.mark()`，稍后再 `end('after-map')` */
  mark(startLabel = 'start'): (endLabel?: string, extra?: Record<string, unknown>) => void {
    if (!this.enabled) {
      return () => undefined
    }
    const start = this.snapshot()
    this.log(startLabel, { phase: 'mark-start' })
    return (endLabel?: string, extra?: Record<string, unknown>) => {
      const end = this.snapshot()
      this.log(endLabel ?? 'end', {
        ...extra,
        phase: 'mark-end',
        deltaMB:
          start && end ? Math.round((end.usedMB - start.usedMB) * 10) / 10 : null,
      })
    }
  }
}

/** 按作用域创建监控器，例如 `createMemoryMonitor('VastQuery')` */
export function createMemoryMonitor(scope: string): MemoryMonitor {
  return new MemoryMonitor(scope)
}
