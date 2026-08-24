/**
 * Kingbase 连接树 Provider：database → schema → 分类 → 对象。
 * 右键菜单对齐 Navicat / DBeaver / Vastbase（PG 系专业密度）。
 */
import type { RsContextMenuItem } from '@niuma/ui'
import type { ConnTreeChildProvider } from '@/modules/ops/conn-tree/registry'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import { kingbaseApi } from '@/api'
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
} from '@/modules/kingbase/conn-tree-shared'

type ActionsModule = typeof import('@/modules/kingbase/conn-tree-actions')

let actionsPromise: Promise<ActionsModule> | null = null

function loadActions(): Promise<ActionsModule> {
  actionsPromise ??= import('@/modules/kingbase/conn-tree-actions')
  return actionsPromise
}

const CONN_MENU_KEYS = new Set(['createDatabase', 'monitor'])

function scriptMenus(allowMutating: boolean): RsContextMenuItem {
  const children: RsContextMenuItem[] = [
    { key: 'genSelect', label: t('modules.kingbase.tree.genSelect'), icon: 'code-2' },
    { key: 'genCount', label: t('modules.kingbase.tree.genCount'), icon: 'hash' },
  ]
  if (allowMutating) {
    children.push(
      { key: 'genInsert', label: t('modules.kingbase.tree.genInsert'), icon: 'square-plus' },
      { key: 'genUpdate', label: t('modules.kingbase.tree.genUpdate'), icon: 'pencil' },
      {
        key: 'genDelete',
        label: t('modules.kingbase.tree.genDelete'),
        icon: 'trash-2',
        danger: true,
      },
    )
  }
  return {
    key: 'scripts',
    label: t('modules.kingbase.tree.scripts'),
    icon: 'file-text',
    children,
  }
}

function dataIoMenus(isView: boolean, isMatView: boolean): RsContextMenuItem[] {
  if (!isView) {
    return [
      {
        key: 'dataIo',
        label: t('modules.kingbase.tree.dataIo'),
        icon: 'arrow-left-right',
        children: [
          { key: 'importCsv', label: t('modules.kingbase.tree.importCsv'), icon: 'upload' },
          { key: 'exportCsv', label: t('modules.kingbase.tree.exportCsv'), icon: 'download' },
          { key: 'dumpSql', label: t('modules.kingbase.tree.dumpSql'), icon: 'file-down' },
        ],
      },
    ]
  }
  if (isMatView) {
    return [
      {
        key: 'dataIo',
        label: t('modules.kingbase.tree.dataIo'),
        icon: 'arrow-left-right',
        children: [
          { key: 'exportCsv', label: t('modules.kingbase.tree.exportCsv'), icon: 'download' },
          { key: 'dumpSql', label: t('modules.kingbase.tree.dumpSql'), icon: 'file-down' },
        ],
      },
    ]
  }
  return [
    {
      key: 'dataIo',
      label: t('modules.kingbase.tree.dataIo'),
      icon: 'arrow-left-right',
      children: [
        { key: 'exportCsv', label: t('modules.kingbase.tree.exportCsv'), icon: 'download' },
        { key: 'dumpSql', label: t('modules.kingbase.tree.dumpSql'), icon: 'file-down' },
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
    designOrEdit.push({ key: 'design', label: t('modules.kingbase.tree.design'), icon: 'layout-list' })
  } else if (isOrdinaryView) {
    designOrEdit.push({
      key: 'editView',
      label: t('modules.kingbase.tree.editView'),
      icon: 'file-pen',
    })
  }
  return [
    {
      key: 'browse',
      label: t(isView ? 'modules.kingbase.tree.viewOpen' : 'modules.kingbase.tree.tableOpen'),
      icon: isView ? 'eye' : 'table',
    },
    { key: 'sep-query', label: '', separator: true },
    { key: 'query', label: t('modules.kingbase.tree.tableQuery'), icon: 'code-2' },
    { key: 'ddl', label: t('modules.kingbase.tree.tableDdl'), icon: 'file-code' },
    ...designOrEdit,
    { key: 'deps', label: t('modules.kingbase.tree.tableDeps'), icon: 'git-fork' },
    scriptMenus(!isView),
    ...(!isView
      ? ([
          {
            key: 'maintenance',
            label: t('modules.kingbase.tree.maintenance'),
            icon: 'wrench',
            children: [
              { key: 'vacuum', label: t('modules.kingbase.tree.vacuum'), icon: 'eraser' },
              { key: 'analyze', label: t('modules.kingbase.tree.analyze'), icon: 'activity' },
            ],
          },
        ] as RsContextMenuItem[])
      : []),
    ...(isMatView
      ? ([
          {
            key: 'refreshMatView',
            label: t('modules.kingbase.tree.refreshMatView'),
            icon: 'refresh-cw',
          },
        ] as RsContextMenuItem[])
      : []),
    ...dataIoMenus(isView, isMatView),
    { key: 'sep-mutate', label: '', separator: true },
    { key: 'grant', label: t('modules.kingbase.tree.grant'), icon: 'shield-check' },
    { key: 'rename', label: t('modules.kingbase.tree.rename'), icon: 'pencil' },
    ...(!isView
      ? ([
          {
            key: 'truncate',
            label: t('modules.kingbase.tree.truncate'),
            icon: 'eraser',
            danger: true,
          },
        ] as RsContextMenuItem[])
      : []),
    {
      key: 'drop',
      label: t(isView ? 'modules.kingbase.tree.dropView' : 'modules.kingbase.tree.dropTable'),
      icon: 'trash-2',
      danger: true,
    },
    { key: 'sep-clipboard', label: '', separator: true },
    { key: 'copyName', label: t('modules.kingbase.tree.copyName'), icon: 'copy' },
    {
      key: 'copyQualified',
      label: t('modules.kingbase.tree.copyQualified'),
      icon: 'clipboard-copy',
    },
    { key: 'copyDdl', label: t('modules.kingbase.tree.copyDdl'), icon: 'clipboard' },
  ]
}

function routineMenus(isProcedure: boolean): RsContextMenuItem[] {
  return [
    {
      key: 'source',
      label: t('modules.kingbase.tree.editSource'),
      icon: 'file-pen',
    },
    { key: 'sep-call', label: '', separator: true },
    {
      key: 'call',
      label: t(isProcedure ? 'modules.kingbase.tree.procCall' : 'modules.kingbase.tree.funcCall'),
      icon: 'play',
    },
    { key: 'deps', label: t('modules.kingbase.tree.tableDeps'), icon: 'git-fork' },
    { key: 'sep-mutate', label: '', separator: true },
    { key: 'grant', label: t('modules.kingbase.tree.grant'), icon: 'shield-check' },
    { key: 'rename', label: t('modules.kingbase.tree.rename'), icon: 'pencil' },
    {
      key: 'drop',
      label: t(isProcedure ? 'modules.kingbase.tree.dropProc' : 'modules.kingbase.tree.dropFunc'),
      icon: 'trash-2',
      danger: true,
    },
    { key: 'sep-clipboard', label: '', separator: true },
    { key: 'copyName', label: t('modules.kingbase.tree.copyName'), icon: 'copy' },
    {
      key: 'copyQualified',
      label: t('modules.kingbase.tree.copyQualified'),
      icon: 'clipboard-copy',
    },
    { key: 'copyDdl', label: t('modules.kingbase.tree.copyDdl'), icon: 'clipboard' },
  ]
}

function sequenceMenus(): RsContextMenuItem[] {
  return [
    { key: 'source', label: t('modules.kingbase.tree.editSequence'), icon: 'file-pen' },
    { key: 'query', label: t('modules.kingbase.tree.schemaQuery'), icon: 'code-2' },
    {
      key: 'scripts',
      label: t('modules.kingbase.tree.scripts'),
      icon: 'file-text',
      children: [
        { key: 'seqNextval', label: t('modules.kingbase.tree.seqNextval'), icon: 'play' },
        { key: 'seqCurrval', label: t('modules.kingbase.tree.seqCurrval'), icon: 'hash' },
        { key: 'seqSetval', label: t('modules.kingbase.tree.seqSetval'), icon: 'pencil' },
      ],
    },
    { key: 'sep-mutate', label: '', separator: true },
    {
      key: 'drop',
      label: t('modules.kingbase.tree.dropSequence'),
      icon: 'trash-2',
      danger: true,
    },
    { key: 'sep-clipboard', label: '', separator: true },
    { key: 'copyName', label: t('modules.kingbase.tree.copyName'), icon: 'copy' },
    {
      key: 'copyQualified',
      label: t('modules.kingbase.tree.copyQualified'),
      icon: 'clipboard-copy',
    },
  ]
}

/** Schema 级「新建」：对齐 MySQL 库节点 / Navicat New / DBeaver Create New。 */
function schemaCreateMenus(): RsContextMenuItem {
  return {
    key: 'createMenu',
    label: t('modules.kingbase.tree.createMenu'),
    icon: 'plus',
    children: [
      { key: 'createTable', label: t('modules.kingbase.tree.create.tables'), icon: 'layout-list' },
      { key: 'createView', label: t('modules.kingbase.tree.create.views'), icon: 'eye' },
      { key: 'createFunction', label: t('modules.kingbase.tree.create.functions'), icon: 'square-function' },
      {
        key: 'createProcedure',
        label: t('modules.kingbase.tree.create.procedures'),
        icon: 'workflow',
      },
      {
        key: 'createSequence',
        label: t('modules.kingbase.tree.create.sequences'),
        icon: 'list-ordered',
      },
    ],
  }
}

export const kingbaseConnTreeProvider: ConnTreeChildProvider = {
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
        const result = await kingbaseApi.treeSchemas({
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
      const result = await kingbaseApi.treeDatabases({
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
      { key: 'createDatabase', label: t('modules.kingbase.tree.createDatabase'), icon: 'database' },
      { key: 'monitor', label: t('modules.kingbase.tree.monitor'), icon: 'activity' },
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
        { key: 'query', label: t('modules.kingbase.tree.dbQuery'), icon: 'code-2' },
        { key: 'createSchema', label: t('modules.kingbase.tree.createSchema'), icon: 'folder-plus' },
        {
          key: 'toolsMenu',
          label: t('modules.kingbase.tree.toolsMenu'),
          icon: 'wrench',
          children: [
            { key: 'dumpSql', label: t('modules.kingbase.tree.dumpSql'), icon: 'file-down' },
            { key: 'execSqlFile', label: t('modules.kingbase.tree.execSqlFile'), icon: 'file-up' },
          ],
        },
        ...(!protectedDb
          ? ([
              { key: 'sep-mutate', label: '', separator: true },
              { key: 'rename', label: t('modules.kingbase.tree.dbRename'), icon: 'pencil' },
              {
                key: 'drop',
                label: t('modules.kingbase.tree.dropDatabase'),
                icon: 'trash-2',
                danger: true,
              },
            ] as RsContextMenuItem[])
          : []),
        { key: 'sep-clipboard', label: '', separator: true },
        { key: 'copyName', label: t('modules.kingbase.tree.copyName'), icon: 'copy' },
        { key: 'copyCreateDdl', label: t('modules.kingbase.tree.copyCreateDdl'), icon: 'clipboard' },
      ]
    }

    if (last.kind === 'schema') {
      const protectedSchema = isProtectedSchema(last.name)
      return [
        { key: 'query', label: t('modules.kingbase.tree.schemaQuery'), icon: 'code-2' },
        schemaCreateMenus(),
        { key: 'grant', label: t('modules.kingbase.tree.grant'), icon: 'shield-check' },
        ...(!protectedSchema
          ? ([
              { key: 'sep-mutate', label: '', separator: true },
              { key: 'rename', label: t('modules.kingbase.tree.schemaRename'), icon: 'pencil' },
              {
                key: 'drop',
                label: t('modules.kingbase.tree.dropSchema'),
                icon: 'trash-2',
                danger: true,
              },
            ] as RsContextMenuItem[])
          : []),
        { key: 'sep-clipboard', label: '', separator: true },
        { key: 'copyName', label: t('modules.kingbase.tree.copyName'), icon: 'copy' },
        {
          key: 'copyQualified',
          label: t('modules.kingbase.tree.copyQualifiedDbSchema'),
          icon: 'clipboard-copy',
        },
      ]
    }

    if (last.kind === 'category' && isCategoryId(last.name)) {
      const items: RsContextMenuItem[] = [
        {
          key: 'create',
          label: t(`modules.kingbase.tree.create.${last.name}`),
          icon: last.name === 'tables' ? 'layout-list' : 'plus',
        },
        { key: 'query', label: t('modules.kingbase.tree.schemaQuery'), icon: 'code-2' },
        { key: 'dumpSql', label: t('modules.kingbase.tree.dumpSql'), icon: 'file-down' },
        {
          key: 'batchDrop',
          label: t('modules.kingbase.tree.batchDrop'),
          icon: 'trash-2',
          danger: true,
        },
      ]
      return items
    }

    if (last.kind === 'table' || segmentName(path, 'table')) {
      return tableMenus(segmentName(path, 'category') === 'views', segmentName(path, 'reltype'))
    }

    if (segmentName(path, 'function') || last.kind === 'function') {
      return routineMenus(false)
    }

    if (segmentName(path, 'procedure') || last.kind === 'procedure') {
      return routineMenus(true)
    }

    if (last.kind === 'oid' || last.kind === 'args') {
      return routineMenus(!!segmentName(path, 'procedure'))
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
