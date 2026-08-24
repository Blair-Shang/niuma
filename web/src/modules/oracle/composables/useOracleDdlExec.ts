import { useRsToast } from '@niuma/ui'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { oracleApi } from '@/api/oracle'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import {
  invalidateConnTreeChildren,
  patchCategoryObjectCount,
  refreshConnTreeRoot,
  refreshResourceIfLoaded,
} from '@/modules/ops/composables/useConnTreeChildren'
import {
  execOracleSql,
  withOracleSession,
} from '@/modules/oracle/composables/useOracleSessionSql'
import { stripOracleSqlPlusTerminator } from '@/modules/oracle/utils/normalize-object-ddl'
import {
  useOracleDdlActionStore,
  type OracleCreateSchemaOptions,
  type OraclePendingDdlAction,
} from '@/modules/oracle/stores/ddl-actions'
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
  grantSchemaConnectResourceSql,
  renameSequenceSql,
  renameTableSql,
  renameViewSql,
  rewriteOracleViewDdlForRename,
  truncateTableSql,
} from '@/modules/oracle/utils/script-templates'

function segmentName(path: ConnResourcePath | undefined, kind: string): string | undefined {
  return path?.segments.find((s) => s.kind === kind)?.name
}

function isOra03001(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /ORA-03001/i.test(msg)
}

/**
 * Oracle：RENAME 要求会话用户即对象属主；DBA + CURRENT_SCHEMA 会 ORA-03001。
 * 先试 RENAME，失败则建新视图再删旧视图。
 */
async function renameViewWithFallback(
  profileId: string,
  schema: string,
  from: string,
  to: string,
): Promise<void> {
  try {
    await execOracleSql(profileId, renameViewSql(schema, from, to), schema)
    return
  } catch (err) {
    if (!isOra03001(err)) throw err
  }

  await withOracleSession(profileId, async (sessionId) => {
    const meta = await oracleApi.metaDDL({
      sessionId,
      schema,
      table: from,
      objectType: 'view',
    })
    const createSql = stripOracleSqlPlusTerminator(
      rewriteOracleViewDdlForRename(meta.ddl ?? '', schema, from, to),
    )
    if (!createSql.trim()) {
      throw new Error('oracle: view ddl empty; cannot rename by recreate')
    }
    const created = await oracleApi.queryExec({
      sessionId,
      schema,
      sql: createSql,
      limit: 1,
    })
    if (created.resultSetId) {
      await oracleApi
        .queryClose({ sessionId, resultSetId: created.resultSetId })
        .catch(() => undefined)
    }
    const dropped = await oracleApi.queryExec({
      sessionId,
      schema,
      sql: dropViewSql(schema, from),
      limit: 1,
    })
    if (dropped.resultSetId) {
      await oracleApi
        .queryClose({ sessionId, resultSetId: dropped.resultSetId })
        .catch(() => undefined)
    }
  })
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
      const opts = req.createOptions
      const password = opts?.password ?? ''
      if (!name) throw new Error('name required')
      if (!password) throw new Error('password required')
      return createSchemaSql(name, password, {
        defaultTablespace: opts?.defaultTablespace,
        temporaryTablespace: opts?.temporaryTablespace,
        quotaUnlimited: opts?.quotaUnlimited,
      })
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

  async function exec(opts?: {
    newName?: string
    createOptions?: OracleCreateSchemaOptions
  }): Promise<void> {
    const pending = store.pending
    if (!pending) return

    busy.value = true
    const conn = pending.conn
    const refreshPath = pending.refreshPath
    const refreshDeep = pending.refreshDeep
    const prunePaths = pending.prunePaths

    try {
      const req: OraclePendingDdlAction = {
        ...pending,
        createOptions: opts?.createOptions ?? pending.createOptions,
      }
      if (req.action === 'rename_view') {
        const to = (opts?.newName ?? req.newName ?? '').trim()
        const schema = (req.schema ?? '').trim()
        if (!to || !schema) throw new Error('schema and newName required')
        await renameViewWithFallback(req.profileId, schema, req.name, to)
      } else {
        const sql = buildDdlSql(req, opts?.newName)
        // CREATE USER 不绑 CURRENT_SCHEMA
        const bindSchema =
          req.action === 'create_schema' || req.action === 'drop_schema' ? undefined : req.schema
        await execOracleSql(req.profileId, sql, bindSchema)
      }

      let grantFailed: string | undefined
      if (req.action === 'create_schema' && req.createOptions?.grantConnectResource !== false) {
        const name = (opts?.newName ?? req.name ?? '').trim()
        try {
          await execOracleSql(req.profileId, grantSchemaConnectResourceSql(name))
        } catch (e) {
          // 用户已创建：刷新树并提示授权失败，避免重复点创建报「用户已存在」
          grantFailed = e instanceof Error ? e.message : t('modules.oracle.ddl.execError')
        }
      }

      if (grantFailed) {
        toast.warning(t('modules.oracle.ddl.createSchemaGrantFailed', { error: grantFailed }))
      } else {
        toast.success(t('modules.oracle.ddl.done'))
      }

      if (conn) {
        const countDelta = req.action.startsWith('drop_') ? -1 : 0
        if (req.action !== 'truncate_table') {
          await refreshTreeAfterDdl(conn, refreshPath, refreshDeep, prunePaths, countDelta)
        }
      } else {
        invalidateConnTreeChildren(req.profileId)
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
