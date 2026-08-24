import { useRsToast } from '@niuma/ui'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import {
  patchCategoryObjectCount,
  refreshConnTreeRoot,
  refreshResourceIfLoaded,
} from '@/modules/ops/composables/useConnTreeChildren'
import { segmentName } from '@/modules/sqlserver/conn-tree-shared'
import { execSqlServerSql } from '@/modules/sqlserver/composables/useSqlServerSessionSql'
import { useSqlServerDdlActionStore } from '@/modules/sqlserver/stores/ddl-actions'

export interface SqlServerDdlExecOptions {
  /** 成功提示文案，由调用方按具体动作拼装。 */
  successMessage: string
  /** 执行连接的目标库；未提供则连 master（新建库场景）。 */
  database?: string
}

/** 执行树 DDL（新建库 / Schema / 清空表 / 删除表等）并刷新连接树。 */
export function useSqlServerDdlExec() {
  const { t } = useI18n()
  const toast = useRsToast()
  const store = useSqlServerDdlActionStore()
  const { busy } = storeToRefs(store)

  async function exec(sql: string, options: SqlServerDdlExecOptions): Promise<void> {
    const pending = store.pending
    if (!pending) return

    busy.value = true
    try {
      await execSqlServerSql(pending.profileId, sql, options.database ?? 'master')
      toast.success(options.successMessage)
      if (pending.action !== 'truncate_table') {
        const prune = pending.prunePaths?.length ? pending.prunePaths : undefined
        if (pending.refreshPath) {
          await refreshResourceIfLoaded(pending.conn, pending.refreshPath, {
            deep: pending.refreshDeep !== false,
            prunePaths: prune,
          })
          if (segmentName(pending.refreshPath, 'category') && pending.action.startsWith('drop_')) {
            patchCategoryObjectCount(pending.conn, pending.refreshPath, { delta: -1 })
          }
        } else {
          await refreshConnTreeRoot(pending.conn, { prunePaths: prune })
        }
      }
      store.clear()
    } catch (e) {
      const fallback =
        pending.kind === 'danger'
          ? t('modules.sqlserver.ddl.execError')
          : t('modules.sqlserver.createDb.execError')
      toast.error(e instanceof Error ? e.message : fallback)
    } finally {
      busy.value = false
    }
  }

  return { exec, busy }
}
