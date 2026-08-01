<script setup lang="ts">
import { RsInput, RsLabel, RsSelect } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

defineProps<{ form: ConnectionFormState }>()
const { t } = useI18n()
const modes = [{ value: 'disable', label: 'Disable' }, { value: 'require', label: 'Wallet' }]
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field"><RsLabel>{{ t('modules.oracle.form.sslMode') }}</RsLabel><RsSelect v-model="form.oracleSslMode" :options="modes" /></div>
    <div class="nm-conn-form__field"><RsLabel>{{ t('modules.oracle.form.walletPath') }}</RsLabel><RsInput v-model="form.oracleWalletPath" autocomplete="off" :placeholder="t('modules.oracle.form.walletPathPlaceholder')" /></div>
  </section>
</template>

<style scoped>
.nm-conn-form__section, .nm-conn-form__field { display: flex; flex-direction: column; gap: var(--rs-space-xs); }
.nm-conn-form__section { gap: var(--rs-space-sm); }
</style>
