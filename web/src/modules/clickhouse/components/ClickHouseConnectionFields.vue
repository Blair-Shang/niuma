<script setup lang="ts">
import { RsInput, RsLabel, RsSelect, RsTooltip } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

defineProps<{ form: ConnectionFormState }>()
const { t } = useI18n()
const protocolOptions = computed(() => [
  { value: 'native', label: t('modules.clickhouse.form.protocolNative') },
  { value: 'http', label: t('modules.clickhouse.form.protocolHttp') },
])
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.clickhouse.form.protocol') }}</RsLabel>
      <RsSelect v-model="form.chProtocol" :options="protocolOptions" />
    </div>
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.clickhouse.form.database') }}</RsLabel>
      <RsInput
        v-model="form.chDatabase"
        autocomplete="off"
        :placeholder="t('modules.clickhouse.form.databasePlaceholder')"
      />
    </div>
    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.clickhouse.form.altHostsHint')" side="top" align="start">
        <RsLabel>{{ t('modules.clickhouse.form.altHosts') }}</RsLabel>
      </RsTooltip>
      <RsInput
        v-model="form.chAltHosts"
        autocomplete="off"
        :placeholder="t('modules.clickhouse.form.altHostsPlaceholder')"
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
