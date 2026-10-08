<script setup lang="ts">
import { RsButton, RsCheckbox, RsInput } from '@niuma/ui'
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { dialogApi } from '@/api'
import { newKvRow } from '../utils/format'
import type { ApiKvRow } from '../types'

const rows = defineModel<ApiKvRow[]>({ default: () => [] })

withDefaults(
  defineProps<{
    /** 表头 + 行分隔。请求 Params / Headers / Form 使用。 */
    table?: boolean
    /** 表单可选择本机文件。 */
    files?: boolean
  }>(),
  { table: false, files: false },
)

const { t } = useI18n()

function isBlank(row: ApiKvRow): boolean {
  return !row.key.trim() && !row.value.trim() && !row.filePath?.trim()
}

/** 末尾始终留一行空行；填入后立刻再补一行。多出来的空行收成一行。 */
function ensureTrailingBlank(): void {
  const list = rows.value
  let end = list.length
  while (end > 0 && isBlank(list[end - 1]!)) end -= 1
  const filled = list.slice(0, end)
  const blank = list.slice(end).find((row) => isBlank(row)) ?? newKvRow()
  const next = [...filled, blank]
  if (next.length === list.length && next.every((row, index) => row === list[index])) return
  rows.value = next
}

watch(
  () => rows.value.map((row) => `${row.key}\0${row.value}\0${row.filePath ?? ''}`).join('\n'),
  () => ensureTrailingBlank(),
  { immediate: true },
)

function displayValue(row: ApiKvRow): string {
  const path = row.filePath?.trim()
  if (!path) return row.value
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash >= 0 ? path.slice(slash + 1) : path
}

function onText(row: ApiKvRow, value: unknown): void {
  row.filePath = undefined
  row.value = String(value ?? '')
}

async function pickFile(row: ApiKvRow): Promise<void> {
  try {
    const picked = await dialogApi.openFile({ title: t('modules.api.pickFile') })
    const path = picked.filePaths[0]
    if (picked.canceled || !path) return
    row.filePath = path
    row.value = ''
    ensureTrailingBlank()
  } catch {
    // 非桌面壳没有文件对话框。
  }
}

function removeRow(id: string): void {
  rows.value = rows.value.filter((row) => row.id !== id)
  ensureTrailingBlank()
}
</script>

<template>
  <div class="nm-api-kv" :class="{ 'nm-api-kv--table': table, 'nm-api-kv--files': files }">
    <div v-if="table" class="nm-api-kv__head">
      <span />
      <span>{{ t('modules.api.key') }}</span>
      <span>{{ t('modules.api.value') }}</span>
      <span v-if="files" />
      <span />
    </div>
    <div
      v-for="(row, index) in rows"
      :key="row.id"
      class="nm-api-kv__row"
    >
      <RsCheckbox
        v-model="row.enabled"
        size="sm"
        :aria-label="t('modules.api.enabled')"
      />
      <RsInput
        v-model="row.key"
        size="sm"
        :placeholder="t('modules.api.key')"
        radius="sm"
      />
      <RsInput
        :model-value="displayValue(row)"
        size="sm"
        :placeholder="files ? t('modules.api.valueOrFile') : t('modules.api.value')"
        radius="sm"
        @update:model-value="onText(row, $event)"
      />
      <RsButton
        v-if="files"
        variant="ghost"
        size="sm"
        radius="sm"
        :tooltip="row.filePath || t('modules.api.pickFile')"
        @click="pickFile(row)"
      >
        {{ t('modules.api.fileShort') }}
      </RsButton>
      <RsButton
        v-if="!(index === rows.length - 1 && isBlank(row))"
        variant="ghost"
        size="sm"
        icon-only
        icon="x"
        radius="sm"
        :aria-label="t('common.close')"
        @click="removeRow(row.id)"
      />
    </div>
  </div>
</template>

<style scoped>
.nm-api-kv {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
  padding: var(--rs-space-sm) var(--rs-space-md);
  min-height: 0;
  overflow: auto;
}

.nm-api-kv--table {
  gap: 0;
  padding: 0;
}

.nm-api-kv__head,
.nm-api-kv__row {
  display: grid;
  grid-template-columns: 2.5rem minmax(8rem, 1fr) minmax(10rem, 1.4fr) 2.5rem;
  column-gap: var(--rs-space-sm);
  align-items: center;
}

.nm-api-kv--files .nm-api-kv__head,
.nm-api-kv--files .nm-api-kv__row {
  grid-template-columns: 2.5rem minmax(6rem, 0.8fr) minmax(8rem, 1.2fr) auto 2.5rem;
}

.nm-api-kv__head {
  position: sticky;
  top: 0;
  min-height: 2rem;
  padding: 0 var(--rs-space-sm);
  font-size: var(--rs-font-size-xs);
  font-weight: var(--rs-font-weight-medium);
  color: var(--rs-muted);
  background: var(--rs-surface);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-api-kv--table .nm-api-kv__row {
  min-height: 2.25rem;
  padding: var(--rs-space-xs) var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-api-kv--table .nm-api-kv__row:hover {
  background: var(--rs-item-hover);
}

.nm-api-kv__row :deep(input) {
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-xs);
}
</style>
