/**
 * 物理会话借用策略与 session key 生成。
 *
 * 新增运维协议时：**只在本文件追加 `SESSION_POLICY` 条目**，勿在 *Session.vue 硬编码。
 *
 * | sharing | 含义 | 典型协议 |
 * |---------|------|----------|
 * | per_tab | 每 Tab 独立 sessionId | SSH, FTP |
 * | scoped | 同 profile + scope 字段共享 | Redis（database） |
 * | per_profile | 同站点共享一条连接 | MongoDB |
 *
 * @see docs/21-session-registry.md §3.3
 */
import type { ConnKind } from '@/modules/ops/types'

/** 物理会话借用策略（见 docs/21-session-registry.md §3.3） */
export type SessionSharing = 'per_tab' | 'scoped' | 'per_profile'

export interface SessionPolicy {
  sharing: SessionSharing
  /** per_tab / 显式断开时关 Tab 立即 close */
  closeOnRelease: boolean
  /** scoped 时用于拼 session key 的 props 字段 */
  scopeField?: 'database'
  /** ref=0 后延迟断开（毫秒）；仅 closeOnRelease=false 时生效 */
  idleMs?: number
}

export const SESSION_POLICY: Record<ConnKind, SessionPolicy> = {
  ssh: { sharing: 'per_tab', closeOnRelease: true },
  ftp: { sharing: 'per_tab', closeOnRelease: true },
  redis: { sharing: 'scoped', scopeField: 'database', closeOnRelease: false, idleMs: 60_000 },
  mongodb: { sharing: 'per_profile', closeOnRelease: false, idleMs: 60_000 },
  vastbase: { sharing: 'per_profile', closeOnRelease: false, idleMs: 60_000 },
  mysql: { sharing: 'per_profile', closeOnRelease: false, idleMs: 60_000 },
}

export interface AcquireOpts {
  kind: ConnKind
  profileId: string
  tabId: string
  /** Redis：逻辑库编号，参与 scoped session key */
  database?: number
}

/** 生成 Layer-1 会话在 Registry 内的唯一 key */
export function buildSessionKey(opts: AcquireOpts): string {
  const policy = SESSION_POLICY[opts.kind]
  switch (policy.sharing) {
    case 'per_tab':
      return `${opts.kind}:${opts.profileId}:${opts.tabId}`
    case 'scoped': {
      const db = opts.database ?? 0
      return `${opts.kind}:${opts.profileId}:db${db}`
    }
    case 'per_profile':
      return `${opts.kind}:${opts.profileId}`
  }
}
