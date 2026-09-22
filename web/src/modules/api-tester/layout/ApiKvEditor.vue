<script setup lang="ts">
import { RsButton, RsCheckbox, RsInput } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import { newKvRow } from '../utils/format'
import type { ApiKvRow } from '../types'

const rows = defineModel<ApiKvRow[]>({ default: () => [] })

withDefaults(
  defineProps<{
    /** 环境页用表头；请求 Params/Headers 保持紧凑行。 */
    table?: boolean
  }>(),
  { table: false },
)

const { t } = useI18n()

function addRow(): void {
  rows.value = [...rows.value, newKvRow()]
}

function removeRow(id: string): void {
  rows.value = rows.value.filter((row) => row.id !== id)
}
</script>

<template>
  <div class="nm-api-kv" :class="{ 'nm-api-kv--table': table }">
    <div v-if="table" class="nm-api-kv__head">
      <span />
      <span>{{ t('modules.api.key') }}</span>
      <span>{{ t('modules.api.value') }}</span>
      <span />
    </div>
    <div v-if="rows.length === 0" class="nm-api-kv__empty">{{ t('modules.api.noKv') }}</div>
    <div
      v-for="row in rows"
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
        v-model="row.value"
        size="sm"
        :placeholder="t('modules.api.value')"
        radius="sm"
      />
      <RsButton
        variant="ghost"
        size="sm"
        icon-only
        icon="x"
        radius="sm"
        :aria-label="t('common.close')"
        @click="removeRow(row.id)"
      />
    </div>
    <RsButton class="nm-api-kv__add" variant="ghost" size="sm" icon="plus" @click="addRow">
      {{ t('modules.api.addRow') }}
    </RsButton>
  </div>
</template>

<style scoped>
.nm-api-kv {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
  min-height: 0;
  overflow: auto;
}

.nm-api-kv--table {
  gap: 0;
  padding: 0;
}

.nm-api-kv__head,
.nm-api-kv--table .nm-api-kv__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(0, 1.4fr) auto;
  gap: 0.375rem;
  align-items: center;
}

.nm-api-kv__head {
  padding: 0.4rem 0.75rem;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--rs-muted);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-api-kv--table .nm-api-kv__row {
  padding: 0.35rem 0.75rem;
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-api-kv--table .nm-api-kv__empty {
  padding: 0.75rem;
}

.nm-api-kv--table .nm-api-kv__add {
  margin: 0.5rem 0.75rem 0.65rem;
  align-self: flex-start;
}

.nm-api-kv__empty {
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  padding: 0.25rem 0;
}

.nm-api-kv__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(0, 1.4fr) auto;
  gap: 0.375rem;
  align-items: center;
}

.nm-api-kv__row :deep(.rs-input) {
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace;
  font-size: 12px;
}
</style>
