import type { ConnItem } from '@/modules/ops/types'
import type { ConnOpenContext } from '@/modules/ops/conn-tree/types'
import { buildConnectionTabTooltip, nextQueryTabIndex } from '@/modules/ops/connection-nav/utils'
import type { ConnectionNavStrategy, ConnectionNavTabSpec } from '@/modules/ops/connection-nav/types'
import { useTabStore } from '@/stores/tab'
import { kindIcon } from '@/modules/ops/types'
import { i18n } from '@/locale'

function segmentName(ctx: ConnOpenContext | undefined, kind: string): string | undefined {
  return ctx?.resourcePath?.segments.find((segment) => segment.kind === kind)?.name
}

function buildQueryTabSpec(item: ConnItem, ctx?: ConnOpenContext): ConnectionNavTabSpec {
  const database = segmentName(ctx, 'database') || item.connectionOptions?.database
  const host = item.hostAddress || item.profileName
  const queryIndex = nextQueryTabIndex(useTabStore().allTabs, 'sqlserver', item.profileId, () => true)
  const queryTitle = i18n.global.t('modules.sqlserver.session.tabQueryIndexed', { n: queryIndex })

  const props: Record<string, unknown> = { profileId: item.profileId, initialTab: 'query' }
  if (typeof database === 'string' && database.trim()) props.database = database.trim()
  if (ctx?.initialSql?.trim()) props.initialSql = ctx.initialSql
  if (ctx?.autoRunInitialSql) props.autoRunInitialSql = true

  return {
    moduleId: 'sqlserver',
    title: `${(typeof database === 'string' && database.trim()) || host} · ${queryTitle}`,
    tooltip: buildConnectionTabTooltip(item.profileName, item.hostAddress, undefined, queryTitle),
    icon: kindIcon('sqlserver'),
    props,
  }
}

export const sqlserverConnectionNavStrategy: ConnectionNavStrategy = {
  kind: 'sqlserver',
  dedupFocus: true,
  buildTabSpec: buildQueryTabSpec,
  findExistingTab() {
    return undefined
  },
}
