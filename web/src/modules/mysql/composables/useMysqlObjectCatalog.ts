/**
 * MySQL 库对象一览：information_schema 状态网格。
 * 布局走公共 ObjectCatalogShell；列、RPC 与打开动作在本 composable。
 */
import {
  useRsToast,
  type RsContextMenuItem,
  type RsTableColumn,
} from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi, mysqlApi } from '@/api'
import type { MysqlObjectCatalogItem } from '@/api/types/mysql'
import type { ObjectCatalogShellLabels } from '@/modules/database'
import {
  categoryPath,
  isCategoryId,
  isProtectedDatabase,
  type CategoryId,
} from '@/modules/mysql/conn-tree-shared'
import { useMysqlDdlActionStore, type MysqlDdlAction } from '@/modules/mysql/stores/ddl-actions'
import {
  MYSQL_CREATE_OBJECT_PLACEHOLDERS,
  categoryToObjectKind,
  type MysqlObjectCategory,
} from '@/modules/mysql/types/object-script'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'

export interface MysqlObjectCatalogPaneProps {
  sessionId: string | null
  profileId?: string
  database?: string
  catalogCategory?: CategoryId
  sessionLabel?: string
  active: boolean
}

export type MysqlCatalogRow = MysqlObjectCatalogItem & { __rowKey: string }

const CATEGORY_TYPE: Record<CategoryId, string> = {
  tables: 'table',
  views: 'view',
  procedures: 'procedure',
  functions: 'function',
}

function normalizeCategory(raw: string | undefined): CategoryId {
  return isCategoryId(raw) ? raw : 'tables'
}

function formatBytes(n: number | null | undefined): string {
  if (n == null || n < 0) return ''
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) {
    const kb = n / 1024
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)}KB`
  }
  if (n < 1024 * 1024 * 1024) {
    const mb = n / (1024 * 1024)
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`
  }
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)}GB`
}

function formatCount(n: number | null | undefined): string {
  if (n == null) return ''
  return String(n)
}

function objectPath(database: string, category: CategoryId, name: string): ConnResourcePath {
  if (category === 'procedures' || category === 'functions') {
    return {
      segments: [
        { kind: 'database', name: database },
        { kind: 'category', name: category },
        { kind: 'routine', name },
      ],
    }
  }
  return {
    segments: [
      { kind: 'database', name: database },
      { kind: 'category', name: category },
      { kind: 'table', name },
    ],
  }
}

export function useMysqlObjectCatalog(props: MysqlObjectCatalogPaneProps) {
  const { t } = useI18n()
  const toast = useRsToast()
  const nav = useConnectionNavigation()

  const category = ref<CategoryId>(normalizeCategory(props.catalogCategory))
  const filterText = ref('')
  const createOpen = ref(false)
  const loading = ref(false)
  const items = ref<MysqlObjectCatalogItem[]>([])
  const truncated = ref(false)
  const selectedRowKeys = ref<string[]>([])
  const loaded = ref(false)
  let loadSeq = 0

  const scopeOk = computed(() => Boolean((props.sessionId || props.profileId) && props.database))
  const protectedDb = computed(() => isProtectedDatabase(props.database))

  const categoryTabs = computed(() =>
    (['tables', 'views', 'procedures', 'functions'] as const).map((id) => ({
      id,
      label: t(`modules.mysql.tree.cat${id.charAt(0).toUpperCase()}${id.slice(1)}`),
    })),
  )

  const rows = computed((): MysqlCatalogRow[] =>
    items.value.map((item) => ({ ...item, __rowKey: `${item.type}:${item.name}` })),
  )

  const filteredRows = computed((): MysqlCatalogRow[] => {
    const q = filterText.value.trim().toLowerCase()
    if (!q) return rows.value
    return rows.value.filter((row) => {
      const name = row.name.toLowerCase()
      const comment = (row.comment ?? '').toLowerCase()
      return name.includes(q) || comment.includes(q)
    })
  })

  const selectedRows = computed(() => {
    const keys = new Set(selectedRowKeys.value)
    return filteredRows.value.filter((row) => keys.has(row.__rowKey))
  })

  const singleRow = computed(() => (selectedRows.value.length === 1 ? selectedRows.value[0] : null))

  const columns = computed((): RsTableColumn<MysqlCatalogRow>[] => {
    if (category.value === 'procedures' || category.value === 'functions') {
      const cols: RsTableColumn<MysqlCatalogRow>[] = [
        { key: 'name', title: t('modules.mysql.catalog.colName'), minWidth: 180, sortable: true },
        { key: 'comment', title: t('modules.mysql.catalog.colComment'), minWidth: 160, sortable: true },
      ]
      if (category.value === 'functions') {
        cols.push({
          key: 'returns',
          title: t('modules.mysql.catalog.colReturns'),
          minWidth: 120,
          sortable: true,
        })
      }
      cols.push(
        { key: 'definer', title: t('modules.mysql.catalog.colDefiner'), minWidth: 140, sortable: true },
        { key: 'charset', title: t('modules.mysql.catalog.colCharset'), width: 100, sortable: true },
        { key: 'updatedAt', title: t('modules.mysql.catalog.colUpdated'), width: 160, sortable: true },
        { key: 'createdAt', title: t('modules.mysql.catalog.colCreated'), width: 160, sortable: true },
      )
      return cols
    }
    const cols: RsTableColumn<MysqlCatalogRow>[] = [
      { key: 'name', title: t('modules.mysql.catalog.colName'), minWidth: 160, sortable: true },
      { key: 'comment', title: t('modules.mysql.catalog.colComment'), minWidth: 160, sortable: true },
    ]
    if (category.value === 'tables') {
      cols.push(
        {
          key: 'rows',
          title: t('modules.mysql.catalog.colRows'),
          width: 88,
          align: 'right',
          sortable: true,
          formatter: (_value, row) => formatCount(row.rows),
        },
        {
          key: 'dataLength',
          title: t('modules.mysql.catalog.colDataLength'),
          width: 108,
          align: 'right',
          sortable: true,
          formatter: (_value, row) => formatBytes(row.dataLength),
        },
        {
          key: 'indexLength',
          title: t('modules.mysql.catalog.colIndexLength'),
          width: 108,
          align: 'right',
          sortable: true,
          formatter: (_value, row) => formatBytes(row.indexLength),
        },
        {
          key: 'autoIncrement',
          title: t('modules.mysql.catalog.colAutoIncrement'),
          width: 88,
          align: 'right',
          sortable: true,
          formatter: (_value, row) => formatCount(row.autoIncrement),
        },
        { key: 'engine', title: t('modules.mysql.catalog.colEngine'), width: 100, sortable: true },
      )
    }
    cols.push(
      { key: 'charset', title: t('modules.mysql.catalog.colCharset'), width: 100, sortable: true },
      { key: 'updatedAt', title: t('modules.mysql.catalog.colUpdated'), width: 160, sortable: true },
      { key: 'createdAt', title: t('modules.mysql.catalog.colCreated'), width: 160, sortable: true },
    )
    return cols
  })

  const shellLabels = computed((): ObjectCatalogShellLabels => ({
    toolbarLabel: t('modules.mysql.session.tabCatalog'),
    featureLabel: t('modules.mysql.session.tabCatalog'),
    query: t('modules.mysql.tree.dbQuery'),
    queryTooltip: t('modules.mysql.tree.dbQuery'),
    create: t('modules.mysql.tree.createMenu'),
    createTooltip: t('modules.mysql.tree.createMenu'),
    refresh: t('modules.mysql.catalog.refresh'),
    ddl: t('modules.mysql.catalog.ddl'),
    ddlTooltip: t('modules.mysql.catalog.ddlTooltip'),
    filterPlaceholder: t('modules.mysql.catalog.filterPlaceholder'),
    needDatabase: t('modules.mysql.catalog.needDatabase'),
    empty: t('modules.mysql.catalog.empty'),
    emptyFilter: t('modules.mysql.catalog.emptyFilter'),
  }))

  const statusMeta = computed(() =>
    t('modules.mysql.catalog.selectedSummary', {
      selected: selectedRowKeys.value.length,
      total: filteredRows.value.length,
    }),
  )

  const statusHint = computed(() => {
    if (truncated.value) return t('modules.mysql.tree.listTruncated', { limit: 2000 })
    if (category.value === 'tables') return t('modules.mysql.catalog.rowsEstimate')
    return ''
  })

  async function resolveConnItem(): Promise<ConnItem | null> {
    if (!props.profileId) return null
    const result = await connectionApi.get({ profileId: props.profileId })
    if (!result.profile) return null
    return { ...result.profile, kind: 'mysql' }
  }

  async function load(): Promise<void> {
    if (!scopeOk.value || !props.database) return
    const seq = ++loadSeq
    loading.value = true
    try {
      const result = await mysqlApi.metaObjectCatalog({
        sessionId: props.sessionId ?? undefined,
        profileId: props.profileId,
        database: props.database,
        types: [CATEGORY_TYPE[category.value]],
      })
      if (seq !== loadSeq) return
      items.value = result.items ?? []
      truncated.value = result.truncated === true
      selectedRowKeys.value = []
      loaded.value = true
    } catch (e) {
      if (seq !== loadSeq) return
      items.value = []
      truncated.value = false
      loaded.value = true
      toast.error(e instanceof Error ? e.message : t('modules.mysql.catalog.loadError'))
    } finally {
      if (seq === loadSeq) loading.value = false
    }
  }

  async function withConn(fn: (item: ConnItem, database: string) => void): Promise<void> {
    const database = props.database
    if (!database) return
    try {
      const item = await resolveConnItem()
      if (!item) throw new Error(t('modules.mysql.catalog.openFailed'))
      fn(item, database)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.mysql.catalog.openFailed'))
    }
  }

  function openQuery(): void {
    void withConn((item, database) => {
      nav.connect(item, {
        resourcePath: { segments: [{ kind: 'database', name: database }] },
        initialTab: 'query',
      })
    })
  }

  function openCreate(kind: CategoryId): void {
    createOpen.value = false
    void withConn((item, database) => {
      if (kind === 'tables') {
        nav.connect(item, {
          resourcePath: categoryPath(database, 'tables'),
          initialTab: 'design',
          designMode: 'create',
        })
        return
      }
      const objectCat = kind as MysqlObjectCategory
      const objectKind = categoryToObjectKind(objectCat)
      nav.connect(item, {
        resourcePath: objectPath(database, kind, MYSQL_CREATE_OBJECT_PLACEHOLDERS[objectCat]),
        initialTab: 'objectScript',
        designMode: 'create',
        objectKind,
      })
    })
  }

  function openRow(row: MysqlCatalogRow, feature: 'browse' | 'ddl' | 'design' | 'objectScript' | 'call' | 'query'): void {
    void withConn((item, database) => {
      const path = objectPath(database, category.value, row.name)
      if (feature === 'query') {
        nav.connect(item, { resourcePath: path, initialTab: 'query' })
        return
      }
      if (feature === 'objectScript') {
        const objectKind = categoryToObjectKind(
          category.value === 'tables' ? 'views' : (category.value as MysqlObjectCategory),
        )
        nav.connect(item, {
          resourcePath: path,
          initialTab: 'objectScript',
          designMode: 'alter',
          objectKind,
        })
        return
      }
      const callKind = category.value === 'functions' ? 'function' : 'procedure'
      nav.connect(item, {
        resourcePath: path,
        initialTab: feature,
        designMode: feature === 'design' ? 'alter' : undefined,
        objectKind: feature === 'call' ? callKind : undefined,
      })
    })
  }

  function onRowDblclick(row: MysqlCatalogRow): void {
    if (category.value === 'tables' || category.value === 'views') {
      openRow(row, 'browse')
      return
    }
    openRow(row, 'objectScript')
  }

  function openDdl(): void {
    const row = singleRow.value
    if (!row) return
    if (category.value === 'tables') {
      openRow(row, 'ddl')
      return
    }
    if (category.value === 'views') {
      openRow(row, 'objectScript')
      return
    }
    openRow(row, 'objectScript')
  }

  function requestDrop(row: MysqlCatalogRow): void {
    const database = props.database
    if (!database || protectedDb.value) return
    void withConn((item) => {
      let action: MysqlDdlAction = 'drop_table'
      let titleKey = 'modules.mysql.tree.dropTable'
      let descKey = 'modules.mysql.ddl.dropTableDesc'
      if (category.value === 'views') {
        action = 'drop_view'
        titleKey = 'modules.mysql.tree.dropView'
        descKey = 'modules.mysql.ddl.dropViewDesc'
      } else if (category.value === 'procedures') {
        action = 'drop_procedure'
        titleKey = 'modules.mysql.tree.dropProc'
        descKey = 'modules.mysql.ddl.dropProcDesc'
      } else if (category.value === 'functions') {
        action = 'drop_function'
        titleKey = 'modules.mysql.tree.dropFunc'
        descKey = 'modules.mysql.ddl.dropFuncDesc'
      }
      const path = objectPath(database, category.value, row.name)
      useMysqlDdlActionStore().request({
        conn: item,
        action,
        profileId: item.profileId,
        database,
        name: row.name,
        title: t(titleKey),
        description: t(descKey, { name: row.name }),
        kind: 'danger',
        refreshPath: categoryPath(database, category.value),
        refreshDeep: false,
        prunePaths: [path],
      })
    })
  }

  function dropLabelKey(): string {
    if (category.value === 'functions') return 'modules.mysql.tree.dropFunc'
    if (category.value === 'procedures') return 'modules.mysql.tree.dropProc'
    if (category.value === 'views') return 'modules.mysql.tree.dropView'
    return 'modules.mysql.tree.dropTable'
  }

  function contextMenuItems(row: MysqlCatalogRow | null): RsContextMenuItem[] {
    if (!row) return []
    const isView = category.value === 'views'
    const isRoutine = category.value === 'procedures' || category.value === 'functions'
    const items: RsContextMenuItem[] = isRoutine
      ? [
          { key: 'source', label: t('modules.mysql.tree.editSource'), icon: 'file-code' },
          {
            key: 'call',
            label: t(
              category.value === 'functions'
                ? 'modules.mysql.tree.funcCall'
                : 'modules.mysql.tree.procCall',
            ),
            icon: 'play',
          },
        ]
      : [
          {
            key: 'open',
            label: t(isView ? 'modules.mysql.tree.viewOpen' : 'modules.mysql.tree.tableOpen'),
            icon: isView ? 'eye' : 'table',
          },
        ]
    items.push({ key: 'query', label: t('modules.mysql.tree.tableQuery'), icon: 'code-2' })
    if (category.value === 'tables') {
      items.push(
        { key: 'design', label: t('modules.mysql.tree.design'), icon: 'layout-list' },
        { key: 'ddl', label: t('modules.mysql.tree.tableDdl'), icon: 'file-code' },
      )
    }
    if (isView) {
      items.push({ key: 'editView', label: t('modules.mysql.tree.editView'), icon: 'file-code' })
    }
    if (!protectedDb.value) {
      items.push(
        { key: 'sep-drop', label: '', separator: true },
        { key: 'drop', label: t(dropLabelKey()), icon: 'trash-2', danger: true },
      )
    }
    items.push(
      { key: 'sep-copy', label: '', separator: true },
      { key: 'copyName', label: t('modules.mysql.tree.copyName'), icon: 'copy' },
    )
    return items
  }

  function onContextMenuSelect(key: string, row: MysqlCatalogRow | null): void {
    if (!row) return
    if (key === 'open') {
      openRow(row, 'browse')
      return
    }
    if (key === 'query') {
      openRow(row, 'query')
      return
    }
    if (key === 'design') {
      openRow(row, 'design')
      return
    }
    if (key === 'ddl') {
      openRow(row, 'ddl')
      return
    }
    if (key === 'editView' || key === 'source') {
      openRow(row, 'objectScript')
      return
    }
    if (key === 'call') {
      openRow(row, 'call')
      return
    }
    if (key === 'drop') {
      requestDrop(row)
      return
    }
    if (key === 'copyName') {
      void navigator.clipboard.writeText(row.name).then(
        () => toast.success(t('modules.mysql.tree.copyOk')),
        () => toast.error(t('modules.mysql.tree.copyFailed')),
      )
    }
  }

  watch(
    () => props.catalogCategory,
    (next) => {
      category.value = normalizeCategory(next)
    },
  )

  watch(
    () => [props.sessionId, props.profileId, props.database, category.value, props.active] as const,
    () => {
      if (props.active && scopeOk.value) void load()
    },
    { immediate: true },
  )

  const ddlStore = useMysqlDdlActionStore()
  watch(
    () => ddlStore.pending,
    (next, prev) => {
      if (prev && !next && props.active && scopeOk.value) void load()
    },
  )

  return {
    t,
    category,
    filterText,
    createOpen,
    loading,
    scopeOk,
    loaded,
    protectedDb,
    categoryTabs,
    filteredRows,
    selectedRowKeys,
    columns,
    shellLabels,
    statusMeta,
    statusHint,
    canDdl: computed(() => singleRow.value != null),
    load,
    openQuery,
    openCreate,
    openDdl,
    onRowDblclick,
    contextMenuItems,
    onContextMenuSelect,
  }
}
