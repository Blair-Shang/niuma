<script setup lang="ts">
import { RsButton, RsInput, RsSelect, type RsSelectOption } from '@niuma/ui'
import { createId } from '@/utils/id'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiCheckKind, ApiRequest } from '../types'

const props = defineProps<{
  request: ApiRequest
}>()

const { t } = useI18n()

const scopeOptions = computed<RsSelectOption[]>(() => [
  { value: 'environment', label: t('modules.api.scriptScopeEnv') },
  { value: 'global', label: t('modules.api.scriptScopeGlobal') },
])

const kindOptions = computed<RsSelectOption[]>(() => [
  { value: 'status', label: t('modules.api.checkStatus') },
  { value: 'bodyContains', label: t('modules.api.checkBody') },
  { value: 'header', label: t('modules.api.checkHeader') },
  { value: 'jsonEquals', label: t('modules.api.checkJson') },
  { value: 'timeUnder', label: t('modules.api.checkTime') },
])

function ensureSteps(): void {
  if (!props.request.preSteps) props.request.preSteps = []
  if (!props.request.checks) props.request.checks = []
}

function addStep(): void {
  ensureSteps()
  props.request.preSteps!.push({
    id: createId('pre'),
    enabled: true,
    scope: 'environment',
    key: '',
    value: '',
  })
}

function addCheck(): void {
  ensureSteps()
  props.request.checks!.push({
    id: createId('chk'),
    enabled: true,
    kind: 'status',
    target: '',
    expect: '200',
  })
}

function needsTarget(kind: ApiCheckKind): boolean {
  return kind === 'header' || kind === 'jsonEquals'
}
</script>

<template>
  <div class="nm-api-script">
    <section class="nm-api-script__block">
      <header class="nm-api-script__head">
        <span>{{ t('modules.api.scriptPre') }}</span>
        <RsButton size="sm" variant="ghost" icon="plus" @click="addStep">
          {{ t('modules.api.scriptAddPre') }}
        </RsButton>
      </header>
      <div v-for="step in request.preSteps ?? []" :key="step.id" class="nm-api-script__row">
        <input v-model="step.enabled" type="checkbox" class="nm-api-script__check">
        <RsSelect
          v-model="step.scope"
          :options="scopeOptions"
          size="sm"
          radius="sm"
          :searchable="false"
          :clearable="false"
        />
        <RsInput v-model="step.key" size="sm" :placeholder="t('modules.api.scriptKey')" />
        <RsInput v-model="step.value" size="sm" :placeholder="t('modules.api.scriptValue')" />
        <RsButton size="sm" variant="ghost" icon-only icon="trash-2" @click="request.preSteps?.splice(request.preSteps.indexOf(step), 1)" />
      </div>
    </section>

    <section class="nm-api-script__block">
      <header class="nm-api-script__head">
        <span>{{ t('modules.api.scriptChecks') }}</span>
        <RsButton size="sm" variant="ghost" icon="plus" @click="addCheck">
          {{ t('modules.api.scriptAddCheck') }}
        </RsButton>
      </header>
      <div v-for="check in request.checks ?? []" :key="check.id" class="nm-api-script__row">
        <input v-model="check.enabled" type="checkbox" class="nm-api-script__check">
        <RsSelect
          v-model="check.kind"
          :options="kindOptions"
          size="sm"
          radius="sm"
          :searchable="false"
          :clearable="false"
        />
        <RsInput
          v-if="needsTarget(check.kind)"
          v-model="check.target"
          size="sm"
          :placeholder="t('modules.api.checkTarget')"
        />
        <RsInput v-model="check.expect" size="sm" :placeholder="t('modules.api.checkExpect')" />
        <RsButton size="sm" variant="ghost" icon-only icon="trash-2" @click="request.checks?.splice(request.checks.indexOf(check), 1)" />
      </div>
    </section>

    <section class="nm-api-script__block">
      <header class="nm-api-script__head">
        <span>{{ t('modules.api.scriptJs') }}</span>
      </header>
      <p class="nm-api-script__hint">{{ t('modules.api.scriptJsHint') }}</p>
      <textarea
        v-model="request.preRequestScript"
        class="nm-api-script__code"
        rows="4"
        spellcheck="false"
        :placeholder="t('modules.api.scriptPre')"
      />
      <textarea
        v-model="request.testScript"
        class="nm-api-script__code"
        rows="4"
        spellcheck="false"
        :placeholder="t('modules.api.scriptChecks')"
      />
    </section>
  </div>
</template>

<style scoped>
.nm-api-script {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  min-height: 0;
  overflow: auto;
  padding: var(--rs-space-sm) var(--rs-space-md);
  background: var(--rs-surface);
}

.nm-api-script__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
}

.nm-api-script__block {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}

.nm-api-script__row {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
}

.nm-api-script__row > :deep(.rs-select),
.nm-api-script__row > :deep(.rs-input) {
  flex: 1;
  min-width: 6rem;
}

.nm-api-script__hint {
  margin: 0;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}

.nm-api-script__code {
  width: 100%;
  resize: vertical;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
  color: var(--rs-text);
  font: inherit;
  padding: var(--rs-space-xs);
}

.nm-api-script__check {
  margin: 0;
}
</style>
