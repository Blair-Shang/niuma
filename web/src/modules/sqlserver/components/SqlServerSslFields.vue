<script setup lang="ts">
import { RsInput, RsLabel, RsSelect, RsTooltip } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

/**
 * SQL Server SSL / Encrypt Tab（对齐 DBeaver Encrypt、Navicat SSL 区）。
 * 使用 TDS Encrypt 模型，而非 MySQL 式 CA/客户端证书文件。
 */
const props = defineProps<{
  form: ConnectionFormState
}>()

const { t } = useI18n()

const encryptOptions = computed<RsSelectOptions>(() => [
  { value: 'optional', label: t('modules.sqlserver.form.encryptOptional') },
  { value: 'disable', label: t('modules.sqlserver.form.encryptDisable') },
  { value: 'mandatory', label: t('modules.sqlserver.form.encryptMandatory') },
  { value: 'strict', label: t('modules.sqlserver.form.encryptStrict') },
])

const boolOptions = computed<RsSelectOptions>(() => [
  { value: 'true', label: t('modules.sqlserver.form.yes') },
  { value: 'false', label: t('modules.sqlserver.form.no') },
])

const showTrustFields = computed(() => {
  const mode = String(props.form.ssEncrypt ?? 'optional')
  return mode !== 'disable'
})

const azureHint = computed(() => {
  const host = String(props.form.hostAddress ?? '').toLowerCase()
  return host.includes('.database.windows.net') || host.includes('.database.chinacloudapi.cn')
})
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.sqlserver.form.encryptHint')" side="top" align="start">
        <RsLabel>{{ t('modules.sqlserver.form.encrypt') }}</RsLabel>
      </RsTooltip>
      <RsSelect v-model="form.ssEncrypt" :options="encryptOptions" />
    </div>

    <p v-if="azureHint" class="nm-conn-form__hint">{{ t('modules.sqlserver.form.azureEncryptHint') }}</p>

    <template v-if="showTrustFields">
      <div class="nm-conn-form__field">
        <RsTooltip icon :content="t('modules.sqlserver.form.trustServerCertificateHint')" side="top" align="start">
          <RsLabel>{{ t('modules.sqlserver.form.trustServerCertificate') }}</RsLabel>
        </RsTooltip>
        <RsSelect v-model="form.ssTrustServerCertificate" :options="boolOptions" />
      </div>
      <div class="nm-conn-form__field">
        <RsTooltip icon :content="t('modules.sqlserver.form.hostNameInCertificateHint')" side="top" align="start">
          <RsLabel>{{ t('modules.sqlserver.form.hostNameInCertificate') }}</RsLabel>
        </RsTooltip>
        <RsInput
          v-model="form.ssHostNameInCertificate"
          autocomplete="off"
          :placeholder="t('modules.sqlserver.form.hostNameInCertificatePlaceholder')"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.nm-conn-form__section {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}

.nm-conn-form__field {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}

.nm-conn-form__hint {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
</style>
