import type { RsContextMenuItem } from '@niuma/ui'
import { oracleApi } from '@/api/oracle'
import { i18n } from '@/locale'
import {
  activate,
  onResourceMenuSelect as handleResourceMenuSelect,
  openCreate,
  openCreateTableDesign,
  openMonitor,
  openQuery,
} from '@/modules/oracle/conn-tree-actions'
import { isObjectCategory } from '@/modules/oracle/types/object-script'
import type { ConnTreeChildProvider } from '@/modules/ops/conn-tree/registry'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'

type Category = 'tables' | 'views' | 'procedures' | 'functions' | 'packages' | 'sequences'

const categories: Array<{ id: Category; key: string; icon: string }> = [
  { id: 'tables', key: 'tables', icon: 'table' },
  { id: 'views', key: 'views', icon: 'eye' },
  { id: 'procedures', key: 'procedures', icon: 'workflow' },
  { id: 'functions', key: 'functions', icon: 'square-function' },
  { id: 'packages', key: 'packages', icon: 'package' },
  { id: 'sequences', key: 'sequences', icon: 'list-ordered' },
]

const segment = (path: ConnResourcePath | undefined, kind: string) =>
  path?.segments.find((item) => item.kind === kind)?.name
const label = (key: string) => i18n.global.t(`modules.oracle.tree.${key}`)

function objectIcon(category: Category): string {
  if (category === 'views') return 'eye'
  if (category === 'sequences') return 'list-ordered'
  if (category === 'procedures') return 'workflow'
  if (category === 'functions') return 'square-function'
  if (category === 'packages') return 'package'
  return 'table'
}

function isTableLike(path: ConnResourcePath | undefined): boolean {
  const category = segment(path, 'category')
  return Boolean(segment(path, 'table') && (category === 'tables' || category === 'views'))
}

function tableMenus(isView: boolean): RsContextMenuItem[] {
  return [
    { key: 'open', label: label('openBrowse'), icon: 'table' },
    { key: 'query', label: label('openQuery'), icon: 'code-2' },
    { key: 'ddl', label: label('openDdl'), icon: 'file-code' },
    ...(!isView
      ? ([
          { key: 'design', label: label('design'), icon: 'layout-list' },
          { key: 'exportCsv', label: label('exportCsv'), icon: 'download' },
          { key: 'importCsv', label: label('importCsv'), icon: 'upload' },
          { key: 'dumpSql', label: label('dumpSql'), icon: 'file-down' },
        ] as RsContextMenuItem[])
      : [{ key: 'editView', label: label('editView'), icon: 'file-pen' }]),
    { key: 'sep-clipboard', label: '', separator: true },
    { key: 'copyName', label: label('copyName'), icon: 'copy' },
    { key: 'copyQualified', label: label('copyQualified'), icon: 'clipboard-copy' },
  ]
}

export const oracleConnTreeProvider: ConnTreeChildProvider = {
  canExpand: () => true,
  async loadChildren(conn, parentPath) {
    const schema = segment(parentPath, 'schema')
    const category = segment(parentPath, 'category') as Category | undefined
    if (!schema) {
      try {
        const result = await oracleApi.treeSchemas({ profileId: conn.profileId, excludeSystem: true })
        return result.schemas.map((item) => ({
          path: { segments: [{ kind: 'schema', name: item.name }] },
          label: item.name, icon: 'database', collapsible: true,
        }))
      } catch { return [] }
    }
    if (!category) {
      return categories.map((item) => ({
        path: { segments: [{ kind: 'schema', name: schema }, { kind: 'category', name: item.id }] },
        label: label(item.key), icon: item.icon, collapsible: true,
      }))
    }
    try {
      let result
      if (category === 'tables' || category === 'views') {
        result = await oracleApi.treeTables({ profileId: conn.profileId, schema, types: [category === 'tables' ? 'table' : 'view'], limit: 2000 })
      } else if (category === 'sequences') {
        result = await oracleApi.treeSequences({ profileId: conn.profileId, schema, limit: 2000 })
      } else if (category === 'packages') {
        result = await oracleApi.treePackages({ profileId: conn.profileId, schema, limit: 2000 })
      } else {
        result = await oracleApi.treeRoutines({ profileId: conn.profileId, schema, types: [category === 'procedures' ? 'procedure' : 'function'], limit: 2000 })
      }
      const items = result.objects ?? result.tables ?? result.routines ?? result.packages ?? result.sequences ?? []
      return items.map((item) => {
        const leafKind = category === 'procedures' || category === 'functions' ? 'routine' : category === 'packages' ? 'package' : 'table'
        return {
          path: { segments: [{ kind: 'schema', name: schema }, { kind: 'category', name: category }, { kind: leafKind, name: item.name }] },
          label: item.name, icon: objectIcon(category), collapsible: false,
        }
      })
    } catch { return [] }
  },
  activate(conn, path) { activate(conn, path) },
  connMenuItems(): RsContextMenuItem[] {
    return [
      { key: 'query', label: label('openQuery'), icon: 'code-2' },
      { key: 'monitor', label: label('monitor'), icon: 'activity' },
    ]
  },
  onConnMenuSelect(conn, key) {
    if (key === 'query') {
      openQuery(conn)
      return true
    }
    if (key === 'monitor') {
      openMonitor(conn)
      return true
    }
    return false
  },
  resourceMenuItems(_conn, path): RsContextMenuItem[] {
    const items: RsContextMenuItem[] = []
    const schema = segment(path, 'schema')
    const category = segment(path, 'category')
    const table = segment(path, 'table')
    const routine = segment(path, 'routine')
    const pkg = segment(path, 'package')

    if (schema && !category) {
      items.push(
        { key: 'query', label: label('openQuery'), icon: 'code-2' },
        { key: 'dumpSql', label: label('dumpSql'), icon: 'file-down' },
        { key: 'execSqlFile', label: label('execSqlFile'), icon: 'file-up' },
      )
    } else if (schema && category && !table && !routine && !pkg) {
      if (category === 'tables') {
        items.push({ key: 'createTable', label: label('create.tables'), icon: 'plus' })
      }
      if (isObjectCategory(category)) {
        items.push({
          key: 'create',
          label: label(`create.${category}`),
          icon: 'plus',
        })
      }
      items.push({ key: 'query', label: label('openQuery'), icon: 'code-2' })
      if (category === 'tables' || category === 'views') {
        items.push({ key: 'dumpSql', label: label('dumpSql'), icon: 'file-down' })
      }
    } else if (isTableLike(path)) {
      items.push(...tableMenus(category === 'views'))
    } else if (isObjectCategory(category) && (routine || pkg || (category === 'views' && table))) {
      items.push({
        key: 'editSource',
        label: label(category === 'views' ? 'editView' : 'editSource'),
        icon: 'file-code',
      })
      items.push({ key: 'query', label: label('openQuery'), icon: 'code-2' })
    } else {
      items.push({ key: 'query', label: label('openQuery'), icon: 'code-2' })
    }

    items.push({ key: 'refresh', label: label('refresh'), icon: 'refresh-cw' })
    return items
  },
  onResourceMenuSelect(conn, path, key) {
    if (key === 'createTable') {
      const schema = segment(path, 'schema')
      if (schema) openCreateTableDesign(conn, schema)
      return
    }
    if (key === 'create') {
      openCreate(conn, path)
      return
    }
    void handleResourceMenuSelect(conn, path, key)
  },
}
