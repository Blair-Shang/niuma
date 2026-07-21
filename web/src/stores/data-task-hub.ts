import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useShellStore } from '@/stores/shell'

/** 任务呈现面：dock 默认；float 弹出；tab 预留重流程 */
export type DataTaskSurface = 'dock' | 'float' | 'tab'

/**
 * 全局数据任务（导入导出 / Dump / 后续同步等）。
 * provider 区分协议（vastbase / mysql / oracle…），UI 由 registry 解析。
 */
export interface DataTask {
  id: string
  /** 协议 / 模块 id，如 vastbase、mysql */
  provider: string
  /** 协议内任务种类，如 dump_sql、export_csv */
  kind: string
  title: string
  description: string
  surface: DataTaskSurface
  busy: boolean
  createdAt: number
  /** 协议私有上下文，由对应 DataTask 视图解释 */
  context: Record<string, unknown>
}

export interface OpenDataTaskInput {
  provider: string
  kind: string
  title: string
  description?: string
  surface?: DataTaskSurface
  context?: Record<string, unknown>
}

let seq = 0

function nextId(provider: string): string {
  seq += 1
  return `data-task-${provider}-${Date.now()}-${seq}`
}

/** 全局数据任务枢纽：底部 Dock + 浮窗，供各数据库模块复用。 */
export const useDataTaskHubStore = defineStore('data-task-hub', () => {
  const tasks = ref<DataTask[]>([])
  const activeId = ref<string | null>(null)

  const dockTasks = computed(() => tasks.value.filter((t) => t.surface === 'dock'))
  const floatTasks = computed(() => tasks.value.filter((t) => t.surface === 'float'))
  const activeCount = computed(() => tasks.value.filter((t) => t.busy).length)
  const hasTasks = computed(() => tasks.value.length > 0)

  function getTask(id: string): DataTask | undefined {
    return tasks.value.find((t) => t.id === id)
  }

  function focusInDock(id: string): void {
    activeId.value = id
    const shell = useShellStore()
    if (shell.bottomDockHeight < 280) {
      shell.setBottomDockHeight(300)
    }
    shell.openBottomDock('dataTasks')
  }

  function openTask(input: OpenDataTaskInput): string {
    const id = nextId(input.provider)
    const surface = input.surface ?? 'dock'
    const task: DataTask = {
      id,
      provider: input.provider,
      kind: input.kind,
      title: input.title,
      description: input.description ?? '',
      surface,
      busy: false,
      createdAt: Date.now(),
      context: input.context ?? {},
    }
    tasks.value = [...tasks.value, task]
    activeId.value = id
    if (surface === 'dock') {
      focusInDock(id)
    }
    return id
  }

  function close(id: string): void {
    tasks.value = tasks.value.filter((t) => t.id !== id)
    if (activeId.value === id) {
      activeId.value = tasks.value[0]?.id ?? null
    }
    if (tasks.value.length === 0) {
      const shell = useShellStore()
      if (shell.bottomDockTab === 'dataTasks') {
        shell.closeBottomDock()
      }
    }
  }

  function setBusy(id: string, busy: boolean): void {
    tasks.value = tasks.value.map((t) => (t.id === id ? { ...t, busy } : t))
  }

  function popOutTask(id: string): void {
    tasks.value = tasks.value.map((t) =>
      t.id === id ? { ...t, surface: 'float' as const } : t,
    )
    activeId.value = id
    // 弹出后仍保留底部 Dock（可显示其它任务 / 再折回）；勿自动收起
  }

  function dockTask(id: string): void {
    tasks.value = tasks.value.map((t) =>
      t.id === id ? { ...t, surface: 'dock' as const } : t,
    )
    // 先改 surface 再开 Dock，避免浮窗 v-model 误关任务
    focusInDock(id)
  }

  return {
    tasks,
    activeId,
    dockTasks,
    floatTasks,
    activeCount,
    hasTasks,
    getTask,
    openTask,
    close,
    setBusy,
    focusInDock,
    dockTask,
    popOutTask,
  }
})
