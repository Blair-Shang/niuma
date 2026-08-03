import { useRsToast } from '@niuma/ui'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { SqliteQueryExecResult } from '@/api/types/sqlite'
import { execSqliteSqlPreferred } from '@/modules/sqlite/composables/useSqliteSessionSql'
import {
  useSqliteMaintainActionStore,
  type SqlitePendingMaintainAction,
} from '@/modules/sqlite/stores/maintain-actions'
import {
  reindexSql,
  vacuumSql,
  walCheckpointSql,
  integrityCheckSql,
  quickCheckSql,
} from '@/modules/sqlite/utils/script-templates'

export interface SqliteMaintainCheckSummary {
  ok: boolean
  messages: string[]
  durationMs: number
  truncated: boolean
}

function schemaOrMain(schema: string | undefined): string | undefined {
  const s = schema?.trim()
  if (!s || s === 'main') return undefined
  return s
}

function buildConfirmSql(req: SqlitePendingMaintainAction): string {
  const schema = schemaOrMain(req.schema)
  switch (req.action) {
    case 'vacuum':
      return vacuumSql(schema)
    case 'wal_checkpoint':
      return walCheckpointSql(schema, 'FULL')
    case 'reindex':
      return reindexSql(schema, req.table)
    default:
      throw new Error(`unsupported confirm action: ${req.action}`)
  }
}

function buildCheckSql(req: SqlitePendingMaintainAction): string {
  const schema = schemaOrMain(req.schema)
  switch (req.action) {
    case 'integrity':
      return integrityCheckSql(schema)
    case 'quick_check':
      return quickCheckSql(schema)
    default:
      throw new Error(`unsupported check action: ${req.action}`)
  }
}

function rowMessages(result: SqliteQueryExecResult): string[] {
  const rows = result.rows ?? []
  return rows.map((row) => {
    if (!Array.isArray(row) || row.length === 0) return ''
    return String(row[0] ?? '')
  }).filter((m) => m.length > 0)
}

/** 解析 integrity_check / quick_check：单行 ok 为通过。 */
export function summarizeCheckResult(result: SqliteQueryExecResult): SqliteMaintainCheckSummary {
  const messages = rowMessages(result)
  const ok =
    messages.length === 1 && messages[0].trim().toLowerCase() === 'ok'
  return {
    ok,
    messages: messages.length ? messages : ['(empty)'],
    durationMs: result.durationMs ?? 0,
    truncated: Boolean(result.hasMore || result.truncated),
  }
}

function formatCheckpointToast(result: SqliteQueryExecResult, t: (k: string, p?: Record<string, unknown>) => string): string {
  const row = result.rows?.[0]
  if (!Array.isArray(row) || row.length < 3) {
    return t('modules.sqlite.maintain.checkpointDone')
  }
  return t('modules.sqlite.maintain.checkpointDoneDetail', {
    busy: String(row[0]),
    log: String(row[1]),
    checkpointed: String(row[2]),
  })
}

/** 执行维护确认项 / 检查项。 */
export function useSqliteMaintainExec() {
  const { t } = useI18n()
  const toast = useRsToast()
  const store = useSqliteMaintainActionStore()
  const { busy } = storeToRefs(store)

  async function execConfirm(): Promise<void> {
    const pending = store.pending
    if (pending?.kind !== 'confirm') return

    busy.value = true
    try {
      const sql = buildConfirmSql(pending)
      const result = await execSqliteSqlPreferred(
        pending.profileId,
        sql,
        schemaOrMain(pending.schema),
        20,
      )
      if (pending.action === 'wal_checkpoint') {
        toast.success(formatCheckpointToast(result, t))
      } else {
        toast.success(t('modules.sqlite.maintain.done'))
      }
      store.clear()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.sqlite.maintain.execError'))
    } finally {
      busy.value = false
    }
  }

  async function runCheck(): Promise<SqliteMaintainCheckSummary | null> {
    const pending = store.pending
    if (pending?.kind !== 'check') return null

    busy.value = true
    try {
      const sql = buildCheckSql(pending)
      const result = await execSqliteSqlPreferred(
        pending.profileId,
        sql,
        schemaOrMain(pending.schema),
        500,
      )
      return summarizeCheckResult(result)
    } catch (e) {
      throw e instanceof Error ? e : new Error(t('modules.sqlite.maintain.execError'))
    } finally {
      busy.value = false
    }
  }

  return { execConfirm, runCheck, busy }
}
