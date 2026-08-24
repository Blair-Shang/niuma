/**
 * MySQL 连接树 Provider：
 * connection → database → {Tables|Views|Procedures|Functions} → object
 * （对齐 Navicat / DBeaver 常用集；无独立 schema 层；密度低于 Vastbase）。
 *
 * 菜单同步定义；激活动作经 dynamic import 加载 conn-tree-actions，
 * 避免 sql-seed / script-templates / ddl Dialog 进入启动注册闭包。
 */
import type { RsContextMenuItem } from '@niuma/ui'
import type { ConnTreeChildProvider } from '@/modules/ops/conn-tree/registry'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import { mysqlApi } from '@/api'
import type { ConnItem } from '@/modules/ops/types'
import {
  isCategoryId,
  isProtectedDatabase,
  lastSegment,
  loadCategoryChildren,
  loadDatabaseCategories,
  segmentName,
  t,
} from '@/modules/mysql/conn-tree-shared'

type ActionsModule = typeof import('@/modules/mysql/conn-tree-actions')

let actionsPromise: Promise<ActionsModule> | null = null

function loadActions(): Promise<ActionsModule> {
  if (!actionsPromise) {
    actionsPromise = import('@/modules/mysql/conn-tree-actions')
  }
  return actionsPromise
}

const CONN_MENU_KEYS = new Set(['createDatabase', 'monitor', 'tools'])


function scriptMenus(allowMutating: boolean): RsContextMenuItem {
  const children: RsContextMenuItem[] = [
    { key: 'genSelect', label: t('modules.mysql.tree.genSelect'), icon: 'code-2' },
    { key: 'genCount', label: t('modules.mysql.tree.genCount'), icon: 'hash' },
  ]
  if (allowMutating) {
    children.push(
      { key: 'genInsert', label: t('modules.mysql.tree.genInsert'), icon: 'square-plus' },
      { key: 'genUpdate', label: t('modules.mysql.tree.genUpdate'), icon: 'pencil' },
      {
        key: 'genDelete',
        label: t('modules.mysql.tree.genDelete'),
        icon: 'trash-2',
        danger: true,
      },
    )
  }
  return {
    key: 'scripts',
    label: t('modules.mysql.tree.scripts'),
    icon: 'file-text',
    children,
  }
}

/**
 * 表/视图导入导出（对齐 Navicat Export/Import Wizard + Dump SQL、DBeaver Export/Import Data）：
 * - 基表：导入 CSV、导出 CSV、转储 SQL
 * - 视图：仅导出 CSV（SELECT *）与转储 SQL（结构）；不可导入
 */
function dataIoMenus(isView: boolean): RsContextMenuItem[] {
  const children: RsContextMenuItem[] = []
  if (!isView) {
    children.push({
      key: 'importCsv',
      label: t('modules.mysql.tree.importCsv'),
      icon: 'upload',
    })
  }
  children.push(
    {
      key: 'exportCsv',
      label: t('modules.mysql.tree.exportCsv'),
      icon: 'download',
    },
    {
      key: 'dumpSql',
      label: t('modules.mysql.tree.dumpSql'),
      icon: 'file-down',
    },
  )
  return [
    {
      key: 'dataIo',
      label: t('modules.mysql.tree.dataIo'),
      icon: 'arrow-left-right',
      children,
    },
  ]
}

/**
 * 库级「新建」：对齐 Navicat New Table/View/Procedure/Function、DBeaver Create New。
 * 表走设计器；视图 / 过程 / 函数走对象脚本面板（新建与编辑共用）。
 */
function databaseCreateMenus(): RsContextMenuItem {
  return {
    key: 'createMenu',
    label: t('modules.mysql.tree.createMenu'),
    icon: 'plus',
    children: [
      {
        key: 'createDesign',
        label: t('modules.mysql.tree.create.tables'),
        icon: 'layout-list',
      },
      {
        key: 'createView',
        label: t('modules.mysql.tree.create.views'),
        icon: 'eye',
      },
      {
        key: 'createProcedure',
        label: t('modules.mysql.tree.create.procedures'),
        icon: 'workflow',
      },
      {
        key: 'createFunction',
        label: t('modules.mysql.tree.create.functions'),
        icon: 'square-function',
      },
    ],
  }
}

/** 库级工具：转储 / 执行 SQL / 备份还原面板（对齐 Navicat Dump/Execute SQL File、DBeaver Tools）。 */
function databaseToolsMenus(): RsContextMenuItem[] {
  return [
    {
      key: 'toolsMenu',
      label: t('modules.mysql.tree.toolsMenu'),
      icon: 'wrench',
      children: [
        {
          key: 'dumpSql',
          label: t('modules.mysql.tree.dumpSql'),
          icon: 'file-down',
        },
        {
          key: 'execSqlFile',
          label: t('modules.mysql.tree.execSqlFile'),
          icon: 'file-up',
        },
        { key: 'sep-backup', label: '', separator: true },
        {
          key: 'tools',
          label: t('modules.mysql.tree.openTools'),
          icon: 'archive',
        },
      ],
    },
  ]
}

function tableMenus(isView: boolean): RsContextMenuItem[] {
  return [
    {
      key: 'open',
      label: t(isView ? 'modules.mysql.tree.viewOpen' : 'modules.mysql.tree.tableOpen'),
      icon: isView ? 'eye' : 'table',
    },
    { key: 'sep-query', label: '', separator: true },
    { key: 'query', label: t('modules.mysql.tree.tableQuery'), icon: 'code-2' },
    {
      key: isView ? 'editView' : 'ddl',
      label: t(isView ? 'modules.mysql.tree.editView' : 'modules.mysql.tree.tableDdl'),
      icon: 'file-code',
    },
    ...(!isView
      ? ([
          { key: 'design', label: t('modules.mysql.tree.design'), icon: 'layout-list' },
        ] as RsContextMenuItem[])
      : []),
    scriptMenus(!isView),
    ...(!isView
      ? ([
          {
            key: 'maintenance',
            label: t('modules.mysql.tree.maintenance'),
            icon: 'wrench',
            children: [
              { key: 'analyze', label: t('modules.mysql.tree.analyze'), icon: 'activity' },
              { key: 'optimize', label: t('modules.mysql.tree.optimize'), icon: 'zap' },
              { key: 'check', label: t('modules.mysql.tree.check'), icon: 'shield-check' },
              { key: 'repair', label: t('modules.mysql.tree.repair'), icon: 'wrench' },
            ],
          },
        ] as RsContextMenuItem[])
      : []),
    ...dataIoMenus(isView),
    { key: 'sep-mutate', label: '', separator: true },
    ...(!isView
      ? ([
          { key: 'rename', label: t('modules.mysql.tree.rename'), icon: 'pencil' },
          {
            key: 'truncate',
            label: t('modules.mysql.tree.truncate'),
            icon: 'eraser',
            danger: true,
          },
        ] as RsContextMenuItem[])
      : []),
    {
      key: 'drop',
      label: t(isView ? 'modules.mysql.tree.dropView' : 'modules.mysql.tree.dropTable'),
      icon: 'trash-2',
      danger: true,
    },
    { key: 'sep-clipboard', label: '', separator: true },
    { key: 'copyName', label: t('modules.mysql.tree.copyName'), icon: 'copy' },
    {
      key: 'copyQualified',
      label: t('modules.mysql.tree.copyQualified'),
      icon: 'clipboard-copy',
    },
    { key: 'copyDdl', label: t('modules.mysql.tree.copyDdl'), icon: 'clipboard' },
  ]
}

function routineMenus(isFunction: boolean): RsContextMenuItem[] {
  return [
    {
      key: 'call',
      label: t(isFunction ? 'modules.mysql.tree.funcCall' : 'modules.mysql.tree.procCall'),
      icon: 'play',
    },
    {
      key: 'source',
      label: t('modules.mysql.tree.editSource'),
      icon: 'file-code',
    },
    { key: 'sep-io', label: '', separator: true },
    {
      key: 'dumpSql',
      label: t('modules.mysql.tree.dumpSql'),
      icon: 'file-down',
    },
    { key: 'sep-mutate', label: '', separator: true },
    {
      key: 'drop',
      label: t(isFunction ? 'modules.mysql.tree.dropFunc' : 'modules.mysql.tree.dropProc'),
      icon: 'trash-2',
      danger: true,
    },
    { key: 'sep-clipboard', label: '', separator: true },
    { key: 'copyName', label: t('modules.mysql.tree.copyName'), icon: 'copy' },
    {
      key: 'copyQualified',
      label: t('modules.mysql.tree.copyQualified'),
      icon: 'clipboard-copy',
    },
    { key: 'copyDdl', label: t('modules.mysql.tree.copyDdl'), icon: 'clipboard' },
  ]
}

export const mysqlConnTreeProvider: ConnTreeChildProvider = {
  canExpand() {
    return true
  },

  async loadChildren(conn, parentPath) {
    if (parentPath) {
      const leaf = lastSegment(parentPath)
      if (leaf && (leaf.kind === 'table' || leaf.kind === 'routine' || leaf.kind === 'hint')) {
        return []
      }
    }

    const database = segmentName(parentPath, 'database')
    const category = segmentName(parentPath, 'category')

    if (database && isCategoryId(category)) {
      try {
        return await loadCategoryChildren(conn, database, category)
      } catch {
        return []
      }
    }

    if (database) {
      return loadDatabaseCategories(conn, database)
    }

    try {
      const result = await mysqlApi.treeDatabases({ profileId: conn.profileId })
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
      { key: 'createDatabase', label: t('modules.mysql.tree.createDatabase'), icon: 'database' },
      { key: 'monitor', label: t('modules.mysql.tree.connMonitor'), icon: 'activity' },
      { key: 'tools', label: t('modules.mysql.tree.openTools'), icon: 'archive' },
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
      // 对齐 Navicat / DBeaver 库节点常用集；不含 Vastbase 的 Owner/Rename/Schema/Grant。
      // 壳层会追加「刷新」。
      const protectedDb = isProtectedDatabase(last.name)
      return [
        { key: 'query', label: t('modules.mysql.tree.dbQuery'), icon: 'code-2' },
        databaseCreateMenus(),
        ...databaseToolsMenus(),
        ...(!protectedDb
          ? ([
              { key: 'sep-mutate', label: '', separator: true },
              {
                key: 'drop',
                label: t('modules.mysql.tree.dropDatabase'),
                icon: 'trash-2',
                danger: true,
              },
            ] as RsContextMenuItem[])
          : []),
        { key: 'sep-clipboard', label: '', separator: true },
        { key: 'copyName', label: t('modules.mysql.tree.copyName'), icon: 'copy' },
        {
          key: 'copyCreateDdl',
          label: t('modules.mysql.tree.copyCreateDdl'),
          icon: 'clipboard',
        },
      ]
    }

    if (last.kind === 'category' && isCategoryId(last.name)) {
      // 表/视图/过程/函数：各一条「新建…」；表统一走设计器（不再并列「用设计器新建表」）。
      return [
        {
          key: 'create',
          label: t(`modules.mysql.tree.create.${last.name}`),
          icon: last.name === 'tables' ? 'layout-list' : 'plus',
        },
        { key: 'sep-query', label: '', separator: true },
        { key: 'query', label: t('modules.mysql.tree.dbQuery'), icon: 'code-2' },
        // 表/视图/过程/函数分类：整类转储（对齐 Navicat 在对象组上 Dump SQL）
        { key: 'sep-io', label: '', separator: true },
        {
          key: 'dumpSql',
          label: t('modules.mysql.tree.dumpSql'),
          icon: 'file-down',
        },
      ]
    }

    if (last.kind === 'table' || segmentName(path, 'table')) {
      return tableMenus(segmentName(path, 'category') === 'views')
    }

    if (last.kind === 'routine' || segmentName(path, 'routine')) {
      return routineMenus(segmentName(path, 'category') === 'functions')
    }

    return []
  },

  onResourceMenuSelect(conn: ConnItem, path: ConnResourcePath, key: string): void {
    void loadActions().then((m) => m.onResourceMenuSelect(conn, path, key))
  },
}
