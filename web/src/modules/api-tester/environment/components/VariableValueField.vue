<script setup lang="ts">
/**
 * 按变量类型编辑值。日期、随机数、每次发送的 UUID 存成标记，发送时再展开。
 */
import { RsButton, RsInput, RsSelect, type RsSelectOption } from '@niuma/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiVariableKind } from '../../types'
import { DATETIME_PRESETS, isDatetimePreset, materializeVariableValue, type DatetimePreset } from '../../utils/variable-dynamic'
import { valuePlaceholderKey } from '../../utils/variable-kind'

const value = defineModel<string>('value', { required: true })
defineProps<{
  kind: ApiVariableKind
}>()

const { t } = useI18n()
const revealSecret = ref(false)

function refreshUuid(): void {
  value.value = globalThis.crypto.randomUUID()
}

const boolOptions = computed<RsSelectOption[]>(() => [
  { value: 'true', label: 'true' },
  { value: 'false', label: 'false' },
])

const DATETIME_LABEL: Record<DatetimePreset, string> = {
  'now:date': 'modules.api.varDynamic.nowDate',
  'now:time': 'modules.api.varDynamic.nowTime',
  'now:datetime': 'modules.api.varDynamic.nowDatetime',
  'now:iso': 'modules.api.varDynamic.nowIso',
  'now:unix': 'modules.api.varDynamic.nowUnix',
  'now:unixMs': 'modules.api.varDynamic.nowUnixMs',
}

const datetimeOptions = computed<RsSelectOption[]>(() =>
  DATETIME_PRESETS.map((preset) => ({ value: preset, label: t(DATETIME_LABEL[preset]) })),
)

const numberModeOptions = computed<RsSelectOption[]>(() => [
  { value: 'fixed', label: t('modules.api.varDynamic.numberFixed') },
  { value: 'int', label: t('modules.api.varDynamic.randomInt') },
  { value: 'float', label: t('modules.api.varDynamic.randomFloat') },
])

const uuidModeOptions = computed<RsSelectOption[]>(() => [
  { value: 'fixed', label: t('modules.api.varDynamic.uuidFixed') },
  { value: 'each', label: t('modules.api.varDynamic.uuidEach') },
])

const numberMode = computed(() => {
  if (value.value.startsWith('random:int:')) return 'int'
  if (value.value.startsWith('random:float:')) return 'float'
  return 'fixed'
})

const randomBounds = computed(() => parseRandom(value.value))

const datetimeValue = computed(() => (isDatetimePreset(value.value) ? value.value : 'now:datetime'))

const datetimePreview = computed(() => materializeVariableValue('datetime', datetimeValue.value))

function parseRandom(raw: string): { min: string; max: string } {
  const match = /^random:(?:int|float):(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)$/.exec(raw)
  return { min: match?.[1] ?? '0', max: match?.[2] ?? '100' }
}

function setNumberMode(raw: unknown): void {
  const mode = String(raw)
  if (mode === 'fixed') {
    value.value = '0'
    return
  }
  const bounds = numberMode.value === 'fixed' ? { min: '0', max: mode === 'int' ? '100' : '1' } : randomBounds.value
  value.value = `random:${mode}:${bounds.min}:${bounds.max}`
}

function setRandomBound(side: 'min' | 'max', raw: string): void {
  const bounds = { ...randomBounds.value, [side]: raw.trim() || '0' }
  const mode = numberMode.value === 'float' ? 'float' : 'int'
  value.value = `random:${mode}:${bounds.min}:${bounds.max}`
}

function setUuidMode(raw: unknown): void {
  if (String(raw) === 'each') {
    value.value = 'uuid:each'
    return
  }
  value.value = crypto.randomUUID()
}
</script>

<template>
  <div
    class="nm-api-var-value"
    :class="{ 'nm-api-var-value--split': kind === 'number' || kind === 'datetime' || kind === 'uuid' }"
  >
    <RsSelect
      v-if="kind === 'boolean'"
      :model-value="value || 'true'"
      :options="boolOptions"
      size="sm"
      radius="sm"
      :searchable="false"
      :clearable="false"
      :filter-option="false"
      @update:model-value="value = String($event)"
    />

    <template v-else-if="kind === 'datetime'">
      <RsSelect
        :model-value="datetimeValue"
        :options="datetimeOptions"
        size="sm"
        radius="sm"
        :searchable="false"
        :clearable="false"
        :filter-option="false"
        @update:model-value="value = String($event)"
      />
      <span class="nm-api-var-value__preview" :title="datetimePreview">{{ datetimePreview }}</span>
    </template>

    <template v-else-if="kind === 'number'">
      <RsSelect
        :model-value="numberMode"
        :options="numberModeOptions"
        size="sm"
        radius="sm"
        :searchable="false"
        :clearable="false"
        :filter-option="false"
        @update:model-value="setNumberMode"
      />
      <RsInput
        v-if="numberMode === 'fixed'"
        v-model="value"
        size="sm"
        radius="sm"
        inputmode="decimal"
        :placeholder="t(valuePlaceholderKey(kind))"
      />
      <div v-else class="nm-api-var-value__pair">
        <RsInput
          :model-value="randomBounds.min"
          size="sm"
          radius="sm"
          inputmode="decimal"
          :aria-label="t('modules.api.varDynamic.min')"
          :placeholder="t('modules.api.varDynamic.min')"
          @update:model-value="setRandomBound('min', String($event))"
        />
        <RsInput
          :model-value="randomBounds.max"
          size="sm"
          radius="sm"
          inputmode="decimal"
          :aria-label="t('modules.api.varDynamic.max')"
          :placeholder="t('modules.api.varDynamic.max')"
          @update:model-value="setRandomBound('max', String($event))"
        />
      </div>
    </template>

    <template v-else-if="kind === 'uuid'">
      <RsSelect
        :model-value="value === 'uuid:each' ? 'each' : 'fixed'"
        :options="uuidModeOptions"
        size="sm"
        radius="sm"
        :searchable="false"
        :clearable="false"
        :filter-option="false"
        @update:model-value="setUuidMode"
      />
      <span v-if="value === 'uuid:each'" class="nm-api-var-value__preview">
        {{ t('modules.api.varDynamic.uuidEachHint') }}
      </span>
      <template v-else>
        <RsInput v-model="value" size="sm" radius="sm" spellcheck="false" />
        <RsButton
          variant="ghost"
          size="sm"
          icon-only
          icon="refresh-cw"
          radius="sm"
          :aria-label="t('modules.api.varGenerateUuid')"
          @click="refreshUuid"
        />
      </template>
    </template>

    <template v-else>
      <RsInput
        v-model="value"
        size="sm"
        radius="sm"
        :type="kind === 'secret' && !revealSecret ? 'password' : 'text'"
        :inputmode="kind === 'counter' ? 'numeric' : 'text'"
        :placeholder="t(valuePlaceholderKey(kind))"
        spellcheck="false"
      />
      <RsButton
        v-if="kind === 'secret'"
        variant="ghost"
        size="sm"
        icon-only
        :icon="revealSecret ? 'eye-off' : 'eye'"
        radius="sm"
        :aria-label="t('modules.api.varReveal')"
        @click="revealSecret = !revealSecret"
      />
    </template>
  </div>
</template>

<style scoped>
.nm-api-var-value {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  min-width: 0;
}

.nm-api-var-value > :first-child {
  flex: 1;
  min-width: 0;
}

.nm-api-var-value--split > :first-child {
  flex: 0 0 8.75rem;
}

.nm-api-var-value--split > :nth-child(2) {
  flex: 1;
  min-width: 0;
}

.nm-api-var-value__pair {
  display: flex;
  flex: 1;
  gap: var(--rs-space-xs);
  min-width: 0;
}

.nm-api-var-value__pair > * {
  flex: 1;
  min-width: 0;
}

.nm-api-var-value__preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace;
  font-size: 12px;
  color: var(--rs-muted);
}
</style>
