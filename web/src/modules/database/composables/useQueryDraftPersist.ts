/**
 * 查询面板编辑器草稿持久化。
 *
 * 将正文写入当前 Workspace Tab 的 `props.draftSql`，随 Platform
 * `workspace.tabs` 落盘；重启后按 tabId 各自恢复，互不串台。
 *
 * **必须**使用面板所属的 `tabId` 写回，禁止回退到 `activeTabId`：
 * keep-alive 下防抖回调可能在切 Tab 后触发，回退会写错草稿。
 */
import { onUnmounted, ref, watch, type Ref } from 'vue'
import { useTabStore } from '@/stores/tab'

/** 与对象脚本草稿一致的防抖间隔 */
export const QUERY_DRAFT_PERSIST_MS = 400

/** 单 Tab 草稿上限；超限跳过写盘，避免撑爆 workspace.tabs */
export const QUERY_DRAFT_MAX_CHARS = 1_000_000

/**
 * 恢复优先级：`draftSql`（含空串）→ `initialSql` → 方言默认 SQL。
 * `draftSql` 为 `string` 即表示该 Tab 曾落过草稿（含用户清空后的空串）。
 */
export function resolveQueryDraftSql(
  draftSql: string | undefined,
  initialSql: string | undefined,
  defaultSql: string,
): string {
  if (typeof draftSql === 'string') {
    return draftSql
  }
  const seed = initialSql?.trim()
  return seed || defaultSql
}

/** 是否从已持久化的 draftSql 恢复（用于跳过 autoRun） */
export function hasQueryDraft(draftSql: string | undefined): boolean {
  return typeof draftSql === 'string'
}

export function useQueryDraftPersist(options: {
  /** 本面板所属 Workspace Tab id（ModuleWorkspace 注入）；勿用 activeTabId */
  tabId: () => string | undefined | null
  draftSql?: () => string | undefined
  initialSql?: () => string | undefined
  defaultSql: string
  debounceMs?: number
  maxChars?: number
}): {
  sqlText: Ref<string>
  /** 挂载时是否从 draftSql 恢复 */
  restoredFromDraft: boolean
  /** 程序化替换正文并短暂抑制写盘（避免回环） */
  replaceSqlText: (sql: string) => void
  /** 立即写回（卸载前 flush） */
  flushDraft: () => void
} {
  const tabs = useTabStore()
  const debounceMs = options.debounceMs ?? QUERY_DRAFT_PERSIST_MS
  const maxChars = options.maxChars ?? QUERY_DRAFT_MAX_CHARS

  const initialDraft = options.draftSql?.()
  const restoredFromDraft = hasQueryDraft(initialDraft)
  const sqlText = ref(
    resolveQueryDraftSql(initialDraft, options.initialSql?.(), options.defaultSql),
  )

  let suppressPersist = false
  let draftTimer: ReturnType<typeof setTimeout> | null = null

  function resolveTabId(): string | null {
    const id = options.tabId()?.trim()
    return id || null
  }

  function persistDraftNow(): void {
    const tabId = resolveTabId()
    if (!tabId || suppressPersist) return
    const text = sqlText.value
    if (text.length > maxChars) return
    tabs.updateTabProps(tabId, { draftSql: text })
  }

  function schedulePersistDraft(): void {
    if (suppressPersist) return
    if (draftTimer) clearTimeout(draftTimer)
    draftTimer = setTimeout(() => {
      draftTimer = null
      persistDraftNow()
    }, debounceMs)
  }

  function replaceSqlText(sql: string): void {
    suppressPersist = true
    sqlText.value = sql
    queueMicrotask(() => {
      suppressPersist = false
    })
  }

  function flushDraft(): void {
    if (draftTimer) {
      clearTimeout(draftTimer)
      draftTimer = null
    }
    persistDraftNow()
  }

  watch(sqlText, () => {
    schedulePersistDraft()
  })

  onUnmounted(() => {
    flushDraft()
  })

  return {
    sqlText,
    restoredFromDraft,
    replaceSqlText,
    flushDraft,
  }
}
