<script setup lang="ts">
import { RsInput, RsLabel, RsSelect, RsTooltip } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

/**
 * MySQL SSL Tab（对齐 Navicat SSL / DBeaver SSL）。
 * 证书路径为服务端可读的本地文件路径（由 mysql-service 加载）。
 */
const props = defineProps<{
  form: ConnectionFormState
}>()

const { t } = useI18n()

const sslOptions = computed<RsSelectOptions>(() => [
  { value: 'disable', label: t('modules.mysql.form.sslDisable') },
  { value: 'preferred', label: t('modules.mysql.form.sslPreferred') },
  { value: 'require', label: t('modules.mysql.form.sslRequire') },
  { value: 'verify-ca', label: t('modules.mysql.form.sslVerifyCa') },
  { value: 'verify-identity', label: t('modules.mysql.form.sslVerifyIdentity') },
])

const showCertFields = computed(() => {
  const mode = String(props.form.mysqlSslMode ?? '')
  return mode === 'require' || mode === 'verify-ca' || mode === 'verify-identity'
})
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.mysql.form.sslModeHint')" side="top" align="start">
        <RsLabel>{{ t('modules.mysql.form.sslMode') }}</RsLabel>
      </RsTooltip>
      <RsSelect v-model="form.mysqlSslMode" :options="sslOptions" />
    </div>

    <template v-if="showCertFields">
      <div class="nm-conn-form__field">
        <RsTooltip icon :content="t('modules.mysql.form.sslCaHint')" side="top" align="start">
          <RsLabel>{{ t('modules.mysql.form.sslCa') }}</RsLabel>
        </RsTooltip>
        <RsInput
          v-model="form.mysqlSslCa"
          autocomplete="off"
          :placeholder="t('modules.mysql.form.sslPathPlaceholder')"
        />
      </div>
      <div class="nm-conn-form__row">
        <div class="nm-conn-form__field nm-conn-form__field--grow">
          <RsTooltip icon :content="t('modules.mysql.form.sslCertHint')" side="top" align="start">
            <RsLabel>{{ t('modules.mysql.form.sslCert') }}</RsLabel>
          </RsTooltip>
          <RsInput
            v-model="form.mysqlSslCert"
            autocomplete="off"
            :placeholder="t('modules.mysql.form.sslPathPlaceholder')"
          />
        </div>
        <div class="nm-conn-form__field nm-conn-form__field--grow">
          <RsTooltip icon :content="t('modules.mysql.form.sslKeyHint')" side="top" align="start">
            <RsLabel>{{ t('modules.mysql.form.sslKey') }}</RsLabel>
          </RsTooltip>
          <RsInput
            v-model="form.mysqlSslKey"
            autocomplete="off"
            :placeholder="t('modules.mysql.form.sslPathPlaceholder')"
          />
        </div>
      </div>
      <p class="nm-conn-form__hint">{{ t('modules.mysql.form.sslCertSectionHint') }}</p>
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
