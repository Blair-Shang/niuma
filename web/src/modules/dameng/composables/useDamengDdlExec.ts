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
import { segmentName } from '@/modules/dameng/conn-tree-shared'
import { execDamengSql } from '@/modules/dameng/composables/useDamengSessionSql'
import {
  createSchemaSql,
  dropFunctionSql,
  dropPackageSql,
  dropProcedureSql,
  dropSchemaSql,
  dropSequenceSql,
  dropSynonymSql,
  dropTableSql,
  dropTriggerSql,
  dropViewSql,
  grantSchemaResourceSql,
  renameSequenceSql,
  renameTableSql,
  renameViewSql,
  truncateTableSql,
} from '@/modules/dameng/utils/script-templates'
import {
  useDamengDdlActionStore,
  type DamengCreateSchemaOptions,
  type DamengPendingDdlAction,
} from '@/modules/dameng/stores/ddl-actions'

function buildDdlSql(req: DamengPendingDdlAction, newName?: string): string {
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
    case 'drop_synonym':
      return dropSynonymSql(schema, req.name)
    case 'drop_trigger':
      return dropTriggerSql(schema, req.name)
    case 'drop_schema':
      return dropSchemaSql(req.name)
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
    case 'create_schema': {
      const name = (newName ?? req.name ?? '').trim()
      const password = req.createOptions?.password ?? ''
      if (!name) throw new Error('name required')
      if (!password) throw new Error('password required')
      return createSchemaSql(name, password)
    }
    default:
      throw new Error(`unsupported action: ${req.action}`)
  }
}

/** 执行 DDL SQL 并刷新连接树、提示结果。 */
export function useDamengDdlExec() {
  const { t } = useI18n()
  const toast = useRsToast()
  const store = useDamengDdlActionStore()
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
      // 只 patch 分类夹徽章，不重拉整个 schema（避免 categoryCounts）
      if (segmentName(refreshPath, 'category')) {
        patchCategoryObjectCount(conn, refreshPath, { delta: countDelta })
      }
      return
    }
    await refreshConnTreeRoot(conn, { prunePaths: prune })
  }

  async function exec(opts?: {
    newName?: string
    createOptions?: DamengCreateSchemaOptions
  }): Promise<void> {
    const pending = store.pending
    if (!pending) return

    busy.value = true
    const conn = pending.conn
    const refreshPath = pending.refreshPath
    const refreshDeep = pending.refreshDeep
    const prunePaths = pending.prunePaths

    try {
      const req: DamengPendingDdlAction = {
        ...pending,
        createOptions: opts?.createOptions ?? pending.createOptions,
      }
      const sql = buildDdlSql(req, opts?.newName)
      // CREATE/DROP USER 不绑 CURRENT_SCHEMA（避免绑到正被删除的用户）
      const bindSchema =
        req.action === 'create_schema' || req.action === 'drop_schema' ? undefined : req.schema
      await execDamengSql(req.profileId, sql, bindSchema)

      if (req.action === 'create_schema' && req.createOptions?.grantResource !== false) {
        const name = (opts?.newName ?? req.name ?? '').trim()
        await execDamengSql(req.profileId, grantSchemaResourceSql(name))
      }

      toast.success(t('modules.dameng.ddl.done'))
      if (conn) {
        const countDelta = req.action.startsWith('drop_') ? -1 : 0
        await refreshTreeAfterDdl(conn, refreshPath, refreshDeep, prunePaths, countDelta)
      } else {
        invalidateConnTreeChildren(req.profileId)
      }
      store.clear()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.dameng.ddl.execError'))
    } finally {
      busy.value = false
    }
  }

  return { exec, busy }
}
