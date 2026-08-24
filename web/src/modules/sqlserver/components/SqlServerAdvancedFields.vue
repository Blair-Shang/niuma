<script setup lang="ts">
import { RsInput, RsLabel, RsSelect, RsTooltip } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ConnectionTimeoutFields } from '@/modules/connection'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

/** SQL Server「高级」Tab：应用名、系统 schema、超时。 */
defineProps<{
  form: ConnectionFormState
}>()

const { t } = useI18n()

const boolOptions = computed<RsSelectOptions>(() => [
  { value: 'true', label: t('modules.sqlserver.form.yes') },
  { value: 'false', label: t('modules.sqlserver.form.no') },
])
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.sqlserver.form.appNameHint')" side="top" align="start">
        <RsLabel>{{ t('modules.sqlserver.form.appName') }}</RsLabel>
      </RsTooltip>
      <RsInput v-model="form.ssAppName" autocomplete="off" />
    </div>
    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.sqlserver.form.excludeSystemSchemasHint')" side="top" align="start">
        <RsLabel>{{ t('modules.sqlserver.form.excludeSystemSchemas') }}</RsLabel>
      </RsTooltip>
      <RsSelect v-model="form.ssExcludeSystemSchemas" :options="boolOptions" />
    </div>
    <ConnectionTimeoutFields :form="form" :default-seconds="10" />
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
</style>
