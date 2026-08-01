import { useRsToast } from '@niuma/ui'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { kingbaseApi } from '@/api'
import type { KingbaseDdlParams } from '@/api/types/kingbase'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import {
  invalidateConnTreeChildren,
  patchCategoryObjectCount,
  refreshConnTreeRoot,
  refreshResourceIfLoaded,
} from '@/modules/ops/composables/useConnTreeChildren'
import { segmentName } from '@/modules/kingbase/conn-tree-shared'
import { useKingbaseDdlActionStore } from '@/modules/kingbase/stores/ddl-actions'

/** 执行 Kingbase DDL 并刷新连接树。 */
export function useKingbaseDdlExec() {
  const { t } = useI18n()
  const toast = useRsToast()
  const store = useKingbaseDdlActionStore()
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

  async function exec(payload: KingbaseDdlParams): Promise<void> {
    busy.value = true
    const pending = store.pending
    const conn = pending?.conn
    const refreshPath = pending?.refreshPath
    const refreshDeep = pending?.refreshDeep
    const prunePaths = pending?.prunePaths
    try {
      await kingbaseApi.ddlExec(payload)
      toast.success(t('modules.kingbase.ddl.done'))
      if (conn) {
        const action = pending?.action ?? ''
        const countDelta = action.startsWith('drop_') ? -1 : 0
        await refreshTreeAfterDdl(conn, refreshPath, refreshDeep, prunePaths, countDelta)
      } else if (payload.profileId) {
        invalidateConnTreeChildren(payload.profileId)
      }
      store.clear()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.kingbase.ddl.execError'))
    } finally {
      busy.value = false
    }
  }

  return { exec, busy }
}
