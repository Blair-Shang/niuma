/**
 * ON CLUSTER 选项加载：Keeper 可用性 + meta.clusters + 连接默认集群预填。
 * 供建库 / 危险 DDL / 重命名 / 表设计器复用。
 */
import type { RsSelectOptions } from '@niuma/ui'
import { computed, ref, type Ref } from 'vue'
import { clickhouseApi } from '@/api/clickhouse'
import { uniqueClusterNames } from '@/modules/clickhouse/utils/cluster'

export interface ClickHouseClusterLoadResult {
  supportOnCluster: boolean
  names: string[]
}

/** 探测 Keeper/ZooKeeper；不可用时 ON CLUSTER 会失败（code 139）。 */
async function probeKeeperAvailable(sessionId: string): Promise<boolean> {
  try {
    const result = await clickhouseApi.queryExec({
      sessionId,
      sql: "SELECT count() FROM system.zookeeper WHERE path = '/'",
      limit: 1,
    })
    if (result.resultSetId) {
      await clickhouseApi
        .queryClose({ sessionId, resultSetId: result.resultSetId })
        .catch(() => undefined)
    }
    return true
  } catch {
    return false
  }
}

/**
 * 加载集群名列表。
 * - 传入 sessionId：复用现有会话，不开关 session
 * - 仅 profileId：临时 open/close
 */
export async function loadClickHouseClusterNames(opts: {
  profileId: string
  sessionId?: string | null
}): Promise<ClickHouseClusterLoadResult> {
  const existing = opts.sessionId?.trim()
  if (existing) {
    if (!(await probeKeeperAvailable(existing))) {
      return { supportOnCluster: false, names: [] }
    }
    const result = await clickhouseApi.metaClusters({ sessionId: existing })
    return { supportOnCluster: true, names: uniqueClusterNames(result.hosts) }
  }

  const opened = await clickhouseApi.sessionOpen({ profileId: opts.profileId })
  try {
    if (!(await probeKeeperAvailable(opened.sessionId))) {
      return { supportOnCluster: false, names: [] }
    }
    const result = await clickhouseApi.metaClusters({ sessionId: opened.sessionId })
    return { supportOnCluster: true, names: uniqueClusterNames(result.hosts) }
  } finally {
    await clickhouseApi.sessionClose({ sessionId: opened.sessionId }).catch(() => undefined)
  }
}

export function useClickHouseClusterOptions() {
  const onCluster = ref('')
  const supportOnCluster = ref(false)
  const clusterNames = ref<string[]>([])
  const loading = ref(false)

  const clusterOptions = computed<RsSelectOptions>(() => {
    const names = clusterNames.value
    const cur = onCluster.value.trim()
    const base = names.map((name) => ({ value: name, label: name }))
    if (cur && !names.includes(cur)) {
      return [{ value: cur, label: cur }, ...base]
    }
    return base
  })

  async function reload(opts: {
    profileId: string
    sessionId?: string | null
    preferred?: string
    /** 方言已声明无集群能力时跳过探测 */
    capabilityHint?: boolean
  }): Promise<void> {
    loading.value = true
    supportOnCluster.value = false
    clusterNames.value = []
    onCluster.value = ''
    const pref = opts.preferred?.trim() || ''
    try {
      if (opts.capabilityHint === false) {
        return
      }
      const result = await loadClickHouseClusterNames({
        profileId: opts.profileId,
        sessionId: opts.sessionId,
      })
      supportOnCluster.value = result.supportOnCluster
      clusterNames.value = result.names
      // 连接配置中的默认集群优先预填（可不在 system.clusters 列表中，Select 可 creatable）
      if (pref && result.supportOnCluster) {
        onCluster.value = pref
      }
    } catch {
      supportOnCluster.value = false
      clusterNames.value = []
      onCluster.value = ''
    } finally {
      loading.value = false
    }
  }

  function reset(): void {
    onCluster.value = ''
    supportOnCluster.value = false
    clusterNames.value = []
    loading.value = false
  }

  /** 提交用：不支持或未填则 undefined */
  function resolveOnCluster(): string | undefined {
    if (!supportOnCluster.value) return undefined
    return onCluster.value.trim() || undefined
  }

  return {
    onCluster: onCluster as Ref<string>,
    supportOnCluster: supportOnCluster as Ref<boolean>,
    clusterNames: clusterNames as Ref<string[]>,
    loading: loading as Ref<boolean>,
    clusterOptions,
    reload,
    reset,
    resolveOnCluster,
  }
}
