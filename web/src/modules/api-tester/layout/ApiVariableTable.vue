<script setup lang="ts">
/**
 * 环境 / 全局变量表：类型列写入 nm_api_variable.variable_kind。
 */
import { RsButton, RsCheckbox, RsInput, RsSelect, type RsSelectOption } from '@niuma/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { createId } from '@/utils/id'
import type { ApiVariableKind, ApiVarRow } from '../types'
import {
  API_VARIABLE_KINDS,
  defaultValueForKind,
  valuePlaceholderKey,
  variableKindLabelKey,
} from '../utils/variable-kind'

const rows = defineModel<ApiVarRow[]>({ default: () => [] })
const { t } = useI18n()
const revealSecret = ref<Record<string, boolean>>({})

const kindOptions = computed<RsSelectOption[]>(() =>
  API_VARIABLE_KINDS.map((kind) => ({ value: kind, label: t(variableKindLabelKey(kind)) })),
)

const boolOptions = computed<RsSelectOption[]>(() => [
  { value: 'true', label: 'true' },
  { value: 'false', label: 'false' },
])

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
  if (!row.value.trim()) {
    row.value = defaultValueForKind(kind)
  } else if (kind === 'boolean' && row.value !== 'true' && row.value !== 'false') {
    row.value = 'true'
  }
}

function fillUuid(row: ApiVarRow): void {
  row.value = crypto.randomUUID()
}

function toggleSecret(id: string): void {
  revealSecret.value = { ...revealSecret.value, [id]: !revealSecret.value[id] }
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
      <div class="nm-api-var__value">
        <RsSelect
          v-if="row.kind === 'boolean'"
          :model-value="row.value || 'true'"
          :options="boolOptions"
          size="sm"
          radius="sm"
          :searchable="false"
          :clearable="false"
          :filter-option="false"
          @update:model-value="row.value = String($event)"
        />
        <template v-else>
          <RsInput
            v-model="row.value"
            size="sm"
            radius="sm"
            :type="row.kind === 'secret' && !revealSecret[row.id] ? 'password' : 'text'"
            :placeholder="t(valuePlaceholderKey(row.kind))"
          />
          <RsButton
            v-if="row.kind === 'secret'"
            variant="ghost"
            size="sm"
            icon-only
            :icon="revealSecret[row.id] ? 'eye-off' : 'eye'"
            radius="sm"
            :aria-label="t('modules.api.varReveal')"
            @click="toggleSecret(row.id)"
          />
          <RsButton
            v-if="row.kind === 'uuid'"
            variant="ghost"
            size="sm"
            icon-only
            icon="refresh-cw"
            radius="sm"
            :aria-label="t('modules.api.varGenerateUuid')"
            @click="fillUuid(row)"
          />
        </template>
      </div>
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
  grid-template-columns: auto 7.5rem minmax(7rem, 1fr) minmax(10rem, 1.6fr) auto;
  gap: 0.4rem;
  align-items: center;
}

.nm-api-var__head {
  padding: 0.4rem 0.75rem;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--rs-muted);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-api-var__row {
  padding: 0.35rem 0.75rem;
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-api-var__row :deep(.rs-input),
.nm-api-var__value :deep(.rs-input) {
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace;
  font-size: 12px;
}

.nm-api-var__value {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  min-width: 0;
}

.nm-api-var__value > :first-child {
  flex: 1;
  min-width: 0;
}

.nm-api-var__empty {
  padding: 0.75rem;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}

.nm-api-var__add {
  margin: 0.5rem 0.75rem 0.65rem;
  align-self: flex-start;
}
</style>
