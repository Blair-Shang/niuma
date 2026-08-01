import { defineAsyncComponent } from 'vue'
import type { ConnItem } from '@/modules/ops/types'
import { registerDataTaskRenderer } from '@/shell/data-tasks/registry'
import { useDataTaskHubStore, type DataTaskSurface } from '@/stores/data-task-hub'

export const CLICKHOUSE_DATA_TASK_PROVIDER = 'clickhouse'

export type ClickHouseIoTaskKind = 'export_csv' | 'import_csv' | 'dump_sql' | 'exec_sql_file'

export interface ClickHouseIoTaskContext {
  conn: ConnItem
  profileId: string
  sessionId?: string | null
  database?: string
  table?: string
  dumpScope?: 'database' | 'tables' | 'views' | 'materializedViews' | 'dictionaries' | 'table'
}

export interface OpenClickHouseIoTaskInput {
  kind: ClickHouseIoTaskKind
  title: string
  description?: string
  surface?: DataTaskSurface
  context: ClickHouseIoTaskContext
}

const ClickHouseSqlFileDialogAsync = defineAsyncComponent(
  () => import('@/modules/clickhouse/components/ClickHouseSqlFileDialog.vue'),
)
const ClickHouseDataTransferDialogAsync = defineAsyncComponent(
  () => import('@/modules/clickhouse/components/ClickHouseDataTransferDialog.vue'),
)

let registered = false

export function registerClickHouseDataTasks(): void {
  if (registered) return
  registered = true
  registerDataTaskRenderer(
    (task) =>
      task.provider === CLICKHOUSE_DATA_TASK_PROVIDER &&
      (task.kind === 'dump_sql' || task.kind === 'exec_sql_file'),
    ClickHouseSqlFileDialogAsync,
  )
  registerDataTaskRenderer(
    (task) =>
      task.provider === CLICKHOUSE_DATA_TASK_PROVIDER &&
      (task.kind === 'export_csv' || task.kind === 'import_csv'),
    ClickHouseDataTransferDialogAsync,
  )
}

export function openClickHouseDataTask(input: OpenClickHouseIoTaskInput): string {
  return useDataTaskHubStore().openTask({
    provider: CLICKHOUSE_DATA_TASK_PROVIDER,
    kind: input.kind,
    title: input.title,
    description: input.description,
    surface: input.surface ?? 'dock',
    context: { ...input.context },
  })
}

export function readClickHouseIoContext(
  context: Record<string, unknown>,
): ClickHouseIoTaskContext | null {
  const profileId = context.profileId
  if (typeof profileId !== 'string' || !profileId) return null
  const dumpScope = context.dumpScope
  return {
    conn: context.conn as ConnItem,
    profileId,
    sessionId: (context.sessionId as string | null | undefined) ?? null,
    database: typeof context.database === 'string' ? context.database : undefined,
    table: typeof context.table === 'string' ? context.table : undefined,
    dumpScope:
      dumpScope === 'database' ||
      dumpScope === 'tables' ||
      dumpScope === 'views' ||
      dumpScope === 'materializedViews' ||
      dumpScope === 'dictionaries' ||
      dumpScope === 'table'
        ? dumpScope
        : undefined,
  }
}
