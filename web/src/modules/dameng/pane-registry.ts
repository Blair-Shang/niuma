/**
 * Dameng Session 功能面板：query / browse / ddl / objectScript / monitor / design / debug。
 */
import type { DamengObjectKind, DamengObjectScriptMode } from '@/modules/dameng/types/object-script'

export type DamengSessionTab =
  | 'query'
  | 'browse'
  | 'ddl'
  | 'objectScript'
  | 'monitor'
  | 'design'
  | 'debug'

export interface DamengPaneScope {
  schema?: string
  table?: string
  isView?: boolean
  designMode?: DamengObjectScriptMode | 'create' | 'alter'
  objectKind?: DamengObjectKind
  objectName?: string
  routine?: string
  routineKind?: DamengObjectKind
  draftSql?: string
}

export interface DamengPaneContext extends DamengPaneScope {
  sessionId: string | null
  profileId?: string
  initialSql?: string
  tabId?: string
  autoRunInitialSql?: boolean
  sessionLabel?: string
}

export interface DamengPaneDescriptor {
  loader: () => Promise<{ default: import('vue').Component }>
  buildProps: (ctx: DamengPaneContext) => Record<string, unknown>
}

export interface DamengFeatureDef {
  icon: string
  labelKey: string
  resolvePane: (scope: DamengPaneScope) => DamengPaneDescriptor
}

function queryProps(ctx: DamengPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    schema: ctx.schema,
    initialSql: ctx.initialSql,
    draftSql: ctx.draftSql,
    tabId: ctx.tabId,
    autoRunInitialSql: ctx.autoRunInitialSql === true,
    sessionLabel: ctx.sessionLabel,
  }
}

function relationProps(ctx: DamengPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    schema: ctx.schema,
    table: ctx.table,
    isView: ctx.isView === true,
    sessionLabel: ctx.sessionLabel,
  }
}

function monitorProps(ctx: DamengPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    sessionLabel: ctx.sessionLabel,
  }
}

function designProps(ctx: DamengPaneContext): Record<string, unknown> {
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    schema: ctx.schema ?? '',
    table: ctx.table,
    designMode: ctx.designMode === 'create' ? 'create' : 'alter',
    sessionLabel: ctx.sessionLabel,
  }
}

function debugProps(ctx: DamengPaneContext): Record<string, unknown> {
  const routineKind =
    ctx.routineKind === 'function' || ctx.objectKind === 'function' ? 'function' : 'procedure'
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    schema: ctx.schema,
    routine: ctx.routine ?? ctx.objectName,
    routineKind,
    sessionLabel: ctx.sessionLabel,
  }
}

function resolveObjectKind(scope: DamengPaneScope): DamengObjectKind {
  const kinds = new Set<DamengObjectKind>([
    'view',
    'procedure',
    'function',
    'package',
    'trigger',
    'synonym',
    'sequence',
  ])
  if (scope.objectKind && kinds.has(scope.objectKind)) {
    return scope.objectKind
  }
  if (scope.routineKind && kinds.has(scope.routineKind)) {
    return scope.routineKind
  }
  if (scope.isView) return 'view'
  return 'view'
}

function resolveObjectName(scope: DamengPaneScope): string | undefined {
  return scope.objectName || scope.routine || scope.table
}

function objectScriptProps(ctx: DamengPaneContext): Record<string, unknown> {
  const objectKind = resolveObjectKind(ctx)
  const objectName = resolveObjectName(ctx)
  return {
    sessionId: ctx.sessionId,
    profileId: ctx.profileId,
    schema: ctx.schema,
    objectKind,
    objectName,
    designMode: ctx.designMode === 'create' ? 'create' : 'alter',
    initialSql: ctx.initialSql,
    draftSql: ctx.draftSql,
    tabId: ctx.tabId,
    sessionLabel: ctx.sessionLabel,
  }
}

export const damengPaneRegistry: Record<DamengSessionTab, DamengFeatureDef> = {
  query: {
    icon: 'code-2',
    labelKey: 'modules.dameng.session.tabQuery',
    resolvePane: () => ({
      loader: () => import('@/modules/dameng/components/DamengQueryPane.vue'),
      buildProps: queryProps,
    }),
  },
  browse: {
    icon: 'table',
    labelKey: 'modules.dameng.session.tabBrowse',
    resolvePane: () => ({
      loader: () => import('@/modules/dameng/components/DamengBrowsePane.vue'),
      buildProps: relationProps,
    }),
  },
  ddl: {
    icon: 'file-code',
    labelKey: 'modules.dameng.session.tabDdl',
    resolvePane: () => ({
      loader: () => import('@/modules/dameng/components/DamengDdlPane.vue'),
      buildProps: relationProps,
    }),
  },
  objectScript: {
    icon: 'file-code',
    labelKey: 'modules.dameng.session.tabObjectScript',
    resolvePane: () => ({
      loader: () => import('@/modules/dameng/components/DamengObjectScriptPane.vue'),
      buildProps: objectScriptProps,
    }),
  },
  monitor: {
    icon: 'activity',
    labelKey: 'modules.dameng.session.tabMonitor',
    resolvePane: () => ({
      loader: () => import('@/modules/dameng/components/DamengMonitorPane.vue'),
      buildProps: monitorProps,
    }),
  },
  design: {
    icon: 'layout-list',
    labelKey: 'modules.dameng.session.tabDesign',
    resolvePane: () => ({
      loader: () => import('@/modules/dameng/components/DamengDesignPane.vue'),
      buildProps: designProps,
    }),
  },
  debug: {
    icon: 'bug',
    labelKey: 'modules.dameng.session.tabDebug',
    resolvePane: () => ({
      loader: () => import('@/modules/dameng/components/DamengDebugPane.vue'),
      buildProps: debugProps,
    }),
  },
}

export function normalizeDamengFeature(tab: string | undefined): DamengSessionTab {
  if (
    tab === 'browse' ||
    tab === 'ddl' ||
    tab === 'query' ||
    tab === 'objectScript' ||
    tab === 'monitor' ||
    tab === 'design' ||
    tab === 'debug'
  ) {
    return tab
  }
  return 'query'
}

/** 自带顶栏的面板（Session 不再叠第二行 header）。 */
export function damengFeatureEmbedsChrome(_tab: DamengSessionTab): boolean {
  return true
}
