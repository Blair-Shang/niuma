<script setup lang="ts">
import { RsInput, RsLabel, RsSelect, RsTooltip } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_VAST_OPTIONS } from '@/api/types/vastbase'
import { ConnectionTimeoutFields } from '@/modules/connection'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'
import { VAST_CLIENT_ENCODINGS } from '@/modules/vastbase/vast-encoding'

/**
 * Vastbase「高级」Tab：search_path / client_encoding / 系统 schema / 超时
 *（对齐 Navicat Advanced、DBeaver Driver properties / libpq）。
 */
const props = defineProps<{
  form: ConnectionFormState
}>()

const { t } = useI18n()

const excludeSystemOptions = computed<RsSelectOptions>(() => [
  { value: 'true', label: t('modules.vastbase.form.excludeSystemYes') },
  { value: 'false', label: t('modules.vastbase.form.excludeSystemNo') },
])

const encodingOptions = computed<RsSelectOptions>(() => {
  const cur = String(props.form.vastClientEncoding ?? '').trim()
  const known = new Set<string>(VAST_CLIENT_ENCODINGS)
  const base = VAST_CLIENT_ENCODINGS.map((v) => ({ value: v, label: v }))
  if (cur && !known.has(cur)) {
    return [{ value: cur, label: cur }, ...base]
  }
  return base
})
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.vastbase.form.searchPathHint')" side="top" align="start">
        <RsLabel>{{ t('modules.vastbase.form.searchPath') }}</RsLabel>
      </RsTooltip>
      <RsInput
        v-model="form.vastSearchPath"
        autocomplete="off"
        :placeholder="t('modules.vastbase.form.searchPathPlaceholder')"
      />
    </div>

    <div class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsTooltip icon :content="t('modules.vastbase.form.clientEncodingHint')" side="top" align="start">
          <RsLabel>{{ t('modules.vastbase.form.clientEncoding') }}</RsLabel>
        </RsTooltip>
        <RsSelect v-model="form.vastClientEncoding" :options="encodingOptions" />
      </div>
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsTooltip icon :content="t('modules.vastbase.form.excludeSystemHint')" side="top" align="start">
          <RsLabel>{{ t('modules.vastbase.form.excludeSystem') }}</RsLabel>
        </RsTooltip>
        <RsSelect v-model="form.vastExcludeSystemSchemas" :options="excludeSystemOptions" />
      </div>
    </div>

    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.vastbase.form.statementTimeoutHint')" side="top" align="start">
        <RsLabel>{{ t('modules.vastbase.form.statementTimeout') }}</RsLabel>
      </RsTooltip>
      <RsInput
        v-model="form.vastStatementTimeoutMs"
        autocomplete="off"
        inputmode="numeric"
        :placeholder="t('modules.vastbase.form.statementTimeoutPlaceholder')"
      />
    </div>

    <ConnectionTimeoutFields
      :form="form"
      :default-seconds="DEFAULT_VAST_OPTIONS.connect_timeout_seconds"
    />
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
</style>
