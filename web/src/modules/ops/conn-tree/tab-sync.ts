import type { WorkspaceTab } from '@/stores/tab'
import type { ConnItem, ConnKind } from '@/modules/ops/types'

/** 活跃 Tab → 侧栏树聚焦 的解析上下文。 */
export interface ConnTreeTabSyncContext {
  profiles: readonly ConnItem[]
}

/**
 * 协议侧：根据当前工作区 Tab 解析应对齐的连接树 key。
 * 无策略或不处理时返回 null，面板保持现状。
 */
export interface ConnTreeTabSyncStrategy {
  kind: ConnKind
  resolveFocusKey(tab: WorkspaceTab, ctx: ConnTreeTabSyncContext): string | null
}

const strategies: Partial<Record<ConnKind, ConnTreeTabSyncStrategy>> = {}

export function registerConnTreeTabSync(kind: ConnKind, strategy: ConnTreeTabSyncStrategy): void {
  if (strategy.kind !== kind) {
    throw new Error(`conn tree tab sync kind mismatch: register ${kind}, strategy ${strategy.kind}`)
  }
  strategies[kind] = strategy
}

export function getConnTreeTabSync(kind: string): ConnTreeTabSyncStrategy | undefined {
  return strategies[kind as ConnKind]
}
