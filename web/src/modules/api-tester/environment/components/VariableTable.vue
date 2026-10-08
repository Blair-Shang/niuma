<script setup lang="ts">
/**
 * 环境 / 全局变量表：类型列写入 nm_api_variable.variable_kind。
 */
import { RsButton, RsCheckbox, RsInput, RsSelect, type RsSelectOption } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { createId } from '@/utils/id'
import type { ApiVariableKind, ApiVarRow } from '../../types'
import { isDatetimePreset } from '../../utils/variable-dynamic'
import {
  API_VARIABLE_KINDS,
  defaultValueForKind,
  variableKindLabelKey,
} from '../../utils/variable-kind'
import VariableValueField from './VariableValueField.vue'

const rows = defineModel<ApiVarRow[]>({ default: () => [] })
const { t } = useI18n()

const kindOptions = computed<RsSelectOption[]>(() =>
  API_VARIABLE_KINDS.map((kind) => ({ value: kind, label: t(variableKindLabelKey(kind)) })),
)

function addRow(): void {
  rows.value = [
    ...rows.value,
    {
      id: createId('var'),
      enabled: true,
      key: '',
      value: '',
      kind: 'string',
    },
  ]
}

function removeRow(id: string): void {
  rows.value = rows.value.filter((row) => row.id !== id)
}

function onKindChange(row: ApiVarRow, raw: unknown): void {
  const kind = String(raw) as ApiVariableKind
  row.kind = kind
  if (kind === 'datetime' && !isDatetimePreset(row.value)) {
    row.value = defaultValueForKind(kind)
    return
  }
  if (kind === 'boolean' && row.value !== 'true' && row.value !== 'false') {
    row.value = 'true'
    return
  }
  if (kind === 'number' && !row.value.startsWith('random:') && Number.isNaN(Number(row.value))) {
    row.value = '0'
    return
  }
  if (!row.value.trim()) row.value = defaultValueForKind(kind)
}
</script>

<template>
  <div class="nm-api-var">
    <div class="nm-api-var__head">
      <span />
      <span>{{ t('modules.api.varType') }}</span>
      <span>{{ t('modules.api.key') }}</span>
      <span>{{ t('modules.api.value') }}</span>
      <span />
    </div>
    <div class="nm-api-var__body">
      <div v-if="rows.length === 0" class="nm-api-var__empty">{{ t('modules.api.noKv') }}</div>
      <div v-for="row in rows" :key="row.id" class="nm-api-var__row">
        <RsCheckbox v-model="row.enabled" size="sm" :aria-label="t('modules.api.enabled')" />
        <RsSelect
          :model-value="row.kind"
          :options="kindOptions"
          size="sm"
          radius="sm"
          :searchable="false"
          :clearable="false"
          :filter-option="false"
          @update:model-value="onKindChange(row, $event)"
        />
        <RsInput v-model="row.key" size="sm" radius="sm" :placeholder="t('modules.api.key')" />
        <VariableValueField v-model:value="row.value" :kind="row.kind" />
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
    </div>
    <RsButton class="nm-api-var__add" variant="ghost" size="sm" icon="plus" @click="addRow">
      {{ t('modules.api.addRow') }}
    </RsButton>
  </div>
</template>

<style scoped>
.nm-api-var {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.nm-api-var__head,
.nm-api-var__row {
  display: grid;
  grid-template-columns: 2.5rem 9.5rem minmax(8rem, 1fr) minmax(14rem, 1.7fr) 2.5rem;
  column-gap: var(--rs-space-sm);
  align-items: center;
}

.nm-api-var__head {
  position: sticky;
  top: 0;
  z-index: 1;
  height: var(--rs-control-height-lg);
  padding: 0 var(--rs-space-md) 0 var(--rs-space-sm);
  font-size: var(--rs-font-size-xs);
  font-weight: var(--rs-font-weight-medium, 500);
  color: var(--rs-muted);
  background: var(--rs-surface-elevated);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-api-var__body {
  min-height: 0;
}

.nm-api-var__row {
  min-height: var(--rs-control-height-lg);
  padding: var(--rs-space-xs) var(--rs-space-md) var(--rs-space-xs) var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-api-var__row:hover {
  background: var(--rs-item-hover);
}

.nm-api-var__row :deep(.rs-input) {
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace;
  font-size: 12px;
}

.nm-api-var__empty {
  padding: var(--rs-space-sm) var(--rs-space-md);
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
}

.nm-api-var__add {
  margin: var(--rs-space-xs) var(--rs-space-sm);
  align-self: flex-start;
}
</style>
