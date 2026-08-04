<script setup lang="ts">
import { RsInput, RsLabel, RsSelect, RsTooltip } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

/**
 * Oracle SSL / Wallet Tab。
 * disable → TCP；require / verify-full → TCPS（Easy Connect Plus / 描述符）。
 * 证书目录为 oracle-service 进程可读的本地 Wallet 路径（建议含 cwallet.sso）。
 */
const props = defineProps<{ form: ConnectionFormState }>()
const { t } = useI18n()

const sslOptions = computed<RsSelectOptions>(() => [
  { value: 'disable', label: t('modules.oracle.form.sslDisable') },
  { value: 'require', label: t('modules.oracle.form.sslRequire') },
  { value: 'verify-full', label: t('modules.oracle.form.sslVerifyFull') },
])

const sslEnabled = computed(() => {
  const mode = String(props.form.oracleSslMode ?? 'disable')
  return mode === 'require' || mode === 'verify-full'
})

const walletRequired = computed(() => String(props.form.oracleSslMode ?? '') === 'verify-full')
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.oracle.form.sslModeHint')" side="top" align="start">
        <RsLabel>{{ t('modules.oracle.form.sslMode') }}</RsLabel>
      </RsTooltip>
      <RsSelect v-model="form.oracleSslMode" :options="sslOptions" />
    </div>

    <template v-if="sslEnabled">
      <div class="nm-conn-form__field">
        <RsTooltip icon :content="t('modules.oracle.form.walletPathHint')" side="top" align="start">
          <RsLabel :required="walletRequired">{{ t('modules.oracle.form.walletPath') }}</RsLabel>
        </RsTooltip>
        <RsInput
          v-model="form.oracleWalletPath"
          autocomplete="off"
          :placeholder="t('modules.oracle.form.walletPathPlaceholder')"
        />
      </div>
      <div class="nm-conn-form__field">
        <RsTooltip icon :content="t('modules.oracle.form.walletPasswordHint')" side="top" align="start">
          <RsLabel>{{ t('modules.oracle.form.walletPassword') }}</RsLabel>
        </RsTooltip>
        <RsInput
          v-model="form.oracleWalletPassword"
          type="password"
          autocomplete="off"
          :placeholder="t('modules.oracle.form.walletPasswordPlaceholder')"
        />
      </div>
      <p class="nm-conn-form__hint">{{ t('modules.oracle.form.sslSectionHint') }}</p>
    </template>
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
.nm-conn-form__hint {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
</style>
