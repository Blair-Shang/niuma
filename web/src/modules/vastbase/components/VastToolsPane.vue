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
  useRsToast,
} from '@niuma/ui'
import type { RsSelectOptions, RsTabItem } from '@niuma/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi, dialogApi, fsApi, vastbaseApi } from '@/api'
import type {
  VastToolsContentMode,
  VastToolsDetectResult,
  VastToolsDumpFormat,
  VastToolsDumpOptions,
  VastToolsRestoreOptions,
} from '@/api/types/vastbase'
import type { ConnItem } from '@/modules/ops/types'
import { openVastbaseDataTask } from '@/modules/vastbase/data-tasks'
import { useVastIoTasks } from '@/modules/vastbase/composables/useVastIoTasks'
import { loadVastToolPaths } from '@/modules/vastbase/utils/tool-paths'
import { backupRestoreScript } from '@/modules/vastbase/utils/script-templates'
import { useTabStore } from '@/stores/tab'

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
const tasks = useVastIoTasks('vastbase.tools.')
const { lastMessage, activeTaskId, lines, track, waitForTask, clearLines } = tasks

const loading = ref(true)
const toolPaths = ref<Record<string, string>>({})
const detect = ref<VastToolsDetectResult | null>(null)
const database = ref(props.database ?? '')
const dumpOutputPath = ref('')
const restoreInputPath = ref('')
const starting = ref(false)
const cancelling = ref(false)
/** 备份 / 还原分区：避免两套表单挤在同一滚动区 */
const toolsSection = ref<'dump' | 'restore'>('dump')

const dumpFormat = ref<VastToolsDumpFormat>('c')
const dumpMode = ref<VastToolsContentMode>('all')
const dumpSchemas = ref('')
const dumpExcludeSchemas = ref('')
const dumpTables = ref('')
const dumpExcludeTables = ref('')
const dumpJobs = ref('')
const dumpCompress = ref('')
const dumpClean = ref(false)
const dumpCreate = ref(false)
const dumpNoOwner = ref(false)
const dumpNoPrivileges = ref(false)
const dumpBlobs = ref(false)
const dumpEncoding = ref('')
const dumpVerbose = ref(false)

const restoreFormat = ref<VastToolsDumpFormat | ''>('')
const restoreMode = ref<VastToolsContentMode>('all')
const restoreSchemas = ref('')
const restoreTables = ref('')
const restoreJobs = ref('')
const restoreClean = ref(true)
const restoreIfExists = ref(true)
const restoreCreate = ref(false)
const restoreNoOwner = ref(false)
const restoreNoPrivileges = ref(false)
const restoreDisableTriggers = ref(false)
const restoreSingleTransaction = ref(false)
const restoreVerbose = ref(false)

watch(
  () => props.database,
  (v) => {
    if (v) database.value = v
  },
)

const busy = computed(() => starting.value || !!activeTaskId.value)

const formatOptions = computed((): RsSelectOptions => [
  { value: 'c', label: t('modules.vastbase.tools.formatCustom') },
  { value: 'd', label: t('modules.vastbase.tools.formatDirectory') },
  { value: 't', label: t('modules.vastbase.tools.formatTar') },
  { value: 'p', label: t('modules.vastbase.tools.formatPlain') },
])

const restoreFormatOptions = computed((): RsSelectOptions => [
  { value: '', label: t('modules.vastbase.tools.formatAuto') },
  ...formatOptions.value,
])

const modeOptions = computed((): RsSelectOptions => [
  { value: 'all', label: t('modules.vastbase.tools.modeAll') },
  { value: 'schema_only', label: t('modules.vastbase.tools.modeSchemaOnly') },
  { value: 'data_only', label: t('modules.vastbase.tools.modeDataOnly') },
])

const toolRows = computed(() => {
  const d = detect.value
  if (!d) return []
  return [
    { id: 'vb_dump' as const, label: 'vb_dump', icon: 'archive', entry: d.vb_dump },
    { id: 'vb_restore' as const, label: 'vb_restore', icon: 'package-open', entry: d.vb_restore },
    { id: 'vsql' as const, label: 'vsql', icon: 'terminal', entry: d.vsql },
  ]
})

const availableCount = computed(() => toolRows.value.filter((r) => r.entry.available).length)

const readyVariant = computed(() => {
  if (!toolRows.value.length) return 'danger' as const
  if (availableCount.value === toolRows.value.length) return 'success' as const
  if (availableCount.value > 0) return 'warning' as const
  return 'danger' as const
})

const dumpJobsEnabled = computed(
  () => dumpFormat.value === 'c' || dumpFormat.value === 'd',
)

const sectionTabs = computed((): RsTabItem[] => [
  { value: 'dump', label: t('modules.vastbase.tools.dumpTitle'), icon: 'download' },
  { value: 'restore', label: t('modules.vastbase.tools.restoreTitle'), icon: 'upload' },
])

function toolAvailable(id: keyof VastToolsDetectResult): boolean {
  return detect.value?.[id]?.available === true
}

/** 本机无官方工具时展示引导（vb_* 通常仅随 Linux 服务端安装包提供）。 */
const toolsMissing = computed(
  () => !loading.value && (!toolAvailable('vb_dump') || !toolAvailable('vb_restore')),
)

function splitList(text: string): string[] | undefined {
  const items = text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return items.length ? items : undefined
}

function parseOptionalInt(text: string): number | undefined {
  const t = text.trim()
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? Math.trunc(n) : undefined
}

function buildDumpOptions(): VastToolsDumpOptions {
  return {
    format: dumpFormat.value,
    mode: dumpMode.value,
    schemas: splitList(dumpSchemas.value),
    excludeSchemas: splitList(dumpExcludeSchemas.value),
    tables: splitList(dumpTables.value),
    excludeTables: splitList(dumpExcludeTables.value),
    jobs: dumpJobsEnabled.value ? parseOptionalInt(dumpJobs.value) : undefined,
    compress: parseOptionalInt(dumpCompress.value),
    clean: dumpClean.value,
    create: dumpCreate.value,
    noOwner: dumpNoOwner.value,
    noPrivileges: dumpNoPrivileges.value,
    blobs: dumpBlobs.value,
    encoding: dumpEncoding.value.trim() || undefined,
    verbose: dumpVerbose.value,
  }
}

function buildRestoreOptions(): VastToolsRestoreOptions {
  return {
    format: restoreFormat.value || undefined,
    mode: restoreMode.value,
    schemas: splitList(restoreSchemas.value),
    tables: splitList(restoreTables.value),
    jobs: parseOptionalInt(restoreJobs.value),
    clean: restoreClean.value,
    ifExists: restoreIfExists.value,
    create: restoreCreate.value,
    noOwner: restoreNoOwner.value,
    noPrivileges: restoreNoPrivileges.value,
    disableTriggers: restoreDisableTriggers.value,
    singleTransaction: restoreSingleTransaction.value,
    verbose: restoreVerbose.value,
  }
}

function dumpDefaultExt(): string {
  switch (dumpFormat.value) {
    case 'p':
      return '.sql'
    case 't':
      return '.tar'
    case 'd':
      return '.dir'
    default:
      return '.dump'
  }
}

async function refreshDetect(): Promise<void> {
  loading.value = true
  try {
    toolPaths.value = await loadVastToolPaths()
    detect.value = await vastbaseApi.toolsDetect({ toolPaths: toolPaths.value })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.tools.detectError'))
  } finally {
    loading.value = false
  }
}

function connectScope(): { sessionId?: string; profileId?: string } {
  const sessionId = props.sessionId?.trim() || undefined
  const profileId = props.profileId?.trim() || undefined
  return { sessionId, profileId }
}

async function pickDumpFile(): Promise<void> {
  try {
    const result = await dialogApi.saveFile({
      title: t('modules.vastbase.tools.browseDumpTitle'),
      defaultPath: dumpOutputPath.value || `${database.value || 'db'}${dumpDefaultExt()}`,
      accept: ['.dump', '.backup', '.sql', '.tar', '.dir'],
    })
    if (!result.canceled && result.filePaths[0]) {
      dumpOutputPath.value = result.filePaths[0]
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.tools.browseError'))
  }
}

async function pickRestoreFile(): Promise<void> {
  try {
    const result = await dialogApi.openFile({
      title: t('modules.vastbase.tools.browseRestoreTitle'),
      defaultPath: restoreInputPath.value || undefined,
      accept: ['.dump', '.backup', '.sql', '.tar', '.dir'],
    })
    if (!result.canceled && result.filePaths[0]) {
      restoreInputPath.value = result.filePaths[0]
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.tools.browseError'))
  }
}

async function runTask(
  label: string,
  runner: () => Promise<{ taskId: string }>,
): Promise<void> {
  const { sessionId, profileId } = connectScope()
  if ((!sessionId && !profileId) || busy.value) {
    if (!sessionId && !profileId) {
      toast.error(t('modules.vastbase.tools.runError'))
    }
    return
  }
  starting.value = true
  track()
  try {
    const result = await runner()
    waitForTask(result.taskId).then(async (done) => {
      if (done.ok) {
        toast.success(t('modules.vastbase.tools.done', { tool: label }))
        if (done.outputPath) {
          try {
            await fsApi.showInFolder({ path: done.outputPath })
          } catch {
            // ignore
          }
        }
      } else {
        toast.error(done.message || t('modules.vastbase.tools.runError'))
      }
    })
    toast.success(t('modules.vastbase.tools.started', { tool: label, taskId: result.taskId }))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.tools.runError'))
  } finally {
    starting.value = false
  }
}

async function stopActiveTask(): Promise<void> {
  const taskId = activeTaskId.value
  if (!taskId || cancelling.value) return
  cancelling.value = true
  try {
    await vastbaseApi.toolsCancel({ taskId })
    toast.success(t('modules.vastbase.tools.stopped', { taskId }))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.tools.stopError'))
  } finally {
    cancelling.value = false
  }
}

async function runDump(): Promise<void> {
  if (!database.value.trim()) {
    toast.error(t('modules.vastbase.tools.needDatabase'))
    return
  }
  const scope = connectScope()
  await runTask('vb_dump', () =>
    vastbaseApi.toolsDump({
      ...scope,
      database: database.value,
      outputPath: dumpOutputPath.value || undefined,
      options: buildDumpOptions(),
      toolPaths: toolPaths.value,
    }),
  )
}

async function runRestore(): Promise<void> {
  if (!database.value.trim() || !restoreInputPath.value.trim()) {
    toast.error(t('modules.vastbase.tools.needRestore'))
    return
  }
  const scope = connectScope()
  await runTask('vb_restore', () =>
    vastbaseApi.toolsRestore({
      ...scope,
      database: database.value,
      inputPath: restoreInputPath.value,
      options: buildRestoreOptions(),
      toolPaths: toolPaths.value,
    }),
  )
}

async function copyShellScript(): Promise<void> {
  const script = backupRestoreScript({
    database: database.value || 'DATABASE',
    dump: {
      ...buildDumpOptions(),
      outputPath: dumpOutputPath.value || undefined,
    },
    restore: {
      ...buildRestoreOptions(),
      inputPath: restoreInputPath.value || undefined,
    },
  })
  try {
    await navigator.clipboard.writeText(script)
    toast.success(t('modules.vastbase.tree.backupScriptCopied'))
  } catch {
    toast.error(t('modules.vastbase.tree.copyFailed'))
  }
}

function openToolSettings(): void {
  tabs.openSettings()
}

async function openDumpSqlFallback(): Promise<void> {
  const profileId = props.profileId?.trim()
  if (!profileId) {
    toast.error(t('modules.vastbase.tools.runError'))
    return
  }
  try {
    const { profile } = await connectionApi.get({ profileId })
    if (!profile) {
      toast.error(t('modules.vastbase.tools.runError'))
      return
    }
    const conn: ConnItem = { ...profile, kind: 'vastbase' }
    openVastbaseDataTask({
      kind: 'dump_sql',
      title: t('modules.vastbase.io.dumpTitle'),
      description: t('modules.vastbase.io.dumpDesc', { name: database.value || '' }),
      context: {
        conn,
        profileId,
        sessionId: props.sessionId,
        database: database.value.trim() || undefined,
      },
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.tools.runError'))
  }
}

onMounted(() => {
  track()
  void refreshDetect()
})
</script>

<template>
  <div class="nm-vast-tools">
    <header class="nm-vast-tools__header">
      <div class="nm-vast-tools__header-left">
        <div class="nm-vast-tools__title-row">
          <RsIcon name="wrench" :size="15" class="nm-vast-tools__title-icon" />
          <h3 class="nm-vast-tools__title">{{ t('modules.vastbase.tools.title') }}</h3>
          <RsBadge v-if="sessionLabel" variant="default">{{ sessionLabel }}</RsBadge>
          <RsBadge v-if="!loading && toolRows.length" :variant="readyVariant">
            {{ t('modules.vastbase.tools.readySummary', { n: availableCount, total: toolRows.length }) }}
          </RsBadge>
        </div>
        <p class="nm-vast-tools__subtitle">{{ t('modules.vastbase.tools.hint') }}</p>
      </div>
      <div class="nm-vast-tools__header-actions">
        <RsButton
          v-if="busy"
          size="sm"
          variant="danger"
          :loading="cancelling"
          @click="stopActiveTask"
        >
          <RsIcon name="square" :size="12" />
          {{ t('modules.vastbase.tools.stop') }}
        </RsButton>
        <RsButton size="sm" variant="ghost" :loading="loading" @click="refreshDetect">
          <RsIcon name="refresh-cw" :size="13" />
          {{ t('modules.vastbase.tools.refresh') }}
        </RsButton>
      </div>
    </header>

    <RsLoading
      v-if="loading"
      class="nm-vast-tools__loading"
      :label="t('modules.vastbase.tools.detecting')"
      show-label
    />

    <div v-else class="nm-vast-tools__body">
      <section class="nm-vast-tools__status" :aria-label="t('modules.vastbase.tools.status')">
        <div
          v-for="row in toolRows"
          :key="row.id"
          class="nm-vast-tools__status-chip"
          :class="row.entry.available ? 'is-ok' : 'is-missing'"
        >
          <div class="nm-vast-tools__status-icon" aria-hidden="true">
            <RsIcon :name="row.icon" :size="14" />
          </div>
          <div class="nm-vast-tools__status-meta min-w-0">
            <span class="nm-vast-tools__status-name">{{ row.label }}</span>
            <RsTooltip
              v-if="row.entry.available && row.entry.path"
              :content="row.entry.path"
              side="bottom"
            >
              <span class="nm-vast-tools__status-path truncate">{{ row.entry.path }}</span>
            </RsTooltip>
            <span v-else-if="row.entry.available" class="nm-vast-tools__status-path">
              {{ t('modules.vastbase.tools.available') }}
            </span>
            <span v-else class="nm-vast-tools__status-path is-missing">
              {{ t('modules.vastbase.tools.missing') }}
            </span>
          </div>
          <span
            class="nm-vast-tools__status-dot"
            :class="row.entry.available ? 'is-ok' : 'is-missing'"
            aria-hidden="true"
          />
        </div>
      </section>

      <section v-if="toolsMissing" class="nm-vast-tools__guide" role="note">
        <div class="nm-vast-tools__guide-head">
          <RsIcon name="info" :size="14" />
          <span>{{ t('modules.vastbase.tools.missingTitle') }}</span>
        </div>
        <p class="nm-vast-tools__guide-body">{{ t('modules.vastbase.tools.missingGuide') }}</p>
        <ol class="nm-vast-tools__guide-steps">
          <li>{{ t('modules.vastbase.tools.missingStepServer') }}</li>
          <li>{{ t('modules.vastbase.tools.missingStepDumpSql') }}</li>
          <li>{{ t('modules.vastbase.tools.missingStepSettings') }}</li>
        </ol>
        <div class="nm-vast-tools__guide-actions">
          <RsButton size="sm" @click="copyShellScript">
            <RsIcon name="clipboard" :size="13" />
            {{ t('modules.vastbase.tools.copyServerCmd') }}
          </RsButton>
          <RsButton size="sm" variant="secondary" @click="openDumpSqlFallback">
            <RsIcon name="file-down" :size="13" />
            {{ t('modules.vastbase.tools.openDumpSql') }}
          </RsButton>
          <RsButton size="sm" variant="ghost" @click="openToolSettings">
            <RsIcon name="settings" :size="13" />
            {{ t('modules.vastbase.tools.openSettings') }}
          </RsButton>
        </div>
      </section>

      <section class="nm-vast-tools__panel">
        <div class="nm-vast-tools__panel-head">
          <RsIcon name="database" :size="13" />
          <span>{{ t('modules.vastbase.tools.target') }}</span>
          <span class="nm-vast-tools__panel-hint">{{ t('modules.vastbase.tools.targetHint') }}</span>
        </div>
        <label class="nm-vast-tools__field">
          <span class="nm-vast-tools__field-label">{{ t('modules.vastbase.tools.database') }}</span>
          <RsInput
            v-model="database"
            :placeholder="t('modules.vastbase.tools.databasePh')"
            :disabled="busy"
          />
        </label>
      </section>

      <div class="nm-vast-tools__ops">
        <section class="nm-vast-tools__panel nm-vast-tools__panel--main">
          <div class="nm-vast-tools__section-tabs">
            <RsTabs v-model="toolsSection" :items="sectionTabs" size="sm" panelless />
            <span class="nm-vast-tools__panel-hint">{{ t('modules.vastbase.tools.backupHint') }}</span>
          </div>

          <div v-show="toolsSection === 'dump'" class="nm-vast-tools__op">
            <div class="nm-vast-tools__op-info">
              <span class="nm-vast-tools__op-title">vb_dump</span>
              <span class="nm-vast-tools__op-desc">{{ t('modules.vastbase.tools.dumpDesc') }}</span>
            </div>
            <div class="nm-vast-tools__op-controls">
              <RsInput
                v-model="dumpOutputPath"
                class="nm-vast-tools__op-input"
                :placeholder="t('modules.vastbase.tools.dumpPathPh')"
                :disabled="busy"
              >
                <template #suffix>
                  <button
                    type="button"
                    class="nm-vast-tools__browse"
                    :aria-label="t('modules.vastbase.tools.browse')"
                    :title="t('modules.vastbase.tools.browse')"
                    :disabled="busy"
                    @pointerdown.prevent
                    @click="pickDumpFile"
                  >
                    <RsIcon name="folder-open" :size="14" />
                  </button>
                </template>
              </RsInput>
              <RsButton
                size="sm"
                :disabled="!toolAvailable('vb_dump') || busy || !database.trim()"
                :loading="starting && !activeTaskId"
                @click="runDump"
              >
                <RsIcon name="download" :size="13" />
                {{ t('modules.vastbase.tools.runDump') }}
              </RsButton>
            </div>

            <div class="nm-vast-tools__grid">
              <div class="nm-vast-tools__field">
                <RsLabel>{{ t('modules.vastbase.tools.format') }}</RsLabel>
                <RsSelect v-model="dumpFormat" :options="formatOptions" :disabled="busy" />
              </div>
              <div class="nm-vast-tools__field">
                <RsLabel>{{ t('modules.vastbase.tools.contentMode') }}</RsLabel>
                <RsSelect v-model="dumpMode" :options="modeOptions" :disabled="busy" />
              </div>
              <div class="nm-vast-tools__field">
                <RsLabel>{{ t('modules.vastbase.tools.jobs') }}</RsLabel>
                <RsInput
                  v-model="dumpJobs"
                  :placeholder="t('modules.vastbase.tools.jobsPh')"
                  :disabled="busy || !dumpJobsEnabled"
                />
              </div>
              <div class="nm-vast-tools__field">
                <RsLabel>{{ t('modules.vastbase.tools.compress') }}</RsLabel>
                <RsInput
                  v-model="dumpCompress"
                  :placeholder="t('modules.vastbase.tools.compressPh')"
                  :disabled="busy"
                />
              </div>
              <div class="nm-vast-tools__field nm-vast-tools__field--wide">
                <RsLabel>{{ t('modules.vastbase.tools.schemas') }}</RsLabel>
                <RsInput
                  v-model="dumpSchemas"
                  :placeholder="t('modules.vastbase.tools.listPh')"
                  :disabled="busy"
                />
              </div>
              <div class="nm-vast-tools__field nm-vast-tools__field--wide">
                <RsLabel>{{ t('modules.vastbase.tools.excludeSchemas') }}</RsLabel>
                <RsInput
                  v-model="dumpExcludeSchemas"
                  :placeholder="t('modules.vastbase.tools.listPh')"
                  :disabled="busy"
                />
              </div>
              <div class="nm-vast-tools__field nm-vast-tools__field--wide">
                <RsLabel>{{ t('modules.vastbase.tools.tables') }}</RsLabel>
                <RsInput
                  v-model="dumpTables"
                  :placeholder="t('modules.vastbase.tools.tableListPh')"
                  :disabled="busy"
                />
              </div>
              <div class="nm-vast-tools__field nm-vast-tools__field--wide">
                <RsLabel>{{ t('modules.vastbase.tools.excludeTables') }}</RsLabel>
                <RsInput
                  v-model="dumpExcludeTables"
                  :placeholder="t('modules.vastbase.tools.tableListPh')"
                  :disabled="busy"
                />
              </div>
              <div class="nm-vast-tools__field">
                <RsLabel>{{ t('modules.vastbase.tools.encoding') }}</RsLabel>
                <RsInput
                  v-model="dumpEncoding"
                  :placeholder="t('modules.vastbase.tools.encodingPh')"
                  :disabled="busy"
                />
              </div>
            </div>
            <div class="nm-vast-tools__options">
              <label class="nm-vast-tools__option">
                <input v-model="dumpClean" type="checkbox" :disabled="busy" />
                <span>{{ t('modules.vastbase.tools.optCleanDump') }}</span>
              </label>
              <label class="nm-vast-tools__option">
                <input v-model="dumpCreate" type="checkbox" :disabled="busy" />
                <span>{{ t('modules.vastbase.tools.optCreate') }}</span>
              </label>
              <label class="nm-vast-tools__option">
                <input v-model="dumpNoOwner" type="checkbox" :disabled="busy" />
                <span>{{ t('modules.vastbase.tools.optNoOwnerDump') }}</span>
              </label>
              <label class="nm-vast-tools__option">
                <input v-model="dumpNoPrivileges" type="checkbox" :disabled="busy" />
                <span>{{ t('modules.vastbase.tools.optNoPrivileges') }}</span>
              </label>
              <label class="nm-vast-tools__option">
                <input v-model="dumpBlobs" type="checkbox" :disabled="busy" />
                <span>{{ t('modules.vastbase.tools.optBlobs') }}</span>
              </label>
              <label class="nm-vast-tools__option">
                <input v-model="dumpVerbose" type="checkbox" :disabled="busy" />
                <span>{{ t('modules.vastbase.tools.optVerbose') }}</span>
              </label>
            </div>
          </div>

          <div v-show="toolsSection === 'restore'" class="nm-vast-tools__op">
            <div class="nm-vast-tools__op-info">
              <span class="nm-vast-tools__op-title">vb_restore</span>
              <span class="nm-vast-tools__op-desc">{{ t('modules.vastbase.tools.restoreDesc') }}</span>
            </div>
            <div class="nm-vast-tools__op-controls">
              <RsInput
                v-model="restoreInputPath"
                class="nm-vast-tools__op-input"
                :placeholder="t('modules.vastbase.tools.restorePathPh')"
                :disabled="busy"
              >
                <template #suffix>
                  <button
                    type="button"
                    class="nm-vast-tools__browse"
                    :aria-label="t('modules.vastbase.tools.browse')"
                    :title="t('modules.vastbase.tools.browse')"
                    :disabled="busy"
                    @pointerdown.prevent
                    @click="pickRestoreFile"
                  >
                    <RsIcon name="file" :size="14" />
                  </button>
                </template>
              </RsInput>
              <RsButton
                size="sm"
                variant="secondary"
                :disabled="!toolAvailable('vb_restore') || busy || !database.trim() || !restoreInputPath.trim()"
                :loading="starting && !activeTaskId"
                @click="runRestore"
              >
                <RsIcon name="upload" :size="13" />
                {{ t('modules.vastbase.tools.runRestore') }}
              </RsButton>
            </div>

            <div class="nm-vast-tools__grid">
              <div class="nm-vast-tools__field">
                <RsLabel>{{ t('modules.vastbase.tools.format') }}</RsLabel>
                <RsSelect v-model="restoreFormat" :options="restoreFormatOptions" :disabled="busy" />
              </div>
              <div class="nm-vast-tools__field">
                <RsLabel>{{ t('modules.vastbase.tools.contentMode') }}</RsLabel>
                <RsSelect v-model="restoreMode" :options="modeOptions" :disabled="busy" />
              </div>
              <div class="nm-vast-tools__field">
                <RsLabel>{{ t('modules.vastbase.tools.jobs') }}</RsLabel>
                <RsInput
                  v-model="restoreJobs"
                  :placeholder="t('modules.vastbase.tools.jobsPh')"
                  :disabled="busy"
                />
              </div>
              <div class="nm-vast-tools__field nm-vast-tools__field--wide">
                <RsLabel>{{ t('modules.vastbase.tools.schemas') }}</RsLabel>
                <RsInput
                  v-model="restoreSchemas"
                  :placeholder="t('modules.vastbase.tools.listPh')"
                  :disabled="busy"
                />
              </div>
              <div class="nm-vast-tools__field nm-vast-tools__field--wide">
                <RsLabel>{{ t('modules.vastbase.tools.tables') }}</RsLabel>
                <RsInput
                  v-model="restoreTables"
                  :placeholder="t('modules.vastbase.tools.tableListPh')"
                  :disabled="busy"
                />
              </div>
            </div>
            <div class="nm-vast-tools__options">
              <label class="nm-vast-tools__option">
                <input v-model="restoreClean" type="checkbox" :disabled="busy" />
                <span>{{ t('modules.vastbase.tools.optClean') }}</span>
              </label>
              <label class="nm-vast-tools__option">
                <input v-model="restoreIfExists" type="checkbox" :disabled="busy" />
                <span>{{ t('modules.vastbase.tools.optIfExists') }}</span>
              </label>
              <label class="nm-vast-tools__option">
                <input v-model="restoreCreate" type="checkbox" :disabled="busy" />
                <span>{{ t('modules.vastbase.tools.optCreate') }}</span>
              </label>
              <label class="nm-vast-tools__option">
                <input v-model="restoreNoOwner" type="checkbox" :disabled="busy" />
                <span>{{ t('modules.vastbase.tools.optNoOwner') }}</span>
              </label>
              <label class="nm-vast-tools__option">
                <input v-model="restoreNoPrivileges" type="checkbox" :disabled="busy" />
                <span>{{ t('modules.vastbase.tools.optNoPrivileges') }}</span>
              </label>
              <label class="nm-vast-tools__option">
                <input v-model="restoreDisableTriggers" type="checkbox" :disabled="busy" />
                <span>{{ t('modules.vastbase.tools.optDisableTriggers') }}</span>
              </label>
              <label class="nm-vast-tools__option">
                <input v-model="restoreSingleTransaction" type="checkbox" :disabled="busy" />
                <span>{{ t('modules.vastbase.tools.optSingleTransaction') }}</span>
              </label>
              <label class="nm-vast-tools__option">
                <input v-model="restoreVerbose" type="checkbox" :disabled="busy" />
                <span>{{ t('modules.vastbase.tools.optVerbose') }}</span>
              </label>
            </div>
          </div>
        </section>

        <section class="nm-vast-tools__panel nm-vast-tools__panel--shell">
          <div class="nm-vast-tools__panel-head">
            <RsIcon name="terminal" :size="13" />
            <span>{{ t('modules.vastbase.tools.shellTitle') }}</span>
          </div>
          <p class="nm-vast-tools__shell-hint">{{ t('modules.vastbase.tools.shellHint') }}</p>
          <RsButton size="sm" variant="ghost" class="nm-vast-tools__shell-btn" @click="copyShellScript">
            <RsIcon name="clipboard" :size="13" />
            {{ t('modules.vastbase.tree.backupScript') }}
          </RsButton>
        </section>
      </div>

      <section class="nm-vast-tools__panel nm-vast-tools__panel--log">
        <div class="nm-vast-tools__panel-head">
          <RsIcon name="scroll-text" :size="13" />
          <span>{{ t('modules.vastbase.tools.log') }}</span>
          <RsBadge v-if="activeTaskId" variant="info">
            {{ t('modules.vastbase.tools.running') }}
          </RsBadge>
          <span v-if="lines.length" class="nm-vast-tools__panel-hint">
            {{ t('modules.vastbase.tools.logCount', { n: lines.length }) }}
          </span>
          <div class="nm-vast-tools__panel-actions">
            <RsButton
              v-if="activeTaskId"
              size="sm"
              variant="danger"
              :loading="cancelling"
              @click="stopActiveTask"
            >
              <RsIcon name="square" :size="12" />
              {{ t('modules.vastbase.tools.stop') }}
            </RsButton>
            <RsButton
              v-if="lines.length"
              size="sm"
              variant="ghost"
              :disabled="!!activeTaskId"
              @click="clearLines"
            >
              {{ t('modules.vastbase.tools.clearLog') }}
            </RsButton>
          </div>
        </div>
        <div v-if="lines.length" class="nm-vast-tools__log" role="log">
          <div
            v-for="(line, idx) in lines"
            :key="`${line.taskId}-${idx}`"
            class="nm-vast-tools__log-line"
            :class="{
              'is-err': line.ok === false && line.phase !== 'canceled',
              'is-ok': line.ok === true,
              'is-canceled': line.phase === 'canceled',
            }"
          >
            <span class="nm-vast-tools__log-id">#{{ line.taskId }}</span>
            <span class="nm-vast-tools__log-msg">{{ line.message }}</span>
            <span v-if="line.outputPath" class="nm-vast-tools__log-path">→ {{ line.outputPath }}</span>
          </div>
        </div>
        <div v-else class="nm-vast-tools__log-empty">
          {{ lastMessage || t('modules.vastbase.tools.logEmpty') }}
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.nm-vast-tools {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--rs-surface);
}

.nm-vast-tools__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
  padding: var(--rs-space-md) var(--rs-space-lg);
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-vast-tools__header-left {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.nm-vast-tools__title-row {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-wrap: wrap;
}

.nm-vast-tools__title-icon {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-vast-tools__title {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  letter-spacing: 0.01em;
}

.nm-vast-tools__subtitle {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: 1.4;
}

.nm-vast-tools__header-actions {
  display: flex;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
}

.nm-vast-tools__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-vast-tools__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--rs-space-md) var(--rs-space-lg) var(--rs-space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
}

.nm-vast-tools__status {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--rs-space-sm);
}

.nm-vast-tools__guide {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-md);
  border-radius: var(--rs-radius-lg);
  border: 1px solid color-mix(in srgb, var(--rs-warning, #c90) 35%, var(--rs-border-subtle));
  background: color-mix(in srgb, var(--rs-warning, #c90) 8%, var(--rs-surface-raised));
}

.nm-vast-tools__guide-head {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-text);
}

.nm-vast-tools__guide-head :deep(svg) {
  color: var(--rs-warning, #b8860b);
  flex-shrink: 0;
}

.nm-vast-tools__guide-body {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: 1.5;
}

.nm-vast-tools__guide-steps {
  margin: 0;
  padding-left: 1.15rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-text);
  line-height: 1.55;
}

.nm-vast-tools__guide-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rs-space-xs);
}

.nm-vast-tools__status-chip {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
  padding: 0.625rem 0.75rem;
  border-radius: var(--rs-radius-md);
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-surface-raised) 88%, transparent);
}

.nm-vast-tools__status-chip.is-ok {
  border-color: color-mix(in srgb, var(--rs-success) 28%, var(--rs-border-subtle));
}

.nm-vast-tools__status-chip.is-missing {
  border-color: color-mix(in srgb, var(--rs-danger) 22%, var(--rs-border-subtle));
  opacity: 0.9;
}

.nm-vast-tools__status-icon {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-hover);
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-vast-tools__status-chip.is-ok .nm-vast-tools__status-icon {
  color: var(--rs-success);
  background: color-mix(in srgb, var(--rs-success) 12%, transparent);
}

.nm-vast-tools__status-chip.is-missing .nm-vast-tools__status-icon {
  color: var(--rs-danger);
  background: color-mix(in srgb, var(--rs-danger) 10%, transparent);
}

.nm-vast-tools__status-meta {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  flex: 1;
  min-width: 0;
}

.nm-vast-tools__status-name {
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  font-family: var(--rs-font-mono);
  line-height: 1.2;
}

.nm-vast-tools__status-path {
  font-size: 0.6875rem;
  color: var(--rs-muted);
  line-height: 1.3;
}

.nm-vast-tools__status-path.is-missing {
  color: var(--rs-danger);
}

.nm-vast-tools__status-dot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  flex-shrink: 0;
}

.nm-vast-tools__status-dot.is-ok {
  background: var(--rs-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rs-success) 18%, transparent);
}

.nm-vast-tools__status-dot.is-missing {
  background: var(--rs-danger);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rs-danger) 14%, transparent);
}

.nm-vast-tools__panel {
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-lg);
  background: color-mix(in srgb, var(--rs-surface-raised) 92%, transparent);
  padding: var(--rs-space-md);
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}

.nm-vast-tools__panel-head {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  color: var(--rs-text);
  min-width: 0;
}

.nm-vast-tools__panel-head > :deep(svg) {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-vast-tools__panel-hint {
  margin-left: var(--rs-space-xs);
  font-weight: 400;
  color: var(--rs-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-vast-tools__panel-actions {
  margin-left: auto;
  flex-shrink: 0;
  display: flex;
  gap: var(--rs-space-xs);
}

.nm-vast-tools__field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.nm-vast-tools__field-label {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  font-weight: 500;
}

.nm-vast-tools__ops {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 0.7fr);
  gap: var(--rs-space-md);
  align-items: start;
}

.nm-vast-tools__panel--main {
  min-width: 0;
}

.nm-vast-tools__panel--shell {
  position: sticky;
  top: 0;
  align-self: start;
}

.nm-vast-tools__section-tabs {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-wrap: wrap;
  padding-bottom: var(--rs-space-xs);
  border-bottom: 1px solid var(--rs-border-subtle);
  margin-bottom: var(--rs-space-xs);
}

.nm-vast-tools__section-tabs .nm-vast-tools__panel-hint {
  margin-left: 0;
  flex: 1;
  min-width: 8rem;
}

.nm-vast-tools__op {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
  padding-top: var(--rs-space-xs);
}

.nm-vast-tools__op-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.nm-vast-tools__op-title {
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
}

.nm-vast-tools__op-desc {
  font-size: 0.6875rem;
  color: var(--rs-muted);
  line-height: 1.35;
}

.nm-vast-tools__op-controls {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
}

.nm-vast-tools__op-input {
  flex: 1;
  min-width: 0;
}

.nm-vast-tools__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--rs-space-sm);
}

.nm-vast-tools__field--wide {
  grid-column: 1 / -1;
}

.nm-vast-tools__options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.85rem;
}

.nm-vast-tools__option {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-text);
  cursor: pointer;
  user-select: none;
}

.nm-vast-tools__option input {
  margin: 0;
}

.nm-vast-tools__browse {
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

.nm-vast-tools__browse:hover:not(:disabled) {
  color: var(--rs-text);
  background: var(--rs-item-hover);
}

.nm-vast-tools__browse:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}

.nm-vast-tools__browse:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.nm-vast-tools__shell-hint {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: 1.45;
}

.nm-vast-tools__shell-btn {
  align-self: flex-start;
  margin-top: auto;
}

.nm-vast-tools__panel--log {
  flex: 1;
  min-height: 10rem;
}

.nm-vast-tools__log {
  flex: 1;
  min-height: 0;
  max-height: 16rem;
  overflow: auto;
  margin: 0;
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-radius: var(--rs-radius-md);
  background: color-mix(in srgb, var(--rs-surface) 70%, #000 8%);
  border: 1px solid var(--rs-border-subtle);
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-xs);
  line-height: 1.5;
}

.nm-vast-tools__log-line {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.6rem;
  padding: 0.15rem 0;
}

.nm-vast-tools__log-line + .nm-vast-tools__log-line {
  border-top: 1px solid color-mix(in srgb, var(--rs-border-subtle) 70%, transparent);
}

.nm-vast-tools__log-id {
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-vast-tools__log-msg {
  color: var(--rs-text);
}

.nm-vast-tools__log-path {
  color: var(--rs-info, var(--rs-primary));
  word-break: break-all;
}

.nm-vast-tools__log-line.is-err .nm-vast-tools__log-msg {
  color: var(--rs-danger);
}

.nm-vast-tools__log-line.is-ok .nm-vast-tools__log-msg {
  color: var(--rs-success);
}

.nm-vast-tools__log-line.is-canceled .nm-vast-tools__log-msg {
  color: var(--rs-muted);
  font-style: italic;
}

.nm-vast-tools__log-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 5rem;
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

@media (max-width: 960px) {
  .nm-vast-tools__status {
    grid-template-columns: 1fr;
  }

  .nm-vast-tools__ops {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .nm-vast-tools__op-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .nm-vast-tools__grid {
    grid-template-columns: 1fr;
  }

  .nm-vast-tools__header {
    flex-direction: column;
  }
}
</style>
