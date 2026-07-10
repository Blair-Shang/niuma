<script setup lang="ts">
import { RsLabel, RsSelect } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_FTP_OPTIONS } from '@/api/types/ftp'
import { ConnectionTimeoutFields } from '@/modules/connection'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

/** FTP/FTPS 专属连接选项字段（供 ConnectionFormDialog #options 插槽使用）。 */
defineProps<{
  form: ConnectionFormState
}>()

const { t } = useI18n()

const protocolOptions = computed<RsSelectOptions>(() => [
  { value: 'ftp', label: 'FTP' },
  { value: 'ftps', label: 'FTPS' },
])
const encodingOptions = computed<RsSelectOptions>(() => [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'gbk', label: 'GBK' },
])
const passiveOptions = computed<RsSelectOptions>(() => [
  { value: 'true', label: t('opsNav.passive.on') },
  { value: 'false', label: t('opsNav.passive.off') },
])
const tlsModeOptions = computed<RsSelectOptions>(() => [
  { value: 'explicit', label: t('modules.ftp.form.tlsModeExplicit') },
  { value: 'implicit', label: t('modules.ftp.form.tlsModeImplicit') },
])
const tlsVerifyOptions = computed<RsSelectOptions>(() => [
  { value: 'true', label: t('modules.ftp.form.tlsVerifyOn') },
  { value: 'false', label: t('modules.ftp.form.tlsVerifyOff') },
])
</script>

<template>
  <section class="nm-conn-form__section">
    <!-- 基础选项：协议 / 编码 / 被动模式 -->
    <div class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsLabel>{{ t('modules.ftp.form.protocol') }}</RsLabel>
        <RsSelect v-model="form.protocol" :options="protocolOptions" />
      </div>
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsLabel>{{ t('modules.ftp.form.encoding') }}</RsLabel>
        <RsSelect v-model="form.encoding" :options="encodingOptions" />
      </div>
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsLabel>{{ t('modules.ftp.form.passive') }}</RsLabel>
        <RsSelect v-model="form.passive" :options="passiveOptions" />
      </div>
    </div>

    <!-- FTPS 专属选项：TLS 模式 + 证书验证（仅当选择 FTPS 时显示） -->
    <div v-if="form.protocol === 'ftps'" class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsLabel>{{ t('modules.ftp.form.tlsMode') }}</RsLabel>
        <RsSelect v-model="form.ftpTlsMode" :options="tlsModeOptions" />
        <p class="nm-conn-form__hint">
          {{ form.ftpTlsMode === 'implicit'
            ? t('modules.ftp.form.tlsModeImplicitHint')
            : t('modules.ftp.form.tlsModeExplicitHint') }}
        </p>
      </div>
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsLabel>{{ t('modules.ftp.form.tlsVerify') }}</RsLabel>
        <RsSelect v-model="form.ftpTlsVerify" :options="tlsVerifyOptions" />
        <p v-if="form.ftpTlsVerify === 'false'" class="nm-conn-form__hint nm-conn-form__hint--warn">
          {{ t('modules.ftp.form.tlsVerifyOffWarn') }}
        </p>
      </div>
    </div>

    <ConnectionTimeoutFields :form="form" :default-seconds="DEFAULT_FTP_OPTIONS.timeout_seconds" />
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

.nm-conn-form__hint--warn {
  color: var(--rs-warning);
}
</style>
