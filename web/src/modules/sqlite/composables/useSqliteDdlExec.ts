import { useRsToast } from '@niuma/ui'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { sqliteApi } from '@/api/sqlite'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import {
  invalidateConnTreeChildren,
  refreshConnTreeRoot,
  refreshResourceIfLoaded,
} from '@/modules/ops/composables/useConnTreeChildren'
import {
  execSqliteSql,
  withPreferredSqliteSession,
} from '@/modules/sqlite/composables/useSqliteSessionSql'
import {
  useSqliteDdlActionStore,
  type SqlitePendingDdlAction,
} from '@/modules/sqlite/stores/ddl-actions'
import { useSessionRegistry } from '@/stores/session-registry'
import {
  dropIndexSql,
  dropTableSql,
  dropTriggerSql,
  dropViewSql,
  emptyTableSql,
  renameTableSql,
} from '@/modules/sqlite/utils/script-templates'

function buildDdlSql(req: SqlitePendingDdlAction, newName?: string): string {
  const schema = req.schema || 'main'
  switch (req.action) {
    case 'drop_table':
      return dropTableSql(schema, req.name)
    case 'drop_view':
      return dropViewSql(schema, req.name)
    case 'drop_index':
      return dropIndexSql(schema, req.name)
    case 'drop_trigger':
      return dropTriggerSql(schema, req.name)
    case 'empty_table':
      return emptyTableSql(schema, req.name)
    case 'rename_table': {
      const to = (newName ?? req.newName ?? '').trim()
      if (!to) throw new Error('newName required')
      return renameTableSql(schema, req.name, to)
    }
    default:
      throw new Error(`unsupported action: ${req.action}`)
  }
}

/** 执行 SQLite DDL 并刷新连接树。 */
export function useSqliteDdlExec() {
  const { t } = useI18n()
  const toast = useRsToast()
  const store = useSqliteDdlActionStore()
  const { busy } = storeToRefs(store)

  async function refreshTreeAfterDdl(
    conn: NonNullable<typeof store.pending>['conn'],
    refreshPath: ConnResourcePath | undefined,
    refreshDeep: boolean | undefined,
    prunePaths: ConnResourcePath[] | undefined,
  ): Promise<void> {
    const prune = prunePaths?.length ? prunePaths : undefined
    if (refreshPath) {
      await refreshResourceIfLoaded(conn, refreshPath, {
        deep: refreshDeep !== false,
        prunePaths: prune,
      })
      return
    }
    await refreshConnTreeRoot(conn, { prunePaths: prune })
  }

  async function execDetach(pending: SqlitePendingDdlAction): Promise<void> {
    const alias = (pending.name || pending.schema || '').trim()
    if (!alias || alias === 'main' || alias === 'temp') {
      throw new Error(t('modules.sqlite.ddl.detachForbidden'))
    }
    const registry = useSessionRegistry()
    const live = registry.getSessionIdForProfile(pending.profileId, 'sqlite')
    if (!live) {
      throw new Error(t('modules.sqlite.ddl.detachNeedSession'))
    }
    await withPreferredSqliteSession(pending.profileId, async (sessionId) => {
      await sqliteApi.sessionDetach({ sessionId, alias })
    })
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
      if (pending.action === 'detach_schema') {
        await execDetach(pending)
      } else {
        const sql = buildDdlSql(pending, opts?.newName)
        await execSqliteSql(pending.profileId, sql, pending.schema)
      }
      toast.success(t('modules.sqlite.ddl.done'))
      if (conn) {
        await refreshTreeAfterDdl(conn, refreshPath, refreshDeep, prunePaths)
      } else {
        invalidateConnTreeChildren(pending.profileId)
      }
      store.clear()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.sqlite.ddl.execError'))
    } finally {
      busy.value = false
    }
  }

  return { exec, busy }
}
