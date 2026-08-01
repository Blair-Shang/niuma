<script setup lang="ts">
import { RsInput, RsLabel, RsSelect } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ConnectionTimeoutFields } from '@/modules/connection'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

defineProps<{ form: ConnectionFormState }>()
const { t } = useI18n()
const boolOptions = computed(() => [
  { value: 'true', label: t('modules.dameng.form.excludeSystemYes') },
  { value: 'false', label: t('modules.dameng.form.excludeSystemNo') },
])
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.dameng.form.appName') }}</RsLabel>
      <RsInput v-model="form.damengAppName" autocomplete="off" />
    </div>
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.dameng.form.excludeSystem') }}</RsLabel>
      <RsSelect v-model="form.damengExcludeSystemSchemas" :options="boolOptions" />
      <p class="nm-conn-form__hint">{{ t('modules.dameng.form.excludeSystemHint') }}</p>
    </div>
    <ConnectionTimeoutFields :form="form" :default-seconds="30" />
  </section>
</template>

<style scoped>
.nm-conn-form__section, .nm-conn-form__field { display: flex; flex-direction: column; gap: var(--rs-space-xs); }
.nm-conn-form__section { gap: var(--rs-space-sm); }
.nm-conn-form__hint {
  margin: 0;
  color: var(--rs-fg-muted, var(--rs-color-fg-muted));
  font-size: var(--rs-font-size-sm, 12px);
  line-height: 1.4;
}
</style>
