/**
 * 物理会话借用策略与 session key 生成。
 *
 * 新增运维协议时：**只在本文件追加 `SESSION_POLICY` 条目**，勿在 *Session.vue 硬编码。
 *
 * | sharing | 含义 | 典型协议 |
 * |---------|------|----------|
 * | per_tab | 每 Tab 独立 sessionId | SSH, FTP, MySQL, Kingbase, Dameng, Oracle（多查询 Tab 事务隔离） |
 * | scoped | 同 profile + scope 字段共享 | Redis（database） |
 * | per_profile | 同站点共享一条连接 | MongoDB, Vastbase |
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
  // 每查询/浏览 Tab 独立物理连接，避免多 Tab 共享 session 时事务串号
  mysql: { sharing: 'per_tab', closeOnRelease: true },
  // SQLite 单连接写串行；同站点多 Tab 共享（per_profile），对齐 docs/27
  sqlite: { sharing: 'per_profile', closeOnRelease: false, idleMs: 60_000 },
  // 每查询/浏览 Tab 独立物理连接，多页签事务隔离（对齐 MySQL / 金仓）。
  dameng: { sharing: 'per_tab', closeOnRelease: true },
  // 每查询/浏览 Tab 独立物理连接，避免多 Tab 共享 session 时事务串号（对齐 MySQL）。
  oracle: { sharing: 'per_tab', closeOnRelease: true },
  // ClickHouse P0 查询 Tab 共享 profile 会话，空闲后释放（docs/30）。
  clickhouse: { sharing: 'per_profile', closeOnRelease: false, idleMs: 60_000 },
  // 每查询/浏览 Tab 独立物理连接，多页签事务隔离（对齐 MySQL）。
  kingbase: { sharing: 'per_tab', closeOnRelease: true },
  // SQL Server：每查询 Tab 独立物理连接与事务（docs/32）。
  sqlserver: { sharing: 'per_tab', closeOnRelease: true },
  // 官方 PostgreSQL：每查询/浏览 Tab 独立物理连接，多页签事务隔离（docs/34）。
  postgres: { sharing: 'per_tab', closeOnRelease: true },
}

export interface AcquireOpts {
  kind: ConnKind
  profileId: string
  tabId: string
  /** Redis：逻辑库编号，参与 scoped session key */
  database?: number
  /**
   * MySQL / Kingbase / PostgreSQL：`session.open` 时覆盖目标库（不参与 session key；per_tab 已隔离）。
   * Dameng 无独立 database，走 schema，无需此项。
   */
  connectDatabase?: string
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
