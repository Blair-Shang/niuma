<script setup lang="ts">
import { RsInput, RsLabel, RsSelect, RsTooltip } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

const props = defineProps<{ form: ConnectionFormState }>()
const { t } = useI18n()

const connectAsOptions = computed<RsSelectOptions>(() => [
  { value: 'service', label: t('modules.oracle.form.connectAsService') },
  { value: 'sid', label: t('modules.oracle.form.connectAsSid') },
])

const useService = computed(() => props.form.oracleConnectAs !== 'sid')
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.oracle.form.connectAsHint')" side="top" align="start">
        <RsLabel>{{ t('modules.oracle.form.connectAs') }}</RsLabel>
      </RsTooltip>
      <RsSelect v-model="form.oracleConnectAs" :options="connectAsOptions" />
    </div>
    <div v-if="useService" class="nm-conn-form__field">
      <RsLabel required>{{ t('modules.oracle.form.serviceName') }}</RsLabel>
      <RsInput
        v-model="form.oracleServiceName"
        autocomplete="off"
        :placeholder="t('modules.oracle.form.serviceNamePlaceholder')"
      />
    </div>
    <div v-else class="nm-conn-form__field">
      <RsLabel required>{{ t('modules.oracle.form.sid') }}</RsLabel>
      <RsInput
        v-model="form.oracleSid"
        autocomplete="off"
        :placeholder="t('modules.oracle.form.sidPlaceholder')"
      />
    </div>
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.oracle.form.schema') }}</RsLabel>
      <RsInput
        v-model="form.oracleSchema"
        autocomplete="off"
        :placeholder="t('modules.oracle.form.schemaPlaceholder')"
      />
    </div>
  </section>
</template>

<style scoped>
.nm-conn-form__section,
.nm-conn-form__field {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}
.nm-conn-form__section {
  gap: var(--rs-space-sm);
}
</style>
