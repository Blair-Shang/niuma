/**
 * 连接表单与 **会话生命周期** 模块入口。
 *
 * 会话相关（L4 Tab ↔ 物理连接）：
 * - `useSessionLease` — *Session.vue 唯一应使用的借用 API
 * - `SESSION_POLICY` / `buildSessionKey` — 协议策略（新增协议只改 session-policy.ts）
 * - `SESSION_RELEASE_CLEANUP_KEY` — Pane 注册 Tab release 时的子资源清理
 *
 * @see docs/21-session-registry.md §0.6 开发者约定
 */
export type { ConnectionFormMode, ConnectionTestMessage, ProxyFormState, TunnelFormState } from './types'
export type { ConnectionKindSlotDef } from './registry'
export { registerConnectionKind, getConnectionKindDef } from './registry'
export {
  applyProxyToForm,
  buildProxyOptions,
  emptyProxyFormState,
  syncProxyPortForType,
  validateProxyForm,
} from './proxy-form'
export {
  applyTunnelToForm,
  buildTunnelOptions,
  emptyTunnelFormState,
  validateTunnelForm,
} from './tunnel-form'
export {
  cappedTestTimeout,
  formatTimeoutFormValue,
  parseTimeoutFormValue,
  readStoredSentinelMasterName,
  readStoredTimeoutSeconds,
} from './connection-options'
export { default as ConnectionProxyFields } from './components/ConnectionProxyFields.vue'
export { default as ConnectionTunnelFields } from './components/ConnectionTunnelFields.vue'
export { default as ConnectionTimeoutFields } from './components/ConnectionTimeoutFields.vue'
export { default as ConnectionTestFeedback } from './components/ConnectionTestFeedback.vue'

/* ── Session Registry（L4）── 见 docs/21-session-registry.md */
export { SESSION_POLICY, buildSessionKey, type AcquireOpts, type SessionPolicy } from './session-policy'
export { SESSION_RELEASE_CLEANUP_KEY, type SessionReleaseCleanup } from './session-release'
export { useSessionLease, type UseSessionLeaseOptions } from './useSessionLease'
