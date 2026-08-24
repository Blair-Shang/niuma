import { defineAsyncComponent } from 'vue'
import type { ConnItem } from '@/modules/ops/types'
import { registerDataTaskRenderer } from '@/shell/data-tasks/registry'
import { useDataTaskHubStore, type DataTaskSurface } from '@/stores/data-task-hub'

export const SQLSERVER_DATA_TASK_PROVIDER = 'sqlserver'

export type SqlServerIoTaskKind = 'export_csv' | 'import_csv' | 'dump_sql' | 'exec_sql_file'

/** 转储对象范围（树节点 → IO 对话框）。 */
export type SqlServerDumpScope =
  | 'database'
  | 'schema'
  | 'tables'
  | 'views'
  | 'procedures'
  | 'functions'
  | 'synonyms'
  | 'sequences'
  | 'table'
  | 'view'
  | 'procedure'
  | 'function'
  | 'synonym'
  | 'sequence'

const DUMP_SCOPES = new Set<SqlServerDumpScope>([
  'database',
  'schema',
  'tables',
  'views',
  'procedures',
  'functions',
  'synonyms',
  'sequences',
  'table',
  'view',
  'procedure',
  'function',
  'synonym',
  'sequence',
])

export interface SqlServerIoTaskContext {
  conn: ConnItem
  profileId: string
  sessionId?: string | null
  database?: string
  schema?: string
  /** 单对象名称（表/视图/例程等共用）。 */
  table?: string
  dumpScope?: SqlServerDumpScope
}

export interface OpenSqlServerIoTaskInput {
  kind: SqlServerIoTaskKind
  title: string
  description?: string
  surface?: DataTaskSurface
  context: SqlServerIoTaskContext
}

const SqlServerSqlFileDialogAsync = defineAsyncComponent(
  () => import('@/modules/sqlserver/components/SqlServerSqlFileDialog.vue'),
)
const SqlServerDataTransferDialogAsync = defineAsyncComponent(
  () => import('@/modules/sqlserver/components/SqlServerDataTransferDialog.vue'),
)

let registered = false

/** 注册 SqlServer 数据任务视图（app 启动时调用一次）。 */
export function registerSqlServerDataTasks(): void {
  if (registered) return
  registered = true

  registerDataTaskRenderer(
    (task) =>
      task.provider === SQLSERVER_DATA_TASK_PROVIDER &&
      (task.kind === 'dump_sql' || task.kind === 'exec_sql_file'),
    SqlServerSqlFileDialogAsync,
  )
  registerDataTaskRenderer(
    (task) =>
      task.provider === SQLSERVER_DATA_TASK_PROVIDER &&
      (task.kind === 'export_csv' || task.kind === 'import_csv'),
    SqlServerDataTransferDialogAsync,
  )
}

/** 打开 SqlServer IO 任务。 */
export function openSqlServerDataTask(input: OpenSqlServerIoTaskInput): string {
  return useDataTaskHubStore().openTask({
    provider: SQLSERVER_DATA_TASK_PROVIDER,
    kind: input.kind,
    title: input.title,
    description: input.description,
    surface: input.surface ?? 'dock',
    context: { ...input.context },
  })
}

export function readSqlServerIoContext(context: Record<string, unknown>): SqlServerIoTaskContext | null {
  const profileId = context.profileId
  if (typeof profileId !== 'string' || !profileId) return null
  const dumpScope = context.dumpScope
  return {
    conn: context.conn as ConnItem,
    profileId,
    sessionId: (context.sessionId as string | null | undefined) ?? null,
    database: typeof context.database === 'string' ? context.database : undefined,
    schema: typeof context.schema === 'string' ? context.schema : undefined,
    table: typeof context.table === 'string' ? context.table : undefined,
    dumpScope:
      typeof dumpScope === 'string' && DUMP_SCOPES.has(dumpScope as SqlServerDumpScope)
        ? (dumpScope as SqlServerDumpScope)
        : undefined,
  }
}
