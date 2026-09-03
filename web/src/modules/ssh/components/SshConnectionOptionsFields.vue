<script setup lang="ts">
import { RsInput, RsLabel, RsSelect, RsTooltip } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_SSH_OPTIONS } from '@/api/types/ssh'
import { ConnectionTimeoutFields } from '@/modules/connection'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

/** SSH / 独立 SFTP 专属连接选项（超时、keepalive、主机密钥、远端编码）。 */
defineProps<{
  form: ConnectionFormState
}>()

const { t } = useI18n()

const encodingOptions = computed<RsSelectOptions>(() => [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'gbk', label: 'GBK' },
])

const verifyOptions = computed<RsSelectOptions>(() => [
  { value: 'false', label: t('connection.form.sshVerifyHostKeyOff') },
  { value: 'true', label: t('connection.form.sshVerifyHostKeyOn') },
])
</script>

<template>
  <section class="nm-conn-form__section">
    <ConnectionTimeoutFields :form="form" :default-seconds="DEFAULT_SSH_OPTIONS.timeout_seconds" />

    <div class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsTooltip icon :content="t('connection.form.sshKeepaliveSecondsHint')" side="top" align="start">
          <RsLabel>{{ t('connection.form.sshKeepaliveSeconds') }}</RsLabel>
        </RsTooltip>
        <RsInput
          v-model="form.sshKeepaliveSeconds"
          autocomplete="off"
          :placeholder="String(DEFAULT_SSH_OPTIONS.keepalive_seconds)"
        />
      </div>
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsLabel>{{ t('connection.form.sshEncoding') }}</RsLabel>
        <RsSelect v-model="form.encoding" :options="encodingOptions" />
      </div>
    </div>

    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('connection.form.sshVerifyHostKeyHint')" side="top" align="start">
        <RsLabel>{{ t('connection.form.sshVerifyHostKey') }}</RsLabel>
      </RsTooltip>
      <RsSelect v-model="form.sshVerifyHostKey" :options="verifyOptions" />
    </div>
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
</style>
