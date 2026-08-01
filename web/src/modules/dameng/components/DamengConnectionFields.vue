<script setup lang="ts">
import { RsInput, RsLabel } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

defineProps<{ form: ConnectionFormState }>()
const { t } = useI18n()
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.dameng.form.schema') }}</RsLabel>
      <RsInput v-model="form.damengSchema" autocomplete="off" :placeholder="t('modules.dameng.form.schemaPlaceholder')" />
    </div>
  </section>
</template>

<style scoped>
.nm-conn-form__section, .nm-conn-form__field { display: flex; flex-direction: column; gap: var(--rs-space-xs); }
</style>
