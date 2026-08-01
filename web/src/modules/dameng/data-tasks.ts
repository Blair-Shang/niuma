import { defineAsyncComponent } from 'vue'
import type { ConnItem } from '@/modules/ops/types'
import { registerDataTaskRenderer } from '@/shell/data-tasks/registry'
import { useDataTaskHubStore, type DataTaskSurface } from '@/stores/data-task-hub'

export const DAMENG_DATA_TASK_PROVIDER = 'dameng'

export type DamengIoTaskKind = 'export_csv' | 'import_csv' | 'dump_sql' | 'exec_sql_file'

/** 转储对象范围（树节点 → IO 对话框）。 */
export type DamengDumpScope =
  | 'schema'
  | 'tables'
  | 'views'
  | 'procedures'
  | 'functions'
  | 'packages'
  | 'synonyms'
  | 'triggers'
  | 'sequences'
  | 'table'
  | 'view'
  | 'procedure'
  | 'function'
  | 'package'
  | 'synonym'
  | 'trigger'
  | 'sequence'

const DUMP_SCOPES = new Set<DamengDumpScope>([
  'schema',
  'tables',
  'views',
  'procedures',
  'functions',
  'packages',
  'synonyms',
  'triggers',
  'sequences',
  'table',
  'view',
  'procedure',
  'function',
  'package',
  'synonym',
  'trigger',
  'sequence',
])

export interface DamengIoTaskContext {
  conn: ConnItem
  profileId: string
  sessionId?: string | null
  schema?: string
  /** 单对象名称（表/视图/例程/包等共用）。 */
  table?: string
  dumpScope?: DamengDumpScope
}

export interface OpenDamengIoTaskInput {
  kind: DamengIoTaskKind
  title: string
  description?: string
  surface?: DataTaskSurface
  context: DamengIoTaskContext
}

const DamengSqlFileDialogAsync = defineAsyncComponent(
  () => import('@/modules/dameng/components/DamengSqlFileDialog.vue'),
)
const DamengDataTransferDialogAsync = defineAsyncComponent(
  () => import('@/modules/dameng/components/DamengDataTransferDialog.vue'),
)

let registered = false

/** 注册 Dameng 数据任务视图（app 启动时调用一次）。 */
export function registerDamengDataTasks(): void {
  if (registered) return
  registered = true

  registerDataTaskRenderer(
    (task) =>
      task.provider === DAMENG_DATA_TASK_PROVIDER &&
      (task.kind === 'dump_sql' || task.kind === 'exec_sql_file'),
    DamengSqlFileDialogAsync,
  )
  registerDataTaskRenderer(
    (task) =>
      task.provider === DAMENG_DATA_TASK_PROVIDER &&
      (task.kind === 'export_csv' || task.kind === 'import_csv'),
    DamengDataTransferDialogAsync,
  )
}

/** 打开 Dameng IO 任务。 */
export function openDamengDataTask(input: OpenDamengIoTaskInput): string {
  return useDataTaskHubStore().openTask({
    provider: DAMENG_DATA_TASK_PROVIDER,
    kind: input.kind,
    title: input.title,
    description: input.description,
    surface: input.surface ?? 'dock',
    context: { ...input.context },
  })
}

export function readDamengIoContext(context: Record<string, unknown>): DamengIoTaskContext | null {
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
      typeof dumpScope === 'string' && DUMP_SCOPES.has(dumpScope as DamengDumpScope)
        ? (dumpScope as DamengDumpScope)
        : undefined,
  }
}
