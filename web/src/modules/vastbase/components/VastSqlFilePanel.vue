<script setup lang="ts">
import { RsIcon, RsInput, RsLabel, RsSelect } from '@niuma/ui'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { VastIoDumpMode, VastTableInfo } from '@/api/types/vastbase'
import type { VastIoTaskLine } from '@/modules/vastbase/composables/useVastIoTasks'

defineProps<{
  isDump: boolean
  busy: boolean
  scopeLabel: string
  modeOptions: Array<{ value: string; label: string }>
  includeStructure: boolean
  includeData: boolean
  showExcludeSystem: boolean
  canPickObjects: boolean
  allObjectsSelected: boolean
  objectRows: VastTableInfo[]
  selectedTables: string[]
  objectsLoading: boolean
  objectsError: string
  lines: VastIoTaskLine[]
}>()

const filePath = defineModel<string>('filePath', { required: true })
const mode = defineModel<VastIoDumpMode>('mode', { required: true })
const includeTables = defineModel<boolean>('includeTables', { required: true })
const includeViews = defineModel<boolean>('includeViews', { required: true })
const includeMatViews = defineModel<boolean>('includeMatViews', { required: true })
const createSchema = defineModel<boolean>('createSchema', { required: true })
const dropIfExists = defineModel<boolean>('dropIfExists', { required: true })
const truncateBeforeData = defineModel<boolean>('truncateBeforeData', { required: true })
const excludeSystem = defineModel<boolean>('excludeSystem', { required: true })
const continueOnError = defineModel<boolean>('continueOnError', { required: true })

const emit = defineEmits<{
  pickPath: []
  toggleSelectAll: [checked: boolean]
  toggleObject: [name: string, checked: boolean]
}>()

const { t } = useI18n()
const logEl = ref<HTMLElement | null>(null)

function scrollLogToBottom(): void {
  if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
}

defineExpose({ scrollLogToBottom })
</script>

<template>
  <div class="nm-vast-sql">
    <div class="nm-vast-sql__scroll">
      <section class="nm-vast-sql__section">
        <div class="nm-vast-sql__field">
          <RsLabel required>{{ t('modules.vastbase.io.filePath') }}</RsLabel>
          <RsInput v-model="filePath" :disabled="busy" class="nm-vast-sql__path">
            <template #suffix>
              <button
                type="button"
                class="nm-vast-sql__browse"
                :aria-label="t('modules.vastbase.io.browse')"
                :title="t('modules.vastbase.io.browse')"
                :disabled="busy"
                @pointerdown.prevent
                @click="emit('pickPath')"
              >
                <RsIcon name="folder-open" :size="14" />
              </button>
            </template>
          </RsInput>
        </div>
      </section>

      <template v-if="isDump">
        <div class="nm-vast-sql__row">
          <section class="nm-vast-sql__section">
            <h3 class="nm-vast-sql__section-title">{{ t('modules.vastbase.io.dumpScope') }}</h3>
            <div class="nm-vast-sql__scope" :title="scopeLabel">{{ scopeLabel }}</div>
          </section>
          <section class="nm-vast-sql__section">
            <h3 class="nm-vast-sql__section-title">{{ t('modules.vastbase.io.dumpMode') }}</h3>
            <RsSelect v-model="mode" :options="modeOptions" :disabled="busy" />
          </section>
        </div>

        <section class="nm-vast-sql__section">
          <h3 class="nm-vast-sql__section-title">{{ t('modules.vastbase.io.dumpObjects') }}</h3>
          <div class="nm-vast-sql__chips">
            <label class="nm-vast-sql__chip">
              <input v-model="includeTables" type="checkbox" :disabled="busy" />
              <span>{{ t('modules.vastbase.io.includeTables') }}</span>
            </label>
            <label class="nm-vast-sql__chip">
              <input v-model="includeViews" type="checkbox" :disabled="busy" />
              <span>{{ t('modules.vastbase.io.includeViews') }}</span>
            </label>
            <label class="nm-vast-sql__chip">
              <input v-model="includeMatViews" type="checkbox" :disabled="busy" />
              <span>{{ t('modules.vastbase.io.includeMatViews') }}</span>
            </label>
          </div>
        </section>

        <section class="nm-vast-sql__section">
          <h3 class="nm-vast-sql__section-title">{{ t('modules.vastbase.io.dumpOptions') }}</h3>
          <div class="nm-vast-sql__options">
            <label v-if="includeStructure" class="nm-vast-sql__option">
              <input v-model="createSchema" type="checkbox" :disabled="busy" />
              <span>{{ t('modules.vastbase.io.createSchema') }}</span>
            </label>
            <label v-if="includeStructure" class="nm-vast-sql__option">
              <input v-model="dropIfExists" type="checkbox" :disabled="busy" />
              <span>{{ t('modules.vastbase.io.dropIfExists') }}</span>
            </label>
            <label v-if="includeData" class="nm-vast-sql__option">
              <input v-model="truncateBeforeData" type="checkbox" :disabled="busy" />
              <span>{{ t('modules.vastbase.io.truncateBeforeData') }}</span>
            </label>
            <label v-if="showExcludeSystem" class="nm-vast-sql__option">
              <input v-model="excludeSystem" type="checkbox" :disabled="busy" />
              <span>{{ t('modules.vastbase.io.excludeSystem') }}</span>
            </label>
          </div>
        </section>

        <section v-if="canPickObjects" class="nm-vast-sql__section">
          <div class="nm-vast-sql__section-head">
            <h3 class="nm-vast-sql__section-title">{{ t('modules.vastbase.io.dumpObjectList') }}</h3>
            <label class="nm-vast-sql__option nm-vast-sql__option--compact">
              <input
                type="checkbox"
                :checked="allObjectsSelected"
                :disabled="busy || objectsLoading || objectRows.length === 0"
                @change="emit('toggleSelectAll', ($event.target as HTMLInputElement).checked)"
              />
              <span>{{ t('modules.vastbase.io.selectAllObjects') }}</span>
            </label>
          </div>
          <p v-if="objectsLoading" class="nm-vast-sql__status">
            {{ t('modules.vastbase.io.objectsLoading') }}
          </p>
          <p v-else-if="objectsError" class="nm-vast-sql__status nm-vast-sql__status--error">
            {{ objectsError }}
          </p>
          <ul v-else class="nm-vast-sql__objects">
            <li v-for="row in objectRows" :key="row.name" class="nm-vast-sql__object-item">
            <label class="nm-vast-sql__object">
              <input
                type="checkbox"
                :checked="selectedTables.includes(row.name)"
                :disabled="busy"
                @change="
                  emit('toggleObject', row.name, ($event.target as HTMLInputElement).checked)
                "
              />
              <span class="nm-vast-sql__object-name">{{ row.name }}</span>
              <span class="nm-vast-sql__object-type">{{ row.type }}</span>
            </label>
            </li>
            <li v-if="objectRows.length === 0" class="nm-vast-sql__object-item">
              <p class="nm-vast-sql__status">
                {{ t('modules.vastbase.io.objectsEmpty') }}
              </p>
            </li>
          </ul>
        </section>
      </template>

      <template v-else>
        <section class="nm-vast-sql__section">
          <h3 class="nm-vast-sql__section-title">{{ t('modules.vastbase.io.execOptions') }}</h3>
          <div class="nm-vast-sql__options">
            <label class="nm-vast-sql__option">
              <input v-model="continueOnError" type="checkbox" :disabled="busy" />
              <span>
                {{ t('modules.vastbase.io.continueOnError') }}
                <span class="nm-vast-sql__option-hint">{{
                  t('modules.vastbase.io.continueOnErrorHint')
                }}</span>
              </span>
            </label>
          </div>
        </section>
      </template>

      <p class="nm-vast-sql__note">
        {{ isDump ? t('modules.vastbase.io.dumpHint') : t('modules.vastbase.io.execHint') }}
      </p>
    </div>

    <section class="nm-vast-sql__log-panel">
      <div class="nm-vast-sql__log-head">
        <span>{{ t('modules.vastbase.io.progressLog') }}</span>
        <span v-if="busy" class="nm-vast-sql__log-running">{{ t('modules.vastbase.io.running') }}</span>
      </div>
      <div ref="logEl" class="nm-vast-sql__log" role="log" aria-live="polite">
        <p v-if="lines.length === 0" class="nm-vast-sql__log-empty">
          {{ t('modules.vastbase.io.progressEmpty') }}
        </p>
        <div
          v-for="(line, idx) in lines"
          :key="`${line.at}-${idx}`"
          class="nm-vast-sql__log-line"
          :class="{
            'is-done': line.ok === true,
            'is-failed':
              line.ok === false ||
              line.message.startsWith('error ') ||
              line.message.startsWith('completed with'),
            'is-canceled': line.phase === 'canceled',
          }"
        >
          <span
            v-if="line.ok !== undefined || line.phase === 'canceled'"
            class="nm-vast-sql__log-phase"
          >{{ line.phase }}</span>
          <span class="nm-vast-sql__log-msg">{{ line.message }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.nm-vast-sql {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  min-height: 0;
  height: 100%;
  color: var(--rs-text);
}

.nm-vast-sql__scroll {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.nm-vast-sql__row {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: var(--rs-space-md);
}

@media (max-width: 640px) {
  .nm-vast-sql__row {
    grid-template-columns: 1fr;
  }
}

.nm-vast-sql__section {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-md);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
}

.nm-vast-sql__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
}

.nm-vast-sql__section-title {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--rs-muted);
}

.nm-vast-sql__field {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}

.nm-vast-sql__path {
  width: 100%;
  min-width: 0;
}

.nm-vast-sql__browse {
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

.nm-vast-sql__browse:hover:not(:disabled) {
  color: var(--rs-text);
  background: var(--rs-item-hover);
}

.nm-vast-sql__browse:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}

.nm-vast-sql__browse:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.nm-vast-sql__scope {
  font-size: var(--rs-font-size-sm);
  line-height: var(--rs-line-height-tight);
  color: var(--rs-text);
  word-break: break-all;
}

.nm-vast-sql__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--rs-space-sm);
}

.nm-vast-sql__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface-elevated);
  color: var(--rs-text);
  font-size: var(--rs-font-size-xs);
  cursor: pointer;
  user-select: none;
  transition:
    border-color var(--rs-transition-fast),
    background var(--rs-transition-fast);
}

.nm-vast-sql__chip:has(input:checked) {
  border-color: color-mix(in srgb, var(--rs-primary) 45%, var(--rs-border-subtle));
  background: color-mix(in srgb, var(--rs-primary) 12%, var(--rs-surface));
}

.nm-vast-sql__chip:has(input:disabled) {
  opacity: 0.55;
  cursor: not-allowed;
}

.nm-vast-sql__chip input {
  margin: 0;
  accent-color: var(--rs-primary);
}

.nm-vast-sql__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--rs-space-sm) var(--rs-space-md);
}

@media (max-width: 520px) {
  .nm-vast-sql__options {
    grid-template-columns: 1fr;
  }
}

.nm-vast-sql__option {
  display: inline-flex;
  align-items: flex-start;
  gap: 8px;
  font-size: var(--rs-font-size-xs);
  line-height: 1.4;
  color: var(--rs-text);
  cursor: pointer;
  user-select: none;
}

.nm-vast-sql__option--compact {
  align-items: center;
  color: var(--rs-muted);
}

.nm-vast-sql__option input {
  margin: 2px 0 0;
  accent-color: var(--rs-primary);
  flex: 0 0 auto;
}

.nm-vast-sql__option:has(input:disabled) {
  opacity: 0.55;
  cursor: not-allowed;
}

.nm-vast-sql__option-hint {
  display: block;
  margin-top: 2px;
  color: var(--rs-muted);
  font-weight: 400;
}

.nm-vast-sql__objects {
  list-style: none;
  margin: 0;
  height: 148px;
  max-height: 148px;
  overflow: auto;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--rs-space-xs);
  border-radius: var(--rs-radius-xs);
  border: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface-elevated);
}

.nm-vast-sql__object-item {
  margin: 0;
  padding: 0;
}

.nm-vast-sql__object {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: var(--rs-radius-xs);
  font-size: var(--rs-font-size-xs);
  color: var(--rs-text);
  cursor: pointer;
}

.nm-vast-sql__object:hover {
  background: var(--rs-item-hover, var(--rs-surface-hover));
}

.nm-vast-sql__object input {
  margin: 0;
  accent-color: var(--rs-primary);
}

.nm-vast-sql__object-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-vast-sql__object-type {
  flex: 0 0 auto;
  color: var(--rs-muted);
  font-size: 11px;
}

.nm-vast-sql__status {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-vast-sql__status--error {
  color: var(--rs-danger);
}

.nm-vast-sql__note {
  margin: 0;
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-radius: var(--rs-radius-sm);
  border: 1px solid color-mix(in srgb, var(--rs-primary) 22%, var(--rs-border-subtle));
  background: color-mix(in srgb, var(--rs-primary) 8%, var(--rs-surface));
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  line-height: 1.5;
}

.nm-vast-sql__log-panel {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
  flex: 0 0 auto;
}

.nm-vast-sql__log-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-vast-sql__log-running {
  color: var(--rs-primary);
}

.nm-vast-sql__log {
  min-height: 96px;
  max-height: 160px;
  overflow: auto;
  padding: var(--rs-space-sm) var(--rs-space-md);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-elevated);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--rs-font-size-xs);
  line-height: 1.45;
}

.nm-vast-sql__log-empty {
  margin: 0;
  color: var(--rs-muted);
}

.nm-vast-sql__log-line {
  display: flex;
  gap: 8px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--rs-text);
}

.nm-vast-sql__log-phase {
  flex: 0 0 auto;
  color: var(--rs-muted);
  min-width: 4.5em;
}

.nm-vast-sql__log-msg {
  flex: 1 1 auto;
  min-width: 0;
}

.nm-vast-sql__log-line.is-done {
  color: var(--rs-success);
}

.nm-vast-sql__log-line.is-failed {
  color: var(--rs-danger);
}

.nm-vast-sql__log-line.is-canceled {
  color: var(--rs-muted);
}
</style>
