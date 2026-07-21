/**
 * MySQL 连接树 Provider：
 * connection → database → {Tables|Views|Procedures|Functions} → object
 * （对齐 Navicat / DBeaver；无独立 schema 层）。
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
  databaseCategoryNodes,
  isCategoryId,
  isProtectedDatabase,
  lastSegment,
  loadCategoryChildren,
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

const CONN_MENU_KEYS = new Set(['createDatabase', 'query', 'monitor'])


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
    { key: 'sep-io', label: '', separator: true },
    { key: 'exportCsv', label: t('modules.mysql.tree.exportCsv'), icon: 'download' },
    ...(!isView ? ([{ key: 'importCsv', label: t('modules.mysql.tree.importCsv'), icon: 'upload' }] as RsContextMenuItem[]) : []),
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
      label: t(isFunction ? 'modules.mysql.tree.funcOpen' : 'modules.mysql.tree.procOpen'),
      icon: 'file-code',
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
      return databaseCategoryNodes(database)
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
      { key: 'sep-query', label: '', separator: true },
      { key: 'query', label: t('modules.mysql.tree.connQuery'), icon: 'code-2' },
      { key: 'monitor', label: t('modules.mysql.tree.connMonitor'), icon: 'activity' },
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
        { key: 'query', label: t('modules.mysql.tree.dbQuery'), icon: 'code-2' },
        { key: 'sep-io', label: '', separator: true },
        { key: 'dumpSql', label: t('modules.mysql.tree.dumpSql'), icon: 'archive' },
        { key: 'execSqlFile', label: t('modules.mysql.tree.execSqlFile'), icon: 'play-circle' },
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
      ]
    }

    if (last.kind === 'category' && isCategoryId(last.name)) {
      const isTables = last.name === 'tables'
      return [
        {
          key: 'create',
          label: t(`modules.mysql.tree.create.${last.name}`),
          icon: 'plus',
        },
        ...(isTables ? ([{ key: 'createDesign', label: t('modules.mysql.tree.createDesign'), icon: 'layout-list' }] as RsContextMenuItem[]) : []),
        { key: 'sep-query', label: '', separator: true },
        { key: 'query', label: t('modules.mysql.tree.dbQuery'), icon: 'code-2' },
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
