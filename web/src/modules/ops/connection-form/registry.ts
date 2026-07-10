import type { ConnKind } from '@/modules/ops/types'
import type { ConnectionFormAdapter } from './types'

/**
 * 连接表单 adapter 注册表。
 *
 * 这里仅保存“表单数据逻辑”，不保存 UI 组件。UI 片段仍由
 * modules/connection/registry.ts 管理。两者都在 ops/connection-kinds.ts 中注册，
 * 这样新增协议时只有一个入口，但数据逻辑与展示逻辑不会混在一起。
 */
const adapters: Partial<Record<ConnKind, ConnectionFormAdapter>> = {}

/**
 * 注册某种连接协议的表单 adapter。
 *
 * 重复注册同一 kind 会覆盖旧 adapter，便于测试或插件替换内置实现。
 */
export function registerConnectionFormAdapter(kind: ConnKind, adapter: ConnectionFormAdapter): void {
  adapters[kind] = adapter
}

/**
 * 获取指定协议的表单 adapter。
 *
 * 如果协议已加入 CONN_KIND_DEFS 但未注册 adapter，说明启动注册流程不完整；
 * 直接抛错能尽早暴露问题，避免保存时生成不完整 connection_options。
 */
export function getConnectionFormAdapter(kind: ConnKind): ConnectionFormAdapter {
  const adapter = adapters[kind]
  if (!adapter) {
    throw new Error(`connection form adapter not registered: ${kind}`)
  }
  return adapter
}
