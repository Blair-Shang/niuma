<script setup lang="ts">
import { RsInput, RsLabel, RsSelect, RsTooltip } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ConnectionTimeoutFields } from '@/modules/connection'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

defineProps<{ form: ConnectionFormState }>()
const { t } = useI18n()
const boolOptions = computed(() => [
  { value: 'true', label: t('modules.clickhouse.form.yes') },
  { value: 'false', label: t('modules.clickhouse.form.no') },
])
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.clickhouse.form.appName') }}</RsLabel>
      <RsInput v-model="form.chAppName" autocomplete="off" />
    </div>
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.clickhouse.form.compress') }}</RsLabel>
      <RsSelect v-model="form.chCompress" :options="boolOptions" />
    </div>
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.clickhouse.form.excludeSystem') }}</RsLabel>
      <RsSelect v-model="form.chExcludeSystemDatabases" :options="boolOptions" />
    </div>
    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.clickhouse.form.clusterHint')" side="top" align="start">
        <RsLabel>{{ t('modules.clickhouse.form.cluster') }}</RsLabel>
      </RsTooltip>
      <RsInput
        v-model="form.chCluster"
        autocomplete="off"
        :placeholder="t('modules.clickhouse.form.clusterPlaceholder')"
      />
    </div>
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.clickhouse.form.readTimeoutSeconds') }}</RsLabel>
      <RsInput
        v-model="form.chReadTimeoutSeconds"
        autocomplete="off"
        :placeholder="t('modules.clickhouse.form.readTimeoutPlaceholder')"
      />
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
