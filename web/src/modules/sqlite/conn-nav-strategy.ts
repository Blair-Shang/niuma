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
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, undefined, queryTitle),
    icon: kindIcon('sqlite'),
    props,
  }
}

function buildSqliteTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const feature = resolveFeature(ctx)
  if (feature === 'query') {
    return buildQueryTabSpec(item, ctx)
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
    const baseName = fileBaseName(item)
    const baseTitle =
      designMode === 'create'
        ? schema || baseName
        : schema && table
          ? `${schema}.${table}`
          : schema || baseName
    return {
      moduleId: 'sqlite',
      title: `${baseTitle} · ${featureLabel('design')}`,
      tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress),
      icon: kindIcon('sqlite'),
      props,
    }
  }

  const baseName = fileBaseName(item)
  const baseTitle = schema && table ? `${schema}.${table}` : schema || baseName

  return {
    moduleId: 'sqlite',
    title: `${baseTitle} · ${featureLabel(feature)}`,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress),
    icon: kindIcon('sqlite'),
    props,
  }
}

/**
 * SQLite：query 可多开；browse/ddl/design 按 profile+schema+table(+designMode) 去重。
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
      if (feature === 'design') {
        const tabDesignMode =
          typeof tab.props.designMode === 'string' ? tab.props.designMode : 'alter'
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
