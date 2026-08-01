<script setup lang="ts">
import { RsInput, RsLabel, RsSelect, RsTooltip } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

const props = defineProps<{
  form: ConnectionFormState
}>()

const { t } = useI18n()

const sslOptions = computed<RsSelectOptions>(() => [
  { value: 'disable', label: t('modules.kingbase.form.sslDisable') },
  { value: 'prefer', label: t('modules.kingbase.form.sslPrefer') },
  { value: 'require', label: t('modules.kingbase.form.sslRequire') },
  { value: 'verify-ca', label: t('modules.kingbase.form.sslVerifyCa') },
  { value: 'verify-full', label: t('modules.kingbase.form.sslVerifyFull') },
])

const showCertFields = computed(() => {
  const mode = String(props.form.kbSslMode ?? '')
  return mode === 'require' || mode === 'verify-ca' || mode === 'verify-full'
})
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.kingbase.form.sslModeHint')" side="top" align="start">
        <RsLabel>{{ t('modules.kingbase.form.sslMode') }}</RsLabel>
      </RsTooltip>
      <RsSelect v-model="form.kbSslMode" :options="sslOptions" />
    </div>

    <template v-if="showCertFields">
      <div class="nm-conn-form__field">
        <RsTooltip icon :content="t('modules.kingbase.form.sslRootCertHint')" side="top" align="start">
          <RsLabel>{{ t('modules.kingbase.form.sslRootCert') }}</RsLabel>
        </RsTooltip>
        <RsInput
          v-model="form.kbSslRootCert"
          autocomplete="off"
          :placeholder="t('modules.kingbase.form.sslPathPlaceholder')"
        />
      </div>
      <div class="nm-conn-form__row">
        <div class="nm-conn-form__field nm-conn-form__field--grow">
          <RsTooltip icon :content="t('modules.kingbase.form.sslCertHint')" side="top" align="start">
            <RsLabel>{{ t('modules.kingbase.form.sslCert') }}</RsLabel>
          </RsTooltip>
          <RsInput
            v-model="form.kbSslCert"
            autocomplete="off"
            :placeholder="t('modules.kingbase.form.sslPathPlaceholder')"
          />
        </div>
        <div class="nm-conn-form__field nm-conn-form__field--grow">
          <RsTooltip icon :content="t('modules.kingbase.form.sslKeyHint')" side="top" align="start">
            <RsLabel>{{ t('modules.kingbase.form.sslKey') }}</RsLabel>
          </RsTooltip>
          <RsInput
            v-model="form.kbSslKey"
            autocomplete="off"
            :placeholder="t('modules.kingbase.form.sslPathPlaceholder')"
          />
        </div>
      </div>
      <p class="nm-conn-form__hint">{{ t('modules.kingbase.form.sslCertSectionHint') }}</p>
    </template>
  </section>
</template>

<style scoped>
.nm-conn-form__section {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}
.nm-conn-form__row {
  display: flex;
  gap: var(--rs-space-md);
  align-items: flex-start;
}
.nm-conn-form__field {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}
.nm-conn-form__field--grow {
  flex: 1;
  min-width: 0;
}
.nm-conn-form__hint {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
</style>
