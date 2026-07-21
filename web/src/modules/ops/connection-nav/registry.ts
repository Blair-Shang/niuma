import type { ConnKind } from '@/modules/ops/types'
import type { ConnectionNavStrategy } from '@/modules/ops/connection-nav/types'

/**
 * L3 连接导航策略注册表。
 *
 * 与 `conn-tree/registry`（树子节点）、`connection-form/registry`（表单 adapter）并列：
 * 新增协议时注册本表，避免在 `useConnectionNavigation` 内堆 `switch (kind)`。
 */
const strategies: Partial<Record<ConnKind, ConnectionNavStrategy>> = {}

/**
 * 注册某协议的连接 → Tab 导航策略。
 *
 * 重复注册同一 kind 会覆盖（便于测试或插件替换内置实现）。
 */
export function registerConnectionNavStrategy(kind: ConnKind, strategy: ConnectionNavStrategy): void {
  if (strategy.kind !== kind) {
    throw new Error(`connection nav strategy kind mismatch: register ${kind}, strategy ${strategy.kind}`)
  }
  strategies[kind] = strategy
}

/**
 * 获取已注册的导航策略。
 *
 * @throws 若 kind 已在 CONN_KIND_DEFS 但未注册——说明尚未 `ensureConnKind` 或 loader 遗漏
 */
export function getConnectionNavStrategy(kind: ConnKind): ConnectionNavStrategy {
  const strategy = strategies[kind]
  if (!strategy) {
    throw new Error(`connection nav strategy not registered: ${kind}`)
  }
  return strategy
}

/** 是否已注册（测试 / 插件探测用） */
export function hasConnectionNavStrategy(kind: ConnKind): boolean {
  return strategies[kind] != null
}
