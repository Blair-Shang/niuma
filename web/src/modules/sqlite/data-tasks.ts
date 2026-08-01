import { defineAsyncComponent } from 'vue'
import type { ConnItem } from '@/modules/ops/types'
import { registerDataTaskRenderer } from '@/shell/data-tasks/registry'
import { useDataTaskHubStore, type DataTaskSurface } from '@/stores/data-task-hub'

export const SQLITE_DATA_TASK_PROVIDER = 'sqlite'

export type SqliteIoTaskKind = 'export_csv' | 'import_csv' | 'dump_sql' | 'exec_sql_file'

export interface SqliteIoTaskContext {
  conn: ConnItem
  profileId: string
  sessionId?: string | null
  schema?: string
  table?: string
  /**
   * 转储对象范围提示（来自树节点）：
   * - `table`：单个对象
   * - `tables` / `views` / `indexes` / `triggers`：分类节点（仅该类）
   * - `schema`：整个 schema（含 ATTACH 别名）
   */
  dumpScope?: 'schema' | 'tables' | 'views' | 'indexes' | 'triggers' | 'table'
}

export interface OpenSqliteIoTaskInput {
  kind: SqliteIoTaskKind
  title: string
  description?: string
  surface?: DataTaskSurface
  context: SqliteIoTaskContext
}

const SqliteSqlFileDialogAsync = defineAsyncComponent(
  () => import('@/modules/sqlite/components/SqliteSqlFileDialog.vue'),
)
const SqliteDataTransferDialogAsync = defineAsyncComponent(
  () => import('@/modules/sqlite/components/SqliteDataTransferDialog.vue'),
)

let registered = false

/** 注册 SQLite 数据任务视图（app 启动时调用一次）。 */
export function registerSqliteDataTasks(): void {
  if (registered) return
  registered = true

  registerDataTaskRenderer(
    (task) =>
      task.provider === SQLITE_DATA_TASK_PROVIDER &&
      (task.kind === 'dump_sql' || task.kind === 'exec_sql_file'),
    SqliteSqlFileDialogAsync,
  )
  registerDataTaskRenderer(
    (task) =>
      task.provider === SQLITE_DATA_TASK_PROVIDER &&
      (task.kind === 'export_csv' || task.kind === 'import_csv'),
    SqliteDataTransferDialogAsync,
  )
}

/** 打开 SQLite IO 任务。 */
export function openSqliteDataTask(input: OpenSqliteIoTaskInput): string {
  return useDataTaskHubStore().openTask({
    provider: SQLITE_DATA_TASK_PROVIDER,
    kind: input.kind,
    title: input.title,
    description: input.description,
    surface: input.surface ?? 'dock',
    context: { ...input.context },
  })
}

export function readSqliteIoContext(context: Record<string, unknown>): SqliteIoTaskContext | null {
  const profileId = context.profileId
  if (typeof profileId !== 'string' || !profileId) return null
  const dumpScope = context.dumpScope
  return {
    conn: context.conn as ConnItem,
    profileId,
    sessionId: (context.sessionId as string | null | undefined) ?? null,
    schema: typeof context.schema === 'string' ? context.schema : undefined,
    table: typeof context.table === 'string' ? context.table : undefined,
    dumpScope:
      dumpScope === 'schema' ||
      dumpScope === 'tables' ||
      dumpScope === 'views' ||
      dumpScope === 'indexes' ||
      dumpScope === 'triggers' ||
      dumpScope === 'table'
        ? dumpScope
        : undefined,
  }
}
