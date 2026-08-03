import type { ConnItem } from '@/modules/ops/types'
import type { ConnOpenContext } from '@/modules/ops/conn-tree/types'
import {
  buildConnectionTabTooltip,
  nextQueryTabIndex,
} from '@/modules/ops/connection-nav/utils'
import type { ConnectionNavStrategy, ConnectionNavTabSpec } from '@/modules/ops/connection-nav/types'
import type { WorkspaceTab } from '@/stores/tab'
import { useTabStore } from '@/stores/tab'
import { kindIcon } from '@/modules/ops/types'
import { i18n } from '@/locale'
import {
  normalizeSqliteFeature,
  sqlitePaneRegistry,
  type SqliteSessionTab,
} from '@/modules/sqlite/pane-registry'

type SqliteObjectKind = 'view' | 'trigger' | 'index'

function segmentName(ctx: ConnOpenContext | undefined, kind: string): string | undefined {
  return ctx?.resourcePath?.segments.find((s) => s.kind === kind)?.name
}

function featureLabel(tab: SqliteSessionTab): string {
  return i18n.global.t(sqlitePaneRegistry[tab].labelKey)
}

function resolveDesignMode(ctx?: ConnOpenContext): 'create' | 'alter' {
  return ctx?.designMode === 'create' ? 'create' : 'alter'
}

function resolveFeature(ctx?: ConnOpenContext): SqliteSessionTab {
  if (ctx?.initialTab) {
    return normalizeSqliteFeature(ctx.initialTab)
  }
  const category = segmentName(ctx, 'category')
  if (category === 'indexes' || category === 'triggers') return 'ddl'
  if (segmentName(ctx, 'table')) return 'browse'
  return 'query'
}

function resolveObjectKind(ctx?: ConnOpenContext): SqliteObjectKind | undefined {
  // 菜单显式传入优先（schema 级「新建视图/索引/触发器」路径无 category）
  const kind = ctx?.objectKind
  if (kind === 'view' || kind === 'trigger' || kind === 'index') return kind
  const category = segmentName(ctx, 'category')
  if (category === 'views') return 'view'
  if (category === 'triggers') return 'trigger'
  if (category === 'indexes') return 'index'
  return undefined
}

function resolveObjectType(ctx?: ConnOpenContext): string | undefined {
  const category = segmentName(ctx, 'category')
  if (category === 'indexes') return 'index'
  if (category === 'triggers') return 'trigger'
  if (category === 'views') return 'view'
  if (category === 'tables') return 'table'
  return undefined
}

function resolveObjectName(ctx?: ConnOpenContext): string | undefined {
  return segmentName(ctx, 'table') ?? segmentName(ctx, 'object')
}

function fileBaseName(item: ConnItem): string {
  const filePath: string =
    typeof item.hostAddress === 'string' && item.hostAddress.trim()
      ? item.hostAddress.trim()
      : item.profileName
  return filePath.split(/[/\\]/).pop() || item.profileName
}

function objectScriptFeatureLabel(
  objectKind: SqliteObjectKind | undefined,
  designMode: 'create' | 'alter',
): string {
  if (designMode === 'create') {
    if (objectKind === 'trigger') {
      return i18n.global.t('modules.sqlite.session.tabNewTrigger')
    }
    if (objectKind === 'index') {
      return i18n.global.t('modules.sqlite.session.tabNewIndex')
    }
    return i18n.global.t('modules.sqlite.session.tabNewView')
  }
  if (objectKind === 'trigger') {
    return i18n.global.t('modules.sqlite.session.tabTrigger')
  }
  if (objectKind === 'index') {
    return i18n.global.t('modules.sqlite.session.tabIndex')
  }
  return i18n.global.t('modules.sqlite.session.tabView')
}

function buildQueryTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const schema = segmentName(ctx, 'schema')

  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: 'query',
  }
  if (schema) props.schema = schema
  if (typeof ctx?.initialSql === 'string' && ctx.initialSql.trim()) {
    props.initialSql = ctx.initialSql
  }
  if (ctx?.autoRunInitialSql) {
    props.autoRunInitialSql = true
  }

  const baseName = fileBaseName(item)
  const queryIndex = nextQueryTabIndex(
    useTabStore().allTabs,
    'sqlite',
    item.profileId,
    (initialTab) =>
      normalizeSqliteFeature(typeof initialTab === 'string' ? initialTab : undefined) === 'query',
  )
  const queryTitle = i18n.global.t('modules.sqlite.session.tabQueryIndexed', { n: queryIndex })

  return {
    moduleId: 'sqlite',
    title: `${baseName} · ${queryTitle}`,
    tooltip: buildConnectionTabTooltip(
      item.profileName,
      item.hostAddress,
      schema || undefined,
      queryTitle,
    ),
    icon: kindIcon('sqlite'),
    props,
  }
}

function buildObjectScriptTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const schema = segmentName(ctx, 'schema')
  const objectKind = resolveObjectKind(ctx) ?? 'view'
  const designMode = resolveDesignMode(ctx)
  const objectName = resolveObjectName(ctx)
  const featureTitle = objectScriptFeatureLabel(objectKind, designMode)

  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: 'objectScript',
    designMode,
    objectKind,
    objectType: objectKind,
  }
  if (schema) props.schema = schema
  if (objectName) {
    props.table = objectName
    props.objectName = objectName
  }
  if (typeof ctx?.initialSql === 'string' && ctx.initialSql.trim()) {
    props.initialSql = ctx.initialSql
  }

  const resource =
    schema && objectName ? `${schema}.${objectName}` : schema || undefined
  // Tab 只显示对象名；完整 schema.对象放 tip（对齐 MySQL）
  const title = objectName || featureTitle

  return {
    moduleId: 'sqlite',
    title,
    tooltip: buildConnectionTabTooltip(
      item.profileName,
      item.hostAddress,
      resource,
      featureTitle,
    ),
    icon: kindIcon('sqlite'),
    props,
  }
}

function buildSqliteTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const feature = resolveFeature(ctx)
  if (feature === 'query') {
    return buildQueryTabSpec(item, ctx)
  }

  if (feature === 'objectScript') {
    return buildObjectScriptTabSpec(item, ctx)
  }

  const schema = segmentName(ctx, 'schema')
  const table = resolveObjectName(ctx)
  const category = segmentName(ctx, 'category')
  const objectType = resolveObjectType(ctx)
  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: feature,
  }
  if (schema) props.schema = schema
  if (table) props.table = table
  if (category === 'views') props.isView = true
  if (objectType) props.objectType = objectType
  if (typeof ctx?.initialSql === 'string' && ctx.initialSql.trim()) {
    props.initialSql = ctx.initialSql
  }

  if (feature === 'design') {
    const designMode = resolveDesignMode(ctx)
    props.designMode = designMode
    const designLabel = featureLabel('design')
    const resource = schema && table ? `${schema}.${table}` : schema || undefined
    return {
      moduleId: 'sqlite',
      title: table || designLabel,
      tooltip: buildConnectionTabTooltip(
        item.profileName,
        item.hostAddress,
        resource,
        designLabel,
      ),
      icon: kindIcon('sqlite'),
      props,
    }
  }

  const baseName = fileBaseName(item)
  const objectName = table
  let resource: string | undefined
  if (schema && objectName) {
    resource = `${schema}.${objectName}`
  } else if (schema) {
    resource = schema
  }
  const paneLabel = featureLabel(feature)
  // 表/视图/索引/触发器：Tab 只显示对象名；无对象时回退 schema 或文件名
  const title = objectName || schema || baseName

  return {
    moduleId: 'sqlite',
    title,
    tooltip: buildConnectionTabTooltip(
      item.profileName,
      item.hostAddress,
      resource,
      paneLabel,
    ),
    icon: kindIcon('sqlite'),
    props,
  }
}

/**
 * SQLite：query 可多开；browse/ddl/design/objectScript 按 profile+schema+table(+designMode) 去重。
 * Tab 标题策略对齐 MySQL：短标题（对象名），完整路径放 tooltip。
 */
export const sqliteConnectionNavStrategy: ConnectionNavStrategy = {
  kind: 'sqlite',
  dedupFocus: true,

  buildTabSpec: buildSqliteTabSpec,

  findExistingTab(tabs, _spec, item, ctx) {
    const feature = resolveFeature(ctx)
    if (feature === 'query') return undefined

    const schema = segmentName(ctx, 'schema')
    const table = resolveObjectName(ctx)
    const designMode = resolveDesignMode(ctx)
    const objectType = resolveObjectType(ctx)

    return tabs.find((tab: WorkspaceTab) => {
      if (tab.moduleId !== 'sqlite' || tab.props.profileId !== item.profileId) return false
      const tabFeature = normalizeSqliteFeature(
        typeof tab.props.initialTab === 'string' ? tab.props.initialTab : undefined,
      )
      if (tabFeature !== feature) return false
      const tabSchema = typeof tab.props.schema === 'string' ? tab.props.schema : undefined
      const tabTable = typeof tab.props.table === 'string' ? tab.props.table : undefined
      const tabObjectType =
        typeof tab.props.objectType === 'string' ? tab.props.objectType : undefined
      if (feature === 'design' || feature === 'objectScript') {
        const tabDesignMode =
          typeof tab.props.designMode === 'string' ? tab.props.designMode : 'alter'
        const tabObjectKind =
          typeof tab.props.objectKind === 'string' ? tab.props.objectKind : undefined
        const wantKind = resolveObjectKind(ctx)
        if (feature === 'objectScript') {
          return (
            tabSchema === schema &&
            tabTable === table &&
            tabDesignMode === designMode &&
            tabObjectKind === wantKind
          )
        }
        return tabSchema === schema && tabTable === table && tabDesignMode === designMode
      }
      // 索引/触发器与表名可能撞名，需用 objectType 区分
      if (objectType === 'index' || objectType === 'trigger') {
        return tabSchema === schema && tabTable === table && tabObjectType === objectType
      }
      return tabSchema === schema && tabTable === table
    })
  },
}
