<script setup lang="ts">
import { RsInput, RsLabel, RsSelect, RsTooltip } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_POSTGRES_OPTIONS } from '@/api/types/postgres'
import { ConnectionTimeoutFields } from '@/modules/connection'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'
import { POSTGRES_CLIENT_ENCODINGS } from '@/modules/postgres/utils/encoding'

const props = defineProps<{
  form: ConnectionFormState
}>()

const { t } = useI18n()

const excludeSystemOptions = computed<RsSelectOptions>(() => [
  { value: 'true', label: t('modules.postgres.form.excludeSystemYes') },
  { value: 'false', label: t('modules.postgres.form.excludeSystemNo') },
])

const encodingOptions = computed<RsSelectOptions>(() => {
  const cur = String(props.form.pgClientEncoding ?? '').trim()
  const known = new Set<string>(POSTGRES_CLIENT_ENCODINGS)
  const base = POSTGRES_CLIENT_ENCODINGS.map((v) => ({ value: v, label: v }))
  if (cur && !known.has(cur)) {
    return [{ value: cur, label: cur }, ...base]
  }
  return base
})
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.postgres.form.searchPathHint')" side="top" align="start">
        <RsLabel>{{ t('modules.postgres.form.searchPath') }}</RsLabel>
      </RsTooltip>
      <RsInput
        v-model="form.pgSearchPath"
        autocomplete="off"
        :placeholder="t('modules.postgres.form.searchPathPlaceholder')"
      />
    </div>

    <div class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsTooltip icon :content="t('modules.postgres.form.clientEncodingHint')" side="top" align="start">
          <RsLabel>{{ t('modules.postgres.form.clientEncoding') }}</RsLabel>
        </RsTooltip>
        <RsSelect v-model="form.pgClientEncoding" :options="encodingOptions" />
      </div>
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsTooltip icon :content="t('modules.postgres.form.excludeSystemHint')" side="top" align="start">
          <RsLabel>{{ t('modules.postgres.form.excludeSystem') }}</RsLabel>
        </RsTooltip>
        <RsSelect v-model="form.pgExcludeSystemSchemas" :options="excludeSystemOptions" />
      </div>
    </div>

    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.postgres.form.statementTimeoutHint')" side="top" align="start">
        <RsLabel>{{ t('modules.postgres.form.statementTimeout') }}</RsLabel>
      </RsTooltip>
      <RsInput
        v-model="form.pgStatementTimeoutMs"
        autocomplete="off"
        inputmode="numeric"
        :placeholder="t('modules.postgres.form.statementTimeoutPlaceholder')"
      />
    </div>

    <ConnectionTimeoutFields
      :form="form"
      :default-seconds="DEFAULT_POSTGRES_OPTIONS.connect_timeout_seconds"
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
