<script setup lang="ts">
/**
 * 设置 · 关于 · 本机诊断（observe.jsonl / crashes，无外部 APM）。
 */
import { RsButton, RsInput } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import { onMounted, ref } from 'vue'
import { diagApi } from '@/api/diag'
import { fsApi } from '@/api/fs'
import { BridgeError } from '@/api/client'
import type { DiagCrashGroup, DiagEvent, DiagMethodStat, DiagSummaryResult } from '@/api/types/diag'

const { t } = useI18n()

const loading = ref(false)
const error = ref('')
const summary = ref<DiagSummaryResult | null>(null)
const crashes = ref<DiagCrashGroup[]>([])
const traceId = ref('')
const traceHits = ref<DiagEvent[]>([])
const traceBusy = ref(false)
const traceSearched = ref(false)

function errMsg(e: unknown): string {
  const raw = e instanceof BridgeError || e instanceof Error ? e.message : ''
  if (!raw || /cef|shell/i.test(raw)) return t('settings.diagLoadFailed')
  return raw
}

/** 对用户隐藏内部进程名（CEF / Shell / Platform 等） */
function displayService(name: string): string {
  const raw = name.trim()
  const lower = raw.toLowerCase()
  if (lower.includes('cef') || lower === 'shell' || /(?:^|[./_-])shell(?:$|[./_-])/.test(lower)) {
    return t('app.title')
  }
  if (lower === 'platform' || lower.startsWith('platform.') || lower.startsWith('platform-')) {
    return t('settings.diagComponentCore')
  }
  return raw.replace(/-service$/i, '')
}

function displayMethod(method: string): string {
  return method
    .replace(/^(platform|shell|cef)\./i, '')
    .replace(/[-_]service\./i, '.')
}

function resultLabel(ev: DiagEvent): string {
  return ev.ok ? t('settings.diagOk') : ev.errorCode || t('settings.diagFailShort')
}

function formatMs(ms: number): string {
  return `${ms} ms`
}

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [sum, crash] = await Promise.all([diagApi.summary(), diagApi.crashes()])
    summary.value = sum
    crashes.value = crash.groups ?? []
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    loading.value = false
  }
}

async function searchTrace(): Promise<void> {
  const id = traceId.value.trim()
  if (!id) return
  traceBusy.value = true
  error.value = ''
  try {
    const r = await diagApi.trace({ traceId: id })
    traceHits.value = r.events ?? []
    traceSearched.value = true
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    traceBusy.value = false
  }
}

async function openLogDir(): Promise<void> {
  const dir = summary.value?.dir
  if (!dir) return
  try {
    await fsApi.showInFolder({ path: dir })
  } catch (e) {
    error.value = errMsg(e)
  }
}

onMounted(() => {
  void refresh()
})

function methodRows(): DiagMethodStat[] {
  return summary.value?.methods ?? []
}
</script>

<template>
  <div class="nm-diag">
    <div class="nm-diag__head">
      <div class="nm-diag__head-text">
        <p class="nm-diag__title">{{ t('settings.diagTitle') }}</p>
        <p class="nm-diag__desc">{{ t('settings.diagDesc') }}</p>
      </div>
      <div class="nm-diag__actions">
        <RsButton variant="secondary" size="sm" :disabled="loading" @click="refresh">
          {{ t('settings.diagRefresh') }}
        </RsButton>
        <RsButton variant="ghost" size="sm" :disabled="!summary?.dir" @click="openLogDir">
          {{ t('settings.diagOpenDir') }}
        </RsButton>
      </div>
    </div>

    <p v-if="error" class="nm-diag__err">{{ error }}</p>

    <div v-if="summary" class="nm-diag__stats">
      <div class="nm-diag__stat">
        <span class="nm-diag__stat-label">{{ t('settings.diagRpc') }}</span>
        <span class="nm-diag__stat-value">{{ summary.rpcTotal }}</span>
      </div>
      <div class="nm-diag__stat" :class="{ 'nm-diag__stat--warn': summary.failTotal > 0 }">
        <span class="nm-diag__stat-label">{{ t('settings.diagFail') }}</span>
        <span class="nm-diag__stat-value">{{ summary.failTotal }}</span>
      </div>
      <div class="nm-diag__stat" :class="{ 'nm-diag__stat--slow': summary.slowTotal > 0 }">
        <span class="nm-diag__stat-label">{{ t('settings.diagSlow') }}</span>
        <span class="nm-diag__stat-value">{{ summary.slowTotal }}</span>
        <span class="nm-diag__stat-hint">≥ {{ formatMs(summary.slowMs) }}</span>
      </div>
    </div>

    <div class="nm-diag__trace">
      <RsInput v-model="traceId" size="sm" :placeholder="t('settings.diagTracePlaceholder')" />
      <RsButton variant="secondary" size="sm" :disabled="traceBusy || !traceId.trim()" @click="searchTrace">
        {{ t('settings.diagTraceSearch') }}
      </RsButton>
    </div>
    <p v-if="traceSearched && traceHits.length === 0 && !traceBusy" class="nm-diag__empty">
      {{ t('settings.diagTraceEmpty') }}
    </p>
    <div v-if="traceHits.length" class="nm-diag__table-wrap">
      <table class="nm-diag__table">
        <thead>
          <tr>
            <th>{{ t('settings.diagColService') }}</th>
            <th>{{ t('settings.diagColMethod') }}</th>
            <th>{{ t('settings.diagColMs') }}</th>
            <th>{{ t('settings.diagColCode') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(ev, i) in traceHits" :key="i">
            <td>{{ displayService(ev.service) }}</td>
            <td>{{ displayMethod(ev.method) }}</td>
            <td>{{ formatMs(ev.durationMs) }}</td>
            <td>
              <span
                class="nm-diag__pill"
                :class="ev.ok ? 'nm-diag__pill--ok' : 'nm-diag__pill--fail'"
              >
                {{ resultLabel(ev) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="nm-diag__block">
      <h2 class="nm-diag__h">{{ t('settings.diagMethods') }}</h2>
      <div v-if="methodRows().length" class="nm-diag__table-wrap">
        <table class="nm-diag__table">
          <thead>
            <tr>
              <th>{{ t('settings.diagColMethod') }}</th>
              <th>{{ t('settings.diagRpc') }}</th>
              <th>{{ t('settings.diagFail') }}</th>
              <th>{{ t('settings.diagColMaxMs') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in methodRows()" :key="row.method">
              <td>{{ displayMethod(row.method) }}</td>
              <td>{{ row.count }}</td>
              <td>{{ row.fail }}</td>
              <td>{{ formatMs(row.maxMs) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="nm-diag__empty">{{ t('settings.diagNoRpc') }}</p>
    </div>

    <div class="nm-diag__block">
      <h2 class="nm-diag__h">{{ t('settings.diagCrashes') }}</h2>
      <div v-if="crashes.length" class="nm-diag__table-wrap">
        <table class="nm-diag__table">
          <thead>
            <tr>
              <th>{{ t('settings.diagColService') }}</th>
              <th>{{ t('settings.diagColSig') }}</th>
              <th>{{ t('settings.diagRpc') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in crashes" :key="g.signature">
              <td>{{ displayService(g.service) }}</td>
              <td>{{ g.signature }}</td>
              <td>{{ g.count }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="nm-diag__empty">{{ t('settings.diagNoCrash') }}</p>
    </div>
  </div>
</template>

<style scoped>
.nm-diag {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  margin-top: var(--rs-space-lg);
  padding: var(--rs-space-lg);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius);
  background: var(--rs-surface-elevated, var(--rs-surface));
}

.nm-diag__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
}

.nm-diag__title {
  margin: 0;
  font-size: var(--nm-font-body);
  font-weight: 600;
  color: var(--rs-text);
}

.nm-diag__desc {
  margin: 0.25rem 0 0;
  font-size: var(--nm-font-caption);
  color: var(--rs-muted);
  line-height: 1.5;
}

.nm-diag__actions {
  display: flex;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
}

.nm-diag__err {
  margin: 0;
  font-size: var(--nm-font-caption);
  color: var(--rs-danger, #c0392b);
}

.nm-diag__empty {
  margin: 0;
  font-size: var(--nm-font-caption);
  color: var(--rs-muted);
}

.nm-diag__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--rs-space-sm);
}

.nm-diag__stat {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.7rem 0.8rem;
  border-radius: var(--rs-radius-sm);
  background: color-mix(in srgb, var(--rs-text) 4%, transparent);
}

.nm-diag__stat--warn {
  background: color-mix(in srgb, var(--rs-danger, #c0392b) 10%, transparent);
}

.nm-diag__stat--slow {
  background: color-mix(in srgb, var(--rs-warning, #d97706) 10%, transparent);
}

.nm-diag__stat-label {
  font-size: var(--nm-font-caption);
  color: var(--rs-muted);
}

.nm-diag__stat-value {
  font-size: 1.15rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  color: var(--rs-text);
}

.nm-diag__stat-hint {
  font-size: var(--nm-font-caption);
  color: var(--rs-muted);
}

.nm-diag__trace {
  display: flex;
  gap: var(--rs-space-sm);
  align-items: center;
}

.nm-diag__trace :deep(.rs-input) {
  flex: 1;
}

.nm-diag__block {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}

.nm-diag__h {
  margin: 0;
  font-size: var(--nm-font-body);
  font-weight: 600;
  color: var(--rs-text);
}

.nm-diag__table-wrap {
  overflow-x: auto;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
}

.nm-diag__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--nm-font-caption);
}

.nm-diag__table th,
.nm-diag__table td {
  text-align: left;
  padding: 0.45rem 0.7rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  vertical-align: top;
}

.nm-diag__table tr:last-child td {
  border-bottom: none;
}

.nm-diag__table th {
  color: var(--rs-muted);
  font-weight: 500;
  background: color-mix(in srgb, var(--rs-text) 3%, transparent);
}

.nm-diag__pill {
  display: inline-flex;
  align-items: center;
  padding: 0.08rem 0.45rem;
  border-radius: var(--rs-radius-full, 999px);
  font-weight: 550;
}

.nm-diag__pill--ok {
  color: var(--rs-success, #16a34a);
  background: color-mix(in srgb, var(--rs-success, #16a34a) 12%, transparent);
}

.nm-diag__pill--fail {
  color: var(--rs-danger, #c0392b);
  background: color-mix(in srgb, var(--rs-danger, #c0392b) 12%, transparent);
}
</style>
