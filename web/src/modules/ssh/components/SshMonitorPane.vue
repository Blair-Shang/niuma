<script setup lang="ts">
import { RsButton, RsIcon, RsLoading, useRsToast } from '@niuma/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { sshApi } from '@/api'
import { type MonitorAutoInterval, type SshMetrics, useSshMonitor } from '@/modules/ssh/composables/useSshMonitor'
import type { SshProcessDetail, SshProcessMetric } from '@/api/types/ssh'

const props = defineProps<{
  sessionId: string | null
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()
const monitorTab = ref<'overview' | 'network' | 'disk'>('overview')
const networkScope = ref<'filtered' | 'all'>('filtered')

const sessionIdRef = computed(() => props.sessionId)
const { metrics, loading, error, autoInterval, refresh, setAutoInterval, applyAutoInterval, stopAutoInterval } =
  useSshMonitor(sessionIdRef)
const selectedProcess = ref<SshProcessMetric | null>(null)
const processDetail = ref<SshProcessDetail | null>(null)
const processLoading = ref(false)
const processError = ref<string | null>(null)

/** 首次激活时自动拉取一次 */
watch(
  () => props.active,
  (val) => {
    if (val) {
      if (!metrics.value && !loading.value) {
        void refresh()
      }
      applyAutoInterval()
      return
    }
    stopAutoInterval()
  },
  { immediate: true },
)

onMounted(() => {
  if (props.active && !metrics.value) {
    void refresh()
    applyAutoInterval()
  }
})

// ── 工具函数 ─────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1)
  const val = bytes / Math.pow(1024, i)
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`
}

function formatBps(bps: number): string {
  if (bps <= 0) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.min(Math.floor(Math.log2(bps) / 10), units.length - 1)
  const val = bps / Math.pow(1024, i)
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`
}

function usagePct(used: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((used / total) * 100)
}

function safePct(used: number, total: number): string {
  return `${usagePct(used, total)}%`
}

function usageColor(pct: number): string {
  if (pct >= 90) return 'var(--rs-danger)'
  if (pct >= 70) return 'var(--rs-warning)'
  return 'var(--rs-success)'
}

function loadColor(load: number, cores: number): string {
  const ratio = cores > 0 ? load / cores : load
  if (ratio >= 1) return 'var(--rs-danger)'
  if (ratio >= 0.7) return 'var(--rs-warning)'
  return 'var(--rs-success)'
}

function relativeTime(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 5) return t('modules.ssh.monitor.justNow')
  if (diff < 60) return t('modules.ssh.monitor.secsAgo', { n: diff })
  return t('modules.ssh.monitor.minsAgo', { n: Math.floor(diff / 60) })
}

const INTERVAL_OPTIONS: { label: string; value: MonitorAutoInterval }[] = [
  { label: '3s', value: 3 },
  { label: '5s', value: 5 },
  { label: '10s', value: 10 },
  { label: '30s', value: 30 },
  { label: '60s', value: 60 },
  { label: t('modules.ssh.monitor.off'), value: 0 },
]

function diskRows(m: SshMetrics) {
  return m.disks.slice(0, 8)
}

function processRows(m: SshMetrics) {
  return m.topProcesses.slice(0, 8)
}

function memoryRows(m: SshMetrics) {
  return m.topMemoryProcesses.slice(0, 8)
}

function fmtPct(value: number): string {
  return `${value.toFixed(1)}%`
}

function formatProcessErrorMessage(pid: number, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  if (raw.includes('not found') || raw.includes('exited') || raw.includes('access denied')) {
    return t('modules.ssh.monitor.processUnavailable', { pid })
  }
  return raw || t('modules.ssh.monitor.processLoadError')
}

function maxDiskUtil(m: SshMetrics): number {
  return m.disks.reduce((max, disk) => Math.max(max, disk.utilPct ?? 0), 0)
}

function totalDiskIops(m: SshMetrics): number {
  return m.disks.reduce((sum, disk) => sum + (disk.iops ?? 0), 0)
}

function diskReadBps(m: SshMetrics): number {
  return m.disks.reduce((sum, disk) => sum + (disk.readBps ?? 0), 0)
}

function diskWriteBps(m: SshMetrics): number {
  return m.disks.reduce((sum, disk) => sum + (disk.writeBps ?? 0), 0)
}

function processDisplayName(proc: SshProcessMetric | null, detail: SshProcessDetail | null): string {
  if (detail?.name && detail.name !== 'N/A') return detail.name
  if (detail?.cmdline && detail.cmdline !== 'N/A') return detail.cmdline
  return proc?.name ?? 'N/A'
}

const visibleNetworkInterfaces = computed(() => {
  const list = metrics.value?.networkInterfaces ?? []
  if (networkScope.value === 'all') return list
  return list.filter((iface) => iface.isPrimary || !iface.name.includes(':'))
})

async function inspectProcess(proc: SshProcessMetric): Promise<void> {
  if (!props.sessionId || processLoading.value) return
  selectedProcess.value = proc
  processLoading.value = true
  processError.value = null
  processDetail.value = null
  try {
    processDetail.value = await sshApi.monitorProcessInspect({
      sessionId: props.sessionId,
      pid: proc.pid,
    })
  } catch (e) {
    processError.value = formatProcessErrorMessage(proc.pid, e)
  } finally {
    processLoading.value = false
  }
}

async function copyCommand(kind: 'ps' | 'top' | 'lsof'): Promise<void> {
  const pid = selectedProcess.value?.pid
  if (!pid) return
  let cmd = `lsof -p ${pid}`
  if (kind === 'ps') {
    cmd = `ps -fp ${pid} && ps -L -p ${pid}`
  } else if (kind === 'top') {
    cmd = `top -Hp ${pid}`
  }
  try {
    await navigator.clipboard.writeText(cmd)
    toast.success(t('modules.ssh.monitor.commandCopied'))
  } catch {
    toast.error(t('modules.ssh.monitor.commandCopyError'))
  }
}

async function refreshSelectedProcess(): Promise<void> {
  if (!selectedProcess.value) return
  await inspectProcess(selectedProcess.value)
}

type HealthAlert = { level: 'critical' | 'warn'; text: string }
type DiskPeak = { name: string; pct: number }
type DiskPeaks = { space: DiskPeak; inode: DiskPeak; util: DiskPeak }

function pushUpperBoundAlert(
  alerts: HealthAlert[],
  value: number,
  criticalAt: number,
  warnAt: number,
  criticalText: () => string,
  warnText: () => string,
): void {
  if (value >= criticalAt) {
    alerts.push({ level: 'critical', text: criticalText() })
  } else if (value >= warnAt) {
    alerts.push({ level: 'warn', text: warnText() })
  }
}

function pushLowerBoundAlert(
  alerts: HealthAlert[],
  value: number,
  criticalAt: number,
  warnAt: number,
  criticalText: () => string,
  warnText: () => string,
): void {
  if (value <= criticalAt) {
    alerts.push({ level: 'critical', text: criticalText() })
  } else if (value <= warnAt) {
    alerts.push({ level: 'warn', text: warnText() })
  }
}

function updateDiskPeak(current: DiskPeak, name: string, pct: number): DiskPeak {
  return pct > current.pct ? { name, pct } : current
}

function diskPeaks(m: SshMetrics): DiskPeaks {
  let space: DiskPeak = { name: '-', pct: 0 }
  let inode: DiskPeak = { name: '-', pct: 0 }
  let util: DiskPeak = { name: '-', pct: 0 }
  for (const disk of m.disks) {
    const name = disk.mountpoint || disk.device
    space = updateDiskPeak(space, name, usagePct(disk.used, disk.total))
    inode = updateDiskPeak(inode, name, disk.inodeTotal > 0 ? usagePct(disk.inodeUsed, disk.inodeTotal) : 0)
    util = updateDiskPeak(util, name, disk.utilPct ?? 0)
  }
  return { space, inode, util }
}

function pushDiskPeakAlert(
  alerts: HealthAlert[],
  peak: DiskPeak,
  criticalKey: string,
  warnKey: string,
  criticalAt = 90,
  warnAt = 80,
): void {
  pushUpperBoundAlert(
    alerts,
    peak.pct,
    criticalAt,
    warnAt,
    () => t(criticalKey, { disk: peak.name, pct: fmtPct(peak.pct) }),
    () => t(warnKey, { disk: peak.name, pct: fmtPct(peak.pct) }),
  )
}

const healthAlerts = computed(() => {
  const m = metrics.value
  if (!m) return []
  const alerts: HealthAlert[] = []
  const memAvailPct = m.memTotal > 0 ? (m.memAvailable / m.memTotal) * 100 : 100
  const disk = diskPeaks(m)
  const syn = m.tcpConnections.synRecv + m.tcpConnections.synSent
  const loadPerCore = m.cpuCores > 0 ? m.loadAvg1 / m.cpuCores : m.loadAvg1

  if (m.cpuUsage >= 90 || loadPerCore >= 1) {
    alerts.push({ level: 'critical', text: t('modules.ssh.monitor.alertCpuHigh', { cpu: fmtPct(m.cpuUsage) }) })
  } else if (m.cpuUsage >= 75 || loadPerCore >= 0.75) {
    alerts.push({ level: 'warn', text: t('modules.ssh.monitor.alertCpuWarn', { cpu: fmtPct(m.cpuUsage) }) })
  }
  pushLowerBoundAlert(
    alerts,
    memAvailPct,
    8,
    15,
    () => t('modules.ssh.monitor.alertMemLow', { pct: fmtPct(memAvailPct) }),
    () => t('modules.ssh.monitor.alertMemWarn', { pct: fmtPct(memAvailPct) }),
  )
  pushDiskPeakAlert(alerts, disk.space, 'modules.ssh.monitor.alertDiskSpaceHigh', 'modules.ssh.monitor.alertDiskSpaceWarn')
  pushDiskPeakAlert(alerts, disk.inode, 'modules.ssh.monitor.alertDiskInodeHigh', 'modules.ssh.monitor.alertDiskInodeWarn')
  pushDiskPeakAlert(alerts, disk.util, 'modules.ssh.monitor.alertDiskIoHigh', 'modules.ssh.monitor.alertDiskIoWarn', 90, 75)
  if (syn >= 200) {
    alerts.push({ level: 'warn', text: t('modules.ssh.monitor.alertTcpSyn', { n: syn }) })
  }
  return alerts
})
</script>

<template>
  <div class="nm-monitor">
    <!-- 工具栏 -->
    <div class="nm-monitor__toolbar">
      <button
        type="button"
        class="nm-monitor__refresh-btn"
        :disabled="loading || !sessionId"
        :title="t('modules.ssh.monitor.refresh')"
        @click="refresh"
      >
        <RsIcon :name="loading ? 'loader-circle' : 'refresh-cw'" :size="13" :class="{ 'nm-monitor__spin': loading }" />
        <span>{{ t('modules.ssh.monitor.refresh') }}</span>
      </button>

      <div class="nm-monitor__auto-row">
        <span class="nm-monitor__label">{{ t('modules.ssh.monitor.autoRefresh') }}</span>
        <div class="nm-monitor__seg">
          <button
            v-for="opt in INTERVAL_OPTIONS"
            :key="opt.value"
            type="button"
            class="nm-monitor__seg-btn"
            :class="{ 'nm-monitor__seg-btn--active': autoInterval === opt.value }"
            @click="setAutoInterval(opt.value)"
          >{{ opt.label }}</button>
        </div>
      </div>

      <span v-if="metrics" class="nm-monitor__updated">
        {{ relativeTime(metrics.collectedAt) }}
      </span>
    </div>

    <!-- 错误提示 -->
    <p v-if="error" class="nm-monitor__error" role="alert">
      <RsIcon name="alert-circle" :size="13" />
      {{ error }}
    </p>

    <!-- 首次加载中 -->
    <div v-if="!metrics && loading" class="nm-monitor__placeholder">
      <RsLoading />
    </div>

    <!-- 未连接 -->
    <div v-else-if="!sessionId" class="nm-monitor__placeholder">
      <span class="nm-monitor__hint">{{ t('modules.ssh.monitor.noSession') }}</span>
    </div>

    <!-- 指标内容 -->
    <div v-else-if="metrics" class="nm-monitor__content">
      <div class="nm-monitor__view-tabs">
        <button
          type="button"
          class="nm-monitor__view-tab"
          :class="{ 'nm-monitor__view-tab--active': monitorTab === 'overview' }"
          @click="monitorTab = 'overview'"
        >
          <RsIcon name="layout-dashboard" :size="12" />
          <span>{{ t('modules.ssh.monitor.overviewTab') }}</span>
        </button>
        <button
          type="button"
          class="nm-monitor__view-tab"
          :class="{ 'nm-monitor__view-tab--active': monitorTab === 'network' }"
          @click="monitorTab = 'network'"
        >
          <RsIcon name="network" :size="12" />
          <span>{{ t('modules.ssh.monitor.networkTab') }}</span>
        </button>
        <button
          type="button"
          class="nm-monitor__view-tab"
          :class="{ 'nm-monitor__view-tab--active': monitorTab === 'disk' }"
          @click="monitorTab = 'disk'"
        >
          <RsIcon name="hard-drive" :size="12" />
          <span>{{ t('modules.ssh.monitor.diskTab') }}</span>
        </button>
      </div>

      <template v-if="monitorTab === 'overview'">
        <div class="nm-monitor__health">
          <div class="nm-monitor__section-title">
            <RsIcon name="shield-alert" :size="12" />
            {{ t('modules.ssh.monitor.health') }}
            <span
              class="nm-monitor__section-summary"
              :title="healthAlerts.length > 0 ? t('modules.ssh.monitor.healthIssues', { n: healthAlerts.length }) : t('modules.ssh.monitor.healthOk')"
            >
              {{ healthAlerts.length > 0 ? t('modules.ssh.monitor.healthIssues', { n: healthAlerts.length }) : t('modules.ssh.monitor.healthOk') }}
            </span>
          </div>
          <div v-if="healthAlerts.length > 0" class="nm-monitor__alert-list">
            <div
              v-for="(item, idx) in healthAlerts"
              :key="`${item.level}-${idx}`"
              class="nm-monitor__alert-item"
              :title="item.text"
              :class="{
                'nm-monitor__alert-item--critical': item.level === 'critical',
                'nm-monitor__alert-item--warn': item.level === 'warn',
              }"
            >
              <RsIcon :name="item.level === 'critical' ? 'triangle-alert' : 'circle-alert'" :size="12" />
              <span>{{ item.text }}</span>
            </div>
          </div>
          <div v-else class="nm-monitor__alert-ok">
            <RsIcon name="shield-check" :size="12" />
            <span>{{ t('modules.ssh.monitor.healthNoIssue') }}</span>
          </div>
        </div>

        <div class="nm-monitor__grid">
          <div class="nm-monitor__card">
            <div class="nm-monitor__card-title">
              <RsIcon name="cpu" :size="12" />
              {{ t('modules.ssh.monitor.cpu') }}
            </div>
            <div class="nm-monitor__model" :title="metrics.cpuModel">{{ metrics.cpuModel }}</div>
            <div class="nm-monitor__meta">
              {{ t('modules.ssh.monitor.cores', { n: metrics.cpuCores }) }}
            </div>
            <div class="nm-monitor__progress-row">
              <div class="nm-monitor__progress-bar">
                <div
                  class="nm-monitor__progress-fill"
                  :style="{ width: `${Math.min(metrics.cpuUsage, 100)}%`, background: usageColor(metrics.cpuUsage) }"
                />
              </div>
              <span class="nm-monitor__pct" :style="{ color: usageColor(metrics.cpuUsage) }">
                {{ metrics.cpuUsage.toFixed(1) }}%
              </span>
            </div>
          </div>

          <div class="nm-monitor__card">
            <div class="nm-monitor__card-title">
              <RsIcon name="memory-stick" :size="12" />
              {{ t('modules.ssh.monitor.memory') }}
            </div>
            <div class="nm-monitor__meta">
              {{ formatBytes(metrics.memUsed) }} / {{ formatBytes(metrics.memTotal) }}
            </div>
            <div class="nm-monitor__progress-row">
              <div class="nm-monitor__progress-bar">
                <div
                  class="nm-monitor__progress-fill"
                  :style="{
                    width: `${usagePct(metrics.memUsed, metrics.memTotal)}%`,
                    background: usageColor(usagePct(metrics.memUsed, metrics.memTotal)),
                  }"
                />
              </div>
              <span
                class="nm-monitor__pct"
                :style="{ color: usageColor(usagePct(metrics.memUsed, metrics.memTotal)) }"
              >
                {{ usagePct(metrics.memUsed, metrics.memTotal) }}%
              </span>
            </div>
            <div v-if="metrics.swapTotal > 0" class="nm-monitor__swap">
              <span>SWAP</span>
              <span>{{ formatBytes(metrics.swapUsed) }} / {{ formatBytes(metrics.swapTotal) }}</span>
            </div>
            <div class="nm-monitor__kv-grid">
              <div class="nm-monitor__kv-item">
                <span>{{ t('modules.ssh.monitor.memAvailable') }}</span>
                <strong :title="formatBytes(metrics.memAvailable)">{{ formatBytes(metrics.memAvailable) }}</strong>
              </div>
              <div class="nm-monitor__kv-item">
                <span>{{ t('modules.ssh.monitor.memCached') }}</span>
                <strong :title="formatBytes(metrics.memCached)">{{ formatBytes(metrics.memCached) }}</strong>
              </div>
              <div class="nm-monitor__kv-item">
                <span>{{ t('modules.ssh.monitor.memBuffers') }}</span>
                <strong :title="formatBytes(metrics.memBuffers)">{{ formatBytes(metrics.memBuffers) }}</strong>
              </div>
              <div class="nm-monitor__kv-item">
                <span>{{ t('modules.ssh.monitor.memSlab') }}</span>
                <strong :title="formatBytes(metrics.memSlab)">{{ formatBytes(metrics.memSlab) }}</strong>
              </div>
            </div>
          </div>

          <div class="nm-monitor__card">
            <div class="nm-monitor__card-title">
              <RsIcon name="plug-zap" :size="12" />
              {{ t('modules.ssh.monitor.tcp') }}
            </div>
            <div class="nm-monitor__info-row">
              <span class="nm-monitor__info-key">{{ t('modules.ssh.monitor.tcpTotal') }}</span>
              <span class="nm-monitor__info-val" :title="String(metrics.tcpConnections.total)">{{ metrics.tcpConnections.total }}</span>
            </div>
            <div class="nm-monitor__info-row">
              <span class="nm-monitor__info-key">ESTAB</span>
              <span class="nm-monitor__info-val" :title="String(metrics.tcpConnections.established)">{{ metrics.tcpConnections.established }}</span>
            </div>
            <div class="nm-monitor__info-row">
              <span class="nm-monitor__info-key">LISTEN</span>
              <span class="nm-monitor__info-val" :title="String(metrics.tcpConnections.listen)">{{ metrics.tcpConnections.listen }}</span>
            </div>
            <div class="nm-monitor__info-row">
              <span class="nm-monitor__info-key">TIME_WAIT</span>
              <span
                class="nm-monitor__info-val"
                :title="`${metrics.tcpConnections.timeWait} / SYN ${metrics.tcpConnections.synSent + metrics.tcpConnections.synRecv}`"
              >
                {{ metrics.tcpConnections.timeWait }} / SYN {{ metrics.tcpConnections.synSent + metrics.tcpConnections.synRecv }}
              </span>
            </div>
          </div>

          <div class="nm-monitor__card">
            <div class="nm-monitor__card-title">
              <RsIcon name="server" :size="12" />
              {{ t('modules.ssh.monitor.system') }}
            </div>
            <div class="nm-monitor__info-row">
              <span class="nm-monitor__info-key">{{ t('modules.ssh.monitor.os') }}</span>
              <span class="nm-monitor__info-val" :title="metrics.osName">{{ metrics.osName }}</span>
            </div>
            <div class="nm-monitor__info-row">
              <span class="nm-monitor__info-key">{{ t('modules.ssh.monitor.kernel') }}</span>
              <span class="nm-monitor__info-val" :title="metrics.kernelVersion">{{ metrics.kernelVersion }}</span>
            </div>
            <div class="nm-monitor__info-row">
              <span class="nm-monitor__info-key">{{ t('modules.ssh.monitor.uptime') }}</span>
              <span class="nm-monitor__info-val" :title="metrics.uptime">{{ metrics.uptime }}</span>
            </div>
            <div class="nm-monitor__info-row">
              <span class="nm-monitor__info-key">{{ t('modules.ssh.monitor.procs') }}</span>
              <span
                class="nm-monitor__info-val"
                :title="`${metrics.processes} ${t('modules.ssh.monitor.procsUnit')} / ${metrics.threads} ${t('modules.ssh.monitor.threadsUnit')}`"
              >
                {{ metrics.processes }} {{ t('modules.ssh.monitor.procsUnit') }} /
                {{ metrics.threads }} {{ t('modules.ssh.monitor.threadsUnit') }}
              </span>
            </div>
          </div>

          <div class="nm-monitor__card">
            <div class="nm-monitor__card-title">
              <RsIcon name="activity" :size="12" />
              {{ t('modules.ssh.monitor.loadAvg') }}
            </div>
            <div class="nm-monitor__load-item">
              <span class="nm-monitor__load-label">1 min</span>
              <span
                class="nm-monitor__load-val"
                :style="{ color: loadColor(metrics.loadAvg1, metrics.cpuCores) }"
              >{{ metrics.loadAvg1.toFixed(2) }}</span>
            </div>
            <div class="nm-monitor__load-item">
              <span class="nm-monitor__load-label">5 min</span>
              <span
                class="nm-monitor__load-val"
                :style="{ color: loadColor(metrics.loadAvg5, metrics.cpuCores) }"
              >{{ metrics.loadAvg5.toFixed(2) }}</span>
            </div>
            <div class="nm-monitor__load-item">
              <span class="nm-monitor__load-label">15 min</span>
              <span
                class="nm-monitor__load-val"
                :style="{ color: loadColor(metrics.loadAvg15, metrics.cpuCores) }"
              >{{ metrics.loadAvg15.toFixed(2) }}</span>
            </div>
          </div>
        </div>

        <div v-if="metrics.cpuCoresDetail.length > 0" class="nm-monitor__section">
          <div class="nm-monitor__section-title">
            <RsIcon name="cpu" :size="12" />
            {{ t('modules.ssh.monitor.cpuPerCore') }}
          </div>
          <div class="nm-monitor__core-grid">
            <div
              v-for="core in metrics.cpuCoresDetail"
              :key="core.core"
              class="nm-monitor__core-item"
              :title="`${t('modules.ssh.monitor.coreLabel', { n: core.core })}: ${core.usage.toFixed(1)}%`"
            >
              <div class="nm-monitor__core-bar-wrap">
                <div
                  class="nm-monitor__core-bar"
                  :style="{ height: `${Math.min(core.usage, 100)}%`, background: usageColor(core.usage) }"
                />
              </div>
              <span class="nm-monitor__core-label">{{ core.core }}</span>
              <span class="nm-monitor__core-pct" :style="{ color: usageColor(core.usage) }">
                {{ core.usage.toFixed(0) }}%
              </span>
            </div>
          </div>
        </div>

        <div v-if="metrics.topProcesses.length > 0" class="nm-monitor__section">
          <div class="nm-monitor__section-title">
            <RsIcon name="list" :size="12" />
            {{ t('modules.ssh.monitor.topProcesses') }}
          </div>
          <div class="nm-monitor__proc-list">
            <div class="nm-monitor__proc-head">
              <span>{{ t('modules.ssh.monitor.procPid') }}</span>
              <span>{{ t('modules.ssh.monitor.procUser') }}</span>
              <span>{{ t('modules.ssh.monitor.procThreads') }}</span>
              <span>{{ t('modules.ssh.monitor.procName') }}</span>
              <span>{{ t('modules.ssh.monitor.procCpu') }}</span>
              <span>{{ t('modules.ssh.monitor.procMem') }}</span>
              <span>{{ t('modules.ssh.monitor.procRss') }}</span>
            </div>
            <div
              v-for="proc in processRows(metrics)"
              :key="proc.pid"
              class="nm-monitor__proc-item"
              :class="{ 'nm-monitor__proc-item--active': selectedProcess?.pid === proc.pid }"
              @click="() => void inspectProcess(proc)"
            >
              <span class="nm-monitor__proc-pid">{{ proc.pid }}</span>
              <span class="nm-monitor__proc-user" :title="proc.user">{{ proc.user }}</span>
              <span class="nm-monitor__proc-threads">{{ proc.threads }}</span>
              <span class="nm-monitor__proc-name" :title="proc.name">{{ proc.name }}</span>
              <span class="nm-monitor__proc-cpu" :style="{ color: usageColor(proc.cpuPct) }">
                {{ fmtPct(proc.cpuPct) }}
              </span>
              <span class="nm-monitor__proc-mem">{{ fmtPct(proc.memPct) }}</span>
              <span class="nm-monitor__proc-rss">{{ formatBytes(proc.rss) }}</span>
            </div>
          </div>
        </div>

        <div v-if="metrics.topMemoryProcesses.length > 0" class="nm-monitor__section">
          <div class="nm-monitor__section-title">
            <RsIcon name="memory-stick" :size="12" />
            {{ t('modules.ssh.monitor.topMemoryProcesses') }}
          </div>
          <div class="nm-monitor__proc-list">
            <div class="nm-monitor__proc-head">
              <span>{{ t('modules.ssh.monitor.procPid') }}</span>
              <span>{{ t('modules.ssh.monitor.procUser') }}</span>
              <span>{{ t('modules.ssh.monitor.procThreads') }}</span>
              <span>{{ t('modules.ssh.monitor.procName') }}</span>
              <span>{{ t('modules.ssh.monitor.procCpu') }}</span>
              <span>{{ t('modules.ssh.monitor.procMem') }}</span>
              <span>{{ t('modules.ssh.monitor.procRss') }}</span>
            </div>
            <div
              v-for="proc in memoryRows(metrics)"
              :key="`${proc.pid}-mem`"
              class="nm-monitor__proc-item"
              :class="{ 'nm-monitor__proc-item--active': selectedProcess?.pid === proc.pid }"
              @click="() => void inspectProcess(proc)"
            >
              <span class="nm-monitor__proc-pid">{{ proc.pid }}</span>
              <span class="nm-monitor__proc-user" :title="proc.user">{{ proc.user }}</span>
              <span class="nm-monitor__proc-threads">{{ proc.threads }}</span>
              <span class="nm-monitor__proc-name" :title="proc.name">{{ proc.name }}</span>
              <span class="nm-monitor__proc-cpu">{{ fmtPct(proc.cpuPct) }}</span>
              <span class="nm-monitor__proc-cpu" :style="{ color: usageColor(proc.memPct) }">
                {{ fmtPct(proc.memPct) }}
              </span>
              <span class="nm-monitor__proc-rss">{{ formatBytes(proc.rss) }}</span>
            </div>
          </div>
        </div>

        <div v-if="selectedProcess" class="nm-monitor__section">
          <div class="nm-monitor__section-title">
            <RsIcon name="scan-search" :size="12" />
            {{ t('modules.ssh.monitor.processDetail') }}
            <span class="nm-monitor__section-summary" :title="`PID ${selectedProcess.pid}`">PID {{ selectedProcess.pid }}</span>
          </div>
          <div class="nm-monitor__detail-tools">
            <RsButton size="sm" variant="default" @click="() => void refreshSelectedProcess()">
              {{ t('modules.ssh.monitor.refreshDetail') }}
            </RsButton>
            <RsButton size="sm" variant="default" @click="() => void copyCommand('ps')">
              {{ t('modules.ssh.monitor.copyPs') }}
            </RsButton>
            <RsButton size="sm" variant="default" @click="() => void copyCommand('top')">
              {{ t('modules.ssh.monitor.copyTop') }}
            </RsButton>
            <RsButton size="sm" variant="default" @click="() => void copyCommand('lsof')">
              {{ t('modules.ssh.monitor.copyLsof') }}
            </RsButton>
          </div>
          <div v-if="processLoading" class="nm-monitor__detail-loading">
            <RsLoading />
          </div>
          <p v-else-if="processError" class="nm-monitor__error nm-monitor__error--inline">{{ processError }}</p>
          <div v-else-if="processDetail" class="nm-monitor__detail-grid">
            <div class="nm-monitor__detail-item nm-monitor__detail-item--full">
              <span>{{ t('modules.ssh.monitor.procName') }}</span>
              <strong :title="processDisplayName(selectedProcess, processDetail)">{{ processDisplayName(selectedProcess, processDetail) }}</strong>
            </div>
            <div class="nm-monitor__detail-item"><span>PID</span><strong :title="String(processDetail.pid)">{{ processDetail.pid }}</strong></div>
            <div class="nm-monitor__detail-item"><span>PPID</span><strong :title="String(processDetail.ppid)">{{ processDetail.ppid }}</strong></div>
            <div class="nm-monitor__detail-item"><span>{{ t('modules.ssh.monitor.procUser') }}</span><strong :title="processDetail.user">{{ processDetail.user }}</strong></div>
            <div class="nm-monitor__detail-item"><span>{{ t('modules.ssh.monitor.procThreads') }}</span><strong :title="String(processDetail.threads)">{{ processDetail.threads }}</strong></div>
            <div class="nm-monitor__detail-item"><span>{{ t('modules.ssh.monitor.procState') }}</span><strong :title="processDetail.state">{{ processDetail.state }}</strong></div>
            <div class="nm-monitor__detail-item"><span>{{ t('modules.ssh.monitor.procFd') }}</span><strong :title="String(processDetail.fdCount)">{{ processDetail.fdCount }}</strong></div>
            <div class="nm-monitor__detail-item"><span>{{ t('modules.ssh.monitor.procCpu') }}</span><strong :title="fmtPct(processDetail.cpuPct)">{{ fmtPct(processDetail.cpuPct) }}</strong></div>
            <div class="nm-monitor__detail-item"><span>{{ t('modules.ssh.monitor.procMem') }}</span><strong :title="fmtPct(processDetail.memPct)">{{ fmtPct(processDetail.memPct) }}</strong></div>
            <div class="nm-monitor__detail-item"><span>{{ t('modules.ssh.monitor.procRss') }}</span><strong :title="formatBytes(processDetail.rss)">{{ formatBytes(processDetail.rss) }}</strong></div>
            <div class="nm-monitor__detail-item nm-monitor__detail-item--wide"><span>{{ t('modules.ssh.monitor.procStart') }}</span><strong>{{ processDetail.startTime }}</strong></div>
            <div class="nm-monitor__detail-item nm-monitor__detail-item--wide"><span>{{ t('modules.ssh.monitor.procExe') }}</span><strong :title="processDetail.exe">{{ processDetail.exe }}</strong></div>
            <div class="nm-monitor__detail-item nm-monitor__detail-item--wide"><span>{{ t('modules.ssh.monitor.procCwd') }}</span><strong :title="processDetail.cwd">{{ processDetail.cwd }}</strong></div>
            <div class="nm-monitor__detail-item nm-monitor__detail-item--full"><span>{{ t('modules.ssh.monitor.procCmdline') }}</span><strong :title="processDetail.cmdline">{{ processDetail.cmdline }}</strong></div>
          </div>
          <p v-else class="nm-monitor__hint nm-monitor__hint--inline">
            {{ t('modules.ssh.monitor.processDetailHint') }}
          </p>
        </div>
      </template>

      <template v-else-if="monitorTab === 'network'">
        <div class="nm-monitor__subtools">
          <span class="nm-monitor__label">{{ t('modules.ssh.monitor.networkScope') }}</span>
          <div class="nm-monitor__seg">
            <button
              type="button"
              class="nm-monitor__seg-btn"
              :class="{ 'nm-monitor__seg-btn--active': networkScope === 'filtered' }"
              @click="networkScope = 'filtered'"
            >
              {{ t('modules.ssh.monitor.networkScopeFiltered') }}
            </button>
            <button
              type="button"
              class="nm-monitor__seg-btn"
              :class="{ 'nm-monitor__seg-btn--active': networkScope === 'all' }"
              @click="networkScope = 'all'"
            >
              {{ t('modules.ssh.monitor.networkScopeAll') }}
            </button>
          </div>
        </div>

        <div class="nm-monitor__spotlight-grid">
          <div class="nm-monitor__spotlight-card">
            <div class="nm-monitor__spotlight-icon"><RsIcon name="arrow-down" :size="14" /></div>
            <div class="nm-monitor__spotlight-body">
              <span class="nm-monitor__spotlight-label">{{ t('modules.ssh.monitor.netRx') }}</span>
              <strong class="nm-monitor__spotlight-value">{{ formatBps(metrics.networkRxBps) }}</strong>
            </div>
          </div>
          <div class="nm-monitor__spotlight-card">
            <div class="nm-monitor__spotlight-icon"><RsIcon name="arrow-up" :size="14" /></div>
            <div class="nm-monitor__spotlight-body">
              <span class="nm-monitor__spotlight-label">{{ t('modules.ssh.monitor.netTx') }}</span>
              <strong class="nm-monitor__spotlight-value">{{ formatBps(metrics.networkTxBps) }}</strong>
            </div>
          </div>
          <div class="nm-monitor__spotlight-card">
            <div class="nm-monitor__spotlight-icon"><RsIcon name="timer" :size="14" /></div>
            <div class="nm-monitor__spotlight-body">
              <span class="nm-monitor__spotlight-label">{{ t('modules.ssh.monitor.realtimeWindow') }}</span>
              <strong class="nm-monitor__spotlight-value">{{ t('modules.ssh.monitor.realtimeSampling', { n: autoInterval || 0 }) }}</strong>
            </div>
          </div>
        </div>

        <div v-if="visibleNetworkInterfaces.length > 0 || metrics.networkRxBps > 0" class="nm-monitor__section">
          <div class="nm-monitor__section-title">
            <RsIcon name="network" :size="12" />
            {{ t('modules.ssh.monitor.network') }}
            <span
              class="nm-monitor__section-summary"
              :title="`${t('modules.ssh.monitor.realtimeSampling', { n: autoInterval || 0 })} | ↓ ${formatBps(metrics.networkRxBps)} · ↑ ${formatBps(metrics.networkTxBps)}`"
            >
              ↓ {{ formatBps(metrics.networkRxBps) }} · ↑ {{ formatBps(metrics.networkTxBps) }}
            </span>
          </div>
          <div class="nm-monitor__net-list">
            <div class="nm-monitor__net-head">
              <span>{{ t('modules.ssh.monitor.netIface') }}</span>
              <span>{{ t('modules.ssh.monitor.netRx') }}</span>
              <span>{{ t('modules.ssh.monitor.netTx') }}</span>
            </div>
            <div
              v-for="iface in visibleNetworkInterfaces"
              :key="iface.name"
              class="nm-monitor__net-item"
              :title="`${iface.name} | ↓ ${formatBps(iface.rxBps)} | ↑ ${formatBps(iface.txBps)}`"
            >
              <span class="nm-monitor__net-name" :title="iface.name">
                {{ iface.name }}
                <em v-if="iface.isPrimary" class="nm-monitor__net-badge">{{ t('modules.ssh.monitor.primaryIface') }}</em>
              </span>
              <span class="nm-monitor__net-rx" :title="`↓ ${formatBps(iface.rxBps)}`">↓ {{ formatBps(iface.rxBps) }}</span>
              <span class="nm-monitor__net-tx" :title="`↑ ${formatBps(iface.txBps)}`">↑ {{ formatBps(iface.txBps) }}</span>
            </div>
          </div>
        </div>

        <div class="nm-monitor__section">
          <div class="nm-monitor__section-title">
            <RsIcon name="plug-zap" :size="12" />
            {{ t('modules.ssh.monitor.tcp') }}
          </div>
          <div class="nm-monitor__spotlight-grid nm-monitor__spotlight-grid--compact">
            <div class="nm-monitor__spotlight-card">
              <div class="nm-monitor__spotlight-body">
                <span class="nm-monitor__spotlight-label">{{ t('modules.ssh.monitor.tcpTotal') }}</span>
                <strong class="nm-monitor__spotlight-value">{{ metrics.tcpConnections.total }}</strong>
              </div>
            </div>
            <div class="nm-monitor__spotlight-card">
              <div class="nm-monitor__spotlight-body">
                <span class="nm-monitor__spotlight-label">ESTAB</span>
                <strong class="nm-monitor__spotlight-value">{{ metrics.tcpConnections.established }}</strong>
              </div>
            </div>
            <div class="nm-monitor__spotlight-card">
              <div class="nm-monitor__spotlight-body">
                <span class="nm-monitor__spotlight-label">SYN</span>
                <strong class="nm-monitor__spotlight-value">{{ metrics.tcpConnections.synSent + metrics.tcpConnections.synRecv }}</strong>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="nm-monitor__spotlight-grid">
          <div class="nm-monitor__spotlight-card">
            <div class="nm-monitor__spotlight-icon"><RsIcon name="gauge" :size="14" /></div>
            <div class="nm-monitor__spotlight-body">
              <span class="nm-monitor__spotlight-label">{{ t('modules.ssh.monitor.diskIops') }}</span>
              <strong class="nm-monitor__spotlight-value">{{ totalDiskIops(metrics).toFixed(1) }}</strong>
            </div>
          </div>
          <div class="nm-monitor__spotlight-card">
            <div class="nm-monitor__spotlight-icon"><RsIcon name="arrow-down-up" :size="14" /></div>
            <div class="nm-monitor__spotlight-body">
              <span class="nm-monitor__spotlight-label">{{ t('modules.ssh.monitor.diskIoThroughput') }}</span>
              <strong class="nm-monitor__spotlight-value">↓ {{ formatBps(diskReadBps(metrics)) }} · ↑ {{ formatBps(diskWriteBps(metrics)) }}</strong>
            </div>
          </div>
          <div class="nm-monitor__spotlight-card">
            <div class="nm-monitor__spotlight-icon"><RsIcon name="hard-drive" :size="14" /></div>
            <div class="nm-monitor__spotlight-body">
              <span class="nm-monitor__spotlight-label">{{ t('modules.ssh.monitor.diskUtilPeak') }}</span>
              <strong class="nm-monitor__spotlight-value" :style="{ color: usageColor(maxDiskUtil(metrics)) }">{{ fmtPct(maxDiskUtil(metrics)) }}</strong>
            </div>
          </div>
        </div>

        <div v-if="metrics.disks.length > 0" class="nm-monitor__disk-section">
          <div class="nm-monitor__disk-title">
            <RsIcon name="hard-drive" :size="12" />
            {{ t('modules.ssh.monitor.disk') }}
          </div>
          <div class="nm-monitor__disk-list">
            <div
              v-for="disk in diskRows(metrics)"
              :key="disk.device"
              class="nm-monitor__disk-item"
            >
              <span class="nm-monitor__disk-mount" :title="disk.mountpoint">{{ disk.mountpoint }}</span>
              <span class="nm-monitor__disk-dev" :title="disk.device">{{ disk.device }}</span>
              <div class="nm-monitor__disk-metrics">
                <div class="nm-monitor__disk-bar-row">
                  <div class="nm-monitor__progress-bar nm-monitor__disk-bar">
                    <div
                      class="nm-monitor__progress-fill"
                      :style="{
                        width: `${usagePct(disk.used, disk.total)}%`,
                        background: usageColor(usagePct(disk.used, disk.total)),
                      }"
                    />
                  </div>
                  <span class="nm-monitor__disk-pct" :style="{ color: usageColor(usagePct(disk.used, disk.total)) }">
                    {{ safePct(disk.used, disk.total) }}
                  </span>
                  <span
                    class="nm-monitor__disk-size"
                    :title="`${formatBytes(disk.used)} / ${formatBytes(disk.total)}`"
                  >{{ formatBytes(disk.used) }} / {{ formatBytes(disk.total) }}</span>
                </div>
                <div
                  v-if="disk.inodeTotal > 0"
                  class="nm-monitor__disk-subline"
                  :title="`${t('modules.ssh.monitor.inode')} ${safePct(disk.inodeUsed, disk.inodeTotal)} | ${disk.inodeUsed} / ${disk.inodeTotal}`"
                >
                  <span>{{ t('modules.ssh.monitor.inode') }}</span>
                  <span :style="{ color: usageColor(usagePct(disk.inodeUsed, disk.inodeTotal)) }">
                    {{ safePct(disk.inodeUsed, disk.inodeTotal) }}
                  </span>
                  <span>{{ disk.inodeUsed }} / {{ disk.inodeTotal }}</span>
                </div>
                <div
                  class="nm-monitor__disk-subline"
                  :title="`${t('modules.ssh.monitor.diskIops')} ${disk.iops.toFixed(1)} | ↓ ${formatBps(disk.readBps)} | ↑ ${formatBps(disk.writeBps)} | util ${fmtPct(disk.utilPct)}`"
                >
                  <span>{{ t('modules.ssh.monitor.diskIops') }} {{ disk.iops.toFixed(1) }}</span>
                  <span>↓ {{ formatBps(disk.readBps) }}</span>
                  <span>↑ {{ formatBps(disk.writeBps) }}</span>
                  <span :style="{ color: usageColor(disk.utilPct) }">
                    util {{ fmtPct(disk.utilPct) }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.nm-monitor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-text);
}

/* ── 工具栏 ── */
.nm-monitor__toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
  padding: var(--rs-space-xs) var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--nm-frame-bg);
}

.nm-monitor__refresh-btn {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  padding: 2px var(--rs-space-sm);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-xs);
  background: transparent;
  color: var(--rs-text);
  font-size: var(--rs-font-size-xs);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--rs-transition-fast);
}

.nm-monitor__refresh-btn:hover:not(:disabled) {
  background: var(--rs-item-hover);
}

.nm-monitor__refresh-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.nm-monitor__spin {
  animation: nm-spin 1s linear infinite;
}

@keyframes nm-spin {
  to { transform: rotate(360deg); }
}

.nm-monitor__auto-row {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
}

.nm-monitor__label {
  color: var(--rs-muted);
  white-space: nowrap;
}

.nm-monitor__seg {
  display: flex;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-xs);
  overflow: hidden;
}

.nm-monitor__seg-btn {
  padding: 1px 8px;
  border: none;
  border-right: 1px solid var(--rs-border-subtle);
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  cursor: pointer;
  transition: background var(--rs-transition-fast), color var(--rs-transition-fast);
}

.nm-monitor__seg-btn:last-child {
  border-right: none;
}

.nm-monitor__seg-btn:hover {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.nm-monitor__seg-btn--active {
  background: var(--rs-primary-container);
  color: var(--rs-on-primary-container);
}

.nm-monitor__updated {
  margin-left: auto;
  color: var(--rs-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* ── 错误/占位 ── */
.nm-monitor__error {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  margin: var(--rs-space-sm);
  padding: var(--rs-space-xs) var(--rs-space-sm);
  border-radius: var(--rs-radius-xs);
  background: var(--rs-danger-container);
  color: var(--rs-on-danger-container);
  font-size: var(--rs-font-size-xs);
}

.nm-monitor__error--inline {
  margin: var(--rs-space-sm);
}

.nm-monitor__placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-monitor__hint {
  color: var(--rs-muted);
}

.nm-monitor__hint--inline {
  padding: var(--rs-space-sm);
}

/* ── 内容区域 ── */
.nm-monitor__content {
  flex: 0 0 auto;
  min-height: 0;
  overflow: visible;
  padding: var(--rs-space-sm);
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}

.nm-monitor__view-tabs {
  display: flex;
  gap: var(--rs-space-xs);
  flex-wrap: wrap;
}

.nm-monitor__subtools {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex-wrap: wrap;
}

.nm-monitor__view-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-xs);
  padding: 4px 10px;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-xs);
  background: var(--rs-surface-elevated);
  color: var(--rs-muted);
  font-size: 11px;
  cursor: pointer;
}

.nm-monitor__view-tab:hover {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.nm-monitor__view-tab--active {
  background: var(--rs-primary-container);
  color: var(--rs-on-primary-container);
  border-color: color-mix(in srgb, var(--rs-primary) 40%, var(--rs-border-subtle));
}

.nm-monitor__spotlight-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--rs-space-sm);
}

.nm-monitor__spotlight-grid--compact {
  padding: var(--rs-space-sm);
}

.nm-monitor__spotlight-card {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-sm);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-elevated);
}

.nm-monitor__spotlight-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--rs-radius-full);
  background: color-mix(in srgb, var(--rs-primary) 14%, transparent);
  color: var(--rs-primary);
  flex-shrink: 0;
}

.nm-monitor__spotlight-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.nm-monitor__spotlight-label {
  color: var(--rs-table-muted-fg);
  font-size: 10px;
}

.nm-monitor__spotlight-value {
  color: var(--rs-text);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nm-monitor__health {
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-elevated);
  overflow: hidden;
}

.nm-monitor__alert-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--rs-space-sm);
}

.nm-monitor__alert-item {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  padding: 4px var(--rs-space-sm);
  border-radius: var(--rs-radius-xs);
  border: 1px solid var(--rs-border-subtle);
  font-size: 11px;
}

.nm-monitor__alert-item--critical {
  color: var(--rs-danger);
  border-color: color-mix(in srgb, var(--rs-danger) 50%, var(--rs-border-subtle));
  background: color-mix(in srgb, var(--rs-danger-container) 70%, transparent);
}

.nm-monitor__alert-item--warn {
  color: var(--rs-warning);
  border-color: color-mix(in srgb, var(--rs-warning) 50%, var(--rs-border-subtle));
  background: color-mix(in srgb, var(--rs-warning-container) 60%, transparent);
}

.nm-monitor__alert-ok {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  padding: var(--rs-space-sm);
  color: var(--rs-success);
  font-size: 11px;
}

/* ── 指标卡片网格 ── */
.nm-monitor__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--rs-space-sm);
}

.nm-monitor__card {
  padding: var(--rs-space-sm);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-elevated);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nm-monitor__card-title {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  color: var(--rs-muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 2px;
}

.nm-monitor__model {
  color: var(--rs-text);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-monitor__meta {
  color: var(--rs-table-muted-fg);
  font-size: 11px;
}

/* ── 进度条 ── */
.nm-monitor__progress-row {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  margin-top: 2px;
}

.nm-monitor__progress-bar {
  flex: 1;
  height: 5px;
  border-radius: var(--rs-radius-full);
  background: var(--rs-border-subtle);
  overflow: hidden;
}

.nm-monitor__progress-fill {
  height: 100%;
  border-radius: var(--rs-radius-full);
  transition: width 0.4s ease, background 0.4s ease;
}

.nm-monitor__pct {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  min-width: 36px;
  text-align: right;
}

/* ── SWAP ── */
.nm-monitor__swap {
  display: flex;
  justify-content: space-between;
  color: var(--rs-table-muted-fg);
  font-size: 11px;
  margin-top: 2px;
}

.nm-monitor__kv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px var(--rs-space-sm);
  margin-top: 4px;
}

.nm-monitor__kv-item {
  display: flex;
  justify-content: space-between;
  gap: var(--rs-space-xs);
  color: var(--rs-table-muted-fg);
}

.nm-monitor__kv-item strong {
  color: var(--rs-text);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

/* ── 系统信息 ── */
.nm-monitor__info-row {
  display: flex;
  gap: var(--rs-space-xs);
  align-items: baseline;
}

.nm-monitor__info-key {
  color: var(--rs-table-muted-fg);
  white-space: nowrap;
  flex-shrink: 0;
  min-width: 44px;
}

.nm-monitor__info-val {
  color: var(--rs-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* ── 负载 ── */
.nm-monitor__load-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.nm-monitor__load-label {
  color: var(--rs-table-muted-fg);
}

.nm-monitor__load-val {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* ── 磁盘 ── */
.nm-monitor__disk-section {
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-elevated);
  overflow: hidden;
}

.nm-monitor__disk-title {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  padding: var(--rs-space-xs) var(--rs-space-sm);
  color: var(--rs-muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-monitor__disk-list {
  display: flex;
  flex-direction: column;
}

.nm-monitor__disk-item {
  display: grid;
  grid-template-columns: 76px 120px 1fr;
  align-items: center;
  gap: var(--rs-space-sm);
  padding: 4px var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-monitor__disk-item:last-child {
  border-bottom: none;
}

.nm-monitor__disk-mount {
  color: var(--rs-text);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-monitor__disk-dev {
  color: var(--rs-table-muted-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-monitor__disk-bar {
  flex: 1;
}

.nm-monitor__disk-metrics {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.nm-monitor__disk-bar-row {
  display: grid;
  grid-template-columns: 1fr 42px 120px;
  align-items: center;
  gap: var(--rs-space-sm);
}

.nm-monitor__disk-pct {
  font-size: 11px;
  font-weight: 600;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.nm-monitor__disk-size {
  color: var(--rs-table-muted-fg);
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.nm-monitor__disk-subline {
  display: flex;
  gap: var(--rs-space-sm);
  justify-content: flex-end;
  color: var(--rs-table-muted-fg);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

/* ── 通用分区 ── */
.nm-monitor__section {
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-elevated);
  overflow: hidden;
}

.nm-monitor__section-title {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  padding: var(--rs-space-xs) var(--rs-space-sm);
  color: var(--rs-muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-monitor__section-summary {
  margin-left: auto;
  font-weight: 400;
  text-transform: none;
  letter-spacing: normal;
  color: var(--rs-text);
  font-variant-numeric: tabular-nums;
}

/* ── 每核 CPU ── */
.nm-monitor__core-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-sm);
}

.nm-monitor__core-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 36px;
}

.nm-monitor__core-bar-wrap {
  width: 20px;
  height: 48px;
  border-radius: var(--rs-radius-xs);
  background: var(--rs-border-subtle);
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}

.nm-monitor__core-bar {
  width: 100%;
  border-radius: var(--rs-radius-xs) var(--rs-radius-xs) 0 0;
  transition: height 0.4s ease, background 0.4s ease;
  min-height: 2px;
}

.nm-monitor__core-label {
  color: var(--rs-table-muted-fg);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.nm-monitor__core-pct {
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* ── 网络 ── */
.nm-monitor__net-list {
  display: flex;
  flex-direction: column;
}

.nm-monitor__net-head,
.nm-monitor__net-item {
  display: grid;
  grid-template-columns: 100px 1fr 1fr;
  gap: var(--rs-space-sm);
  padding: 4px var(--rs-space-sm);
  align-items: center;
}

.nm-monitor__net-head {
  color: var(--rs-table-muted-fg);
  font-size: 10px;
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-monitor__net-item {
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-monitor__net-item:last-child {
  border-bottom: none;
}

.nm-monitor__net-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  color: var(--rs-text);
}

.nm-monitor__net-badge {
  display: inline-flex;
  align-items: center;
  height: 16px;
  padding: 0 6px;
  border-radius: var(--rs-radius-full);
  background: color-mix(in srgb, var(--rs-primary) 14%, transparent);
  color: var(--rs-primary);
  font-size: 10px;
  font-style: normal;
  white-space: nowrap;
}

.nm-monitor__net-rx,
.nm-monitor__net-tx {
  font-variant-numeric: tabular-nums;
  color: var(--rs-text);
}

.nm-monitor__net-rx {
  color: var(--rs-info);
}

.nm-monitor__net-tx {
  color: var(--rs-success);
}

/* ── 进程 ── */
.nm-monitor__proc-list {
  display: flex;
  flex-direction: column;
}

.nm-monitor__proc-head,
.nm-monitor__proc-item {
  display: grid;
  grid-template-columns: 52px 84px 44px 1fr 52px 52px 72px;
  gap: var(--rs-space-sm);
  padding: 4px var(--rs-space-sm);
  align-items: center;
}

.nm-monitor__proc-head {
  color: var(--rs-table-muted-fg);
  font-size: 10px;
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-monitor__proc-item {
  border-bottom: 1px solid var(--rs-border-subtle);
  cursor: pointer;
}

.nm-monitor__proc-item:last-child {
  border-bottom: none;
}

.nm-monitor__proc-item:hover {
  background: var(--rs-item-hover);
}

.nm-monitor__proc-item--active {
  background: color-mix(in srgb, var(--rs-primary) 14%, transparent);
}

.nm-monitor__proc-pid {
  color: var(--rs-table-muted-fg);
  font-variant-numeric: tabular-nums;
}

.nm-monitor__proc-user,
.nm-monitor__proc-threads {
  color: var(--rs-table-muted-fg);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-monitor__proc-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--rs-text);
}

.nm-monitor__proc-cpu,
.nm-monitor__proc-mem,
.nm-monitor__proc-rss {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.nm-monitor__proc-cpu {
  font-weight: 600;
}

.nm-monitor__proc-mem,
.nm-monitor__proc-rss {
  color: var(--rs-table-muted-fg);
}

.nm-monitor__detail-tools {
  display: flex;
  gap: var(--rs-space-xs);
  flex-wrap: wrap;
  padding: var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-monitor__detail-loading {
  padding: var(--rs-space-sm);
}

.nm-monitor__detail-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--rs-space-sm);
  padding: var(--rs-space-sm);
}

.nm-monitor__detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.nm-monitor__detail-item span {
  color: var(--rs-table-muted-fg);
  font-size: 10px;
}

.nm-monitor__detail-item strong {
  color: var(--rs-text);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-monitor__detail-item--wide {
  grid-column: span 2;
}

.nm-monitor__detail-item--full {
  grid-column: 1 / -1;
}
</style>
