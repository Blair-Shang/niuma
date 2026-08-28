/**
 * L4 Session Registry — Web 侧 **唯一** 管理 `session.open` / `session.close` 的入口。
 *
 * ## 在 Tab 四层架构中的位置
 *
 * ```
 * L1 tabStore.closeTab*  ──►  release(tabId)     ← 本 Store（修复 keep-alive 关 Tab 不漏 close）
 * L3 useConnectionNavigation  ──►  openTab（只管 UI，不碰 session）
 * *Session.vue  ──►  acquire()  via useSessionLease（消费 sessionId，禁止 onBeforeUnmount close）
 * ```
 *
 * ## 三个标识（勿混淆）
 *
 * | 标识 | 来源 | 本 Store 角色 |
 * |------|------|---------------|
 * | `profileId` | Platform SQLite 连接配置 | `session.open({ profileId, database? })` 入参 |
 * | `tabId` | L1 Tab Store 页签实例 | 借用方；`release(tabId)` 的查找键 |
 * | `sessionId` | Layer-1 能力服务 | lease 持有；多 Tab 可共享同一条 |
 *
 * ## 核心模型：Lease（租约）
 *
 * 一条物理连接对应一个 `SessionLease`，由 `buildSessionKey()` 决定合并粒度：
 *
 * - SSH/FTP：`per_tab` → 每 Tab 独立 session（key 含 tabId）
 * - Redis：`scoped` → 同 profile + 同 DB 共享（key 含 database）
 * - MongoDB：`per_profile` → 同站点多 Tab 共享
 *
 * 每个借用方 Tab 在 `tabBindings` 中登记，可附带 `onRelease` 清理子资源（停流、注销传输队列等）。
 *
 * ## 生命周期摘要
 *
 * | 操作 | 行为 |
 * |------|------|
 * | `acquire` | key 已有 → 追加 tabId；否则 Bridge `session.open` 后登记 |
 * | `release` | 移除 tabId → 调 onRelease → 按策略立即 close 或 idle 延迟 close |
 * | `forceReconnect` | `release(forceClose)` + 重新 `acquire`（重连按钮） |
 * | `disconnect` | 用户显式断开：清全部 tab 绑定并立即 close |
 *
 * 策略表见 `session-policy.ts`；完整设计见 docs/21-session-registry.md。
 *
 * @see docs/21-session-registry.md
 * @see web/src/modules/connection/session-policy.ts
 * @see web/src/modules/connection/useSessionLease.ts
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  clickhouseApi,
  damengApi,
  ftpApi,
  kingbaseApi,
  mongodbApi,
  mysqlApi,
  oracleApi,
  postgresApi,
  redisApi,
  sqliteApi,
  sqlserverApi,
  sshApi,
  vastbaseApi,
} from '@/api'
import type { ConnKind } from '@/modules/ops/types'
import {
  SESSION_POLICY,
  buildSessionKey,
  type AcquireOpts,
} from '@/modules/connection/session-policy'
import type { SessionReleaseCleanup } from '@/modules/connection/session-release'
import type { SqlServerProfile } from '@/modules/sql-editor/capabilities'
import {
  defaultClickHouseProfile,
  defaultDamengProfile,
  defaultKingbaseProfile,
  defaultMySQLProfile,
  defaultOracleProfile,
  defaultPostgreSQLProfile,
  defaultSqliteProfile,
  defaultSqlServerProfile,
  defaultVastbaseProfile,
} from '@/modules/sql-editor/capabilities'

/** Bridge dialect 原始形状（Vastbase / MySQL 同构） */
interface BridgeDialectProfile {
  family: string
  version?: string
  versionNum?: string
  sqlCompatibility?: string
  capabilities: string[]
}

function toSqlServerProfile(raw: BridgeDialectProfile | undefined): SqlServerProfile | undefined {
  if (!raw?.family || !Array.isArray(raw.capabilities)) return undefined
  return {
    family: raw.family,
    version: raw.version,
    versionNum: raw.versionNum,
    sqlCompatibility: raw.sqlCompatibility,
    capabilities: raw.capabilities,
  }
}

/** `acquire` / `forceReconnect` 的返回值 */
export interface AcquireResult {
  /** Layer-1 物理会话 id，供各 Pane 的 Bridge 调用使用 */
  sessionId: string
  /** 本次是否新开了物理连接（false 表示复用已有 lease） */
  isNew: boolean
}

/** 单个 Tab 对某条 lease 的借用记录 */
interface TabBinding {
  tabId: string
  /** Tab 释放时执行：停 Change Stream / MONITOR、unregister transferHub 等 */
  onRelease?: SessionReleaseCleanup
}

/**
 * 一条物理连接的租约记录。
 * key 由 `buildSessionKey` 生成，同一 key 的多个 Tab 共享同一个 `sessionId`。
 */
interface SessionLease {
  key: string
  kind: ConnKind
  profileId: string
  sessionId: string
  /** Vastbase 等：会话探测的方言能力集 */
  dialect?: SqlServerProfile
  /** 当前借用此连接的 Tab 集合；size=0 时进入断开判定 */
  tabBindings: Map<string, TabBinding>
  lastUsedAt: number
  /** 数据库类协议：全部 Tab 释放后的 idle 倒计时，到期后 `finalizeClose` */
  idleTimer?: ReturnType<typeof setTimeout>
}

/** `acquire` 时由 `useSessionLease` 传入的可选钩子 */
interface AcquireHooks {
  onRelease?: SessionReleaseCleanup
}

export const useSessionRegistry = defineStore('session-registry', () => {
  /** 活跃租约表：sessionKey → SessionLease */
  const leases = ref(new Map<string, SessionLease>())
  /**
   * 并发 acquire 去重：同一 key 同时只有一个 in-flight `session.open`。
   * 避免两个 Tab 几乎同时打开时重复建连。
   */
  const inflightOpens = new Map<string, Promise<{ sessionId: string; dialect?: SqlServerProfile }>>()

  /**
   * 不可变更新 leases（替换整个 Map 引用），保证 Pinia 响应式与连接树「已连接」态刷新。
   */
  function replaceLeases(mutator: (map: Map<string, SessionLease>) => void): void {
    const next = new Map(leases.value)
    mutator(next)
    leases.value = next
  }

  /** 按 tabId 反查所属 lease（release / getSessionIdForTab 使用） */
  function getLeaseByTabId(tabId: string): SessionLease | undefined {
    for (const lease of leases.value.values()) {
      if (lease.tabBindings.has(tabId)) {
        return lease
      }
    }
    return undefined
  }

  /** Bridge 调用：按协议打开 Layer-1 物理会话 */
  async function openRemoteSession(
    kind: ConnKind,
    profileId: string,
    connectDatabase?: string,
  ): Promise<{ sessionId: string; dialect?: SqlServerProfile }> {
    const db = connectDatabase?.trim() || undefined
    switch (kind) {
      case 'ssh':
        return { sessionId: (await sshApi.sessionOpen({ profileId })).sessionId }
      case 'ftp':
        return { sessionId: (await ftpApi.sessionOpen({ profileId })).sessionId }
      case 'redis':
        return { sessionId: (await redisApi.sessionOpen({ profileId })).sessionId }
      case 'mongodb':
        return { sessionId: (await mongodbApi.sessionOpen({ profileId })).sessionId }
      case 'vastbase': {
        const r = await vastbaseApi.sessionOpen({ profileId })
        return {
          sessionId: r.sessionId,
          dialect: toSqlServerProfile(r.dialect) ?? defaultVastbaseProfile(),
        }
      }
      case 'mysql': {
        const r = await mysqlApi.sessionOpen({ profileId, database: db })
        return {
          sessionId: r.sessionId,
          dialect: toSqlServerProfile(r.dialect) ?? defaultMySQLProfile(),
        }
      }
      case 'sqlite': {
        const r = await sqliteApi.sessionOpen({ profileId })
        return {
          sessionId: r.sessionId,
          dialect: toSqlServerProfile(r.dialect) ?? defaultSqliteProfile(),
        }
      }
      case 'dameng': {
        const r = await damengApi.sessionOpen({ profileId })
        return {
          sessionId: r.sessionId,
          dialect: toSqlServerProfile(r.dialect) ?? defaultDamengProfile(),
        }
      }
      case 'oracle': {
        const r = await oracleApi.sessionOpen({ profileId })
        return {
          sessionId: r.sessionId,
          dialect: toSqlServerProfile(r.dialect) ?? defaultOracleProfile(),
        }
      }
      case 'clickhouse': {
        const r = await clickhouseApi.sessionOpen({ profileId })
        return {
          sessionId: r.sessionId,
          dialect: toSqlServerProfile(r.dialect) ?? defaultClickHouseProfile(),
        }
      }
      case 'kingbase': {
        const r = await kingbaseApi.sessionOpen({ profileId, database: db })
        return {
          sessionId: r.sessionId,
          dialect: toSqlServerProfile(r.dialect) ?? defaultKingbaseProfile(),
        }
      }
      case 'sqlserver': {
        const r = await sqlserverApi.sessionOpen({ profileId, database: db })
        return {
          sessionId: r.sessionId,
          dialect: toSqlServerProfile(r.dialect) ?? defaultSqlServerProfile(),
        }
      }
      case 'postgres': {
        const r = await postgresApi.sessionOpen({ profileId, database: db })
        return {
          sessionId: r.sessionId,
          dialect: toSqlServerProfile(r.dialect) ?? defaultPostgreSQLProfile(),
        }
      }
    }
  }

  /** Bridge 调用：关闭 Layer-1 物理会话；失败不抛错，避免阻断本地 lease 清理 */
  async function closeRemoteSession(kind: ConnKind, sessionId: string): Promise<void> {
    try {
      switch (kind) {
        case 'ssh':
          await sshApi.sessionClose({ sessionId })
          break
        case 'ftp':
          await ftpApi.sessionClose({ sessionId })
          break
        case 'redis':
          await redisApi.sessionClose({ sessionId })
          break
        case 'mongodb':
          await mongodbApi.sessionClose({ sessionId })
          break
        case 'vastbase':
          await vastbaseApi.sessionClose({ sessionId })
          break
        case 'mysql':
          await mysqlApi.sessionClose({ sessionId })
          break
        case 'sqlite':
          await sqliteApi.sessionClose({ sessionId })
          break
        case 'dameng':
          await damengApi.sessionClose({ sessionId })
          break
        case 'oracle':
          await oracleApi.sessionClose({ sessionId })
          break
        case 'clickhouse':
          await clickhouseApi.sessionClose({ sessionId })
          break
        case 'kingbase':
          await kingbaseApi.sessionClose({ sessionId })
          break
        case 'sqlserver':
          await sqlserverApi.sessionClose({ sessionId })
          break
        case 'postgres':
          await postgresApi.sessionClose({ sessionId })
          break
      }
    } catch {
      // 关闭失败不阻断后续清理
    }
  }

  /** 取消 idle 倒计时（新 Tab acquire 或显式 disconnect 时） */
  function clearIdleTimer(lease: SessionLease): void {
    if (lease.idleTimer) {
      clearTimeout(lease.idleTimer)
      lease.idleTimer = undefined
    }
  }

  /** 执行单个 Tab 的 onRelease 钩子（子资源清理） */
  async function runTabRelease(binding: TabBinding | undefined): Promise<void> {
    if (!binding?.onRelease) {
      return
    }
    try {
      await binding.onRelease()
    } catch {
      // 子资源清理失败不阻断 release
    }
  }

  /**
   * 彻底关闭一条 lease：清 idle 计时器 → 从表删除 → Bridge session.close。
   * 幂等：lease 已被删除时直接返回。
   */
  async function finalizeClose(lease: SessionLease): Promise<void> {
    clearIdleTimer(lease)
    if (!leases.value.has(lease.key)) {
      return
    }
    replaceLeases((map) => {
      map.delete(lease.key)
    })
    await closeRemoteSession(lease.kind, lease.sessionId)
  }

  /**
   * 全部 Tab 已释放且策略为 delayed close 时，启动 idle 倒计时。
   * 倒计时内若有新 Tab acquire 同一 key，会 clearIdleTimer 并复用连接。
   */
  function scheduleIdleClose(lease: SessionLease): void {
    clearIdleTimer(lease)
    const idleMs = SESSION_POLICY[lease.kind].idleMs
    if (!idleMs) {
      void finalizeClose(lease)
      return
    }
    lease.idleTimer = setTimeout(() => {
      if (lease.tabBindings.size === 0) {
        void finalizeClose(lease)
      }
    }, idleMs)
    replaceLeases((map) => {
      map.set(lease.key, lease)
    })
  }

  /**
   * 确保某 sessionKey 对应 Layer-1 已有 sessionId（及可选方言档案）。
   * lease 未登记但 open 已在进行时，复用 inflightOpens 中的 Promise。
   */
  async function ensureSessionOpen(
    opts: AcquireOpts,
  ): Promise<{ sessionId: string; dialect?: SqlServerProfile }> {
    const key = buildSessionKey(opts)
    const existing = leases.value.get(key)
    if (existing) {
      return { sessionId: existing.sessionId, dialect: existing.dialect }
    }

    let inflight = inflightOpens.get(key)
    if (!inflight) {
      inflight = openRemoteSession(opts.kind, opts.profileId, opts.connectDatabase)
      inflightOpens.set(key, inflight)
      try {
        return await inflight
      } finally {
        inflightOpens.delete(key)
      }
    }
    return inflight
  }

  /**
   * Tab 借用物理会话（由 `useSessionLease.acquireSession` 在 *Session.vue onMounted 时调用）。
   *
   * 1. 按 key 查找已有 lease → 追加 tabBinding，取消 idle 计时
   * 2. 否则 `session.open` 后新建 lease
   *
   * @param opts - kind / profileId / tabId / database(Redis) / connectDatabase(MySQL·Kingbase·SQL Server)
   * @param hooks.onRelease - 该 Tab 被 release 时执行的清理（停流、unregister transferHub）
   */
  async function acquire(opts: AcquireOpts, hooks?: AcquireHooks): Promise<AcquireResult> {
    const key = buildSessionKey(opts)
    const existing = leases.value.get(key)

    if (existing) {
      clearIdleTimer(existing)
      existing.tabBindings.set(opts.tabId, { tabId: opts.tabId, onRelease: hooks?.onRelease })
      existing.lastUsedAt = Date.now()
      replaceLeases((map) => {
        map.set(key, existing)
      })
      return { sessionId: existing.sessionId, isNew: false }
    }

    const opened = await ensureSessionOpen(opts)
    const lease: SessionLease = {
      key,
      kind: opts.kind,
      profileId: opts.profileId,
      sessionId: opened.sessionId,
      dialect: opened.dialect,
      tabBindings: new Map([[opts.tabId, { tabId: opts.tabId, onRelease: hooks?.onRelease }]]),
      lastUsedAt: Date.now(),
    }
    replaceLeases((map) => {
      map.set(key, lease)
    })
    return { sessionId: opened.sessionId, isNew: true }
  }

  /**
   * 释放单个 Tab 的借用（由 `tabStore.closeTab*` 调用，**不依赖**组件 unmount）。
   *
   * 流程：onRelease → 从 tabBindings 移除 →
   * - 仍有其他 Tab 借用 → 保持连接
   * - ref=0 且 closeOnRelease → 立即 finalizeClose（SSH/FTP）
   * - ref=0 且 idle 策略 → scheduleIdleClose（Redis/MongoDB）
   *
   * @param tabId - 被关闭的 WorkspaceTab.tabId
   * @param options.forceClose - 跳过错 idle，立即断线（forceReconnect / disconnect 内部使用）
   */
  async function release(tabId: string, options?: { forceClose?: boolean }): Promise<void> {
    const lease = getLeaseByTabId(tabId)
    if (!lease) {
      return
    }

    const binding = lease.tabBindings.get(tabId)
    await runTabRelease(binding)
    lease.tabBindings.delete(tabId)

    if (lease.tabBindings.size > 0) {
      lease.lastUsedAt = Date.now()
      replaceLeases((map) => {
        map.set(lease.key, lease)
      })
      return
    }

    const policy = SESSION_POLICY[lease.kind]
    if (options?.forceClose || policy.closeOnRelease) {
      await finalizeClose(lease)
      return
    }

    scheduleIdleClose(lease)
  }

  /** 批量 release；tabStore 关闭多个 Tab 时一次调用 */
  async function releaseMany(tabIds: string[]): Promise<void> {
    await Promise.all(tabIds.map((id) => release(id)))
  }

  /**
   * 强制重连：先 forceClose 释放当前 Tab 的 lease，再重新 acquire。
   * 供 *Session.vue 重连按钮与 sessionActionStore 信号使用。
   */
  async function forceReconnect(opts: AcquireOpts, hooks?: AcquireHooks): Promise<AcquireResult> {
    await release(opts.tabId, { forceClose: true })
    return acquire(opts, hooks)
  }

  /**
   * 用户显式断开（连接树右键「断开连接」）。
   * 匹配 profileId（及可选 kind）的所有 lease，执行全部 onRelease 后立即 close。
   * 不自动关闭对应 Tab（Tab 内 sessionId 可能失效，需用户自行重连或关 Tab）。
   */
  async function disconnect(profileId: string, kind?: ConnKind): Promise<void> {
    const targets = [...leases.value.values()].filter(
      (lease) => lease.profileId === profileId && (!kind || lease.kind === kind),
    )
    for (const lease of targets) {
      for (const binding of lease.tabBindings.values()) {
        await runTabRelease(binding)
      }
      lease.tabBindings.clear()
      await finalizeClose(lease)
    }
  }

  /**
   * 连接树「已连接」态：存在活跃 Tab 借用，或 idle 倒计时未到期。
   * @param kind - 可选，限定协议（同 profile 多协议时区分）
   */
  function isProfileConnected(profileId: string, kind?: ConnKind): boolean {
    for (const lease of leases.value.values()) {
      if (lease.profileId !== profileId) {
        continue
      }
      if (kind && lease.kind !== kind) {
        continue
      }
      if (lease.tabBindings.size > 0 || lease.idleTimer) {
        return true
      }
    }
    return false
  }

  /** 查询某 Tab 当前借用的 sessionId；未 acquire 或已 release 时返回 null */
  function getSessionIdForTab(tabId: string): string | null {
    return getLeaseByTabId(tabId)?.sessionId ?? null
  }

  /** 按 sessionId 取方言能力集（Vastbase 等） */
  function getDialectForSession(sessionId: string | null | undefined): SqlServerProfile | null {
    if (!sessionId) return null
    for (const lease of leases.value.values()) {
      if (lease.sessionId === sessionId) {
        return lease.dialect ?? null
      }
    }
    return null
  }

  /** 按 Tab 取方言能力集 */
  function getDialectForTab(tabId: string): SqlServerProfile | null {
    return getLeaseByTabId(tabId)?.dialect ?? null
  }

  /** 按 profile 取任一存活 lease（树右键新建 DDL 等无 Tab 上下文时） */
  function getLeaseByProfile(
    profileId: string,
    kind?: ConnKind,
  ): SessionLease | null {
    for (const lease of leases.value.values()) {
      if (lease.profileId !== profileId) continue
      if (kind && lease.kind !== kind) continue
      return lease
    }
    return null
  }

  function getSessionIdForProfile(profileId: string, kind?: ConnKind): string | null {
    return getLeaseByProfile(profileId, kind)?.sessionId ?? null
  }

  function getDialectForProfile(profileId: string, kind?: ConnKind): SqlServerProfile | null {
    return getLeaseByProfile(profileId, kind)?.dialect ?? null
  }

  /**
   * 能力进程崩溃：清掉该协议全部 lease，不调用 session.close（对端已不在）。
   * Tab 保留，用户可点重连。
   *
   * @param kind - 连接协议（与 manifest `bridge.namespace` 相同）
   * @returns 被清理的 lease 数量
   */
  async function markKindLost(kind: ConnKind): Promise<number> {
    const targets = [...leases.value.values()].filter((lease) => lease.kind === kind)
    for (const lease of targets) {
      for (const binding of lease.tabBindings.values()) {
        await runTabRelease(binding)
      }
      lease.tabBindings.clear()
      clearIdleTimer(lease)
      replaceLeases((map) => {
        map.delete(lease.key)
      })
    }
    return targets.length
  }

  /**
   * 单条能力会话意外断开：只清匹配 sessionId 的 lease，不调用 session.close。
   * sessionId 为 `*` 时与进程崩溃相同，清掉该协议全部 lease。
   */
  async function markSessionLost(kind: ConnKind, sessionId: string): Promise<number> {
    const id = sessionId.trim()
    if (!id || id === '*') {
      return markKindLost(kind)
    }
    const targets = [...leases.value.values()].filter(
      (lease) => lease.kind === kind && lease.sessionId === id,
    )
    for (const lease of targets) {
      for (const binding of lease.tabBindings.values()) {
        await runTabRelease(binding)
      }
      lease.tabBindings.clear()
      clearIdleTimer(lease)
      replaceLeases((map) => {
        map.delete(lease.key)
      })
    }
    return targets.length
  }

  return {
    /** 只读租约表（调试 / 连接树响应式） */
    leases,
    acquire,
    release,
    releaseMany,
    forceReconnect,
    disconnect,
    isProfileConnected,
    getSessionIdForTab,
    getDialectForSession,
    getDialectForTab,
    getLeaseByProfile,
    getSessionIdForProfile,
    getDialectForProfile,
    markKindLost,
    markSessionLost,
  }
})
