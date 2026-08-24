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
  normalizeDamengFeature,
  damengPaneRegistry,
  type DamengSessionTab,
} from '@/modules/dameng/pane-registry'
import {
  categoryToObjectKind,
  isObjectCategory,
  isRoutineObjectKind,
  objectKindIcon,
  type DamengObjectKind,
  type DamengObjectScriptMode,
} from '@/modules/dameng/types/object-script'

function segmentName(ctx: ConnOpenContext | undefined, kind: string): string | undefined {
  return ctx?.resourcePath?.segments.find((s) => s.kind === kind)?.name
}

function featureLabel(tab: DamengSessionTab): string {
  return i18n.global.t(damengPaneRegistry[tab].labelKey)
}

function resolveDesignMode(ctx?: ConnOpenContext): DamengObjectScriptMode {
  return ctx?.designMode === 'create' ? 'create' : 'alter'
}

const OBJECT_KINDS: DamengObjectKind[] = [
  'view',
  'procedure',
  'function',
  'package',
  'trigger',
  'synonym',
  'sequence',
]

function isDamengObjectKind(v: unknown): v is DamengObjectKind {
  return typeof v === 'string' && (OBJECT_KINDS as string[]).includes(v)
}

function resolveObjectKind(ctx?: ConnOpenContext): DamengObjectKind | undefined {
  if (isDamengObjectKind(ctx?.objectKind)) return ctx.objectKind
  const category = segmentName(ctx, 'category')
  if (isObjectCategory(category)) return categoryToObjectKind(category)
  if (segmentName(ctx, 'sequence')) return 'sequence'
  if (segmentName(ctx, 'routine')) return 'procedure'
  return undefined
}

function resolveObjectName(ctx?: ConnOpenContext, objectKind?: DamengObjectKind): string | undefined {
  if (objectKind === 'sequence') {
    return segmentName(ctx, 'sequence') ?? segmentName(ctx, 'routine') ?? segmentName(ctx, 'table')
  }
  if (objectKind && isRoutineObjectKind(objectKind)) {
    return segmentName(ctx, 'routine') ?? segmentName(ctx, 'table')
  }
  return segmentName(ctx, 'table') ?? segmentName(ctx, 'routine') ?? segmentName(ctx, 'sequence')
}

function objectScriptFeatureLabel(
  objectKind: DamengObjectKind,
  designMode: DamengObjectScriptMode,
): string {
  const key =
    designMode === 'create'
      ? ({
          view: 'tabNewView',
          procedure: 'tabNewProcedure',
          function: 'tabNewFunction',
          package: 'tabNewPackage',
          trigger: 'tabNewTrigger',
          synonym: 'tabNewSynonym',
          sequence: 'tabNewSequence',
        } as const)[objectKind]
      : ({
          view: 'tabView',
          procedure: 'tabProcedure',
          function: 'tabFunction',
          package: 'tabPackage',
          trigger: 'tabTrigger',
          synonym: 'tabSynonym',
          sequence: 'tabSequence',
        } as const)[objectKind]
  return i18n.global.t(`modules.dameng.session.${key}`)
}

function resolveFeature(ctx?: ConnOpenContext): DamengSessionTab {
  if (ctx?.initialTab) {
    return normalizeDamengFeature(ctx.initialTab)
  }
  if (segmentName(ctx, 'routine')) return 'objectScript'
  const category = segmentName(ctx, 'category')
  if (category === 'views' && segmentName(ctx, 'table') && ctx?.designMode) {
    return 'objectScript'
  }
  if (segmentName(ctx, 'sequence') && ctx?.designMode) {
    return 'objectScript'
  }
  // 序列无 Browse；表/视图默认 Browse
  if (segmentName(ctx, 'sequence') || category === 'sequences') return 'query'
  if (segmentName(ctx, 'table')) return 'browse'
  return 'query'
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

  const queryIndex = nextQueryTabIndex(
    useTabStore().allTabs,
    'dameng',
    item.profileId,
    (initialTab) =>
      normalizeDamengFeature(typeof initialTab === 'string' ? initialTab : undefined) === 'query',
  )
  const queryTitle = i18n.global.t('modules.dameng.session.tabQueryIndexed', { n: queryIndex })
  const host = item.hostAddress || item.profileName

  return {
    moduleId: 'dameng',
    title: `${schema || host} · ${queryTitle}`,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, undefined, queryTitle),
    icon: kindIcon('dameng'),
    props,
  }
}

function buildObjectScriptTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const schema = segmentName(ctx, 'schema')
  const objectKind = resolveObjectKind(ctx) ?? 'view'
  const designMode = resolveDesignMode(ctx)
  const objectName = resolveObjectName(ctx, objectKind)
  const featureTitle = objectScriptFeatureLabel(objectKind, designMode)

  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: 'objectScript',
    objectKind,
    designMode,
  }
  if (schema) props.schema = schema
  if (objectName) props.objectName = objectName
  if (objectKind === 'view' && objectName) {
    props.table = objectName
    props.isView = true
  }
  if (isRoutineObjectKind(objectKind) && objectName) {
    props.routine = objectName
    props.routineKind = objectKind
  }
  if (objectKind === 'sequence' && objectName) {
    props.sequence = objectName
  }
  if (typeof ctx?.initialSql === 'string' && ctx.initialSql.trim()) {
    props.initialSql = ctx.initialSql
  }

  // Tab 只显示对象名；完整 schema.对象放 tip（对齐 MySQL）
  const title = objectName || featureTitle
  const resource =
    schema && objectName ? `${schema}.${objectName}` : schema || undefined

  return {
    moduleId: 'dameng',
    title,
    tooltip: buildConnectionTabTooltip(
      item.profileName,
      item.hostAddress,
      resource,
      featureTitle,
    ),
    icon: objectKindIcon(objectKind),
    props,
  }
}

function buildCallTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const schema = segmentName(ctx, 'schema')
  const objectKind = resolveObjectKind(ctx)
  const routineKind =
    objectKind === 'function' || ctx?.objectKind === 'function' ? 'function' : 'procedure'
  const routine =
    resolveObjectName(ctx, routineKind) ?? segmentName(ctx, 'routine')
  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: 'call',
    routineKind,
  }
  if (schema) props.schema = schema
  if (routine) {
    props.routine = routine
    props.objectName = routine
    props.objectKind = routineKind
  }

  const resource =
    schema && routine ? `${schema}.${routine}` : schema || undefined
  const paneLabel = featureLabel('call')

  return {
    moduleId: 'dameng',
    title: routine ? `${routine} · ${paneLabel}` : paneLabel,
    tooltip: buildConnectionTabTooltip(
      item.profileName,
      item.hostAddress,
      resource,
      paneLabel,
    ),
    icon: 'bug',
    props,
  }
}

function buildDamengTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const feature = resolveFeature(ctx)
  if (feature === 'query') return buildQueryTabSpec(item, ctx)
  if (feature === 'objectScript') return buildObjectScriptTabSpec(item, ctx)
  if (feature === 'call') return buildCallTabSpec(item, ctx)

  if (feature === 'monitor') {
    return {
      moduleId: 'dameng',
      title: `${item.hostAddress || item.profileName} · ${featureLabel('monitor')}`,
      tooltip: buildConnectionTabTooltip(
        item.profileName,
        item.hostAddress,
        undefined,
        featureLabel('monitor'),
      ),
      icon: kindIcon('dameng'),
      props: {
        profileId: item.profileId,
        initialTab: 'monitor',
      },
    }
  }

  if (feature === 'design') {
    const schema = segmentName(ctx, 'schema')
    const table = segmentName(ctx, 'table')
    const designMode = resolveDesignMode(ctx)
    const host = item.hostAddress || item.profileName
    const baseTitle = schema && table ? `${schema}.${table}` : schema || host
    const props: Record<string, unknown> = {
      profileId: item.profileId,
      initialTab: 'design',
      designMode,
    }
    if (schema) props.schema = schema
    if (table) props.table = table
    return {
      moduleId: 'dameng',
      title: `${baseTitle} · ${featureLabel('design')}`,
      tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress),
      icon: kindIcon('dameng'),
      props,
    }
  }

  const schema = segmentName(ctx, 'schema')
  const table = segmentName(ctx, 'table')
  const category = segmentName(ctx, 'category')
  const props: Record<string, unknown> = {
    profileId: item.profileId,
    initialTab: feature,
  }
  if (schema) props.schema = schema
  if (table) props.table = table
  if (category === 'views') props.isView = true
  if (typeof ctx?.initialSql === 'string' && ctx.initialSql.trim()) {
    props.initialSql = ctx.initialSql
  }

  const host = item.hostAddress || item.profileName
  const baseTitle = schema && table ? `${schema}.${table}` : schema || host

  return {
    moduleId: 'dameng',
    title: `${baseTitle} · ${featureLabel(feature)}`,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress),
    icon: kindIcon('dameng'),
    props,
  }
}

/**
 * Dameng：query 可多开；browse/ddl/objectScript/monitor/design/call 按 profile+资源+feature 去重。
 */
export const damengConnectionNavStrategy: ConnectionNavStrategy = {
  kind: 'dameng',
  dedupFocus: true,

  buildTabSpec: buildDamengTabSpec,

  findExistingTab(tabs, _spec, item, ctx) {
    const feature = resolveFeature(ctx)
    if (feature === 'query') return undefined

    const schema = segmentName(ctx, 'schema')

    return tabs.find((tab: WorkspaceTab) => {
      if (tab.moduleId !== 'dameng' || tab.props.profileId !== item.profileId) return false
      const tabFeature = normalizeDamengFeature(
        typeof tab.props.initialTab === 'string' ? tab.props.initialTab : undefined,
      )
      if (tabFeature !== feature) return false
      if (feature === 'monitor') return true

      const tabSchema = typeof tab.props.schema === 'string' ? tab.props.schema : undefined
      if (tabSchema !== schema) return false

      if (feature === 'design') {
        const table = segmentName(ctx, 'table')
        const designMode = resolveDesignMode(ctx)
        const tabTable = typeof tab.props.table === 'string' ? tab.props.table : undefined
        const tabMode = tab.props.designMode === 'create' ? 'create' : 'alter'
        return tabTable === table && tabMode === designMode
      }

      if (feature === 'objectScript') {
        const objectKind = resolveObjectKind(ctx) ?? 'view'
        const objectName = resolveObjectName(ctx, objectKind)
        const designMode = resolveDesignMode(ctx)
        const tabKind = tab.props.objectKind
        const tabName =
          (typeof tab.props.objectName === 'string' && tab.props.objectName) ||
          (typeof tab.props.routine === 'string' && tab.props.routine) ||
          (typeof tab.props.sequence === 'string' && tab.props.sequence) ||
          (typeof tab.props.table === 'string' && tab.props.table) ||
          undefined
        const tabMode = tab.props.designMode === 'create' ? 'create' : 'alter'
        return tabKind === objectKind && tabName === objectName && tabMode === designMode
      }

      if (feature === 'call') {
        // 同一过程/函数只开一个调用页；不同对象各自独立
        const objectKind = resolveObjectKind(ctx)
        const routineKind =
          objectKind === 'function' || ctx?.objectKind === 'function' ? 'function' : 'procedure'
        const routine =
          resolveObjectName(ctx, routineKind) ?? segmentName(ctx, 'routine')
        const tabRoutine =
          (typeof tab.props.routine === 'string' && tab.props.routine) ||
          (typeof tab.props.objectName === 'string' && tab.props.objectName) ||
          undefined
        const tabKind =
          tab.props.routineKind === 'function' || tab.props.objectKind === 'function'
            ? 'function'
            : 'procedure'
        return tabRoutine === routine && tabKind === routineKind
      }

      const table = segmentName(ctx, 'table')
      const tabTable = typeof tab.props.table === 'string' ? tab.props.table : undefined
      return tabTable === table
    })
  },
}
