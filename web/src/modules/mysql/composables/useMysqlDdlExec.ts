import { useRsToast } from '@niuma/ui'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import {
  invalidateConnTreeChildren,
  refreshConnTreeRoot,
  refreshResourceIfLoaded,
} from '@/modules/ops/composables/useConnTreeChildren'
import { execMysqlSql } from '@/modules/mysql/composables/useMysqlSessionSql'
import {
  createDatabaseSql,
  dropDatabaseSql,
  dropFunctionSql,
  dropProcedureSql,
  dropTableSql,
  dropViewSql,
  renameTableSql,
  truncateTableSql,
} from '@/modules/mysql/utils/script-templates'
import {
  useMysqlDdlActionStore,
  type MysqlPendingDdlAction,
} from '@/modules/mysql/stores/ddl-actions'

function buildDdlSql(req: MysqlPendingDdlAction, newName?: string): string {
  const database = req.database ?? ''
  switch (req.action) {
    case 'drop_database':
      return dropDatabaseSql(req.name)
    case 'drop_table':
      return dropTableSql(database, req.name)
    case 'drop_view':
      return dropViewSql(database, req.name)
    case 'drop_procedure':
      return dropProcedureSql(database, req.name)
    case 'drop_function':
      return dropFunctionSql(database, req.name)
    case 'truncate_table':
      return truncateTableSql(database, req.name)
    case 'rename_table': {
      const to = (newName ?? req.newName ?? '').trim()
      if (!to) throw new Error('newName required')
      return renameTableSql(database, req.name, to)
    }
    case 'create_database': {
      const name = (newName ?? req.name ?? '').trim()
      if (!name) throw new Error('name required')
      return createDatabaseSql(name, {
        charset: req.createOptions?.charset,
        collation: req.createOptions?.collation,
      })
    }
    default:
      throw new Error(`unsupported action: ${req.action}`)
  }
}

/** 执行 DDL SQL 并刷新连接树、提示结果。 */
export function useMysqlDdlExec() {
  const { t } = useI18n()
  const toast = useRsToast()
  const store = useMysqlDdlActionStore()
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
    createOptions?: { charset?: string; collation?: string }
  }): Promise<void> {
    const pending = store.pending
    if (!pending) return

    busy.value = true
    const conn = pending.conn
    const refreshPath = pending.refreshPath
    const refreshDeep = pending.refreshDeep
    const prunePaths = pending.prunePaths

    try {
      const req: MysqlPendingDdlAction = {
        ...pending,
        createOptions: opts?.createOptions
          ? {
              charset: opts.createOptions.charset ?? '',
              collation: opts.createOptions.collation ?? '',
            }
          : pending.createOptions,
      }
      const sql = buildDdlSql(req, opts?.newName)
      // DROP/CREATE DATABASE 不绑库；表级 DDL 绑当前 database
      const database =
        req.action === 'drop_database' || req.action === 'create_database'
          ? undefined
          : req.database
      await execMysqlSql(req.profileId, sql, database)
      toast.success(t('modules.mysql.ddl.done'))
      if (conn) {
        await refreshTreeAfterDdl(conn, refreshPath, refreshDeep, prunePaths)
      } else {
        invalidateConnTreeChildren(req.profileId)
      }
      store.clear()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.mysql.ddl.execError'))
    } finally {
      busy.value = false
    }
  }

  return { exec, busy }
}
