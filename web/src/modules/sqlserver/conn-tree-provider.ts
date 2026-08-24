/**
 * SQL Server 连接树 Provider：
 * connection → database → schema → {Tables|Views|Procedures|Functions|Synonyms|Sequences} → object
 *
 * 右键密度对齐 docs/32 §5.3（低于 SSMS；清空表 / 删除表为确认后执行，其余变更类为「生成脚本到查询」）。
 * 库节点转储扫全部用户 schema；Triggers / Types / 约束树、重命名、GRANT、sqlcmd/bcp 属 P5。
 */
import type { RsContextMenuItem } from '@niuma/ui'
import { useRsToast } from '@niuma/ui'
import type { ConnTreeChildProvider } from '@/modules/ops/conn-tree/registry'
import type { ConnResourceDescriptor, ConnResourcePath } from '@/modules/ops/conn-tree/types'
import { sqlserverApi } from '@/api'
import type { ConnItem } from '@/modules/ops/types'
import {
  excludeSystemSchemasEnabled,
  isCategoryId,
  isProtectedDatabase,
  isProtectedSchema,
  lastSegment,
  loadCategoryChildren,
  loadSchemaCategories,
  segmentName,
  systemDatabaseBadge,
  t,
  truncatedHint,
  TREE_CHILDREN_LIMIT,
} from '@/modules/sqlserver/conn-tree-shared'

function notifyTreeLoadError(err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err ?? '')
  const message = detail.trim()
    ? t('modules.sqlserver.tree.loadFailedDetail', { message: detail })
    : t('modules.sqlserver.tree.loadFailed')
  try {
    useRsToast().error(message)
  } catch {
    console.warn('[sqlserver] tree load failed', err)
  }
}

type ActionsModule = typeof import('@/modules/sqlserver/conn-tree-actions')

let actionsPromise: Promise<ActionsModule> | null = null

function loadActions(): Promise<ActionsModule> {
  actionsPromise ??= import('@/modules/sqlserver/conn-tree-actions')
  return actionsPromise
}

const CONN_MENU_KEYS = new Set(['query', 'createDatabase', 'monitor'])

function scriptMenus(allowMutating: boolean): RsContextMenuItem {
  const children: RsContextMenuItem[] = [
    { key: 'genSelect', label: t('modules.sqlserver.tree.genSelect'), icon: 'code-2' },
    { key: 'genCount', label: t('modules.sqlserver.tree.genCount'), icon: 'hash' },
  ]
  if (allowMutating) {
    children.push(
      { key: 'genInsert', label: t('modules.sqlserver.tree.genInsert'), icon: 'square-plus' },
      { key: 'genUpdate', label: t('modules.sqlserver.tree.genUpdate'), icon: 'pencil' },
      {
        key: 'genDelete',
        label: t('modules.sqlserver.tree.genDelete'),
        icon: 'trash-2',
        danger: true,
      },
    )
  }
  return {
    key: 'scripts',
    label: t('modules.sqlserver.tree.scripts'),
    icon: 'file-text',
    children,
  }
}

function schemaCreateMenus(): RsContextMenuItem {
  return {
    key: 'createMenu',
    label: t('modules.sqlserver.tree.createMenu'),
    icon: 'plus',
    children: [
      { key: 'createTable', label: t('modules.sqlserver.tree.create.tables'), icon: 'layout-list' },
      { key: 'createView', label: t('modules.sqlserver.tree.create.views'), icon: 'eye' },
      {
        key: 'createProcedure',
        label: t('modules.sqlserver.tree.create.procedures'),
        icon: 'workflow',
      },
      {
        key: 'createFunction',
        label: t('modules.sqlserver.tree.create.functions'),
        icon: 'square-function',
      },
      {
        key: 'createSequence',
        label: t('modules.sqlserver.tree.create.sequences'),
        icon: 'hash',
      },
      {
        key: 'createSynonym',
        label: t('modules.sqlserver.tree.create.synonyms'),
        icon: 'link',
      },
    ],
  }
}

function clipboardMenus(qualifiedKey = 'copyQualified'): RsContextMenuItem[] {
  return [
    { key: 'sep-clipboard', label: '', separator: true },
    { key: 'copyName', label: t('modules.sqlserver.tree.copyName'), icon: 'copy' },
    {
      key: 'copyQualified',
      label: t(`modules.sqlserver.tree.${qualifiedKey}`),
      icon: 'clipboard-copy',
    },
  ]
}

function relationClipboardMenus(): RsContextMenuItem[] {
  return [
    ...clipboardMenus(),
    { key: 'copyDdl', label: t('modules.sqlserver.tree.copyDdl'), icon: 'clipboard' },
  ]
}

function tableOpenLabelKey(isView: boolean, isSynonym: boolean): string {
  if (isSynonym) return 'modules.sqlserver.tree.synonymOpen'
  if (isView) return 'modules.sqlserver.tree.viewOpen'
  return 'modules.sqlserver.tree.tableOpen'
}

function tableQueryLabelKey(isView: boolean, isSynonym: boolean): string {
  if (isSynonym) return 'modules.sqlserver.tree.synonymQuery'
  if (isView) return 'modules.sqlserver.tree.viewQuery'
  return 'modules.sqlserver.tree.tableQuery'
}

function tableDropMeta(isView: boolean, isSynonym: boolean): { key: string; labelKey: string } {
  if (isSynonym) return { key: 'dropSynonym', labelKey: 'modules.sqlserver.tree.dropSynonym' }
  if (isView) return { key: 'dropView', labelKey: 'modules.sqlserver.tree.dropView' }
  return { key: 'dropTable', labelKey: 'modules.sqlserver.tree.dropTable' }
}

function dataIoMenus(isView: boolean): RsContextMenuItem[] {
  const children: RsContextMenuItem[] = []
  if (!isView) {
    children.push({
      key: 'importCsv',
      label: t('modules.sqlserver.tree.importCsv'),
      icon: 'upload',
    })
  }
  children.push(
    {
      key: 'exportCsv',
      label: t('modules.sqlserver.tree.exportCsv'),
      icon: 'download',
    },
    {
      key: 'dumpSql',
      label: t('modules.sqlserver.tree.dumpSql'),
      icon: 'file-down',
    },
  )
  return [
    {
      key: 'dataIo',
      label: t('modules.sqlserver.tree.dataIo'),
      icon: 'arrow-left-right',
      children,
    },
  ]
}

/** 库 / schema 共用工具菜单；库级 dump 由 actions 设 dumpScope=database，不缺省 dbo。 */
function schemaToolsMenus(): RsContextMenuItem[] {
  return [
    {
      key: 'toolsMenu',
      label: t('modules.sqlserver.tree.toolsMenu'),
      icon: 'wrench',
      children: [
        { key: 'dumpSql', label: t('modules.sqlserver.tree.dumpSql'), icon: 'file-down' },
        { key: 'execSqlFile', label: t('modules.sqlserver.tree.execSqlFile'), icon: 'file-up' },
      ],
    },
  ]
}

function tableLikeMenus(isView: boolean, isSynonym: boolean): RsContextMenuItem[] {
  const drop = tableDropMeta(isView, isSynonym)
  return [
    {
      key: 'browse',
      label: t(tableOpenLabelKey(isView, isSynonym)),
      icon: isView || isSynonym ? 'eye' : 'table',
    },
    {
      key: 'query',
      label: t(tableQueryLabelKey(isView, isSynonym)),
      icon: 'code-2',
    },
    { key: 'ddl', label: t('modules.sqlserver.tree.tableDdl'), icon: 'file-code' },
    ...(!isView && !isSynonym
      ? ([{ key: 'design', label: t('modules.sqlserver.tree.design'), icon: 'layout-list' }] as RsContextMenuItem[])
      : []),
    ...(!isSynonym && isView
      ? ([
          {
            key: 'editView',
            label: t('modules.sqlserver.tree.editView'),
            icon: 'file-pen',
          },
        ] as RsContextMenuItem[])
      : []),
    ...(isSynonym
      ? ([
          {
            key: 'editSynonym',
            label: t('modules.sqlserver.tree.editSynonym'),
            icon: 'file-pen',
          },
        ] as RsContextMenuItem[])
      : []),
    scriptMenus(!isView && !isSynonym),
    ...(!isSynonym
      ? dataIoMenus(isView)
      : ([
          { key: 'dumpSql', label: t('modules.sqlserver.tree.dumpSql'), icon: 'file-down' },
        ] as RsContextMenuItem[])),
    { key: 'sep-mutate', label: '', separator: true },
    ...(!isView && !isSynonym
      ? ([
          {
            key: 'truncate',
            label: t('modules.sqlserver.tree.truncate'),
            icon: 'eraser',
            danger: true,
          },
        ] as RsContextMenuItem[])
      : []),
    {
      key: drop.key,
      label: t(drop.labelKey),
      icon: 'trash-2',
      danger: true,
    },
    ...relationClipboardMenus(),
  ]
}

function routineMenus(isProcedure: boolean): RsContextMenuItem[] {
  return [
    {
      key: 'exec',
      label: t(isProcedure ? 'modules.sqlserver.tree.procExec' : 'modules.sqlserver.tree.funcExec'),
      icon: 'play',
    },
    { key: 'query', label: t(isProcedure ? 'modules.sqlserver.tree.procQuery' : 'modules.sqlserver.tree.funcQuery'), icon: 'code-2' },
    { key: 'source', label: t(isProcedure ? 'modules.sqlserver.tree.editSource' : 'modules.sqlserver.tree.editSource'), icon: 'file-pen' },
    { key: 'dumpSql', label: t('modules.sqlserver.tree.dumpSql'), icon: 'file-down' },
    { key: 'sep-mutate', label: '', separator: true },
    {
      key: isProcedure ? 'dropProc' : 'dropFunc',
      label: t(isProcedure ? 'modules.sqlserver.tree.dropProc' : 'modules.sqlserver.tree.dropFunc'),
      icon: 'trash-2',
      danger: true,
    },
    ...relationClipboardMenus(),
  ]
}

function sequenceMenus(): RsContextMenuItem[] {
  return [
    { key: 'source', label: t('modules.sqlserver.tree.editSequence'), icon: 'file-pen' },
    { key: 'dumpSql', label: t('modules.sqlserver.tree.dumpSql'), icon: 'file-down' },
    { key: 'seqNext', label: t('modules.sqlserver.tree.seqNext'), icon: 'play' },
    { key: 'query', label: t('modules.sqlserver.tree.schemaQuery'), icon: 'code-2' },
    { key: 'sep-mutate', label: '', separator: true },
    {
      key: 'dropSequence',
      label: t('modules.sqlserver.tree.dropSequence'),
      icon: 'trash-2',
      danger: true,
    },
    ...relationClipboardMenus(),
  ]
}

export const sqlserverConnTreeProvider: ConnTreeChildProvider = {
  canExpand() {
    return true
  },

  async loadChildren(conn, parentPath, opts) {
    if (parentPath) {
      const leaf = lastSegment(parentPath)
      if (
        leaf &&
        (leaf.kind === 'table' ||
          leaf.kind === 'synonym' ||
          leaf.kind === 'function' ||
          leaf.kind === 'procedure' ||
          leaf.kind === 'sequence' ||
          leaf.kind === 'reltype' ||
          leaf.kind === 'hint')
      ) {
        return []
      }
    }

    const database = segmentName(parentPath, 'database')
    const schema = segmentName(parentPath, 'schema')
    const category = segmentName(parentPath, 'category')

    if (database && schema && isCategoryId(category)) {
      try {
        return await loadCategoryChildren(conn, database, schema, category, opts?.filter)
      } catch (err) {
        notifyTreeLoadError(err)
        return []
      }
    }

    if (database && schema) {
      return loadSchemaCategories(conn, database, schema)
    }

    if (database) {
      try {
        const result = await sqlserverApi.treeSchemas({
          profileId: conn.profileId,
          database,
          filter: opts?.filter,
          excludeSystem: excludeSystemSchemasEnabled(conn),
        })
        const nodes: ConnResourceDescriptor[] = result.schemas.map((sch) => ({
          path: {
            segments: [
              { kind: 'database', name: database },
              { kind: 'schema', name: sch.name },
            ],
          },
          label: sch.name,
          icon: 'folder',
          badge: isProtectedSchema(sch.name) ? t('modules.sqlserver.tree.systemBadge') : undefined,
          collapsible: true,
        }))
        if (result.truncated) {
          nodes.push(
            truncatedHint(
              { segments: [{ kind: 'database', name: database }] },
              'schemas',
              TREE_CHILDREN_LIMIT,
            ),
          )
        }
        return nodes
      } catch (err) {
        notifyTreeLoadError(err)
        return []
      }
    }

    try {
      const result = await sqlserverApi.treeDatabases({
        profileId: conn.profileId,
        filter: opts?.filter,
        limit: TREE_CHILDREN_LIMIT,
      })
      const nodes: ConnResourceDescriptor[] = result.databases.map((db) => ({
        path: { segments: [{ kind: 'database', name: db.name }] },
        label: db.name,
        icon: 'database',
        badge: systemDatabaseBadge(db.name),
        collapsible: true,
      }))
      if (result.truncated) {
        nodes.push(truncatedHint({ segments: [] }, 'databases', TREE_CHILDREN_LIMIT))
      }
      return nodes
    } catch (err) {
      notifyTreeLoadError(err)
      return []
    }
  },

  activate(conn, path) {
    void loadActions().then((m) => m.activate(conn, path))
  },

  connMenuItems(): RsContextMenuItem[] {
    return [
      { key: 'query', label: t('modules.sqlserver.tree.connQuery'), icon: 'code-2' },
      { key: 'createDatabase', label: t('modules.sqlserver.tree.createDatabase'), icon: 'database' },
      { key: 'monitor', label: t('modules.sqlserver.tree.monitor'), icon: 'activity' },
    ]
  },

  onConnMenuSelect(conn: ConnItem, key: string): boolean {
    if (!CONN_MENU_KEYS.has(key)) return false
    void loadActions().then((m) => m.onConnMenuSelect(conn, key))
    return true
  },

  resourceMenuItems(_conn: ConnItem, path: ConnResourcePath): RsContextMenuItem[] {
    const last = lastSegment(path)
    if (!last || last.kind === 'hint') return []

    if (last.kind === 'database') {
      const protectedDb = isProtectedDatabase(last.name)
      return [
        { key: 'query', label: t('modules.sqlserver.tree.dbQuery'), icon: 'code-2' },
        { key: 'createSchema', label: t('modules.sqlserver.tree.createSchema'), icon: 'folder-plus' },
        schemaCreateMenus(),
        ...schemaToolsMenus(),
        ...(!protectedDb
          ? ([
              { key: 'sep-mutate', label: '', separator: true },
              {
                key: 'dropDatabase',
                label: t('modules.sqlserver.tree.dropDatabase'),
                icon: 'trash-2',
                danger: true,
              },
            ] as RsContextMenuItem[])
          : []),
        { key: 'sep-clipboard', label: '', separator: true },
        { key: 'copyName', label: t('modules.sqlserver.tree.copyName'), icon: 'copy' },
      ]
    }

    if (last.kind === 'schema') {
      const protectedSchema = isProtectedSchema(last.name)
      return [
        { key: 'query', label: t('modules.sqlserver.tree.schemaQuery'), icon: 'code-2' },
        schemaCreateMenus(),
        ...schemaToolsMenus(),
        ...(!protectedSchema
          ? ([
              { key: 'sep-mutate', label: '', separator: true },
              {
                key: 'dropSchema',
                label: t('modules.sqlserver.tree.dropSchema'),
                icon: 'trash-2',
                danger: true,
              },
            ] as RsContextMenuItem[])
          : []),
        ...clipboardMenus('copyQualifiedDbSchema'),
      ]
    }

    if (last.kind === 'category' && isCategoryId(last.name)) {
      return [
        {
          key: 'create',
          label: t(`modules.sqlserver.tree.create.${last.name}`),
          icon: last.name === 'tables' ? 'layout-list' : 'plus',
        },
        { key: 'query', label: t('modules.sqlserver.tree.schemaQuery'), icon: 'code-2' },
        { key: 'dumpSql', label: t('modules.sqlserver.tree.dumpSql'), icon: 'file-down' },
      ]
    }

    if (last.kind === 'synonym' || segmentName(path, 'synonym')) {
      return tableLikeMenus(false, true)
    }

    if (last.kind === 'table' || segmentName(path, 'table')) {
      return tableLikeMenus(segmentName(path, 'category') === 'views', false)
    }

    if (segmentName(path, 'function') || last.kind === 'function') {
      return routineMenus(false)
    }

    if (segmentName(path, 'procedure') || last.kind === 'procedure') {
      return routineMenus(true)
    }

    if (segmentName(path, 'sequence') || last.kind === 'sequence') {
      return sequenceMenus()
    }

    return []
  },

  onResourceMenuSelect(conn: ConnItem, path: ConnResourcePath, key: string): void {
    void loadActions().then((m) => m.onResourceMenuSelect(conn, path, key))
  },
}
