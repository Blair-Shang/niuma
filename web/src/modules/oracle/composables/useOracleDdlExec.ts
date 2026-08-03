import { useRsToast } from '@niuma/ui'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import {
  invalidateConnTreeChildren,
  patchCategoryObjectCount,
  refreshConnTreeRoot,
  refreshResourceIfLoaded,
} from '@/modules/ops/composables/useConnTreeChildren'
import { execOracleSql } from '@/modules/oracle/composables/useOracleSessionSql'
import {
  useOracleDdlActionStore,
  type OraclePendingDdlAction,
} from '@/modules/oracle/stores/ddl-actions'
import {
  dropFunctionSql,
  dropPackageSql,
  dropProcedureSql,
  dropSequenceSql,
  dropTableSql,
  dropViewSql,
  renameSequenceSql,
  renameTableSql,
  renameViewSql,
  truncateTableSql,
} from '@/modules/oracle/utils/script-templates'

function segmentName(path: ConnResourcePath | undefined, kind: string): string | undefined {
  return path?.segments.find((s) => s.kind === kind)?.name
}

function buildDdlSql(req: OraclePendingDdlAction, newName?: string): string {
  const schema = req.schema ?? ''
  switch (req.action) {
    case 'drop_table':
      return dropTableSql(schema, req.name)
    case 'drop_view':
      return dropViewSql(schema, req.name)
    case 'drop_procedure':
      return dropProcedureSql(schema, req.name)
    case 'drop_function':
      return dropFunctionSql(schema, req.name)
    case 'drop_sequence':
      return dropSequenceSql(schema, req.name)
    case 'drop_package':
      return dropPackageSql(schema, req.name)
    case 'truncate_table':
      return truncateTableSql(schema, req.name)
    case 'rename_table': {
      const to = (newName ?? req.newName ?? '').trim()
      if (!to) throw new Error('newName required')
      return renameTableSql(schema, req.name, to)
    }
    case 'rename_view': {
      const to = (newName ?? req.newName ?? '').trim()
      if (!to) throw new Error('newName required')
      return renameViewSql(schema, req.name, to)
    }
    case 'rename_sequence': {
      const to = (newName ?? req.newName ?? '').trim()
      if (!to) throw new Error('newName required')
      return renameSequenceSql(schema, req.name, to)
    }
    default:
      throw new Error(`unsupported action: ${req.action}`)
  }
}

/** 执行 DDL SQL 并刷新连接树、提示结果。 */
export function useOracleDdlExec() {
  const { t } = useI18n()
  const toast = useRsToast()
  const store = useOracleDdlActionStore()
  const { busy } = storeToRefs(store)

  async function refreshTreeAfterDdl(
    conn: NonNullable<typeof store.pending>['conn'],
    refreshPath: ConnResourcePath | undefined,
    refreshDeep: boolean | undefined,
    prunePaths: ConnResourcePath[] | undefined,
    countDelta?: number,
  ): Promise<void> {
    const prune = prunePaths?.length ? prunePaths : undefined
    if (refreshPath) {
      await refreshResourceIfLoaded(conn, refreshPath, {
        deep: refreshDeep !== false,
        prunePaths: prune,
      })
      if (segmentName(refreshPath, 'category')) {
        patchCategoryObjectCount(conn, refreshPath, { delta: countDelta })
      }
      return
    }
    await refreshConnTreeRoot(conn, { prunePaths: prune })
  }

  async function exec(opts?: { newName?: string }): Promise<void> {
    const pending = store.pending
    if (!pending) return

    busy.value = true
    const conn = pending.conn
    const refreshPath = pending.refreshPath
    const refreshDeep = pending.refreshDeep
    const prunePaths = pending.prunePaths

    try {
      const sql = buildDdlSql(pending, opts?.newName)
      await execOracleSql(pending.profileId, sql, pending.schema)
      toast.success(t('modules.oracle.ddl.done'))
      if (conn) {
        const countDelta = pending.action.startsWith('drop_') ? -1 : 0
        await refreshTreeAfterDdl(conn, refreshPath, refreshDeep, prunePaths, countDelta)
      } else {
        invalidateConnTreeChildren(pending.profileId)
      }
      store.clear()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.oracle.ddl.execError'))
    } finally {
      busy.value = false
    }
  }

  return { exec, busy }
}
