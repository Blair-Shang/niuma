/**
 * Vastbase 连接树 Provider：database → schema → 分类文件夹 → 对象。
 * 右键菜单对齐企业级工具；菜单/激活动作经 dynamic import 加载 conn-tree-actions，
 * 避免 sql-seed / script-templates / ddl Dialog 进入启动注册闭包。
 */
import type { RsContextMenuItem } from '@niuma/ui'
import type { ConnTreeChildProvider } from '@/modules/ops/conn-tree/registry'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import { vastbaseApi } from '@/api'
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
} from '@/modules/vastbase/conn-tree-shared'

type ActionsModule = typeof import('@/modules/vastbase/conn-tree-actions')

let actionsPromise: Promise<ActionsModule> | null = null

function loadActions(): Promise<ActionsModule> {
  if (!actionsPromise) {
    actionsPromise = import('@/modules/vastbase/conn-tree-actions')
  }
  return actionsPromise
}

const CONN_MENU_KEYS = new Set(['createDatabase', 'monitor', 'tools', 'query'])

/** 生成脚本：表保留写类模板；视图/外表仅 SELECT / COUNT。 */
function scriptMenus(allowMutating: boolean): RsContextMenuItem {
  const children: RsContextMenuItem[] = [
    {
      key: 'genSelect',
      label: t('modules.vastbase.tree.genSelect'),
      icon: 'code-2',
    },
    {
      key: 'genCount',
      label: t('modules.vastbase.tree.genCount'),
      icon: 'hash',
    },
  ]
  if (allowMutating) {
    children.push(
      {
        key: 'genInsert',
        label: t('modules.vastbase.tree.genInsert'),
        icon: 'square-plus',
      },
      {
        key: 'genUpdate',
        label: t('modules.vastbase.tree.genUpdate'),
        icon: 'pencil',
      },
      {
        key: 'genDelete',
        label: t('modules.vastbase.tree.genDelete'),
        icon: 'trash-2',
        danger: true,
      },
    )
  }
  return {
    key: 'scripts',
    label: t('modules.vastbase.tree.scripts'),
    icon: 'file-text',
    children,
  }
}

/**
 * 树级 CSV 走服务端 COPY：
 * - 基表：导入 + 导出
 * - 物化视图：仅导出（COPY TO）
 * - 普通视图 / 外表：不提供（COPY 不能直接作用于视图）
 */
function dataIoMenus(isView: boolean, isMatView: boolean): RsContextMenuItem[] {
  if (!isView) {
    return [
      {
        key: 'dataIo',
        label: t('modules.vastbase.tree.dataIo'),
        icon: 'arrow-left-right',
        children: [
          {
            key: 'importCsv',
            label: t('modules.vastbase.tree.importCsv'),
            icon: 'upload',
          },
          {
            key: 'exportCsv',
            label: t('modules.vastbase.tree.exportCsv'),
            icon: 'download',
          },
        ],
      },
    ]
  }
  if (isMatView) {
    return [
      {
        key: 'dataIo',
        label: t('modules.vastbase.tree.dataIo'),
        icon: 'arrow-left-right',
        children: [
          {
            key: 'exportCsv',
            label: t('modules.vastbase.tree.exportCsv'),
            icon: 'download',
          },
        ],
      },
    ]
  }
  return []
}

function tableMenus(isView: boolean, relType?: string): RsContextMenuItem[] {
  const isMatView = relType === 'materialized_view'
  const isForeignTable = relType === 'foreign_table'
  /** 普通视图（不含物化视图 / 外表）：可编辑定义，不可走表设计器。 */
  const isOrdinaryView = isView && !isMatView && !isForeignTable
  return [
    {
      key: 'browse',
      label: t(isView ? 'modules.vastbase.tree.viewOpen' : 'modules.vastbase.tree.tableOpen'),
      icon: isView ? 'eye' : 'table',
    },
    { key: 'sep-query', label: '', separator: true },
    { key: 'query', label: t('modules.vastbase.tree.tableQuery'), icon: 'code-2' },
    { key: 'ddl', label: t('modules.vastbase.tree.tableDdl'), icon: 'file-code' },
    // 设计表仅对基表有意义；视图改定义走 editView
    ...(!isView
      ? ([
          {
            key: 'design',
            label: t('modules.vastbase.tree.tableDesign'),
            icon: 'pencil-ruler',
          },
        ] as RsContextMenuItem[])
      : []),
    ...(isOrdinaryView
      ? ([
          {
            key: 'editView',
            label: t('modules.vastbase.tree.editView'),
            icon: 'file-code',
          },
        ] as RsContextMenuItem[])
      : []),
    { key: 'deps', label: t('modules.vastbase.tree.tableDeps'), icon: 'git-fork' },
    scriptMenus(!isView),
    ...(!isView
      ? ([
          {
            key: 'maintenance',
            label: t('modules.vastbase.tree.maintenance'),
            icon: 'wrench',
            children: [
              {
                key: 'vacuum',
                label: t('modules.vastbase.tree.vacuum'),
                icon: 'eraser',
              },
              {
                key: 'analyze',
                label: t('modules.vastbase.tree.analyze'),
                icon: 'activity',
              },
            ],
          },
        ] as RsContextMenuItem[])
      : []),
    ...(isMatView
      ? ([
          {
            key: 'refreshMatView',
            label: t('modules.vastbase.tree.refreshMatView'),
            icon: 'refresh-cw',
          },
        ] as RsContextMenuItem[])
      : []),
    ...dataIoMenus(isView, isMatView),
    { key: 'sep-mutate', label: '', separator: true },
    {
      key: 'grant',
      label: t('modules.vastbase.tree.grant'),
      icon: 'shield-check',
    },
    {
      key: 'rename',
      label: t('modules.vastbase.tree.rename'),
      icon: 'pencil',
    },
    ...(isView
      ? []
      : ([
          {
            key: 'truncate',
            label: t('modules.vastbase.tree.truncate'),
            icon: 'eraser',
            danger: true,
          },
        ] as RsContextMenuItem[])),
    {
      key: 'drop',
      label: t(isView ? 'modules.vastbase.tree.dropView' : 'modules.vastbase.tree.dropTable'),
      icon: 'trash-2',
      danger: true,
    },
    { key: 'sep-clipboard', label: '', separator: true },
    { key: 'copyName', label: t('modules.vastbase.tree.copyName'), icon: 'copy' },
    {
      key: 'copyQualified',
      label: t('modules.vastbase.tree.copyQualified'),
      icon: 'clipboard-copy',
    },
    { key: 'copyDdl', label: t('modules.vastbase.tree.copyDdl'), icon: 'clipboard' },
  ]
}

function routineMenus(isProcedure: boolean): RsContextMenuItem[] {
  return [
    {
      key: 'source',
      label: t(isProcedure ? 'modules.vastbase.tree.procOpen' : 'modules.vastbase.tree.funcOpen'),
      icon: isProcedure ? 'workflow' : 'square-function',
    },
    { key: 'sep-call', label: '', separator: true },
    {
      key: 'call',
      label: t(isProcedure ? 'modules.vastbase.tree.procCall' : 'modules.vastbase.tree.funcCall'),
      icon: 'play',
    },
    {
      key: 'debug',
      label: t('modules.vastbase.tree.routineDebug'),
      icon: 'bug',
    },
    {
      key: 'deps',
      label: t('modules.vastbase.tree.tableDeps'),
      icon: 'git-fork',
    },
    { key: 'sep-mutate', label: '', separator: true },
    {
      key: 'grant',
      label: t('modules.vastbase.tree.grant'),
      icon: 'shield-check',
    },
    {
      key: 'alterOwner',
      label: t('modules.vastbase.tree.alterOwner'),
      icon: 'user-cog',
    },
    {
      key: 'rename',
      label: t('modules.vastbase.tree.rename'),
      icon: 'pencil',
    },
    {
      key: 'drop',
      label: t(isProcedure ? 'modules.vastbase.tree.dropProc' : 'modules.vastbase.tree.dropFunc'),
      icon: 'trash-2',
      danger: true,
    },
    { key: 'sep-clipboard', label: '', separator: true },
    { key: 'copyName', label: t('modules.vastbase.tree.copyName'), icon: 'copy' },
    {
      key: 'copyQualified',
      label: t('modules.vastbase.tree.copyQualified'),
      icon: 'clipboard-copy',
    },
    { key: 'copyDdl', label: t('modules.vastbase.tree.copyDdl'), icon: 'clipboard' },
  ]
}

export const vastbaseConnTreeProvider: ConnTreeChildProvider = {
  canExpand() {
    return true
  },

  async loadChildren(conn, parentPath, opts) {
    // 表 / 视图 / 例程等叶子 path 不可展开；避免误把分类下兄弟列表当作其子节点
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
        const result = await vastbaseApi.treeSchemas({
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
      const result = await vastbaseApi.treeDatabases({
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
      { key: 'createDatabase', label: t('modules.vastbase.tree.createDatabase'), icon: 'database' },
      { key: 'sep-query', label: '', separator: true },
      { key: 'query', label: t('modules.vastbase.tree.connQuery'), icon: 'code-2' },
      { key: 'monitor', label: t('modules.vastbase.tree.connMonitor'), icon: 'activity' },
      { key: 'tools', label: t('modules.vastbase.tree.openTools'), icon: 'wrench' },
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
      const dbName = last.name
      const protectedDb = isProtectedDatabase(dbName)
      return [
        { key: 'open', label: t('modules.vastbase.tree.dbOpen'), icon: 'database' },
        { key: 'createSchema', label: t('modules.vastbase.tree.createSchema'), icon: 'folder-plus' },
        { key: 'sep-query', label: '', separator: true },
        { key: 'query', label: t('modules.vastbase.tree.dbQuery'), icon: 'code-2' },
        // dumpSql / execSqlFile → 数据任务 Dock；tools → VastToolsPane（vb_dump/vb_restore）
        {
          key: 'toolsMenu',
          label: t('modules.vastbase.tree.toolsMenu'),
          icon: 'wrench',
          children: [
            {
              key: 'dumpSql',
              label: t('modules.vastbase.tree.dumpSql'),
              icon: 'file-down',
            },
            {
              key: 'execSqlFile',
              label: t('modules.vastbase.tree.execSqlFile'),
              icon: 'file-up',
            },
            {
              key: 'tools',
              label: t('modules.vastbase.tree.openTools'),
              icon: 'archive',
            },
            {
              key: 'backupScript',
              label: t('modules.vastbase.tree.backupScript'),
              icon: 'clipboard',
            },
          ],
        },
        ...(!protectedDb
          ? ([
              { key: 'sep-mutate', label: '', separator: true },
              { key: 'alterOwner', label: t('modules.vastbase.tree.alterOwner'), icon: 'user-cog' },
              { key: 'rename', label: t('modules.vastbase.tree.dbRename'), icon: 'pencil' },
              {
                key: 'drop',
                label: t('modules.vastbase.tree.dropDatabase'),
                icon: 'trash-2',
                danger: true,
              },
            ] as RsContextMenuItem[])
          : []),
        { key: 'sep-clipboard', label: '', separator: true },
        { key: 'copyName', label: t('modules.vastbase.tree.copyName'), icon: 'copy' },
        { key: 'copyCreateDdl', label: t('modules.vastbase.tree.copyCreateDdl'), icon: 'clipboard' },
      ]
    }

    if (last.kind === 'schema') {
      const schemaName = last.name
      const protectedSchema = isProtectedSchema(schemaName)
      return [
        { key: 'open', label: t('modules.vastbase.tree.schemaOpen'), icon: 'layout-grid' },
        { key: 'sep-query', label: '', separator: true },
        { key: 'query', label: t('modules.vastbase.tree.schemaQuery'), icon: 'code-2' },
        {
          key: 'setSearchPath',
          label: t('modules.vastbase.tree.setSearchPath'),
          icon: 'route',
        },
        { key: 'grant', label: t('modules.vastbase.tree.grant'), icon: 'shield-check' },
        ...(!protectedSchema
          ? ([
              { key: 'sep-mutate', label: '', separator: true },
              { key: 'alterOwner', label: t('modules.vastbase.tree.alterOwner'), icon: 'user-cog' },
              { key: 'rename', label: t('modules.vastbase.tree.schemaRename'), icon: 'pencil' },
              {
                key: 'drop',
                label: t('modules.vastbase.tree.dropSchema'),
                icon: 'trash-2',
                danger: true,
              },
            ] as RsContextMenuItem[])
          : []),
        { key: 'sep-clipboard', label: '', separator: true },
        { key: 'copyName', label: t('modules.vastbase.tree.copyName'), icon: 'copy' },
        {
          key: 'copyQualified',
          label: t('modules.vastbase.tree.copyQualifiedDbSchema'),
          icon: 'clipboard-copy',
        },
      ]
    }

    if (last.kind === 'category' && isCategoryId(last.name)) {
      return [
        {
          key: 'create',
          label: t(`modules.vastbase.tree.create.${last.name}`),
          icon: 'plus',
        },
        {
          key: 'openSchemaOverview',
          label: t('modules.vastbase.tree.schemaOpen'),
          icon: 'layout-grid',
        },
        { key: 'sep-query', label: '', separator: true },
        { key: 'query', label: t('modules.vastbase.tree.schemaQuery'), icon: 'code-2' },
        {
          key: 'batchDrop',
          label: t('modules.vastbase.tree.batchDrop'),
          icon: 'trash-2',
          danger: true,
        },
      ]
    }

    if (last.kind === 'table' || segmentName(path, 'table')) {
      const category = segmentName(path, 'category')
      return tableMenus(category === 'views', segmentName(path, 'reltype'))
    }

    if (segmentName(path, 'function') || last.kind === 'function') {
      return routineMenus(false)
    }

    if (segmentName(path, 'procedure') || last.kind === 'procedure') {
      return routineMenus(true)
    }

    // oid/args 叶子：回退到例程菜单
    if (last.kind === 'oid' || last.kind === 'args') {
      return routineMenus(!!segmentName(path, 'procedure'))
    }

    return []
  
  },

  onResourceMenuSelect(conn: ConnItem, path: ConnResourcePath, key: string): void {
    void loadActions().then((m) => m.onResourceMenuSelect(conn, path, key))
  },
}
