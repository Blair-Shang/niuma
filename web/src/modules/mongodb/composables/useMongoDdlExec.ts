import { useRsToast } from '@niuma/ui'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { mongodbApi } from '@/api'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import {
  invalidateConnTreeChildren,
  refreshConnTreeRoot,
  refreshResourceIfLoaded,
} from '@/modules/ops/composables/useConnTreeChildren'
import { useMongoDdlActionStore } from '@/modules/mongodb/stores/ddl-actions'

/** 执行 MongoDB 建库 / 重命名并刷新连接树。 */
export function useMongoDdlExec() {
  const { t } = useI18n()
  const toast = useRsToast()
  const store = useMongoDdlActionStore()
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
    createOptions?: { collection?: string }
  }): Promise<void> {
    const pending = store.pending
    if (!pending) return

    busy.value = true
    const conn = pending.conn
    const refreshPath = pending.refreshPath
    const refreshDeep = pending.refreshDeep
    const prunePaths = pending.prunePaths

    try {
      const profileId = pending.profileId
      if (pending.action === 'create_database') {
        const database = (opts?.newName ?? pending.name).trim()
        const collection = (opts?.createOptions?.collection ?? pending.createOptions?.collection ?? '').trim()
        await mongodbApi.catalogCreateDatabase({ profileId, database, collection })
      } else if (pending.action === 'rename_collection') {
        const to = (opts?.newName ?? pending.newName ?? '').trim()
        const database = pending.database ?? ''
        await mongodbApi.catalogRenameCollection({
          profileId,
          database,
          from: pending.name,
          to,
        })
      } else if (pending.action === 'rename_database') {
        const to = (opts?.newName ?? pending.newName ?? '').trim()
        await mongodbApi.catalogRenameDatabase({
          profileId,
          from: pending.name,
          to,
        })
      } else {
        throw new Error(`unsupported action: ${pending.action}`)
      }

      toast.success(t('modules.mongodb.ddl.done'))
      if (conn) {
        await refreshTreeAfterDdl(conn, refreshPath, refreshDeep, prunePaths)
      } else {
        invalidateConnTreeChildren(profileId)
      }
      store.clear()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.mongodb.ddl.execError'))
    } finally {
      busy.value = false
    }
  }

  return { exec, busy }
}
