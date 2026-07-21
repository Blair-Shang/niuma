import { defineAsyncComponent } from 'vue'
import type { ConnItem } from '@/modules/ops/types'
import { registerDataTaskRenderer } from '@/shell/data-tasks/registry'
import { useDataTaskHubStore, type DataTaskSurface } from '@/stores/data-task-hub'

export const VASTBASE_DATA_TASK_PROVIDER = 'vastbase'

export type VastIoTaskKind =
  | 'export_csv'
  | 'import_csv'
  | 'dump_sql'
  | 'exec_sql_file'

export interface VastIoTaskContext {
  conn: ConnItem
  profileId: string
  sessionId?: string | null
  database?: string
  schema?: string
  table?: string
}

export interface OpenVastIoTaskInput {
  kind: VastIoTaskKind
  title: string
  description?: string
  surface?: DataTaskSurface
  context: VastIoTaskContext
}

/**
 * 模块级单例异步组件：避免 resolve 时重复 defineAsyncComponent，
 * 保证 DataTaskHost 按 taskId 保活时组件类型稳定（dock/float 切换不丢表单）。
 */
const VastSqlFileDialogAsync = defineAsyncComponent(
  () => import('@/modules/vastbase/components/VastSqlFileDialog.vue'),
)
const VastDataTransferDialogAsync = defineAsyncComponent(
  () => import('@/modules/vastbase/components/VastDataTransferDialog.vue'),
)

let registered = false

/** 注册 Vastbase 数据任务视图（app 启动时调用一次）。 */
export function registerVastbaseDataTasks(): void {
  if (registered) return
  registered = true

  registerDataTaskRenderer(
    (task) =>
      task.provider === VASTBASE_DATA_TASK_PROVIDER &&
      (task.kind === 'dump_sql' || task.kind === 'exec_sql_file'),
    VastSqlFileDialogAsync,
  )
  registerDataTaskRenderer(
    (task) =>
      task.provider === VASTBASE_DATA_TASK_PROVIDER &&
      (task.kind === 'export_csv' || task.kind === 'import_csv'),
    VastDataTransferDialogAsync,
  )
}

/** 打开 Vastbase IO 任务（默认进全局数据任务 Dock）。 */
export function openVastbaseDataTask(input: OpenVastIoTaskInput): string {
  return useDataTaskHubStore().openTask({
    provider: VASTBASE_DATA_TASK_PROVIDER,
    kind: input.kind,
    title: input.title,
    description: input.description,
    surface: input.surface ?? 'dock',
    context: { ...input.context },
  })
}

export function readVastIoContext(
  context: Record<string, unknown>,
): VastIoTaskContext | null {
  const profileId = context.profileId
  if (typeof profileId !== 'string' || !profileId) return null
  return {
    conn: context.conn as ConnItem,
    profileId,
    sessionId: (context.sessionId as string | null | undefined) ?? null,
    database: typeof context.database === 'string' ? context.database : undefined,
    schema: typeof context.schema === 'string' ? context.schema : undefined,
    table: typeof context.table === 'string' ? context.table : undefined,
  }
}
