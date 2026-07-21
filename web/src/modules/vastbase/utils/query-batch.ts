/**
 * 查询批跑约定（桌面客户端：脚本可能成百上千句）。
 *
 * - **严禁并发**：拆句后严格顺序 `await query.exec`，一句结束再下一句；执行中禁止重入
 * - 有结果集的语句各开一结果 Tab；表格/消息均走虚拟滚动
 * - 服务端 MaxOpenResultSets=8 → 客户端主动关闭过旧游标
 * - 结果 Tab 有上限：超出后丢掉最旧 Tab 的行数据（消息摘要仍在）
 */

/** 单次批跑绝对上限（防误贴超大生成脚本）；正常迁移脚本应远低于此 */
export const MAX_BATCH_STATEMENTS = 10_000

/** 同时保留行数据的结果 Tab 上限（再多则丢弃最旧网格，只留消息） */
export const MAX_RESULT_GRID_TABS = 48

/**
 * 客户端同时保持打开的服务端游标上限。
 * 低于服务端 MaxOpenResultSets(8)，给 Explain/并发留余量。
 */
export const MAX_OPEN_RESULT_CURSORS = 6

/** SQL 预览长度（消息列表） */
export const BATCH_SQL_PREVIEW_CHARS = 96

export type BatchStatementStatus =
  | 'pending'
  | 'running'
  | 'ok'
  | 'error'
  | 'cancelled'
  | 'skipped'

/** 批跑单句摘要（不含 rows，控制内存） */
export interface BatchStatementItem {
  index: number
  sqlPreview: string
  status: BatchStatementStatus
  durationMs?: number
  /** 首屏/影响行数 */
  rowCount?: number
  hasMore?: boolean
  commandTag?: string
  /** 是否曾产出可展示网格（columns.length > 0） */
  hasGrid?: boolean
  /** 对应结果 Tab id（若仍保留） */
  gridTabId?: string
  error?: string
}

export function previewSql(sql: string, max = BATCH_SQL_PREVIEW_CHARS): string {
  const oneLine = sql.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max)}…`
}

export function resultHasGrid(columns: readonly { name: string }[] | undefined): boolean {
  return Array.isArray(columns) && columns.length > 0
}

/** 让出主线程，避免长批跑卡死输入/绘制 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(() => resolve())
    } else {
      globalThis.setTimeout(resolve, 0)
    }
  })
}
