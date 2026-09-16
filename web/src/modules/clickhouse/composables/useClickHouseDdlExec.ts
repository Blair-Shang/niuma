import { useRsToast } from '@niuma/ui'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import {
  invalidateConnTreeChildren,
  refreshConnTreeRoot,
  refreshResourceIfLoaded,
} from '@/modules/ops/composables/useConnTreeChildren'
import { execClickHouseSql } from '@/modules/clickhouse/composables/useClickHouseSessionSql'
import {
  alterDatabaseSql,
  createDatabaseSql,
  dropDatabaseSql,
  dropDictionarySql,
  dropTableSql,
  dropViewSql,
  reloadDictionarySql,
  renameDatabaseSql,
  renameTableSql,
  truncateTableSql,
} from '@/modules/clickhouse/utils/script-templates'
import {
  useClickHouseDdlActionStore,
  type ClickHousePendingDdlAction,
} from '@/modules/clickhouse/stores/ddl-actions'

function buildDdlSql(req: ClickHousePendingDdlAction, newName?: string): string {
  const database = req.database ?? ''
  const onCluster = req.createOptions?.onCluster
  const clusterOpts = onCluster ? { onCluster } : undefined
  switch (req.action) {
    case 'create_database': {
      const name = (newName ?? req.name ?? '').trim()
      if (!name) throw new Error('name required')
      return createDatabaseSql(name, {
        ...clusterOpts,
        engine: req.createOptions?.engine,
        comment: req.createOptions?.comment,
      })
    }
    case 'alter_database':
      return alterDatabaseSql(req.name, {
        ...clusterOpts,
        comment: req.createOptions?.comment,
      })
    case 'rename_database': {
      const to = (newName ?? req.newName ?? '').trim()
      if (!to) throw new Error('newName required')
      return renameDatabaseSql(req.name, to, clusterOpts)
    }
    case 'drop_database':
      return dropDatabaseSql(req.name, clusterOpts)
    case 'drop_table':
      return dropTableSql(database, req.name, clusterOpts)
    case 'drop_view':
      return dropViewSql(database, req.name, clusterOpts)
    case 'drop_dictionary':
      return dropDictionarySql(database, req.name, clusterOpts)
    case 'truncate_table':
      return truncateTableSql(database, req.name, clusterOpts)
    case 'reload_dictionary':
      return reloadDictionarySql(database, req.name)
    case 'rename_table': {
      const to = (newName ?? req.newName ?? '').trim()
      if (!to) throw new Error('newName required')
      return renameTableSql(database, req.name, to, clusterOpts)
    }
    default:
      throw new Error(`unsupported action: ${req.action}`)
  }
}

/** 执行 DDL SQL 并刷新连接树、提示结果。 */
export function useClickHouseDdlExec() {
  const { t } = useI18n()
  const toast = useRsToast()
  const store = useClickHouseDdlActionStore()
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

  async function exec(opts?: {
    newName?: string
    createOptions?: { onCluster?: string; engine?: string; comment?: string }
  }): Promise<void> {
    const pending = store.pending
    if (!pending) return

    busy.value = true
    const conn = pending.conn
    const refreshPath = pending.refreshPath
    const refreshDeep = pending.refreshDeep
    const prunePaths = pending.prunePaths

    try {
      const req: ClickHousePendingDdlAction = {
        ...pending,
        createOptions: opts?.createOptions
          ? {
              onCluster: opts.createOptions.onCluster?.trim() || undefined,
              engine: opts.createOptions.engine?.trim() || undefined,
              comment: opts.createOptions.comment,
            }
          : pending.createOptions,
      }
      const sql = buildDdlSql(req, opts?.newName)
      // 库级 DDL 不绑库；表级 DDL 绑当前 database
      const database =
        req.action === 'drop_database' ||
        req.action === 'create_database' ||
        req.action === 'alter_database' ||
        req.action === 'rename_database'
          ? undefined
          : req.database
      await execClickHouseSql(req.profileId, sql, database)
      toast.success(t('modules.clickhouse.ddl.done'))
      if (conn) {
        // 改注释不改变树节点；清空表也不刷新结构
        if (req.action !== 'truncate_table' && req.action !== 'alter_database') {
          await refreshTreeAfterDdl(conn, refreshPath, refreshDeep, prunePaths)
        }
      } else {
        invalidateConnTreeChildren(req.profileId)
      }
      store.clear()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.clickhouse.ddl.execError'))
    } finally {
      busy.value = false
    }
  }

  return { exec, busy }
}
