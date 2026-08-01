<script setup lang="ts">
import {
  RsBadge,
  RsButton,
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
import { connectionApi, dialogApi, fsApi, mysqlApi } from '@/api'
import type {
  MysqlToolsDetectResult,
  MysqlToolsDumpOptions,
  MysqlToolsRestoreOptions,
} from '@/api/types/mysql'
import type { ConnItem } from '@/modules/ops/types'
import { DataTransferCheck } from '@/modules/database'
import { openMysqlDataTask } from '@/modules/mysql/data-tasks'
import { useMysqlIoTasks } from '@/modules/mysql/composables/useMysqlIoTasks'
import { loadMysqlToolPaths } from '@/modules/mysql/utils/tool-paths'
import { useTabStore } from '@/stores/tab'

type DumpContentMode = 'all' | 'structure_only' | 'data_only'

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
const tasks = useMysqlIoTasks('mysql.tools.')
const { lastMessage, activeTaskId, lines, track, waitForTask, clearLines } = tasks

/** 任务日志行高（与样式 padding/line-height 对齐） */
const LOG_ITEM_SIZE = 28
/** 跟随时滚到最新一行 */
const logFollowIndex = computed(() => (lines.value.length > 0 ? lines.value.length - 1 : null))

const loading = ref(true)
const toolPaths = ref<Record<string, string>>({})
const detect = ref<MysqlToolsDetectResult | null>(null)
const database = ref(props.database ?? '')
const dumpOutputPath = ref('')
const restoreInputPath = ref('')
const starting = ref(false)
const cancelling = ref(false)
/** 用户主动取消的任务，done 时不再当失败弹窗 */
const canceledTaskIds = new Set<string>()
const toolsSection = ref<'dump' | 'restore'>('dump')

const dumpMode = ref<DumpContentMode>('all')
const dropIfExists = ref(true)
const routines = ref(true)
const triggers = ref(true)
const events = ref(true)
const singleTransaction = ref(true)
/** 默认忽略 GTID（--set-gtid-purged=OFF），避免跨库还原报错 */
const omitGtid = ref(true)
/** 备份过程日志（mysqldump --verbose）；还原默认关闭，避免整句 SQL 刷屏占内存 */
const dumpVerboseLog = ref(true)
const restoreVerboseLog = ref(false)
const selectedTables = ref<string[]>([])

/** 还原：过滤旧备份中的 GTID 语句；遇错继续（目标库已有对象时更实用） */
const restoreStripGtid = ref(true)
const restoreForce = ref(true)

const databaseOptions = ref<RsSelectOptions>([])
const tableRows = ref<string[]>([])
const catalogLoading = ref(false)
const tablesLoading = ref(false)

watch(
  () => props.database,
  (v) => {
    if (v) database.value = v
  },
)

const busy = computed(() => starting.value || !!activeTaskId.value)

const toolRows = computed(() => {
  const d = detect.value
  if (!d) return []
  return [
    { id: 'mysqldump' as const, label: 'mysqldump', icon: 'archive', entry: d.mysqldump },
    { id: 'mysql' as const, label: 'mysql', icon: 'terminal', entry: d.mysql },
  ]
})

const availableCount = computed(() => toolRows.value.filter((r) => r.entry.available).length)

const readyVariant = computed(() => {
  if (!toolRows.value.length) return 'danger' as const
  if (availableCount.value === toolRows.value.length) return 'success' as const
  if (availableCount.value > 0) return 'warning' as const
  return 'danger' as const
})

const sectionTabs = computed((): RsTabItem[] => [
  { value: 'dump', label: t('modules.mysql.tools.dumpTitle'), icon: 'download' },
  { value: 'restore', label: t('modules.mysql.tools.restoreTitle'), icon: 'upload' },
])

const modeOptions = computed((): RsSelectOptions => [
  { value: 'all', label: t('modules.mysql.tools.modeAll') },
  { value: 'structure_only', label: t('modules.mysql.tools.modeStructureOnly') },
  { value: 'data_only', label: t('modules.mysql.tools.modeDataOnly') },
])

const allTablesSelected = computed(
  () =>
    tableRows.value.length > 0 &&
    tableRows.value.every((name) => selectedTables.value.includes(name)),
)

function toolAvailable(id: keyof MysqlToolsDetectResult): boolean {
  return detect.value?.[id]?.available === true
}

const toolsMissing = computed(
  () => !loading.value && (!toolAvailable('mysqldump') || !toolAvailable('mysql')),
)

function connectScope(): { sessionId?: string; profileId?: string } {
  const sessionId = props.sessionId?.trim() || undefined
  const profileId = props.profileId?.trim() || undefined
  return { sessionId, profileId }
}

function buildDumpOptions(): MysqlToolsDumpOptions {
  return {
    structureOnly: dumpMode.value === 'structure_only' || undefined,
    dataOnly: dumpMode.value === 'data_only' || undefined,
    dropIfExists: dropIfExists.value || undefined,
    // mysqldump 在指定表名时仍支持 --routines（导出全部例程）
    routines: routines.value || undefined,
    triggers: triggers.value || undefined,
    events: selectedTables.value.length ? undefined : events.value || undefined,
    singleTransaction: singleTransaction.value || undefined,
    setGtidPurged: omitGtid.value ? 'OFF' : 'ON',
    tables: selectedTables.value.length ? [...selectedTables.value] : undefined,
    verbose: dumpVerboseLog.value,
  }
}

function buildRestoreOptions(): MysqlToolsRestoreOptions {
  return {
    force: restoreForce.value || undefined,
    stripGtid: restoreStripGtid.value,
    verbose: restoreVerboseLog.value,
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
    const result = await mysqlApi.treeDatabases({ ...scope, limit: 500 })
    const names = (result.databases ?? []).map((d) => d.name)
    databaseOptions.value = names.map((name) => ({ value: name, label: name }))
    if (database.value && !names.includes(database.value)) {
      databaseOptions.value = [
        { value: database.value, label: database.value },
        ...databaseOptions.value,
      ]
    } else if (!database.value && names.length) {
      database.value = names[0]
    }
  } catch {
    databaseOptions.value = database.value
      ? [{ value: database.value, label: database.value }]
      : []
  } finally {
    catalogLoading.value = false
  }
}

async function loadTables(): Promise<void> {
  const db = database.value.trim()
  const scope = connectScope()
  tableRows.value = []
  selectedTables.value = []
  if (!db || (!scope.sessionId && !scope.profileId)) return

  tablesLoading.value = true
  try {
    // 表 + 视图均可勾选；例程由 --routines 覆盖整库（与 mysqldump 行为一致）
    const result = await mysqlApi.treeTables({
      ...scope,
      database: db,
      types: ['table', 'view'],
      limit: 5000,
    })
    tableRows.value = (result.tables ?? [])
      .map((tbl) => tbl.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    tableRows.value = []
  } finally {
    tablesLoading.value = false
  }
}

function toggleTable(name: string, checked: boolean): void {
  const cur = new Set(selectedTables.value)
  if (checked) cur.add(name)
  else cur.delete(name)
  selectedTables.value = [...cur].sort((a, b) => a.localeCompare(b))
}

function toggleSelectAllTables(checked: boolean): void {
  selectedTables.value = checked ? [...tableRows.value] : []
}

watch(database, () => {
  void loadTables()
})

async function refreshDetect(): Promise<void> {
  loading.value = true
  try {
    toolPaths.value = await loadMysqlToolPaths()
    detect.value = await mysqlApi.toolsDetect({ toolPaths: toolPaths.value })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mysql.tools.detectError'))
  } finally {
    loading.value = false
  }
}

async function refreshCatalog(): Promise<void> {
  await loadDatabases()
  await loadTables()
}

async function pickDumpFile(): Promise<void> {
  try {
    const result = await dialogApi.saveFile({
      title: t('modules.mysql.tools.browseDumpTitle'),
      defaultPath: dumpOutputPath.value || `${database.value || 'db'}.sql`,
      accept: ['.sql'],
    })
    if (!result.canceled && result.filePaths[0]) {
      dumpOutputPath.value = result.filePaths[0]
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mysql.tools.browseError'))
  }
}

async function pickRestoreFile(): Promise<void> {
  try {
    const result = await dialogApi.openFile({
      title: t('modules.mysql.tools.browseRestoreTitle'),
      defaultPath: restoreInputPath.value || undefined,
      accept: ['.sql'],
    })
    if (!result.canceled && result.filePaths[0]) {
      restoreInputPath.value = result.filePaths[0]
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mysql.tools.browseError'))
  }
}

async function runTask(
  label: string,
  runner: () => Promise<{ taskId: string }>,
): Promise<void> {
  const { sessionId, profileId } = connectScope()
  if ((!sessionId && !profileId) || busy.value) {
    if (!sessionId && !profileId) {
      toast.error(t('modules.mysql.tools.runError'))
    }
    return
  }
  starting.value = true
  track()
  try {
    const result = await runner()
    waitForTask(result.taskId).then(async (done) => {
      if (done.ok) {
        toast.success(t('modules.mysql.tools.done', { tool: label }))
        if (done.outputPath) {
          try {
            await fsApi.showInFolder({ path: done.outputPath })
          } catch {
            // ignore
          }
        }
        return
      }
      // 用户主动取消：已在 stop 时提示，勿再当失败弹窗
      if (canceledTaskIds.has(done.taskId) || isToolsCanceledMessage(done.message)) {
        canceledTaskIds.delete(done.taskId)
        return
      }
      toast.error(done.message || t('modules.mysql.tools.runError'))
    })
    toast.success(t('modules.mysql.tools.started', { tool: label, taskId: result.taskId }))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mysql.tools.runError'))
  } finally {
    starting.value = false
  }
}

function isToolsCanceledMessage(message?: string): boolean {
  const m = (message ?? '').trim().toLowerCase()
  return m === 'canceled' || m === 'cancelled' || m.includes('context canceled')
}

async function stopActiveTask(): Promise<void> {
  const taskId = activeTaskId.value
  if (!taskId || cancelling.value) return
  cancelling.value = true
  canceledTaskIds.add(taskId)
  try {
    await mysqlApi.toolsCancel({ taskId })
    toast.success(t('modules.mysql.tools.stopped', { taskId }))
  } catch (e) {
    canceledTaskIds.delete(taskId)
    toast.error(e instanceof Error ? e.message : t('modules.mysql.tools.stopError'))
  } finally {
    cancelling.value = false
  }
}

async function runDump(): Promise<void> {
  if (!database.value.trim()) {
    toast.error(t('modules.mysql.tools.needDatabase'))
    return
  }
  const scope = connectScope()
  await runTask(t('modules.mysql.tools.toolDump'), () =>
    mysqlApi.toolsDump({
      ...scope,
      database: database.value,
      outputPath: dumpOutputPath.value || undefined,
      dumpOptions: buildDumpOptions(),
      toolPaths: toolPaths.value,
    }),
  )
}

async function runRestore(): Promise<void> {
  if (!database.value.trim() || !restoreInputPath.value.trim()) {
    toast.error(t('modules.mysql.tools.needRestore'))
    return
  }
  const scope = connectScope()
  await runTask(t('modules.mysql.tools.toolRestore'), () =>
    mysqlApi.toolsRestore({
      ...scope,
      database: database.value,
      inputPath: restoreInputPath.value,
      restoreOptions: buildRestoreOptions(),
      toolPaths: toolPaths.value,
    }),
  )
}

function openToolSettings(): void {
  tabs.openSettings()
}

async function openDumpSqlFallback(): Promise<void> {
  const profileId = props.profileId?.trim()
  if (!profileId) {
    toast.error(t('modules.mysql.tools.runError'))
    return
  }
  try {
    const { profile } = await connectionApi.get({ profileId })
    if (!profile) {
      toast.error(t('modules.mysql.tools.runError'))
      return
    }
    const conn: ConnItem = { ...profile, kind: 'mysql' }
    openMysqlDataTask({
      kind: 'dump_sql',
      title: t('modules.mysql.io.dumpTitle'),
      description: t('modules.mysql.io.dumpDesc', { name: database.value || '' }),
      context: {
        conn,
        profileId,
        sessionId: props.sessionId,
        database: database.value.trim() || undefined,
        dumpScope: 'database',
      },
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mysql.tools.runError'))
  }
}

onMounted(() => {
  track()
  void refreshDetect()
  void loadDatabases().then(() => loadTables())
})
</script>

<template>
  <div class="nm-mysql-tools">
    <header class="nm-mysql-tools__header">
      <div class="nm-mysql-tools__header-left">
        <div class="nm-mysql-tools__title-row">
          <RsIcon name="archive" :size="15" class="nm-mysql-tools__title-icon" />
          <h3 class="nm-mysql-tools__title">{{ t('modules.mysql.tools.title') }}</h3>
          <RsBadge v-if="sessionLabel" variant="default">{{ sessionLabel }}</RsBadge>
          <RsBadge v-if="!loading && toolRows.length" :variant="readyVariant">
            {{ t('modules.mysql.tools.readySummary', { n: availableCount, total: toolRows.length }) }}
          </RsBadge>
        </div>
        <p class="nm-mysql-tools__subtitle">{{ t('modules.mysql.tools.hint') }}</p>
      </div>
      <div class="nm-mysql-tools__header-actions">
        <RsButton
          v-if="busy"
          size="sm"
          variant="danger"
          :loading="cancelling"
          @click="stopActiveTask"
        >
          <RsIcon name="square" :size="12" />
          {{ t('modules.mysql.tools.stop') }}
        </RsButton>
        <RsButton size="sm" variant="ghost" :loading="loading" @click="refreshDetect">
          <RsIcon name="refresh-cw" :size="13" />
          {{ t('modules.mysql.tools.refresh') }}
        </RsButton>
      </div>
    </header>

    <RsLoading
      v-if="loading"
      class="nm-mysql-tools__loading"
      :label="t('modules.mysql.tools.detecting')"
      show-label
    />

    <div v-else class="nm-mysql-tools__body">
      <div class="nm-mysql-tools__main">
      <section class="nm-mysql-tools__status" :aria-label="t('modules.mysql.tools.status')">
        <div
          v-for="row in toolRows"
          :key="row.id"
          class="nm-mysql-tools__status-chip"
          :class="row.entry.available ? 'is-ok' : 'is-missing'"
        >
          <div class="nm-mysql-tools__status-icon" aria-hidden="true">
            <RsIcon :name="row.icon" :size="14" />
          </div>
          <div class="nm-mysql-tools__status-meta min-w-0">
            <span class="nm-mysql-tools__status-name">{{ row.label }}</span>
            <RsTooltip
              v-if="row.entry.available && row.entry.path"
              :content="row.entry.path"
              side="bottom"
            >
              <span class="nm-mysql-tools__status-path truncate">{{ row.entry.path }}</span>
            </RsTooltip>
            <span v-else-if="row.entry.available" class="nm-mysql-tools__status-path">
              {{ t('modules.mysql.tools.available') }}
            </span>
            <span v-else class="nm-mysql-tools__status-path is-missing">
              {{ t('modules.mysql.tools.missing') }}
            </span>
          </div>
          <span
            class="nm-mysql-tools__status-dot"
            :class="row.entry.available ? 'is-ok' : 'is-missing'"
            aria-hidden="true"
          />
        </div>
      </section>

      <section v-if="toolsMissing" class="nm-mysql-tools__guide" role="note">
        <div class="nm-mysql-tools__guide-head">
          <RsIcon name="info" :size="14" />
          <span>{{ t('modules.mysql.tools.missingTitle') }}</span>
        </div>
        <p class="nm-mysql-tools__guide-body">{{ t('modules.mysql.tools.missingGuide') }}</p>
        <div class="nm-mysql-tools__guide-actions">
          <RsButton size="sm" variant="secondary" @click="openDumpSqlFallback">
            <RsIcon name="file-down" :size="13" />
            {{ t('modules.mysql.tools.openDumpSql') }}
          </RsButton>
          <RsButton size="sm" variant="ghost" @click="openToolSettings">
            <RsIcon name="settings" :size="13" />
            {{ t('modules.mysql.tools.openSettings') }}
          </RsButton>
        </div>
      </section>

      <section class="nm-mysql-tools__panel nm-mysql-tools__panel--target">
        <div class="nm-mysql-tools__panel-head">
          <RsIcon name="database" :size="13" />
          <span>{{ t('modules.mysql.tools.target') }}</span>
          <span class="nm-mysql-tools__panel-hint">{{ t('modules.mysql.tools.targetHint') }}</span>
          <RsButton
            size="sm"
            variant="ghost"
            class="nm-mysql-tools__panel-refresh"
            :loading="catalogLoading || tablesLoading"
            :disabled="busy"
            @click="refreshCatalog"
          >
            <RsIcon name="refresh-cw" :size="12" />
            {{ t('modules.mysql.tools.refreshCatalog') }}
          </RsButton>
        </div>
        <label class="nm-mysql-tools__field nm-mysql-tools__field--db">
          <span class="nm-mysql-tools__field-label">{{ t('modules.mysql.tools.database') }}</span>
          <RsSelect
            v-model="database"
            :options="databaseOptions"
            :placeholder="t('modules.mysql.tools.databasePh')"
            :disabled="busy || databaseOptions.length === 0"
          />
        </label>
      </section>

      <section class="nm-mysql-tools__panel nm-mysql-tools__panel--main">
        <div class="nm-mysql-tools__section-tabs">
          <RsTabs v-model="toolsSection" :items="sectionTabs" size="sm" panelless />
          <span class="nm-mysql-tools__panel-hint">{{ t('modules.mysql.tools.backupHint') }}</span>
        </div>

        <div v-show="toolsSection === 'dump'" class="nm-mysql-tools__op">
          <div class="nm-mysql-tools__op-info">
            <span class="nm-mysql-tools__op-title">{{ t('modules.mysql.tools.dumpTitle') }}</span>
            <span class="nm-mysql-tools__op-desc">{{ t('modules.mysql.tools.dumpDesc') }}</span>
          </div>

          <div class="nm-mysql-tools__grid">
            <div class="nm-mysql-tools__field">
              <RsLabel>{{ t('modules.mysql.tools.contentMode') }}</RsLabel>
              <RsSelect v-model="dumpMode" :options="modeOptions" :disabled="busy" />
            </div>
            <div class="nm-mysql-tools__field nm-mysql-tools__field--wide">
              <RsLabel>{{ t('modules.mysql.tools.outputFile') }}</RsLabel>
              <RsInput
                v-model="dumpOutputPath"
                class="nm-mysql-tools__op-input"
                :placeholder="t('modules.mysql.tools.dumpPathPh')"
                :disabled="busy"
              >
                <template #suffix>
                  <button
                    type="button"
                    class="nm-mysql-tools__browse"
                    :aria-label="t('modules.mysql.tools.browse')"
                    :title="t('modules.mysql.tools.browse')"
                    :disabled="busy"
                    @pointerdown.prevent
                    @click="pickDumpFile"
                  >
                    <RsIcon name="folder-open" :size="14" />
                  </button>
                </template>
              </RsInput>
            </div>
          </div>

          <div class="nm-mysql-tools__picker">
            <div class="nm-mysql-tools__picker-head">
              <div class="nm-mysql-tools__picker-title">
                <span>{{ t('modules.mysql.tools.tables') }}</span>
                <span class="nm-mysql-tools__picker-hint">{{ t('modules.mysql.tools.tablesHint') }}</span>
              </div>
              <label class="nm-mysql-tools__picker-all">
                <input
                  type="checkbox"
                  :checked="allTablesSelected"
                  :disabled="busy || tablesLoading || tableRows.length === 0"
                  @change="toggleSelectAllTables(($event.target as HTMLInputElement).checked)"
                />
                {{ t('modules.mysql.tools.selectAll') }}
              </label>
            </div>
            <p v-if="tablesLoading" class="nm-mysql-tools__picker-status">
              {{ t('modules.mysql.tools.catalogLoading') }}
            </p>
            <ul v-else class="nm-mysql-tools__picker-list">
              <li v-for="name in tableRows" :key="name">
                <label class="nm-mysql-tools__picker-item">
                  <input
                    type="checkbox"
                    :checked="selectedTables.includes(name)"
                    :disabled="busy"
                    @change="toggleTable(name, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="nm-mysql-tools__picker-name" :title="name">{{ name }}</span>
                </label>
              </li>
              <li v-if="tableRows.length === 0" class="nm-mysql-tools__picker-empty">
                {{ t('modules.mysql.tools.tablesEmpty') }}
              </li>
            </ul>
            <p class="nm-mysql-tools__picker-meta">
              {{
                t('modules.mysql.tools.selectedCount', {
                  n: selectedTables.length,
                  total: tableRows.length,
                })
              }}
            </p>
          </div>

          <div class="nm-mysql-tools__options">
            <DataTransferCheck
              v-model="dropIfExists"
              variant="chip"
              :label="t('modules.mysql.tools.optDropIfExists')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="omitGtid"
              variant="chip"
              :label="t('modules.mysql.tools.optOmitGtid')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="triggers"
              variant="chip"
              :label="t('modules.mysql.tools.optTriggers')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="routines"
              variant="chip"
              :label="t('modules.mysql.tools.optRoutines')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="events"
              variant="chip"
              :label="t('modules.mysql.tools.optEvents')"
              :disabled="busy || selectedTables.length > 0"
            />
            <DataTransferCheck
              v-model="singleTransaction"
              variant="chip"
              :label="t('modules.mysql.tools.optSingleTransaction')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="dumpVerboseLog"
              variant="chip"
              :label="t('modules.mysql.tools.optVerbose')"
              :disabled="busy"
            />
          </div>

          <div class="nm-mysql-tools__op-actions">
            <RsButton
              size="sm"
              :disabled="!toolAvailable('mysqldump') || busy || !database.trim()"
              :loading="starting && !activeTaskId"
              @click="runDump"
            >
              <RsIcon name="download" :size="13" />
              {{ t('modules.mysql.tools.runDump') }}
            </RsButton>
          </div>
        </div>

        <div v-show="toolsSection === 'restore'" class="nm-mysql-tools__op">
          <div class="nm-mysql-tools__op-info">
            <span class="nm-mysql-tools__op-title">{{ t('modules.mysql.tools.restoreTitle') }}</span>
            <span class="nm-mysql-tools__op-desc">{{ t('modules.mysql.tools.restoreDesc') }}</span>
          </div>

          <div class="nm-mysql-tools__field nm-mysql-tools__field--wide">
            <RsLabel>{{ t('modules.mysql.tools.inputFile') }}</RsLabel>
            <RsInput
              v-model="restoreInputPath"
              class="nm-mysql-tools__op-input"
              :placeholder="t('modules.mysql.tools.restorePathPh')"
              :disabled="busy"
            >
              <template #suffix>
                <button
                  type="button"
                  class="nm-mysql-tools__browse"
                  :aria-label="t('modules.mysql.tools.browse')"
                  :title="t('modules.mysql.tools.browse')"
                  :disabled="busy"
                  @pointerdown.prevent
                  @click="pickRestoreFile"
                >
                  <RsIcon name="file" :size="14" />
                </button>
              </template>
            </RsInput>
          </div>

          <p class="nm-mysql-tools__restore-hint">{{ t('modules.mysql.tools.restoreHint') }}</p>

          <div class="nm-mysql-tools__options">
            <DataTransferCheck
              v-model="restoreStripGtid"
              variant="chip"
              :label="t('modules.mysql.tools.optStripGtid')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="restoreForce"
              variant="chip"
              :label="t('modules.mysql.tools.optForce')"
              :disabled="busy"
            />
            <DataTransferCheck
              v-model="restoreVerboseLog"
              variant="chip"
              :label="t('modules.mysql.tools.optVerboseRestore')"
              :disabled="busy"
            />
          </div>

          <div class="nm-mysql-tools__op-actions">
            <RsButton
              size="sm"
              variant="secondary"
              :disabled="!toolAvailable('mysql') || busy || !database.trim() || !restoreInputPath.trim()"
              :loading="starting && !activeTaskId"
              @click="runRestore"
            >
              <RsIcon name="upload" :size="13" />
              {{ t('modules.mysql.tools.runRestore') }}
            </RsButton>
          </div>
        </div>
      </section>
      </div>

      <section class="nm-mysql-tools__panel nm-mysql-tools__panel--log">
        <div class="nm-mysql-tools__panel-head">
          <RsIcon name="scroll-text" :size="13" />
          <span>{{ t('modules.mysql.tools.log') }}</span>
          <RsBadge v-if="activeTaskId" variant="info">
            {{ t('modules.mysql.tools.running') }}
          </RsBadge>
          <span v-if="lines.length" class="nm-mysql-tools__panel-hint">
            {{ t('modules.mysql.tools.logCount', { n: lines.length }) }}
          </span>
          <div class="nm-mysql-tools__panel-actions">
            <RsButton
              v-if="activeTaskId"
              size="sm"
              variant="danger"
              :loading="cancelling"
              @click="stopActiveTask"
            >
              <RsIcon name="square" :size="12" />
              {{ t('modules.mysql.tools.stop') }}
            </RsButton>
            <RsButton
              v-if="lines.length"
              size="sm"
              variant="ghost"
              :disabled="!!activeTaskId"
              @click="clearLines"
            >
              {{ t('modules.mysql.tools.clearLog') }}
            </RsButton>
          </div>
        </div>
        <RsVirtualList
          v-if="lines.length"
          class="nm-mysql-tools__log"
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
              class="nm-mysql-tools__log-line"
              :class="{
                'is-err': item.ok === false && item.phase !== 'canceled',
                'is-ok': item.ok === true,
                'is-canceled': item.phase === 'canceled',
              }"
            >
              <span class="nm-mysql-tools__log-id">#{{ item.taskId }}</span>
              <span class="nm-mysql-tools__log-msg" :title="item.message">{{ item.message }}</span>
              <span v-if="item.outputPath" class="nm-mysql-tools__log-path">→ {{ item.outputPath }}</span>
            </div>
          </template>
        </RsVirtualList>
        <div v-else class="nm-mysql-tools__log-empty">
          {{ lastMessage || t('modules.mysql.tools.logEmpty') }}
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.nm-mysql-tools {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--rs-surface);
}

.nm-mysql-tools__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
  padding: var(--rs-space-md) var(--rs-space-lg);
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-mysql-tools__header-left {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.nm-mysql-tools__title-row {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-wrap: wrap;
}

.nm-mysql-tools__title-icon {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-mysql-tools__title {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  letter-spacing: 0.01em;
}

.nm-mysql-tools__subtitle {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: 1.4;
}

.nm-mysql-tools__header-actions {
  display: flex;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
}

.nm-mysql-tools__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-mysql-tools__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: var(--rs-space-md) var(--rs-space-lg) var(--rs-space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
}

.nm-mysql-tools__main {
  flex: 0 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
}

.nm-mysql-tools__status {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--rs-space-sm);
}

.nm-mysql-tools__guide {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-md);
  border-radius: var(--rs-radius-lg);
  border: 1px solid color-mix(in srgb, var(--rs-warning, #c90) 35%, var(--rs-border-subtle));
  background: color-mix(in srgb, var(--rs-warning, #c90) 8%, var(--rs-surface-raised));
}

.nm-mysql-tools__guide-head {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-text);
}

.nm-mysql-tools__guide-head :deep(svg) {
  color: var(--rs-warning, #b8860b);
  flex-shrink: 0;
}

.nm-mysql-tools__guide-body {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: 1.5;
}

.nm-mysql-tools__guide-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rs-space-xs);
}

.nm-mysql-tools__status-chip {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
  padding: 0.625rem 0.75rem;
  border-radius: var(--rs-radius-md);
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-surface-raised) 88%, transparent);
}

.nm-mysql-tools__status-chip.is-ok {
  border-color: color-mix(in srgb, var(--rs-success) 28%, var(--rs-border-subtle));
}

.nm-mysql-tools__status-chip.is-missing {
  border-color: color-mix(in srgb, var(--rs-danger) 22%, var(--rs-border-subtle));
  opacity: 0.9;
}

.nm-mysql-tools__status-icon {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-hover);
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-mysql-tools__status-chip.is-ok .nm-mysql-tools__status-icon {
  color: var(--rs-success);
  background: color-mix(in srgb, var(--rs-success) 12%, transparent);
}

.nm-mysql-tools__status-chip.is-missing .nm-mysql-tools__status-icon {
  color: var(--rs-danger);
  background: color-mix(in srgb, var(--rs-danger) 10%, transparent);
}

.nm-mysql-tools__status-meta {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  flex: 1;
  min-width: 0;
}

.nm-mysql-tools__status-name {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  font-family: var(--rs-font-mono);
  line-height: 1.2;
}

.nm-mysql-tools__status-path {
  font-size: 0.6875rem;
  color: var(--rs-muted);
  line-height: 1.3;
}

.nm-mysql-tools__status-path.is-missing {
  color: var(--rs-danger);
}

.nm-mysql-tools__status-dot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  flex-shrink: 0;
}

.nm-mysql-tools__status-dot.is-ok {
  background: var(--rs-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rs-success) 18%, transparent);
}

.nm-mysql-tools__status-dot.is-missing {
  background: var(--rs-danger);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rs-danger) 14%, transparent);
}

.nm-mysql-tools__panel {
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-lg);
  background: color-mix(in srgb, var(--rs-surface-raised) 92%, transparent);
  padding: var(--rs-space-md);
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}

.nm-mysql-tools__panel-head {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-text);
  min-width: 0;
}

.nm-mysql-tools__panel-head > :deep(svg) {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-mysql-tools__panel-hint {
  margin-left: var(--rs-space-xs);
  font-weight: 400;
  color: var(--rs-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-mysql-tools__panel-refresh {
  margin-left: auto;
  flex-shrink: 0;
}

.nm-mysql-tools__panel-actions {
  margin-left: auto;
  flex-shrink: 0;
  display: flex;
  gap: var(--rs-space-xs);
}

.nm-mysql-tools__field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.nm-mysql-tools__field-label {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  font-weight: 500;
}

.nm-mysql-tools__field--db {
  max-width: 22rem;
}

.nm-mysql-tools__field--wide {
  grid-column: 1 / -1;
}

.nm-mysql-tools__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--rs-space-sm) var(--rs-space-md);
}

.nm-mysql-tools__section-tabs {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-wrap: wrap;
  padding-bottom: var(--rs-space-xs);
  border-bottom: 1px solid var(--rs-border-subtle);
  margin-bottom: var(--rs-space-xs);
}

.nm-mysql-tools__section-tabs .nm-mysql-tools__panel-hint {
  margin-left: 0;
  flex: 1;
  min-width: 8rem;
}

.nm-mysql-tools__op {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  padding-top: var(--rs-space-xs);
}

.nm-mysql-tools__op-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.nm-mysql-tools__op-title {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
}

.nm-mysql-tools__op-desc {
  font-size: 0.6875rem;
  color: var(--rs-muted);
  line-height: 1.35;
}

.nm-mysql-tools__op-input {
  width: 100%;
  min-width: 0;
}

.nm-mysql-tools__op-actions {
  display: flex;
  justify-content: flex-end;
}

.nm-mysql-tools__picker {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md);
  background: color-mix(in srgb, var(--rs-surface) 75%, transparent);
  padding: var(--rs-space-sm);
}

.nm-mysql-tools__picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
}

.nm-mysql-tools__picker-title {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
}

.nm-mysql-tools__picker-hint {
  font-weight: 400;
  color: var(--rs-muted);
  font-size: 0.6875rem;
}

.nm-mysql-tools__picker-all {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}

.nm-mysql-tools__picker-all input {
  margin: 0;
}

.nm-mysql-tools__picker-list {
  list-style: none;
  margin: 0;
  padding: 0.15rem;
  max-height: 11rem;
  overflow: auto;
  border-radius: var(--rs-radius-sm);
  border: 1px solid color-mix(in srgb, var(--rs-border-subtle) 80%, transparent);
  background: var(--rs-surface);
}

.nm-mysql-tools__picker-item {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.28rem 0.4rem;
  border-radius: var(--rs-radius-sm);
  font-size: var(--rs-font-size-xs);
  cursor: pointer;
}

.nm-mysql-tools__picker-item:hover {
  background: var(--rs-item-hover);
}

.nm-mysql-tools__picker-item input {
  margin: 0;
  flex-shrink: 0;
}

.nm-mysql-tools__picker-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-mysql-tools__picker-empty,
.nm-mysql-tools__picker-status {
  margin: 0;
  padding: 0.75rem 0.5rem;
  text-align: center;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-mysql-tools__picker-meta {
  margin: 0;
  font-size: 0.6875rem;
  color: var(--rs-muted);
}

.nm-mysql-tools__options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.nm-mysql-tools__restore-hint {
  margin: 0;
  font-size: 0.6875rem;
  color: var(--rs-muted);
  line-height: 1.4;
}

.nm-mysql-tools__browse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  border: none;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
}

.nm-mysql-tools__browse:hover:not(:disabled) {
  color: var(--rs-text);
  background: var(--rs-item-hover);
}

.nm-mysql-tools__browse:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}

.nm-mysql-tools__browse:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.nm-mysql-tools__panel--log {
  flex: 1 1 12rem;
  min-height: 12rem;
  max-height: min(42vh, 22rem);
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.nm-mysql-tools__panel--log .nm-mysql-tools__panel-head {
  flex-shrink: 0;
}

.nm-mysql-tools__log {
  flex: 1 1 auto;
  min-height: 0;
  height: 0;
  margin: 0;
  border-radius: var(--rs-radius-md);
  background: color-mix(in srgb, var(--rs-surface) 70%, #000 8%);
  border: 1px solid var(--rs-border-subtle);
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-xs);
}

.nm-mysql-tools__log :deep(.rs-virtual-list__item--active) {
  background: color-mix(in srgb, var(--rs-primary) 10%, transparent);
}

.nm-mysql-tools__log-line {
  display: flex;
  align-items: center;
  gap: 0.45rem 0.6rem;
  height: 28px;
  padding: 0 var(--rs-space-md);
  box-sizing: border-box;
  border-bottom: 1px solid color-mix(in srgb, var(--rs-border-subtle) 70%, transparent);
  overflow: hidden;
}

.nm-mysql-tools__log-id {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-mysql-tools__log-msg {
  color: var(--rs-text);
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-mysql-tools__log-path {
  color: var(--rs-info, var(--rs-primary));
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}

.nm-mysql-tools__log-line.is-err .nm-mysql-tools__log-msg {
  color: var(--rs-danger);
}

.nm-mysql-tools__log-line.is-ok .nm-mysql-tools__log-msg {
  color: var(--rs-success);
}

.nm-mysql-tools__log-line.is-canceled .nm-mysql-tools__log-msg {
  color: var(--rs-muted);
  font-style: italic;
}

.nm-mysql-tools__log-empty {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--rs-radius-md);
  border: 1px dashed var(--rs-border-subtle);
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}

.min-w-0 {
  min-width: 0;
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .nm-mysql-tools__status,
  .nm-mysql-tools__grid {
    grid-template-columns: 1fr;
  }

  .nm-mysql-tools__field--db {
    max-width: none;
  }

  .nm-mysql-tools__header {
    flex-direction: column;
  }
}
</style>
