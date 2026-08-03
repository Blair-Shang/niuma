<script setup lang="ts">
import { RsButton, RsInput, RsLabel, RsSelect, RsTooltip } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { useRsToast } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { dialogApi } from '@/api/dialog'
import type { SqliteAttachEntry } from '@/api/types/sqlite'
import type { ConnectionFormState } from '@/modules/ops/connection-form/types'
import {
  parseAttachText,
  serializeAttachEntries,
} from '@/modules/sqlite/connection-form-adapter'

/** SQLite「高级」Tab：加密口令 / ATTACH 行编辑 / 只读 / 创建 / 日志 / 外键 / 排除系统 / busy_timeout。 */
const props = defineProps<{
  form: ConnectionFormState
}>()

const { t } = useI18n()
const toast = useRsToast()

const boolOptions = computed<RsSelectOptions>(() => [
  { value: 'true', label: t('modules.sqlite.form.readOnlyYes') },
  { value: 'false', label: t('modules.sqlite.form.readOnlyNo') },
])

const journalModeOptions = computed<RsSelectOptions>(() => [
  { value: '', label: t('modules.sqlite.form.journalModePlaceholder') },
  { value: 'WAL', label: t('modules.sqlite.form.journalModeWal') },
  { value: 'DELETE', label: t('modules.sqlite.form.journalModeDelete') },
  { value: 'TRUNCATE', label: t('modules.sqlite.form.journalModeTruncate') },
  { value: 'MEMORY', label: t('modules.sqlite.form.journalModeMemory') },
  { value: 'OFF', label: t('modules.sqlite.form.journalModeOff') },
])

const attachRows = ref<SqliteAttachEntry[]>([])
let syncingFromForm = false

function syncRowsToForm(): void {
  syncingFromForm = true
  props.form.sqliteAttachText = serializeAttachEntries(attachRows.value)
  syncingFromForm = false
}

watch(
  () => props.form.sqliteAttachText as string,
  (text) => {
    if (syncingFromForm) return
    attachRows.value = parseAttachText(text ?? '')
  },
  { immediate: true },
)

function addAttachRow(): void {
  attachRows.value = [...attachRows.value, { alias: '', filePath: '', readOnly: false }]
  syncRowsToForm()
}

function removeAttachRow(index: number): void {
  attachRows.value = attachRows.value.filter((_, i) => i !== index)
  syncRowsToForm()
}

function patchAttachRow(index: number, patch: Partial<SqliteAttachEntry>): void {
  attachRows.value = attachRows.value.map((row, i) => (i === index ? { ...row, ...patch } : row))
  syncRowsToForm()
}

async function browseAttachFile(index: number): Promise<void> {
  try {
    const result = await dialogApi.openFile({
      title: t('modules.sqlite.form.attachBrowseTitle'),
      accept: ['.db', '.sqlite', '.sqlite3'],
    })
    const filePath = result?.filePaths?.[0] ?? ''
    if (filePath) {
      patchAttachRow(index, { filePath })
    }
  } catch {
    toast.error(t('modules.sqlite.form.browseError'))
  }
}
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsTooltip
          icon
          :content="t('modules.sqlite.form.encryptionPasswordHint')"
          side="top"
          align="start"
        >
          <RsLabel>{{ t('modules.sqlite.form.encryptionPassword') }}</RsLabel>
        </RsTooltip>
        <RsInput
          v-model="form.password"
          type="password"
          autocomplete="new-password"
          :placeholder="t('modules.sqlite.form.encryptionPasswordPlaceholder')"
        />
      </div>
    </div>

    <div class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsTooltip icon :content="t('modules.sqlite.form.attachHint')" side="top" align="start">
          <RsLabel>{{ t('modules.sqlite.form.attach') }}</RsLabel>
        </RsTooltip>

        <div v-if="attachRows.length === 0" class="nm-sqlite-attach__empty">
          {{ t('modules.sqlite.form.attachEmpty') }}
        </div>

        <div
          v-for="(row, index) in attachRows"
          :key="`attach-${index}`"
          class="nm-sqlite-attach__row"
        >
          <RsInput
            class="nm-sqlite-attach__alias"
            :model-value="row.alias"
            size="sm"
            :placeholder="t('modules.sqlite.form.attachAliasPh')"
            @update:model-value="patchAttachRow(index, { alias: String($event ?? '') })"
          />
          <div class="nm-sqlite-path-row nm-sqlite-attach__path">
            <RsInput
              class="nm-sqlite-path-input"
              :model-value="row.filePath"
              size="sm"
              :placeholder="t('modules.sqlite.form.attachPathPh')"
              @update:model-value="patchAttachRow(index, { filePath: String($event ?? '') })"
            />
            <RsButton variant="ghost" size="sm" @click="browseAttachFile(index)">
              {{ t('modules.sqlite.form.browse') }}
            </RsButton>
          </div>
          <RsSelect
            class="nm-sqlite-attach__ro"
            :model-value="row.readOnly ? 'true' : 'false'"
            size="sm"
            :options="boolOptions"
            @update:model-value="
              patchAttachRow(index, { readOnly: String($event) === 'true' })
            "
          />
          <RsButton variant="ghost" size="sm" @click="removeAttachRow(index)">
            {{ t('modules.sqlite.form.attachRemove') }}
          </RsButton>
        </div>

        <div class="nm-sqlite-attach__actions">
          <RsButton variant="ghost" size="sm" @click="addAttachRow">
            {{ t('modules.sqlite.form.attachAdd') }}
          </RsButton>
        </div>
      </div>
    </div>

    <div class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsTooltip icon :content="t('modules.sqlite.form.readOnlyHint')" side="top" align="start">
          <RsLabel>{{ t('modules.sqlite.form.readOnly') }}</RsLabel>
        </RsTooltip>
        <RsSelect v-model="form.sqliteReadOnly" :options="boolOptions" />
      </div>
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsTooltip icon :content="t('modules.sqlite.form.createIfMissingHint')" side="top" align="start">
          <RsLabel>{{ t('modules.sqlite.form.createIfMissing') }}</RsLabel>
        </RsTooltip>
        <RsSelect v-model="form.sqliteCreateIfMissing" :options="boolOptions" />
      </div>
    </div>

    <div class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsTooltip icon :content="t('modules.sqlite.form.journalModeHint')" side="top" align="start">
          <RsLabel>{{ t('modules.sqlite.form.journalMode') }}</RsLabel>
        </RsTooltip>
        <RsSelect v-model="form.sqliteJournalMode" :options="journalModeOptions" />
      </div>
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsTooltip icon :content="t('modules.sqlite.form.foreignKeysHint')" side="top" align="start">
          <RsLabel>{{ t('modules.sqlite.form.foreignKeys') }}</RsLabel>
        </RsTooltip>
        <RsSelect v-model="form.sqliteForeignKeys" :options="boolOptions" />
      </div>
    </div>

    <div class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsTooltip icon :content="t('modules.sqlite.form.excludeSystemHint')" side="top" align="start">
          <RsLabel>{{ t('modules.sqlite.form.excludeSystem') }}</RsLabel>
        </RsTooltip>
        <RsSelect v-model="form.sqliteExcludeSystem" :options="boolOptions" />
      </div>
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsTooltip icon :content="t('modules.sqlite.form.busyTimeoutHint')" side="top" align="start">
          <RsLabel>{{ t('modules.sqlite.form.busyTimeout') }}</RsLabel>
        </RsTooltip>
        <RsInput
          v-model="form.sqliteBusyTimeoutMs"
          type="number"
          autocomplete="off"
          placeholder="5000"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.nm-conn-form__section {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}

.nm-conn-form__row {
  display: flex;
  gap: var(--rs-space-md);
  align-items: flex-start;
}

.nm-conn-form__field {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}

.nm-conn-form__field--grow {
  flex: 1;
  min-width: 0;
}

.nm-sqlite-path-row {
  display: flex;
  gap: var(--rs-space-xs);
  align-items: center;
  min-width: 0;
}

.nm-sqlite-path-input {
  flex: 1;
  min-width: 0;
}

.nm-sqlite-attach__empty {
  font-size: var(--rs-font-size-xs, 12px);
  color: var(--rs-fg-muted, #64748b);
  padding: 0.25rem 0;
}

.nm-sqlite-attach__row {
  display: grid;
  grid-template-columns: minmax(72px, 110px) minmax(0, 1fr) 88px auto;
  gap: var(--rs-space-xs);
  align-items: center;
  margin-bottom: var(--rs-space-xs);
}

.nm-sqlite-attach__path {
  min-width: 0;
}

.nm-sqlite-attach__actions {
  display: flex;
  margin-top: 0.15rem;
}

@media (max-width: 720px) {
  .nm-sqlite-attach__row {
    grid-template-columns: 1fr;
  }
}
</style>
