/**
 * Postgres 连接树 Provider：database → schema → 分类 → 对象。
 * 右键菜单覆盖连接 / 库 / Schema / 对象的常用操作。
 */
import type { RsContextMenuItem } from '@niuma/ui'
import type { ConnTreeChildProvider } from '@/modules/ops/conn-tree/registry'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import { postgresApi } from '@/api'
import type { ConnItem } from '@/modules/ops/types'
import {
  isCategoryId,
  isProtectedDatabase,
  isProtectedSchema,
  lastSegment,
  loadCategoryChildren,
  loadSchemaCategories,
  segmentName,
  t,
} from '@/modules/postgres/conn-tree-shared'

type ActionsModule = typeof import('@/modules/postgres/conn-tree-actions')

let actionsPromise: Promise<ActionsModule> | null = null

function loadActions(): Promise<ActionsModule> {
  actionsPromise ??= import('@/modules/postgres/conn-tree-actions')
  return actionsPromise
}

const CONN_MENU_KEYS = new Set(['createDatabase', 'monitor'])

function scriptMenus(allowMutating: boolean): RsContextMenuItem {
  const children: RsContextMenuItem[] = [
    { key: 'genSelect', label: t('modules.postgres.tree.genSelect'), icon: 'code-2' },
    { key: 'genCount', label: t('modules.postgres.tree.genCount'), icon: 'hash' },
  ]
  if (allowMutating) {
    children.push(
      { key: 'genInsert', label: t('modules.postgres.tree.genInsert'), icon: 'square-plus' },
      { key: 'genUpdate', label: t('modules.postgres.tree.genUpdate'), icon: 'pencil' },
      {
        key: 'genDelete',
        label: t('modules.postgres.tree.genDelete'),
        icon: 'trash-2',
        danger: true,
      },
    )
  }
  return {
    key: 'scripts',
    label: t('modules.postgres.tree.scripts'),
    icon: 'file-text',
    children,
  }
}

function dataIoMenus(isView: boolean, isMatView: boolean): RsContextMenuItem[] {
  if (!isView) {
    return [
      {
        key: 'dataIo',
        label: t('modules.postgres.tree.dataIo'),
        icon: 'arrow-left-right',
        children: [
          { key: 'importCsv', label: t('modules.postgres.tree.importCsv'), icon: 'upload' },
          { key: 'exportCsv', label: t('modules.postgres.tree.exportCsv'), icon: 'download' },
          { key: 'dumpSql', label: t('modules.postgres.tree.dumpSql'), icon: 'file-down' },
        ],
      },
    ]
  }
  if (isMatView) {
    return [
      {
        key: 'dataIo',
        label: t('modules.postgres.tree.dataIo'),
        icon: 'arrow-left-right',
        children: [
          { key: 'exportCsv', label: t('modules.postgres.tree.exportCsv'), icon: 'download' },
          { key: 'dumpSql', label: t('modules.postgres.tree.dumpSql'), icon: 'file-down' },
        ],
      },
    ]
  }
  return [
    {
      key: 'dataIo',
      label: t('modules.postgres.tree.dataIo'),
      icon: 'arrow-left-right',
      children: [
        { key: 'exportCsv', label: t('modules.postgres.tree.exportCsv'), icon: 'download' },
        { key: 'dumpSql', label: t('modules.postgres.tree.dumpSql'), icon: 'file-down' },
      ],
    },
  ]
}

function tableMenus(isView: boolean, relType?: string): RsContextMenuItem[] {
  const isMatView = relType === 'materialized_view'
  const isForeignTable = relType === 'foreign_table'
  const isOrdinaryView = isView && !isMatView && !isForeignTable
  const designOrEdit: RsContextMenuItem[] = []
  if (!isView) {
    designOrEdit.push({ key: 'design', label: t('modules.postgres.tree.design'), icon: 'layout-list' })
  } else if (isOrdinaryView) {
    designOrEdit.push({
      key: 'editView',
      label: t('modules.postgres.tree.editView'),
      icon: 'file-pen',
    })
  }
  return [
    {
      key: 'open',
      label: t(isView ? 'modules.postgres.tree.viewOpen' : 'modules.postgres.tree.tableOpen'),
      icon: isView ? 'eye' : 'table',
    },
    { key: 'sep-query', label: '', separator: true },
    { key: 'query', label: t('modules.postgres.tree.tableQuery'), icon: 'code-2' },
    { key: 'ddl', label: t('modules.postgres.tree.tableDdl'), icon: 'file-code' },
    ...designOrEdit,
    { key: 'deps', label: t('modules.postgres.tree.tableDeps'), icon: 'git-fork' },
    scriptMenus(!isView),
    ...(!isView
      ? ([
          {
            key: 'maintenance',
            label: t('modules.postgres.tree.maintenance'),
            icon: 'wrench',
            children: [
              { key: 'vacuum', label: t('modules.postgres.tree.vacuum'), icon: 'eraser' },
              { key: 'analyze', label: t('modules.postgres.tree.analyze'), icon: 'activity' },
            ],
          },
        ] as RsContextMenuItem[])
      : []),
    ...(isMatView
      ? ([
          {
            key: 'refreshMatView',
            label: t('modules.postgres.tree.refreshMatView'),
            icon: 'refresh-cw',
          },
        ] as RsContextMenuItem[])
      : []),
    ...dataIoMenus(isView, isMatView),
    { key: 'sep-mutate', label: '', separator: true },
    { key: 'grant', label: t('modules.postgres.tree.grant'), icon: 'shield-check' },
    { key: 'rename', label: t('modules.postgres.tree.rename'), icon: 'pencil' },
    ...(!isView
      ? ([
          {
            key: 'truncate',
            label: t('modules.postgres.tree.truncate'),
            icon: 'eraser',
            danger: true,
          },
        ] as RsContextMenuItem[])
      : []),
    {
      key: 'drop',
      label: t(isView ? 'modules.postgres.tree.dropView' : 'modules.postgres.tree.dropTable'),
      icon: 'trash-2',
      danger: true,
    },
    { key: 'sep-clipboard', label: '', separator: true },
    { key: 'copyName', label: t('modules.postgres.tree.copyName'), icon: 'copy' },
    {
      key: 'copyQualified',
      label: t('modules.postgres.tree.copyQualified'),
      icon: 'clipboard-copy',
    },
    { key: 'copyDdl', label: t('modules.postgres.tree.copyDdl'), icon: 'clipboard' },
  ]
}

/** 过程/函数：调用面板为主（对齐 MySQL：入参 / 运行 / 结果），生成 CALL/SELECT 脚本为辅。 */
function routineMenus(isProcedure: boolean): RsContextMenuItem[] {
  return [
    {
      key: 'call',
      label: t(isProcedure ? 'modules.postgres.tree.procCall' : 'modules.postgres.tree.funcCall'),
      icon: 'play',
    },
    {
      key: 'query',
      label: t(isProcedure ? 'modules.postgres.tree.procQuery' : 'modules.postgres.tree.funcQuery'),
      icon: 'code-2',
    },
    {
      key: 'source',
      label: t('modules.postgres.tree.editSource'),
      icon: 'file-pen',
    },
    { key: 'deps', label: t('modules.postgres.tree.tableDeps'), icon: 'git-fork' },
    { key: 'sep-mutate', label: '', separator: true },
    { key: 'grant', label: t('modules.postgres.tree.grant'), icon: 'shield-check' },
    { key: 'alterOwner', label: t('modules.postgres.tree.alterOwner'), icon: 'user-cog' },
    { key: 'rename', label: t('modules.postgres.tree.rename'), icon: 'pencil' },
    {
      key: 'drop',
      label: t(isProcedure ? 'modules.postgres.tree.dropProc' : 'modules.postgres.tree.dropFunc'),
      icon: 'trash-2',
      danger: true,
    },
    { key: 'sep-clipboard', label: '', separator: true },
    { key: 'copyName', label: t('modules.postgres.tree.copyName'), icon: 'copy' },
    {
      key: 'copyQualified',
      label: t('modules.postgres.tree.copyQualified'),
      icon: 'clipboard-copy',
    },
    { key: 'copyDdl', label: t('modules.postgres.tree.copyDdl'), icon: 'clipboard' },
  ]
}

function sequenceMenus(): RsContextMenuItem[] {
  return [
    { key: 'source', label: t('modules.postgres.tree.editSequence'), icon: 'file-pen' },
    { key: 'query', label: t('modules.postgres.tree.schemaQuery'), icon: 'code-2' },
    {
      key: 'scripts',
      label: t('modules.postgres.tree.scripts'),
      icon: 'file-text',
      children: [
        { key: 'seqNextval', label: t('modules.postgres.tree.seqNextval'), icon: 'play' },
        { key: 'seqCurrval', label: t('modules.postgres.tree.seqCurrval'), icon: 'hash' },
        { key: 'seqSetval', label: t('modules.postgres.tree.seqSetval'), icon: 'pencil' },
      ],
    },
    { key: 'sep-mutate', label: '', separator: true },
    {
      key: 'drop',
      label: t('modules.postgres.tree.dropSequence'),
      icon: 'trash-2',
      danger: true,
    },
    { key: 'sep-clipboard', label: '', separator: true },
    { key: 'copyName', label: t('modules.postgres.tree.copyName'), icon: 'copy' },
    {
      key: 'copyQualified',
      label: t('modules.postgres.tree.copyQualified'),
      icon: 'clipboard-copy',
    },
  ]
}

/** Schema 级「新建」：表 / 视图 / 例程 / 序列 / 物化视图 / 触发器。 */
function schemaCreateMenus(): RsContextMenuItem {
  return {
    key: 'createMenu',
    label: t('modules.postgres.tree.createMenu'),
    icon: 'plus',
    children: [
      { key: 'createTable', label: t('modules.postgres.tree.create.tables'), icon: 'layout-list' },
      { key: 'createView', label: t('modules.postgres.tree.create.views'), icon: 'eye' },
      { key: 'createFunction', label: t('modules.postgres.tree.create.functions'), icon: 'square-function' },
      {
        key: 'createProcedure',
        label: t('modules.postgres.tree.create.procedures'),
        icon: 'workflow',
      },
      {
        key: 'createSequence',
        label: t('modules.postgres.tree.create.sequences'),
        icon: 'list-ordered',
      },
      {
        key: 'createMatView',
        label: t('modules.postgres.tree.create.materialized_views'),
        icon: 'layers',
      },
      {
        key: 'createTrigger',
        label: t('modules.postgres.tree.create.triggers'),
        icon: 'zap',
      },
    ],
  }
}

function triggerMenus(): RsContextMenuItem[] {
  return [
    { key: 'source', label: t('modules.postgres.tree.editTrigger'), icon: 'file-pen' },
    { key: 'sep-mutate', label: '', separator: true },
    {
      key: 'drop',
      label: t('modules.postgres.tree.dropTrigger'),
      icon: 'trash-2',
      danger: true,
    },
    { key: 'sep-clipboard', label: '', separator: true },
    { key: 'copyName', label: t('modules.postgres.tree.copyName'), icon: 'copy' },
    { key: 'copyDdl', label: t('modules.postgres.tree.copyDdl'), icon: 'clipboard' },
  ]
}

export const postgresConnTreeProvider: ConnTreeChildProvider = {
  canExpand() {
    return true
  },

  async loadChildren(conn, parentPath, opts) {
    if (parentPath) {
      const leaf = lastSegment(parentPath)
      if (
        leaf &&
        (leaf.kind === 'table' ||
          leaf.kind === 'function' ||
          leaf.kind === 'procedure' ||
          leaf.kind === 'sequence' ||
          leaf.kind === 'oid' ||
          leaf.kind === 'args' ||
          leaf.kind === 'reltype' ||
          leaf.kind === 'trigger' ||
          leaf.kind === 'ontable' ||
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
      } catch {
        return []
      }
    }

    if (database && schema) {
      return loadSchemaCategories(conn, database, schema)
    }

    if (database) {
      try {
        const result = await postgresApi.treeSchemas({
          profileId: conn.profileId,
          database,
          filter: opts?.filter,
        })
        return result.schemas.map((sch) => ({
          path: {
            segments: [
              { kind: 'database', name: database },
              { kind: 'schema', name: sch.name },
            ],
          },
          label: sch.name,
          icon: 'folder',
          collapsible: true,
        }))
      } catch {
        return []
      }
    }

    try {
      const result = await postgresApi.treeDatabases({
        profileId: conn.profileId,
        filter: opts?.filter,
      })
      return result.databases.map((db) => ({
        path: { segments: [{ kind: 'database', name: db.name }] },
        label: db.name,
        icon: 'database',
        collapsible: true,
      }))
    } catch {
      return []
    }
  },

  activate(conn, path) {
    void loadActions().then((m) => m.activate(conn, path))
  },

  connMenuItems(): RsContextMenuItem[] {
    return [
      { key: 'createDatabase', label: t('modules.postgres.tree.createDatabase'), icon: 'database' },
      { key: 'monitor', label: t('modules.postgres.tree.monitor'), icon: 'activity' },
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
        { key: 'query', label: t('modules.postgres.tree.dbQuery'), icon: 'code-2' },
        { key: 'createSchema', label: t('modules.postgres.tree.createSchema'), icon: 'folder-plus' },
        {
          key: 'toolsMenu',
          label: t('modules.postgres.tree.toolsMenu'),
          icon: 'wrench',
          children: [
            { key: 'dumpSql', label: t('modules.postgres.tree.dumpSql'), icon: 'file-down' },
            { key: 'execSqlFile', label: t('modules.postgres.tree.execSqlFile'), icon: 'file-up' },
          ],
        },
        ...(!protectedDb
          ? ([
              { key: 'sep-mutate', label: '', separator: true },
              { key: 'rename', label: t('modules.postgres.tree.dbRename'), icon: 'pencil' },
              {
                key: 'drop',
                label: t('modules.postgres.tree.dropDatabase'),
                icon: 'trash-2',
                danger: true,
              },
            ] as RsContextMenuItem[])
          : []),
        { key: 'sep-clipboard', label: '', separator: true },
        { key: 'copyName', label: t('modules.postgres.tree.copyName'), icon: 'copy' },
        { key: 'copyCreateDdl', label: t('modules.postgres.tree.copyCreateDdl'), icon: 'clipboard' },
      ]
    }

    if (last.kind === 'schema') {
      const protectedSchema = isProtectedSchema(last.name)
      return [
        { key: 'query', label: t('modules.postgres.tree.schemaQuery'), icon: 'code-2' },
        schemaCreateMenus(),
        { key: 'grant', label: t('modules.postgres.tree.grant'), icon: 'shield-check' },
        ...(!protectedSchema
          ? ([
              { key: 'sep-mutate', label: '', separator: true },
              { key: 'rename', label: t('modules.postgres.tree.schemaRename'), icon: 'pencil' },
              {
                key: 'drop',
                label: t('modules.postgres.tree.dropSchema'),
                icon: 'trash-2',
                danger: true,
              },
            ] as RsContextMenuItem[])
          : []),
        { key: 'sep-clipboard', label: '', separator: true },
        { key: 'copyName', label: t('modules.postgres.tree.copyName'), icon: 'copy' },
        {
          key: 'copyQualified',
          label: t('modules.postgres.tree.copyQualifiedDbSchema'),
          icon: 'clipboard-copy',
        },
      ]
    }

    if (last.kind === 'category' && isCategoryId(last.name)) {
      const items: RsContextMenuItem[] = [
        {
          key: 'create',
          label: t(`modules.postgres.tree.create.${last.name}`),
          icon: last.name === 'tables' ? 'layout-list' : 'plus',
        },
        { key: 'query', label: t('modules.postgres.tree.schemaQuery'), icon: 'code-2' },
        { key: 'dumpSql', label: t('modules.postgres.tree.dumpSql'), icon: 'file-down' },
        {
          key: 'batchDrop',
          label: t('modules.postgres.tree.batchDrop'),
          icon: 'trash-2',
          danger: true,
        },
      ]
      return items
    }

    if (segmentName(path, 'trigger') || last.kind === 'trigger') {
      return triggerMenus()
    }

    if (last.kind === 'table' || segmentName(path, 'table')) {
      const category = segmentName(path, 'category')
      const relType =
        segmentName(path, 'reltype') ??
        (category === 'materialized_views' ? 'materialized_view' : undefined)
      return tableMenus(category === 'views' || category === 'materialized_views', relType)
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
