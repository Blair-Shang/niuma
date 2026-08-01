<script setup lang="ts">
import { RsInput, RsLabel } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

defineProps<{ form: ConnectionFormState }>()
const { t } = useI18n()
</script>

<template>
  <section class="nm-conn-form__section">
    <div v-for="field in [['oracleSchema', 'schema'], ['oracleServiceName', 'serviceName'], ['oracleSid', 'sid']] as const" :key="field[0]" class="nm-conn-form__field">
      <RsLabel>{{ t(`modules.oracle.form.${field[1]}`) }}</RsLabel>
      <RsInput v-model="form[field[0]]" autocomplete="off" :placeholder="t(`modules.oracle.form.${field[1]}Placeholder`)" />
    </div>
  </section>
</template>

<style scoped>
.nm-conn-form__section, .nm-conn-form__field { display: flex; flex-direction: column; gap: var(--rs-space-xs); }
.nm-conn-form__section { gap: var(--rs-space-sm); }
</style>
