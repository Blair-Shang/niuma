/**
 * Oracle 连接树 Provider：
 * connection → schema → {Tables|Views|Procedures|Functions|Packages|Sequences} → object
 * 菜单结构对齐达梦 / Navicat 常用集（无 createSchema / synonym / trigger）。
 */
import type { RsContextMenuItem } from '@niuma/ui'
import { oracleApi } from '@/api/oracle'
import { i18n } from '@/locale'
import {
  activate,
  onResourceMenuSelect as handleResourceMenuSelect,
  openCreateObjectScript,
  openCreateSequence,
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

function isCategoryId(name: string | undefined): name is Category {
  return categories.some((item) => item.id === name)
}

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

function isRoutineLike(path: ConnResourcePath | undefined): boolean {
  const category = segment(path, 'category')
  return Boolean(
    (segment(path, 'routine') || segment(path, 'package')) &&
      (category === 'procedures' || category === 'functions' || category === 'packages'),
  )
}

function isSequenceLike(path: ConnResourcePath | undefined): boolean {
  return Boolean(segment(path, 'sequence') && segment(path, 'category') === 'sequences')
}

/** 生成脚本：对齐 Navicat / DBeaver Generate SQL。 */
function scriptMenus(allowMutating: boolean): RsContextMenuItem {
  const children: RsContextMenuItem[] = [
    { key: 'genSelect', label: label('genSelect'), icon: 'code-2' },
    { key: 'genCount', label: label('genCount'), icon: 'hash' },
  ]
  if (allowMutating) {
    children.push(
      { key: 'genInsert', label: label('genInsert'), icon: 'square-plus' },
      { key: 'genUpdate', label: label('genUpdate'), icon: 'pencil' },
      {
        key: 'genDelete',
        label: label('genDelete'),
        icon: 'trash-2',
        danger: true,
      },
    )
  }
  return {
    key: 'scripts',
    label: label('scripts'),
    icon: 'file-text',
    children,
  }
}

/**
 * 导入/导出：基表含导入；视图仅导出 CSV + 转储结构。
 * 对齐 DBeaver Export Data / Dump。
 */
function dataIoMenus(isView: boolean): RsContextMenuItem[] {
  const children: RsContextMenuItem[] = []
  if (!isView) {
    children.push({
      key: 'importCsv',
      label: label('importCsv'),
      icon: 'upload',
    })
  }
  children.push(
    {
      key: 'exportCsv',
      label: label('exportCsv'),
      icon: 'download',
    },
    {
      key: 'dumpSql',
      label: label('dumpSql'),
      icon: 'file-down',
    },
  )
  return [
    {
      key: 'dataIo',
      label: label('dataIo'),
      icon: 'arrow-left-right',
      children,
    },
  ]
}

/** Schema 级「新建」：对齐 Navicat New / DBeaver Create New。 */
function schemaCreateMenus(): RsContextMenuItem {
  return {
    key: 'createMenu',
    label: label('createMenu'),
    icon: 'plus',
    children: [
      { key: 'createTable', label: label('create.tables'), icon: 'layout-list' },
      { key: 'createView', label: label('create.views'), icon: 'eye' },
      { key: 'createProcedure', label: label('create.procedures'), icon: 'workflow' },
      { key: 'createFunction', label: label('create.functions'), icon: 'square-function' },
      { key: 'createPackage', label: label('create.packages'), icon: 'package' },
      { key: 'createSequence', label: label('create.sequences'), icon: 'list-ordered' },
    ],
  }
}

/** Schema 级工具：转储 / 执行 SQL 文件。 */
function schemaToolsMenus(): RsContextMenuItem[] {
  return [
    {
      key: 'toolsMenu',
      label: label('toolsMenu'),
      icon: 'wrench',
      children: [
        { key: 'dumpSql', label: label('dumpSql'), icon: 'file-down' },
        { key: 'execSqlFile', label: label('execSqlFile'), icon: 'file-up' },
      ],
    },
  ]
}

function tableMenus(isView: boolean): RsContextMenuItem[] {
  return [
    { key: 'open', label: label('openBrowse'), icon: isView ? 'eye' : 'table' },
    { key: 'sep-query', label: '', separator: true },
    { key: 'query', label: label('openQuery'), icon: 'code-2' },
    { key: 'ddl', label: label('openDdl'), icon: 'file-code' },
    ...(!isView
      ? ([{ key: 'design', label: label('design'), icon: 'layout-list' }] as RsContextMenuItem[])
      : [{ key: 'editView', label: label('editView'), icon: 'file-pen' }]),
    scriptMenus(!isView),
    ...dataIoMenus(isView),
    { key: 'sep-mutate', label: '', separator: true },
    { key: 'rename', label: label('rename'), icon: 'pencil' },
    ...(!isView
      ? ([{ key: 'truncate', label: label('truncate'), icon: 'eraser', danger: true }] as RsContextMenuItem[])
      : []),
    {
      key: 'drop',
      label: label(isView ? 'dropView' : 'dropTable'),
      icon: 'trash-2',
      danger: true,
    },
    { key: 'sep-clipboard', label: '', separator: true },
    { key: 'copyName', label: label('copyName'), icon: 'copy' },
    { key: 'copyQualified', label: label('copyQualified'), icon: 'clipboard-copy' },
    { key: 'copyDdl', label: label('copyDdl'), icon: 'clipboard' },
  ]
}

function routineMenus(isFunction: boolean): RsContextMenuItem[] {
  return [
    {
      key: 'call',
      label: label(isFunction ? 'funcCall' : 'procCall'),
      icon: 'play',
    },
    { key: 'source', label: label('editSource'), icon: 'file-pen' },
    { key: 'compileRoutine', label: label('compileRoutine'), icon: 'wrench' },
    { key: 'query', label: label('openQuery'), icon: 'code-2' },
    { key: 'sep-io', label: '', separator: true },
    { key: 'dumpSql', label: label('dumpSql'), icon: 'file-down' },
    { key: 'sep-mutate', label: '', separator: true },
    {
      key: 'drop',
      label: label(isFunction ? 'dropFunc' : 'dropProc'),
      icon: 'trash-2',
      danger: true,
    },
    { key: 'sep-clipboard', label: '', separator: true },
    { key: 'copyName', label: label('copyName'), icon: 'copy' },
    { key: 'copyQualified', label: label('copyQualified'), icon: 'clipboard-copy' },
    { key: 'copyDdl', label: label('copyDdl'), icon: 'clipboard' },
  ]
}

function packageCompileMenus(): RsContextMenuItem {
  return {
    key: 'compileMenu',
    label: label('compile'),
    icon: 'wrench',
    children: [
      { key: 'compilePackage', label: label('compilePackage'), icon: 'package' },
      { key: 'compilePackageBody', label: label('compilePackageBody'), icon: 'file-code' },
    ],
  }
}

function packageMenus(): RsContextMenuItem[] {
  return [
    { key: 'source', label: label('editSource'), icon: 'file-pen' },
    { key: 'query', label: label('openQuery'), icon: 'code-2' },
    packageCompileMenus(),
    { key: 'sep-io', label: '', separator: true },
    { key: 'dumpSql', label: label('dumpSql'), icon: 'file-down' },
    { key: 'sep-mutate', label: '', separator: true },
    { key: 'drop', label: label('dropPackage'), icon: 'trash-2', danger: true },
    { key: 'sep-clipboard', label: '', separator: true },
    { key: 'copyName', label: label('copyName'), icon: 'copy' },
    { key: 'copyQualified', label: label('copyQualified'), icon: 'clipboard-copy' },
    { key: 'copyDdl', label: label('copyDdl'), icon: 'clipboard' },
  ]
}

function sequenceScriptMenus(): RsContextMenuItem {
  return {
    key: 'scripts',
    label: label('scripts'),
    icon: 'file-text',
    children: [
      { key: 'genNextval', label: label('genNextval'), icon: 'list-ordered' },
      { key: 'genCurrval', label: label('genCurrval'), icon: 'hash' },
    ],
  }
}

function sequenceMenus(): RsContextMenuItem[] {
  return [
    { key: 'query', label: label('openQuery'), icon: 'code-2' },
    sequenceScriptMenus(),
    { key: 'sep-io', label: '', separator: true },
    { key: 'dumpSql', label: label('dumpSql'), icon: 'file-down' },
    { key: 'sep-mutate', label: '', separator: true },
    { key: 'rename', label: label('rename'), icon: 'pencil' },
    { key: 'drop', label: label('dropSequence'), icon: 'trash-2', danger: true },
    { key: 'sep-clipboard', label: '', separator: true },
    { key: 'copyName', label: label('copyName'), icon: 'copy' },
    { key: 'copyQualified', label: label('copyQualified'), icon: 'clipboard-copy' },
    { key: 'copyDdl', label: label('copyDdl'), icon: 'clipboard' },
  ]
}

function categorySupportsDump(category: Category): boolean {
  return (
    category === 'tables' ||
    category === 'views' ||
    category === 'procedures' ||
    category === 'functions'
  )
}

function categoryCreateKey(category: Category): string | null {
  if (category === 'tables') return 'createTable'
  if (category === 'sequences') return 'createSequence'
  if (category === 'views') return 'createView'
  if (category === 'procedures') return 'createProcedure'
  if (category === 'functions') return 'createFunction'
  if (category === 'packages') return 'createPackage'
  return null
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
          label: item.name,
          icon: 'database',
          collapsible: true,
        }))
      } catch {
        return []
      }
    }
    if (!category) {
      return categories.map((item) => ({
        path: {
          segments: [
            { kind: 'schema', name: schema },
            { kind: 'category', name: item.id },
          ],
        },
        label: label(item.key),
        icon: item.icon,
        collapsible: true,
      }))
    }
    if (!isCategoryId(category)) return []
    try {
      let result
      if (category === 'tables' || category === 'views') {
        result = await oracleApi.treeTables({
          profileId: conn.profileId,
          schema,
          types: [category === 'tables' ? 'table' : 'view'],
          limit: 2000,
        })
      } else if (category === 'sequences') {
        result = await oracleApi.treeSequences({ profileId: conn.profileId, schema, limit: 2000 })
      } else if (category === 'packages') {
        result = await oracleApi.treePackages({ profileId: conn.profileId, schema, limit: 2000 })
      } else {
        result = await oracleApi.treeRoutines({
          profileId: conn.profileId,
          schema,
          types: [category === 'procedures' ? 'procedure' : 'function'],
          limit: 2000,
        })
      }
      const items =
        result.objects ?? result.tables ?? result.routines ?? result.packages ?? result.sequences ?? []
      return items.map((item) => {
        const leafKind =
          category === 'procedures' || category === 'functions'
            ? 'routine'
            : category === 'packages'
              ? 'package'
              : category === 'sequences'
                ? 'sequence'
                : 'table'
        return {
          path: {
            segments: [
              { kind: 'schema', name: schema },
              { kind: 'category', name: category },
              { kind: leafKind, name: item.name },
            ],
          },
          label: item.name,
          icon: objectIcon(category),
          collapsible: false,
        }
      })
    } catch {
      return []
    }
  },

  activate(conn, path) {
    activate(conn, path)
  },

  connMenuItems(): RsContextMenuItem[] {
    return [
      { key: 'query', label: label('openQuery'), icon: 'code-2' },
      { key: 'monitor', label: label('openMonitor'), icon: 'activity' },
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
    const sequence = segment(path, 'sequence')

    if (schema && !category) {
      items.push(
        { key: 'query', label: label('openQuery'), icon: 'code-2' },
        schemaCreateMenus(),
        ...schemaToolsMenus(),
        { key: 'sep-clipboard', label: '', separator: true },
        { key: 'copyName', label: label('copyName'), icon: 'copy' },
        { key: 'copyQualified', label: label('copyQualified'), icon: 'clipboard-copy' },
      )
    } else if (
      schema &&
      category &&
      !table &&
      !routine &&
      !pkg &&
      !sequence &&
      isCategoryId(category)
    ) {
      const createKey = categoryCreateKey(category)
      if (createKey) {
        items.push({
          key: createKey,
          label: label(`create.${category}`),
          icon: category === 'tables' ? 'layout-list' : 'plus',
        })
      }
      const categoryExtras: RsContextMenuItem[] = [
        { key: 'sep-query', label: '', separator: true },
        { key: 'query', label: label('openQuery'), icon: 'code-2' },
      ]
      if (categorySupportsDump(category)) {
        categoryExtras.push(
          { key: 'sep-io', label: '', separator: true },
          { key: 'dumpSql', label: label('dumpSql'), icon: 'file-down' },
        )
      }
      items.push(...categoryExtras)
    } else if (isTableLike(path)) {
      items.push(...tableMenus(category === 'views'))
    } else if (isRoutineLike(path)) {
      if (category === 'procedures' || category === 'functions') {
        items.push(...routineMenus(category === 'functions'))
      } else if (category === 'packages') {
        items.push(...packageMenus())
      }
    } else if (isSequenceLike(path)) {
      items.push(...sequenceMenus())
    } else {
      items.push({ key: 'query', label: label('openQuery'), icon: 'code-2' })
    }

    // 壳层 OpsConnectionPanel 会追加 resource-refresh，勿再加 refresh
    return items
  },

  onResourceMenuSelect(conn, path, key) {
    const schema = segment(path, 'schema')
    if (!schema) {
      void handleResourceMenuSelect(conn, path, key)
      return
    }

    switch (key) {
      case 'createTable':
        openCreateTableDesign(conn, schema)
        return
      case 'createSequence':
        openCreateSequence(conn, schema)
        return
      case 'createView':
        openCreateObjectScript(conn, schema, 'views')
        return
      case 'createProcedure':
        openCreateObjectScript(conn, schema, 'procedures')
        return
      case 'createFunction':
        openCreateObjectScript(conn, schema, 'functions')
        return
      case 'createPackage':
        openCreateObjectScript(conn, schema, 'packages')
        return
      case 'create': {
        const category = segment(path, 'category')
        if (isObjectCategory(category)) {
          openCreateObjectScript(conn, schema, category)
        }
        return
      }
      default:
        void handleResourceMenuSelect(conn, path, key)
    }
  },
}
