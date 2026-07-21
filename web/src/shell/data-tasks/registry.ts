import type { Component } from 'vue'
import type { DataTask } from '@/stores/data-task-hub'

export type DataTaskPresentation = 'float' | 'inline'

/** 协议视图 props：taskId + 呈现面 */
export interface DataTaskViewProps {
  taskId: string
  presentation: DataTaskPresentation
}

type Matcher = (task: DataTask) => boolean

interface DataTaskRendererEntry {
  match: Matcher
  component: Component
}

const entries: DataTaskRendererEntry[] = []

/**
 * 注册数据任务视图（各数据库模块在启动时调用）。
 * 后注册的优先匹配。
 */
export function registerDataTaskRenderer(
  match: Matcher,
  component: Component,
): void {
  entries.unshift({ match, component })
}

/** 按任务解析视图组件；未注册时返回 null。 */
export function resolveDataTaskRenderer(task: DataTask): Component | null {
  for (const entry of entries) {
    if (entry.match(task)) return entry.component
  }
  return null
}
