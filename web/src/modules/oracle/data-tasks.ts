import { defineAsyncComponent } from 'vue'
import type { ConnItem } from '@/modules/ops/types'
import { registerDataTaskRenderer } from '@/shell/data-tasks/registry'
import { useDataTaskHubStore, type DataTaskSurface } from '@/stores/data-task-hub'

export const ORACLE_DATA_TASK_PROVIDER = 'oracle'

export type OracleIoTaskKind = 'export_csv' | 'import_csv' | 'dump_sql' | 'exec_sql_file'

export interface OracleIoTaskContext {
  conn: ConnItem
  profileId: string
  sessionId?: string | null
  schema?: string
  table?: string
  /**
   * 转储对象范围提示（来自树节点）：
   * - `table`：单个对象
   * - `tables` / `views` / `procedures` / `functions`：分类节点
   * - `schema`：整个 schema
   */
  dumpScope?: 'schema' | 'tables' | 'views' | 'procedures' | 'functions' | 'table'
}

export interface OpenOracleIoTaskInput {
  kind: OracleIoTaskKind
  title: string
  description?: string
  surface?: DataTaskSurface
  context: OracleIoTaskContext
}

const OracleSqlFileDialogAsync = defineAsyncComponent(
  () => import('@/modules/oracle/components/OracleSqlFileDialog.vue'),
)
const OracleDataTransferDialogAsync = defineAsyncComponent(
  () => import('@/modules/oracle/components/OracleDataTransferDialog.vue'),
)

let registered = false

/** 注册 Oracle 数据任务视图（app 启动时调用一次）。 */
export function registerOracleDataTasks(): void {
  if (registered) return
  registered = true

  registerDataTaskRenderer(
    (task) =>
      task.provider === ORACLE_DATA_TASK_PROVIDER &&
      (task.kind === 'dump_sql' || task.kind === 'exec_sql_file'),
    OracleSqlFileDialogAsync,
  )
  registerDataTaskRenderer(
    (task) =>
      task.provider === ORACLE_DATA_TASK_PROVIDER &&
      (task.kind === 'export_csv' || task.kind === 'import_csv'),
    OracleDataTransferDialogAsync,
  )
}

/** 打开 Oracle IO 任务。 */
export function openOracleDataTask(input: OpenOracleIoTaskInput): string {
  return useDataTaskHubStore().openTask({
    provider: ORACLE_DATA_TASK_PROVIDER,
    kind: input.kind,
    title: input.title,
    description: input.description,
    surface: input.surface ?? 'dock',
    context: { ...input.context },
  })
}

export function readOracleIoContext(context: Record<string, unknown>): OracleIoTaskContext | null {
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
      dumpScope === 'procedures' ||
      dumpScope === 'functions' ||
      dumpScope === 'table'
        ? dumpScope
        : undefined,
  }
}
