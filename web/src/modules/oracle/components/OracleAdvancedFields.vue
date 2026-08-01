<script setup lang="ts">
import { RsInput, RsLabel, RsSelect } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ConnectionTimeoutFields } from '@/modules/connection'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

defineProps<{ form: ConnectionFormState }>()
const { t } = useI18n()
const roleOptions = computed(() => [
  { value: 'normal', label: t('modules.oracle.form.roleNormal') },
  { value: 'sysdba', label: 'SYSDBA' },
  { value: 'sysoper', label: 'SYSOPER' },
])
const boolOptions = computed(() => [
  { value: 'true', label: t('modules.oracle.form.excludeSystemYes') },
  { value: 'false', label: t('modules.oracle.form.excludeSystemNo') },
])
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field"><RsLabel>{{ t('modules.oracle.form.role') }}</RsLabel><RsSelect v-model="form.oracleRole" :options="roleOptions" /></div>
    <div class="nm-conn-form__field"><RsLabel>{{ t('modules.oracle.form.appName') }}</RsLabel><RsInput v-model="form.oracleAppName" autocomplete="off" /></div>
    <div class="nm-conn-form__field"><RsLabel>{{ t('modules.oracle.form.excludeSystem') }}</RsLabel><RsSelect v-model="form.oracleExcludeSystemSchemas" :options="boolOptions" /></div>
    <ConnectionTimeoutFields :form="form" :default-seconds="30" />
  </section>
</template>

<style scoped>
.nm-conn-form__section, .nm-conn-form__field { display: flex; flex-direction: column; gap: var(--rs-space-xs); }
.nm-conn-form__section { gap: var(--rs-space-sm); }
</style>
