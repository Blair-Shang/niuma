import { defineAsyncComponent } from 'vue'
import type { ConnItem } from '@/modules/ops/types'
import { registerDataTaskRenderer } from '@/shell/data-tasks/registry'
import { useDataTaskHubStore, type DataTaskSurface } from '@/stores/data-task-hub'

export const MYSQL_DATA_TASK_PROVIDER = 'mysql'

export type MysqlIoTaskKind = 'export_csv' | 'import_csv' | 'dump_sql' | 'exec_sql_file'

export interface MysqlIoTaskContext {
  conn: ConnItem
  profileId: string
  sessionId?: string | null
  database?: string
  table?: string
  /**
   * 转储对象范围提示（来自树节点）：
   * - `table` / `procedure` / `function`：单个对象
   * - `tables` / `views` / `procedures` / `functions`：分类节点（仅该类）
   * - `database`：整库
   */
  dumpScope?:
    | 'database'
    | 'tables'
    | 'views'
    | 'procedures'
    | 'functions'
    | 'table'
    | 'procedure'
    | 'function'
}

export interface OpenMysqlIoTaskInput {
  kind: MysqlIoTaskKind
  title: string
  description?: string
  surface?: DataTaskSurface
  context: MysqlIoTaskContext
}

const MysqlSqlFileDialogAsync = defineAsyncComponent(
  () => import('@/modules/mysql/components/MysqlSqlFileDialog.vue'),
)
const MysqlDataTransferDialogAsync = defineAsyncComponent(
  () => import('@/modules/mysql/components/MysqlDataTransferDialog.vue'),
)

let registered = false

/** 注册 MySQL 数据任务视图（app 启动时调用一次）。 */
export function registerMysqlDataTasks(): void {
  if (registered) return
  registered = true

  registerDataTaskRenderer(
    (task) =>
      task.provider === MYSQL_DATA_TASK_PROVIDER &&
      (task.kind === 'dump_sql' || task.kind === 'exec_sql_file'),
    MysqlSqlFileDialogAsync,
  )
  registerDataTaskRenderer(
    (task) =>
      task.provider === MYSQL_DATA_TASK_PROVIDER &&
      (task.kind === 'export_csv' || task.kind === 'import_csv'),
    MysqlDataTransferDialogAsync,
  )
}

/** 打开 MySQL IO 任务。 */
export function openMysqlDataTask(input: OpenMysqlIoTaskInput): string {
  return useDataTaskHubStore().openTask({
    provider: MYSQL_DATA_TASK_PROVIDER,
    kind: input.kind,
    title: input.title,
    description: input.description,
    surface: input.surface ?? 'dock',
    context: { ...input.context },
  })
}

export function readMysqlIoContext(context: Record<string, unknown>): MysqlIoTaskContext | null {
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
      dumpScope === 'procedures' ||
      dumpScope === 'functions' ||
      dumpScope === 'table' ||
      dumpScope === 'procedure' ||
      dumpScope === 'function'
        ? dumpScope
        : undefined,
  }
}
