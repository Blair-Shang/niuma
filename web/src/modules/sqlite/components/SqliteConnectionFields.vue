<script setup lang="ts">
import { RsIcon, RsInput, RsLabel, RsTooltip, useRsToast } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import { dialogApi } from '@/api/dialog'
import type { ConnectionFormState } from '@/modules/ops/connection-form/types'

/** SQLite「基础信息」专属字段：文件路径。 */
const props = defineProps<{
  form: ConnectionFormState
}>()

const { t } = useI18n()
const toast = useRsToast()

async function browseFile(): Promise<void> {
  try {
    const result = await dialogApi.openFile({
      title: t('modules.sqlite.form.browseTitle'),
      accept: ['.db', '.sqlite', '.sqlite3'],
    })
    const filePath = result?.filePaths?.[0] ?? ''
    if (filePath) {
      props.form.sqliteFilePath = filePath
      // 同步到 hostAddress，确保通用「主机地址」校验通过
      props.form.hostAddress = filePath
    }
  } catch {
    toast.error(t('modules.sqlite.form.browseError'))
  }
}

function onFilePathInput(val: string): void {
  props.form.sqliteFilePath = val
  props.form.hostAddress = val
}
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsTooltip
        icon
        :content="`${t('modules.sqlite.form.filePathHint')} ${t('modules.sqlite.form.credentialHint')}`"
        side="top"
        align="start"
      >
        <RsLabel>{{ t('modules.sqlite.form.filePath') }}</RsLabel>
      </RsTooltip>
      <RsInput
        :model-value="form.sqliteFilePath"
        autocomplete="off"
        :placeholder="t('modules.sqlite.form.filePathPlaceholder')"
        class="nm-sqlite-path-input"
        @update:model-value="onFilePathInput"
      >
        <template #suffix>
          <button
            type="button"
            class="nm-sqlite-path-browse"
            :aria-label="t('modules.sqlite.form.browse')"
            :title="t('modules.sqlite.form.browse')"
            @pointerdown.prevent
            @click="browseFile"
          >
            <RsIcon name="folder-open" :size="14" />
          </button>
        </template>
      </RsInput>
    </div>
  </section>
</template>

<style scoped>
.nm-conn-form__section {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}

.nm-conn-form__field {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}

.nm-sqlite-path-input {
  width: 100%;
  min-width: 0;
}

.nm-sqlite-path-browse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  border: none;
  border-radius: var(--rs-radius-sm, 4px);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
}

.nm-sqlite-path-browse:hover {
  color: var(--rs-text);
  background: var(--rs-item-hover);
}

.nm-sqlite-path-browse:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}
</style>
