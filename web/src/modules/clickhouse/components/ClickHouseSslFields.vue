<script setup lang="ts">
import { RsInput, RsLabel, RsSelect } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

const props = defineProps<{ form: ConnectionFormState }>()
const { t } = useI18n()
const options = computed(() => [
  { value: 'disable', label: t('modules.clickhouse.form.sslDisable') },
  { value: 'require', label: t('modules.clickhouse.form.sslRequire') },
  { value: 'verify-ca', label: t('modules.clickhouse.form.sslVerifyCa') },
  { value: 'verify-full', label: t('modules.clickhouse.form.sslVerifyFull') },
])
const certificates = computed(() => props.form.chSslMode !== 'disable')
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.clickhouse.form.sslMode') }}</RsLabel>
      <RsSelect v-model="form.chSslMode" :options="options" />
    </div>
    <template v-if="certificates">
      <div v-for="field in [['chSslCa', 'sslCa'], ['chSslCert', 'sslCert'], ['chSslKey', 'sslKey']] as const" :key="field[0]" class="nm-conn-form__field">
        <RsLabel>{{ t(`modules.clickhouse.form.${field[1]}`) }}</RsLabel>
        <RsInput v-model="form[field[0]]" autocomplete="off" :placeholder="t('modules.clickhouse.form.sslPathPlaceholder')" />
      </div>
    </template>
  </section>
</template>

<style scoped>
.nm-conn-form__section, .nm-conn-form__field { display: flex; flex-direction: column; gap: var(--rs-space-xs); }
.nm-conn-form__section { gap: var(--rs-space-sm); }
</style>
