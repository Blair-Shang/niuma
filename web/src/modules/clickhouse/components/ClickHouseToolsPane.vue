<script setup lang="ts">
import {
  RsBadge,
  RsButton,
  RsConfirmDialog,
  RsIcon,
  RsInput,
  RsLabel,
  RsLoading,
  RsSelect,
  RsTabs,
  RsTooltip,
  RsVirtualList,
  useRsToast,
} from '@niuma/ui'
import type { RsSelectOptions, RsTabItem } from '@niuma/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { dialogApi } from '@/api'
import { clickhouseApi } from '@/api/clickhouse'
import type { ClickHouseIoDumpMode, ClickHouseToolsDetectResult } from '@/api/types/clickhouse'
import { DataTransferCheck } from '@/modules/database'
import {
  useClickHouseIoTasks,
  type ClickHouseIoTaskLine,
} from '@/modules/clickhouse/composables/useClickHouseIoTasks'
import { loadClickHouseToolPaths } from '@/modules/clickhouse/utils/tool-paths'
import { useTabStore } from '@/stores/tab'

type DumpContentMode = 'all' | 'structure_only' | 'data_only'
/** cli = 本机 clickhouse-client；builtin = 服务端纯 Go（无需客户端） */
type Engine = 'cli' | 'builtin'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  sessionLabel?: string
  active?: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()
const tabs = useTabStore()

const cliTasks = useClickHouseIoTasks('clickhouse.tools.')
const ioTasks = useClickHouseIoTasks('clickhouse.io.')

const LOG_ITEM_SIZE = 28
const loading = ref(true)
const toolPaths = ref<Record<string, string>>({})
const detect = ref<ClickHouseToolsDetectResult | null>(null)
const database = ref(props.database ?? '')
const dumpOutputPath = ref('')
const restoreInputPath = ref('')
const starting = ref(false)
const cancelling = ref(false)
const canceledTaskIds = new Set<string>()
const toolsSection = ref<'dump' | 'restore'>('dump')
const dumpMode = ref<DumpContentMode>('all')
const selectedTables = ref<string[]>([])
const tableRows = ref<string[]>([])
const tablesLoading = ref(false)
const catalogLoading = ref(false)
const databaseOptions = ref<RsSelectOptions>([])
/** 默认内置引擎（跨协议/隧道更稳；CLI 需 Native 且本机有 client） */
const engine = ref<Engine>('builtin')
/** 当前运行任务所用引擎（取消 / 日志跟随） */
const runningEngine = ref<Engine | null>(null)

const PROTECTED_DATABASES = new Set(['system', 'information_schema', 'INFORMATION_SCHEMA'])

const dropIfExists = ref(true)
const includeCreateDatabase = ref(false)
const truncateBeforeData = ref(false)
const includeViews = ref(true)
const includeMaterializedViews = ref(true)
const includeDictionaries = ref(true)
const continueOnError = ref(true)
const restoreConfirmOpen = ref(false)

const clientOk = computed(() => Boolean(detect.value?.clickhouseClient?.available))
const busy = computed(
  () => starting.value || !!cliTasks.activeTaskId.value || !!ioTasks.activeTaskId.value,
)
const activeTaskId = computed(
  () => cliTasks.activeTaskId.value ?? ioTasks.activeTaskId.value,
)
const lines = computed((): ClickHouseIoTaskLine[] => {
  const merged = [...cliTasks.lines.value, ...ioTasks.lines.value]
  return merged.sort((a, b) => a.at - b.at)
})
const lastMessage = computed(
  () => cliTasks.lastMessage.value || ioTasks.lastMessage.value,
)
const logFollowIndex = computed(() => (lines.value.length > 0 ? lines.value.length - 1 : null))

const readyVariant = computed(() => (clientOk.value ? ('success' as const) : ('warning' as const)))
const availableCount = computed(() => (clientOk.value ? 2 : 1))
const totalEngines = 2

const sectionTabs = computed((): RsTabItem[] => [
  { value: 'dump', label: t('modules.clickhouse.tools.dumpTitle'), icon: 'download' },
  { value: 'restore', label: t('modules.clickhouse.tools.restoreTitle'), icon: 'upload' },
])

const modeOptions = computed((): RsSelectOptions => [
  { value: 'all', label: t('modules.clickhouse.tools.modeAll') },
  { value: 'structure_only', label: t('modules.clickhouse.tools.modeStructureOnly') },
  { value: 'data_only', label: t('modules.clickhouse.tools.modeDataOnly') },
])

const engineOptions = computed((): RsSelectOptions => [
  {
    value: 'builtin',
    label: t('modules.clickhouse.tools.engineBuiltin'),
  },
  {
    value: 'cli',
    label: t('modules.clickhouse.tools.engineCli'),
    disabled: !clientOk.value,
  },
])

const allTablesSelected = computed(
  () =>
    tableRows.value.length > 0 &&
    tableRows.value.every((name) => selectedTables.value.includes(name)),
)

const opDesc = computed(() => {
  if (toolsSection.value === 'dump') {
    return engine.value === 'cli'
      ? t('modules.clickhouse.tools.dumpDescCli')
      : t('modules.clickhouse.tools.dumpDescBuiltin')
  }
  return engine.value === 'cli'
    ? t('modules.clickhouse.tools.restoreDescCli')
    : t('modules.clickhouse.tools.restoreDescBuiltin')
})

const databaseProtected = computed(() => PROTECTED_DATABASES.has(database.value.trim()))

const restoreConfirmDesc = computed(() =>
  t('modules.clickhouse.tools.restoreConfirm', { name: database.value.trim() || '—' }),
)

watch(
  () => props.database,
  (v) => {
    if (v) database.value = v
  },
)

watch(clientOk, (ok) => {
  if (!ok && engine.value === 'cli') engine.value = 'builtin'
})

function toIoMode(mode: DumpContentMode): ClickHouseIoDumpMode {
  if (mode === 'structure_only') return 'structure_only'
  if (mode === 'data_only') return 'data_only'
  return 'structure_and_data'
}

function connectScope(): { sessionId?: string; profileId?: string } {
  return {
    sessionId: props.sessionId?.trim() || undefined,
    profileId: props.profileId?.trim() || undefined,
  }
}

function resolveEngine(): Engine | null {
  if (engine.value === 'builtin') return 'builtin'
  if (!clientOk.value) {
    toast.error(t('modules.clickhouse.tools.cliUnavailable'))
    return null
  }
  return 'cli'
}

function guardDatabase(): boolean {
  if (!database.value.trim()) {
    toast.error(t('modules.clickhouse.tools.needDatabase'))
    return false
  }
  if (databaseProtected.value) {
    toast.error(t('modules.clickhouse.tools.protectedDatabase', { name: database.value.trim() }))
    return false
  }
  return true
}

async function refreshDetect(): Promise<void> {
  loading.value = true
  try {
    toolPaths.value = await loadClickHouseToolPaths()
    detect.value = await clickhouseApi.toolsDetect({ toolPaths: toolPaths.value })
    if (!clientOk.value && engine.value === 'cli') engine.value = 'builtin'
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.clickhouse.tools.detectError'))
  } finally {
    loading.value = false
  }
}

async function loadDatabases(): Promise<void> {
  const scope = connectScope()
  if (!scope.sessionId && !scope.profileId) {
    databaseOptions.value = []
    return
  }
  catalogLoading.value = true
  try {
    const result = await clickhouseApi.treeDatabases({ ...scope, limit: 500 })
    const names = (result.databases ?? []).map((d) => d.name)
    databaseOptions.value = names.map((name) => ({
      value: name,
      label: PROTECTED_DATABASES.has(name)
        ? `${name} (${t('modules.clickhouse.tools.protectedTag')})`
        : name,
      disabled: PROTECTED_DATABASES.has(name),
    }))
    if (database.value && !names.includes(database.value)) {
      databaseOptions.value = [
        {
          value: database.value,
          label: database.value,
          disabled: PROTECTED_DATABASES.has(database.value),
        },
        ...databaseOptions.value,
      ]
    } else if (!database.value && names.length) {
      database.value = names.find((n) => !PROTECTED_DATABASES.has(n)) ?? names[0]
    }
  } catch {
    databaseOptions.value = database.value
      ? [{ value: database.value, label: database.value }]
      : []
  } finally {
    catalogLoading.value = false
  }
}

async function refreshTables(): Promise<void> {
  const scope = connectScope()
  if ((!scope.sessionId && !scope.profileId) || !database.value.trim()) {
    tableRows.value = []
    selectedTables.value = []
    return
  }
  tablesLoading.value = true
  selectedTables.value = []
  try {
    const result = await clickhouseApi.treeTables({
      ...scope,
      database: database.value.trim(),
      types: ['table'],
    })
    tableRows.value = (result.tables ?? []).map((row) => row.name)
  } catch {
    tableRows.value = []
  } finally {
    tablesLoading.value = false
  }
}

async function refreshCatalog(): Promise<void> {
  await loadDatabases()
  await refreshTables()
}

function toggleTable(name: string, checked: boolean): void {
  if (checked) {
    if (!selectedTables.value.includes(name)) selectedTables.value = [...selectedTables.value, name]
    return
  }
  selectedTables.value = selectedTables.value.filter((item) => item !== name)
}

function toggleSelectAllTables(checked: boolean): void {
  selectedTables.value = checked ? [...tableRows.value] : []
}

async function browseDump(): Promise<void> {
  try {
    const picked = await dialogApi.saveFile({
      title: t('modules.clickhouse.tools.browseDumpTitle'),
      defaultPath: `${database.value || 'dump'}.sql`,
      accept: ['.sql'],
    })
    if (!picked.canceled && picked.filePaths[0]) dumpOutputPath.value = picked.filePaths[0]
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.clickhouse.tools.browseError'))
  }
}

async function browseRestore(): Promise<void> {
  try {
    const picked = await dialogApi.openFile({
      title: t('modules.clickhouse.tools.browseRestoreTitle'),
      accept: ['.sql'],
    })
    if (!picked.canceled && picked.filePaths[0]) restoreInputPath.value = picked.filePaths[0]
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.clickhouse.tools.browseError'))
  }
}

function clearAllLogs(): void {
  cliTasks.clearLines()
  ioTasks.clearLines()
}

async function runTask(
  label: string,
  useEngine: Engine,
  start: () => Promise<{ taskId: string }>,
): Promise<void> {
  const scope = connectScope()
  if (!scope.sessionId && !scope.profileId) {
    toast.error(t('modules.clickhouse.tools.runError'))
    return
  }
  starting.value = true
  runningEngine.value = useEngine
  const bag = useEngine === 'cli' ? cliTasks : ioTasks
  bag.track()
  try {
    const result = await start()
    toast.success(t('modules.clickhouse.tools.started', { tool: label, taskId: result.taskId }))
    const done = await bag.waitForTask(result.taskId)
    if (canceledTaskIds.has(result.taskId)) {
      canceledTaskIds.delete(result.taskId)
      return
    }
    if (!done.ok) {
      toast.error(done.message || t('modules.clickhouse.tools.runError'))
      return
    }
    toast.success(t('modules.clickhouse.tools.done', { tool: label }))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.clickhouse.tools.runError'))
  } finally {
    starting.value = false
    runningEngine.value = null
  }
}

async function runDump(): Promise<void> {
  if (!guardDatabase()) return
  if (!dumpOutputPath.value.trim()) {
    toast.error(t('modules.clickhouse.tools.needDumpPath'))
    return
  }
  const useEngine = resolveEngine()
  if (!useEngine) return
  if (useEngine === 'cli') {
    if (!props.sessionId?.trim()) {
      toast.error(t('modules.clickhouse.tools.cliNeedSession'))
      return
    }
    await runTask(t('modules.clickhouse.tools.toolDump'), 'cli', () =>
      clickhouseApi.toolsDump({
        sessionId: props.sessionId!,
        database: database.value.trim(),
        outputPath: dumpOutputPath.value.trim(),
        dumpOptions: {
          mode: dumpMode.value,
          tables: selectedTables.value.length ? selectedTables.value : undefined,
        },
        toolPaths: toolPaths.value,
      }),
    )
    return
  }
  const scope = connectScope()
  await runTask(t('modules.clickhouse.tools.toolDumpBuiltin'), 'builtin', () =>
    clickhouseApi.ioDumpSql({
      ...scope,
      dump: {
        database: database.value.trim(),
        tables: selectedTables.value.length ? selectedTables.value : undefined,
        mode: toIoMode(dumpMode.value),
        outputPath: dumpOutputPath.value.trim(),
        dropIfExists: dropIfExists.value,
        truncateBeforeData: truncateBeforeData.value,
        includeCreateDatabase: includeCreateDatabase.value,
        includeTables: true,
        includeViews: selectedTables.value.length ? false : includeViews.value,
        includeMaterializedViews: selectedTables.value.length ? false : includeMaterializedViews.value,
        includeDictionaries: selectedTables.value.length ? false : includeDictionaries.value,
      },
    }),
  )
}

async function runRestore(): Promise<void> {
  if (!guardDatabase()) return
  if (!restoreInputPath.value.trim()) {
    toast.error(t('modules.clickhouse.tools.needRestore'))
    return
  }
  if (!resolveEngine()) return
  restoreConfirmOpen.value = true
}

async function confirmRestore(): Promise<void> {
  restoreConfirmOpen.value = false
  const useEngine = resolveEngine()
  if (!useEngine) return
  if (useEngine === 'cli') {
    if (!props.sessionId?.trim()) {
      toast.error(t('modules.clickhouse.tools.cliNeedSession'))
      return
    }
    await runTask(t('modules.clickhouse.tools.toolRestore'), 'cli', () =>
      clickhouseApi.toolsRestore({
        sessionId: props.sessionId!,
        database: database.value.trim(),
        inputPath: restoreInputPath.value.trim(),
        toolPaths: toolPaths.value,
      }),
    )
    return
  }
  const scope = connectScope()
  await runTask(t('modules.clickhouse.tools.toolRestoreBuiltin'), 'builtin', () =>
    clickhouseApi.ioExecSqlFile({
      ...scope,
      database: database.value.trim(),
      inputPath: restoreInputPath.value.trim(),
      execOptions: { continueOnError: continueOnError.value },
    }),
  )
}

async function stopActive(): Promise<void> {
  const taskId = activeTaskId.value
  if (!taskId) return
  cancelling.value = true
  try {
    canceledTaskIds.add(taskId)
    const eng = runningEngine.value
      ?? (cliTasks.activeTaskId.value === taskId ? 'cli' : 'builtin')
    if (eng === 'cli') {
      await clickhouseApi.toolsCancel({ taskId, sessionId: props.sessionId ?? undefined })
    } else {
      await clickhouseApi.ioCancel({ taskId, sessionId: props.sessionId ?? undefined })
    }
    toast.success(t('modules.clickhouse.tools.stopped', { taskId }))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.clickhouse.tools.stopError'))
  } finally {
    cancelling.value = false
  }
}

function openSettings(): void {
  tabs.openSettings({ section: 'components' })
}

function useBuiltinNow(): void {
  engine.value = 'builtin'
}

onMounted(async () => {
  cliTasks.track()
  ioTasks.track()
  await refreshDetect()
  await loadDatabases()
  await refreshTables()
})

watch(
  () => [props.sessionId, props.profileId, database.value, props.active] as const,
  () => {
    if (props.active !== false) void refreshTables()
  },
)
</script>

<template>
  <div class="nm-clickhouse-tools">
    <header class="nm-clickhouse-tools__header">
      <div class="nm-clickhouse-tools__header-left">
        <div class="nm-clickhouse-tools__title-row">
          <RsIcon name="archive" :size="15" class="nm-clickhouse-tools__title-icon" />
          <h3 class="nm-clickhouse-tools__title">{{ t('modules.clickhouse.tools.title') }}</h3>
          <RsBadge v-if="sessionLabel" variant="default">{{ sessionLabel }}</RsBadge>
          <RsBadge v-if="!loading" :variant="readyVariant">
            {{ t('modules.clickhouse.tools.readySummary', { n: availableCount, total: totalEngines }) }}
          </RsBadge>
        </div>
        <p class="nm-clickhouse-tools__subtitle">{{ t('modules.clickhouse.tools.hint') }}</p>
      </div>
      <div class="nm-clickhouse-tools__header-actions">
        <RsButton
          v-if="busy"
          size="sm"
          variant="danger"
          :loading="cancelling"
          @click="stopActive"
        >
          <RsIcon name="square" :size="12" />
          {{ t('modules.clickhouse.tools.stop') }}
        </RsButton>
        <RsButton size="sm" variant="ghost" :loading="loading" @click="refreshDetect">
          <RsIcon name="refresh-cw" :size="13" />
          {{ t('modules.clickhouse.tools.refresh') }}
        </RsButton>
      </div>
    </header>

    <RsLoading
      v-if="loading && !detect"
      class="nm-clickhouse-tools__loading"
      :label="t('modules.clickhouse.tools.detecting')"
      show-label
    />

    <div v-else class="nm-clickhouse-tools__body">
      <div class="nm-clickhouse-tools__main">
        <section class="nm-clickhouse-tools__status" :aria-label="t('modules.clickhouse.tools.status')">
          <div
            class="nm-clickhouse-tools__status-chip is-ok"
            :class="{ 'is-active': engine === 'builtin' }"
          >
            <div class="nm-clickhouse-tools__status-icon" aria-hidden="true">
              <RsIcon name="cpu" :size="14" />
            </div>
            <div class="nm-clickhouse-tools__status-meta min-w-0">
              <span class="nm-clickhouse-tools__status-name">
                {{ t('modules.clickhouse.tools.engineBuiltinShort') }}
              </span>
              <span class="nm-clickhouse-tools__status-path">
                {{ t('modules.clickhouse.tools.builtinReady') }}
              </span>
            </div>
            <span class="nm-clickhouse-tools__status-dot is-ok" aria-hidden="true" />
          </div>

          <div
            class="nm-clickhouse-tools__status-chip"
            :class="[clientOk ? 'is-ok' : 'is-missing', { 'is-active': engine === 'cli' && clientOk }]"
          >
            <div class="nm-clickhouse-tools__status-icon" aria-hidden="true">
              <RsIcon name="terminal" :size="14" />
            </div>
            <div class="nm-clickhouse-tools__status-meta min-w-0">
              <span class="nm-clickhouse-tools__status-name">clickhouse-client</span>
              <RsTooltip
                v-if="clientOk && detect?.clickhouseClient?.path"
                :content="detect.clickhouseClient.path"
                side="bottom"
              >
                <span class="nm-clickhouse-tools__status-path truncate">
                  {{ detect.clickhouseClient.path }}
                  <template v-if="detect.clickhouseClient.version">
                    · {{ detect.clickhouseClient.version }}
                  </template>
                </span>
              </RsTooltip>
              <span v-else-if="clientOk" class="nm-clickhouse-tools__status-path">
                {{ t('modules.clickhouse.tools.available') }}
              </span>
              <span v-else class="nm-clickhouse-tools__status-path is-missing">
                {{ t('modules.clickhouse.tools.missing') }}
              </span>
            </div>
            <span
              class="nm-clickhouse-tools__status-dot"
              :class="clientOk ? 'is-ok' : 'is-missing'"
              aria-hidden="true"
            />
          </div>
        </section>

        <section v-if="!clientOk" class="nm-clickhouse-tools__guide" role="note">
          <div class="nm-clickhouse-tools__guide-head">
            <RsIcon name="info" :size="14" />
            <span>{{ t('modules.clickhouse.tools.missingTitle') }}</span>
          </div>
          <p class="nm-clickhouse-tools__guide-body">{{ t('modules.clickhouse.tools.missingGuide') }}</p>
          <div class="nm-clickhouse-tools__guide-actions">
            <RsButton size="sm" variant="secondary" @click="useBuiltinNow">
              <RsIcon name="cpu" :size="13" />
              {{ t('modules.clickhouse.tools.useBuiltin') }}
            </RsButton>
            <RsButton size="sm" variant="ghost" @click="openSettings">
              <RsIcon name="settings" :size="13" />
              {{ t('modules.clickhouse.tools.openSettings') }}
            </RsButton>
          </div>
        </section>

        <section class="nm-clickhouse-tools__panel nm-clickhouse-tools__panel--target">
          <div class="nm-clickhouse-tools__panel-head">
            <RsIcon name="database" :size="13" />
            <span>{{ t('modules.clickhouse.tools.target') }}</span>
            <span class="nm-clickhouse-tools__panel-hint">{{ t('modules.clickhouse.tools.targetHint') }}</span>
            <RsButton
              size="sm"
              variant="ghost"
              class="nm-clickhouse-tools__panel-refresh"
              :loading="catalogLoading || tablesLoading"
              :disabled="busy"
              @click="refreshCatalog"
            >
              <RsIcon name="refresh-cw" :size="12" />
              {{ t('modules.clickhouse.tools.refreshCatalog') }}
            </RsButton>
          </div>
          <div class="nm-clickhouse-tools__target-grid">
            <div class="nm-clickhouse-tools__field">
              <span class="nm-clickhouse-tools__field-label">{{ t('modules.clickhouse.tools.database') }}</span>
              <RsSelect
                v-model="database"
                :options="databaseOptions"
                :placeholder="t('modules.clickhouse.tools.databasePh')"
                :disabled="busy || (databaseOptions.length === 0 && !database)"
              />
            </div>
            <div class="nm-clickhouse-tools__field">
              <span class="nm-clickhouse-tools__field-label">{{ t('modules.clickhouse.tools.engine') }}</span>
              <RsSelect
                v-model="engine"
                :options="engineOptions"
                :disabled="busy"
              />
            </div>
          </div>
          <p v-if="engine === 'cli'" class="nm-clickhouse-tools__engine-note">
            {{ t('modules.clickhouse.tools.cliLimitations') }}
          </p>
          <p v-if="databaseProtected" class="nm-clickhouse-tools__engine-note is-danger">
            {{ t('modules.clickhouse.tools.protectedDatabase', { name: database.trim() || '—' }) }}
          </p>
        </section>

        <section class="nm-clickhouse-tools__panel nm-clickhouse-tools__panel--main">
          <div class="nm-clickhouse-tools__section-tabs">
            <RsTabs v-model="toolsSection" :items="sectionTabs" size="sm" panelless />
            <span class="nm-clickhouse-tools__panel-hint">{{ t('modules.clickhouse.tools.backupHint') }}</span>
          </div>

          <div v-show="toolsSection === 'dump'" class="nm-clickhouse-tools__op">
            <div class="nm-clickhouse-tools__op-info">
              <span class="nm-clickhouse-tools__op-title">{{ t('modules.clickhouse.tools.dumpTitle') }}</span>
              <span class="nm-clickhouse-tools__op-desc">{{ opDesc }}</span>
            </div>

            <div class="nm-clickhouse-tools__grid">
              <div class="nm-clickhouse-tools__field">
                <RsLabel>{{ t('modules.clickhouse.tools.contentMode') }}</RsLabel>
                <RsSelect v-model="dumpMode" :options="modeOptions" :disabled="busy" />
              </div>
              <div class="nm-clickhouse-tools__field nm-clickhouse-tools__field--wide">
                <RsLabel>{{ t('modules.clickhouse.tools.outputFile') }}</RsLabel>
                <RsInput
                  v-model="dumpOutputPath"
                  class="nm-clickhouse-tools__op-input"
                  :placeholder="t('modules.clickhouse.tools.dumpPathPh')"
                  :disabled="busy"
                >
                  <template #suffix>
                    <button
                      type="button"
                      class="nm-clickhouse-tools__browse"
                      :aria-label="t('modules.clickhouse.tools.browse')"
                      :title="t('modules.clickhouse.tools.browse')"
                      :disabled="busy"
                      @pointerdown.prevent
                      @click="browseDump"
                    >
                      <RsIcon name="folder-open" :size="14" />
                    </button>
                  </template>
                </RsInput>
              </div>
            </div>

            <div class="nm-clickhouse-tools__picker">
              <div class="nm-clickhouse-tools__picker-head">
                <div class="nm-clickhouse-tools__picker-title">
                  <span>{{ t('modules.clickhouse.tools.tables') }}</span>
                  <span class="nm-clickhouse-tools__picker-hint">{{ t('modules.clickhouse.tools.tablesHint') }}</span>
                </div>
                <label class="nm-clickhouse-tools__picker-all">
                  <input
                    type="checkbox"
                    :checked="allTablesSelected"
                    :disabled="busy || tablesLoading || tableRows.length === 0"
                    @change="toggleSelectAllTables(($event.target as HTMLInputElement).checked)"
                  />
                  {{ t('modules.clickhouse.tools.selectAll') }}
                </label>
              </div>
              <p v-if="tablesLoading" class="nm-clickhouse-tools__picker-status">
                {{ t('modules.clickhouse.tools.catalogLoading') }}
              </p>
              <ul v-else class="nm-clickhouse-tools__picker-list">
                <li v-for="name in tableRows" :key="name">
                  <label class="nm-clickhouse-tools__picker-item">
                    <input
                      type="checkbox"
                      :checked="selectedTables.includes(name)"
                      :disabled="busy"
                      @change="toggleTable(name, ($event.target as HTMLInputElement).checked)"
                    />
                    <span class="nm-clickhouse-tools__picker-name" :title="name">{{ name }}</span>
                  </label>
                </li>
                <li v-if="tableRows.length === 0" class="nm-clickhouse-tools__picker-empty">
                  {{ t('modules.clickhouse.tools.tablesEmpty') }}
                </li>
              </ul>
              <p class="nm-clickhouse-tools__picker-meta">
                {{
                  t('modules.clickhouse.tools.selectedCount', {
                    n: selectedTables.length,
                    total: tableRows.length,
                  })
                }}
              </p>
            </div>

            <div v-if="engine === 'builtin'" class="nm-clickhouse-tools__options">
              <DataTransferCheck
                v-model="dropIfExists"
                variant="chip"
                :label="t('modules.clickhouse.io.dumpDropIfExists')"
                :disabled="busy"
              />
              <DataTransferCheck
                v-model="includeCreateDatabase"
                variant="chip"
                :label="t('modules.clickhouse.io.dumpIncludeCreateDatabase')"
                :disabled="busy"
              />
              <DataTransferCheck
                v-model="truncateBeforeData"
                variant="chip"
                :label="t('modules.clickhouse.io.dumpTruncate')"
                :disabled="busy || dumpMode === 'structure_only'"
              />
              <DataTransferCheck
                v-if="!selectedTables.length"
                v-model="includeViews"
                variant="chip"
                :label="t('modules.clickhouse.io.dumpIncludeViews')"
                :disabled="busy"
              />
              <DataTransferCheck
                v-if="!selectedTables.length"
                v-model="includeMaterializedViews"
                variant="chip"
                :label="t('modules.clickhouse.io.dumpIncludeMaterializedViews')"
                :disabled="busy"
              />
              <DataTransferCheck
                v-if="!selectedTables.length"
                v-model="includeDictionaries"
                variant="chip"
                :label="t('modules.clickhouse.io.dumpIncludeDictionaries')"
                :disabled="busy"
              />
            </div>

            <div class="nm-clickhouse-tools__op-actions">
              <RsButton
                size="sm"
                :disabled="busy || !database.trim() || !dumpOutputPath.trim() || databaseProtected || (engine === 'cli' && !clientOk)"
                :loading="starting && toolsSection === 'dump'"
                @click="runDump"
              >
                <RsIcon name="download" :size="13" />
                {{ t('modules.clickhouse.tools.runDump') }}
              </RsButton>
            </div>
          </div>

          <div v-show="toolsSection === 'restore'" class="nm-clickhouse-tools__op">
            <div class="nm-clickhouse-tools__op-info">
              <span class="nm-clickhouse-tools__op-title">{{ t('modules.clickhouse.tools.restoreTitle') }}</span>
              <span class="nm-clickhouse-tools__op-desc">{{ opDesc }}</span>
            </div>

            <div class="nm-clickhouse-tools__field nm-clickhouse-tools__field--wide">
              <RsLabel>{{ t('modules.clickhouse.tools.inputFile') }}</RsLabel>
              <RsInput
                v-model="restoreInputPath"
                class="nm-clickhouse-tools__op-input"
                :placeholder="t('modules.clickhouse.tools.restorePathPh')"
                :disabled="busy"
              >
                <template #suffix>
                  <button
                    type="button"
                    class="nm-clickhouse-tools__browse"
                    :aria-label="t('modules.clickhouse.tools.browse')"
                    :title="t('modules.clickhouse.tools.browse')"
                    :disabled="busy"
                    @pointerdown.prevent
                    @click="browseRestore"
                  >
                    <RsIcon name="file" :size="14" />
                  </button>
                </template>
              </RsInput>
            </div>

            <p class="nm-clickhouse-tools__restore-hint">
              {{
                engine === 'cli'
                  ? t('modules.clickhouse.tools.restoreHintCli')
                  : t('modules.clickhouse.tools.restoreHintBuiltin')
              }}
            </p>

            <div v-if="engine === 'builtin'" class="nm-clickhouse-tools__options">
              <DataTransferCheck
                v-model="continueOnError"
                variant="chip"
                :label="t('modules.clickhouse.io.execContinueOnError')"
                :disabled="busy"
              />
            </div>

            <div class="nm-clickhouse-tools__op-actions">
              <RsButton
                size="sm"
                variant="secondary"
                :disabled="busy || !database.trim() || !restoreInputPath.trim() || databaseProtected || (engine === 'cli' && !clientOk)"
                :loading="starting && toolsSection === 'restore'"
                @click="runRestore"
              >
                <RsIcon name="upload" :size="13" />
                {{ t('modules.clickhouse.tools.runRestore') }}
              </RsButton>
            </div>
          </div>
        </section>
      </div>

      <section class="nm-clickhouse-tools__panel nm-clickhouse-tools__panel--log">
        <div class="nm-clickhouse-tools__panel-head">
          <RsIcon name="scroll-text" :size="13" />
          <span>{{ t('modules.clickhouse.tools.log') }}</span>
          <RsBadge v-if="activeTaskId" variant="info">
            {{ t('modules.clickhouse.tools.running') }}
          </RsBadge>
          <span v-if="lines.length" class="nm-clickhouse-tools__panel-hint">
            {{ t('modules.clickhouse.tools.logCount', { n: lines.length }) }}
          </span>
          <div class="nm-clickhouse-tools__panel-actions">
            <RsButton
              v-if="activeTaskId"
              size="sm"
              variant="danger"
              :loading="cancelling"
              @click="stopActive"
            >
              <RsIcon name="square" :size="12" />
              {{ t('modules.clickhouse.tools.stop') }}
            </RsButton>
            <RsButton
              v-if="lines.length"
              size="sm"
              variant="ghost"
              :disabled="!!activeTaskId"
              @click="clearAllLogs"
            >
              {{ t('modules.clickhouse.tools.clearLog') }}
            </RsButton>
          </div>
        </div>
        <RsVirtualList
          v-if="lines.length"
          class="nm-clickhouse-tools__log"
          role="log"
          :items="lines"
          :height="0"
          :item-size="LOG_ITEM_SIZE"
          :overscan="12"
          :active-index="logFollowIndex"
          :layout-active="active !== false"
          radius="md"
        >
          <template #default="{ item }">
            <div
              class="nm-clickhouse-tools__log-line"
              :class="{
                'is-err': item.ok === false && item.phase !== 'canceled',
                'is-ok': item.ok === true,
                'is-canceled': item.phase === 'canceled',
              }"
            >
              <span class="nm-clickhouse-tools__log-id">#{{ item.taskId }}</span>
              <span class="nm-clickhouse-tools__log-msg" :title="item.message">{{ item.message }}</span>
              <span v-if="item.outputPath" class="nm-clickhouse-tools__log-path">→ {{ item.outputPath }}</span>
            </div>
          </template>
        </RsVirtualList>
        <div v-else class="nm-clickhouse-tools__log-empty">
          {{ lastMessage || t('modules.clickhouse.tools.logEmpty') }}
        </div>
      </section>
    </div>

    <RsConfirmDialog
      v-model:open="restoreConfirmOpen"
      tone="danger"
      confirm-variant="danger"
      :title="t('modules.clickhouse.tools.restoreConfirmTitle')"
      :description="restoreConfirmDesc"
      :confirm-text="t('modules.clickhouse.tools.restoreConfirmOk')"
      @confirm="confirmRestore"
    />
  </div>
</template>

<style scoped>
.nm-clickhouse-tools {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--rs-surface);
}

.nm-clickhouse-tools__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
  padding: var(--rs-space-md) var(--rs-space-lg);
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-clickhouse-tools__header-left {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.nm-clickhouse-tools__title-row {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-wrap: wrap;
}

.nm-clickhouse-tools__title-icon {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-clickhouse-tools__title {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  letter-spacing: 0.01em;
}

.nm-clickhouse-tools__subtitle {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: 1.4;
}

.nm-clickhouse-tools__header-actions {
  display: flex;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
}

.nm-clickhouse-tools__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-clickhouse-tools__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: var(--rs-space-md) var(--rs-space-lg) var(--rs-space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
}

.nm-clickhouse-tools__main {
  flex: 0 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
}

.nm-clickhouse-tools__status {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--rs-space-sm);
}

.nm-clickhouse-tools__guide {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-md);
  border-radius: var(--rs-radius-lg);
  border: 1px solid color-mix(in srgb, var(--rs-warning, #c90) 35%, var(--rs-border-subtle));
  background: color-mix(in srgb, var(--rs-warning, #c90) 8%, var(--rs-surface-raised));
}

.nm-clickhouse-tools__guide-head {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-text);
}

.nm-clickhouse-tools__guide-head :deep(svg) {
  color: var(--rs-warning, #b8860b);
  flex-shrink: 0;
}

.nm-clickhouse-tools__guide-body {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: 1.5;
}

.nm-clickhouse-tools__guide-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rs-space-xs);
}

.nm-clickhouse-tools__status-chip {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
  padding: 0.625rem 0.75rem;
  border-radius: var(--rs-radius-md);
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-surface-raised) 88%, transparent);
}

.nm-clickhouse-tools__status-chip.is-ok {
  border-color: color-mix(in srgb, var(--rs-success) 28%, var(--rs-border-subtle));
}

.nm-clickhouse-tools__status-chip.is-missing {
  border-color: color-mix(in srgb, var(--rs-danger) 22%, var(--rs-border-subtle));
  opacity: 0.9;
}

.nm-clickhouse-tools__status-chip.is-active {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rs-accent, #2563eb) 45%, transparent);
}

.nm-clickhouse-tools__status-icon {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-hover);
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-clickhouse-tools__status-chip.is-ok .nm-clickhouse-tools__status-icon {
  color: var(--rs-success);
  background: color-mix(in srgb, var(--rs-success) 12%, transparent);
}

.nm-clickhouse-tools__status-chip.is-missing .nm-clickhouse-tools__status-icon {
  color: var(--rs-danger);
  background: color-mix(in srgb, var(--rs-danger) 10%, transparent);
}

.nm-clickhouse-tools__status-meta {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  flex: 1;
  min-width: 0;
}

.nm-clickhouse-tools__status-name {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  font-family: var(--rs-font-mono);
  line-height: 1.2;
}

.nm-clickhouse-tools__status-path {
  font-size: 0.6875rem;
  color: var(--rs-muted);
  line-height: 1.3;
}

.nm-clickhouse-tools__status-path.is-missing {
  color: var(--rs-danger);
}

.nm-clickhouse-tools__status-dot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  flex-shrink: 0;
}

.nm-clickhouse-tools__status-dot.is-ok {
  background: var(--rs-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rs-success) 18%, transparent);
}

.nm-clickhouse-tools__status-dot.is-missing {
  background: var(--rs-danger);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rs-danger) 14%, transparent);
}

.nm-clickhouse-tools__panel {
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-lg);
  background: color-mix(in srgb, var(--rs-surface-raised) 92%, transparent);
  padding: var(--rs-space-md);
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}

.nm-clickhouse-tools__panel--log {
  flex: 1;
  min-height: 8rem;
}

.nm-clickhouse-tools__panel-head {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-text);
  min-width: 0;
}

.nm-clickhouse-tools__panel-head > :deep(svg) {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-clickhouse-tools__panel-hint {
  margin-left: var(--rs-space-xs);
  font-weight: 400;
  color: var(--rs-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-clickhouse-tools__panel-refresh,
.nm-clickhouse-tools__panel-actions {
  margin-left: auto;
  flex-shrink: 0;
  display: flex;
  gap: var(--rs-space-xs);
}

.nm-clickhouse-tools__target-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--rs-space-sm) var(--rs-space-md);
}

.nm-clickhouse-tools__field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.nm-clickhouse-tools__field-label {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  font-weight: 500;
}

.nm-clickhouse-tools__field--wide {
  grid-column: 1 / -1;
}

.nm-clickhouse-tools__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--rs-space-sm) var(--rs-space-md);
}

.nm-clickhouse-tools__section-tabs {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-wrap: wrap;
  padding-bottom: var(--rs-space-xs);
  border-bottom: 1px solid var(--rs-border-subtle);
  margin-bottom: var(--rs-space-xs);
}

.nm-clickhouse-tools__section-tabs .nm-clickhouse-tools__panel-hint {
  margin-left: 0;
  flex: 1;
  min-width: 8rem;
}

.nm-clickhouse-tools__op {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  padding-top: var(--rs-space-xs);
}

.nm-clickhouse-tools__op-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.nm-clickhouse-tools__op-title {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
}

.nm-clickhouse-tools__op-desc,
.nm-clickhouse-tools__restore-hint {
  font-size: 0.6875rem;
  color: var(--rs-muted);
  line-height: 1.35;
}

.nm-clickhouse-tools__restore-hint,
.nm-clickhouse-tools__engine-note {
  margin: 0;
}

.nm-clickhouse-tools__engine-note {
  font-size: 0.6875rem;
  color: var(--rs-muted);
  line-height: 1.4;
}

.nm-clickhouse-tools__engine-note.is-danger {
  color: var(--rs-danger);
}

.nm-clickhouse-tools__op-input {
  width: 100%;
  min-width: 0;
}

.nm-clickhouse-tools__browse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
  padding: 0.15rem;
}

.nm-clickhouse-tools__browse:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.nm-clickhouse-tools__op-actions {
  display: flex;
  justify-content: flex-end;
}

.nm-clickhouse-tools__options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.nm-clickhouse-tools__picker {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md);
  background: color-mix(in srgb, var(--rs-surface) 75%, transparent);
  padding: var(--rs-space-sm);
}

.nm-clickhouse-tools__picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
}

.nm-clickhouse-tools__picker-title {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
}

.nm-clickhouse-tools__picker-hint {
  font-weight: 400;
  color: var(--rs-muted);
  font-size: 0.6875rem;
}

.nm-clickhouse-tools__picker-all {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}

.nm-clickhouse-tools__picker-all input {
  margin: 0;
}

.nm-clickhouse-tools__picker-list {
  list-style: none;
  margin: 0;
  padding: 0.15rem;
  max-height: 11rem;
  overflow: auto;
  border-radius: var(--rs-radius-sm);
  border: 1px solid color-mix(in srgb, var(--rs-border-subtle) 80%, transparent);
  background: var(--rs-surface);
}

.nm-clickhouse-tools__picker-item {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.28rem 0.4rem;
  border-radius: var(--rs-radius-sm);
  font-size: var(--rs-font-size-xs);
  cursor: pointer;
}

.nm-clickhouse-tools__picker-item:hover {
  background: var(--rs-item-hover);
}

.nm-clickhouse-tools__picker-item input {
  margin: 0;
  flex-shrink: 0;
}

.nm-clickhouse-tools__picker-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-clickhouse-tools__picker-empty,
.nm-clickhouse-tools__picker-status,
.nm-clickhouse-tools__picker-meta {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-clickhouse-tools__picker-empty,
.nm-clickhouse-tools__picker-status {
  padding: 0.75rem 0.5rem;
  text-align: center;
}

.nm-clickhouse-tools__log {
  flex: 1;
  min-height: 6rem;
  border: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
}

.nm-clickhouse-tools__log-empty {
  flex: 1;
  min-height: 6rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  border: 1px dashed var(--rs-border-subtle);
  border-radius: var(--rs-radius-md);
}

.nm-clickhouse-tools__log-line {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  height: 28px;
  padding: 0 0.5rem;
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
}

.nm-clickhouse-tools__log-line.is-err {
  color: var(--rs-danger);
}

.nm-clickhouse-tools__log-line.is-ok {
  color: var(--rs-success);
}

.nm-clickhouse-tools__log-line.is-canceled {
  color: var(--rs-muted);
}

.nm-clickhouse-tools__log-id {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-clickhouse-tools__log-msg {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nm-clickhouse-tools__log-path {
  color: var(--rs-muted);
  flex-shrink: 0;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 720px) {
  .nm-clickhouse-tools__status,
  .nm-clickhouse-tools__target-grid,
  .nm-clickhouse-tools__grid {
    grid-template-columns: 1fr;
  }
}
</style>
