<script setup lang="ts">
import { RsInput, RsLabel, RsSelect } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ConnectionTimeoutFields } from '@/modules/connection'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

defineProps<{ form: ConnectionFormState }>()
const { t } = useI18n()

const boolOptions = computed(() => [
  { value: 'true', label: t('modules.sqlserver.form.yes') },
  { value: 'false', label: t('modules.sqlserver.form.no') },
])
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.sqlserver.form.appName') }}</RsLabel>
      <RsInput v-model="form.ssAppName" autocomplete="off" />
    </div>
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.sqlserver.form.trustServerCertificate') }}</RsLabel>
      <RsSelect v-model="form.ssTrustServerCertificate" :options="boolOptions" />
    </div>
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.sqlserver.form.hostNameInCertificate') }}</RsLabel>
      <RsInput
        v-model="form.ssHostNameInCertificate"
        autocomplete="off"
        :placeholder="t('modules.sqlserver.form.hostNameInCertificatePlaceholder')"
      />
    </div>
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.sqlserver.form.excludeSystemSchemas') }}</RsLabel>
      <RsSelect v-model="form.ssExcludeSystemSchemas" :options="boolOptions" />
    </div>
    <ConnectionTimeoutFields :form="form" :default-seconds="10" />
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
