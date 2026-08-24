import { useRsToast } from '@niuma/ui'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { postgresApi } from '@/api'
import type { PostgresDdlParams } from '@/api/types/postgres'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import {
  invalidateConnTreeChildren,
  patchCategoryObjectCount,
  refreshConnTreeRoot,
  refreshResourceIfLoaded,
} from '@/modules/ops/composables/useConnTreeChildren'
import { segmentName } from '@/modules/postgres/conn-tree-shared'
import { usePostgresDdlActionStore } from '@/modules/postgres/stores/ddl-actions'

/** 执行 Postgres DDL 并刷新连接树。 */
export function usePostgresDdlExec() {
  const { t } = useI18n()
  const toast = useRsToast()
  const store = usePostgresDdlActionStore()
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

  async function exec(payload: PostgresDdlParams): Promise<void> {
    busy.value = true
    const pending = store.pending
    const conn = pending?.conn
    const refreshPath = pending?.refreshPath
    const refreshDeep = pending?.refreshDeep
    const prunePaths = pending?.prunePaths
    try {
      await postgresApi.ddlExec(payload)
      toast.success(t('modules.postgres.ddl.done'))
      if (conn) {
        const action = pending?.action ?? ''
        const countDelta = action.startsWith('drop_') ? -1 : 0
        if (action !== 'truncate_table') {
          await refreshTreeAfterDdl(conn, refreshPath, refreshDeep, prunePaths, countDelta)
        }
      } else if (payload.profileId) {
        invalidateConnTreeChildren(payload.profileId)
      }
      store.clear()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.postgres.ddl.execError'))
    } finally {
      busy.value = false
    }
  }

  return { exec, busy }
}
