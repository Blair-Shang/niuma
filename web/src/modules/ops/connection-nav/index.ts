/**
 * L3 连接导航 — 连接树 / Provider → Tab Store。
 *
 * @see docs/18-ops-connection-tree.md §7
 * @see docs/21-session-registry.md §0
 */
export type {
  ConnectionNavConnectOptions,
  ConnectionNavStrategy,
  ConnectionNavTabSpec,
} from './types'
export {
  registerConnectionNavStrategy,
  getConnectionNavStrategy,
  hasConnectionNavStrategy,
} from './registry'
export {
  redisDatabaseFromContext,
  mongoResourceFromContext,
  buildConnectionTabTitle,
  buildConnectionTabTooltip,
} from './utils'
