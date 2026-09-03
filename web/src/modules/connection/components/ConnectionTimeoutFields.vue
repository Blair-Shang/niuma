<script setup lang="ts">
import { RsInput, RsLabel, RsTooltip } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

/** 各协议共用的建连超时字段（供 ConnectionFormDialog #options 插槽使用）。 */
defineProps<{
  form: ConnectionFormState
  /** placeholder 与 hint 中展示的协议默认超时（秒）。 */
  defaultSeconds: number
}>()

const { t } = useI18n()
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field nm-conn-form__field--timeout">
      <RsTooltip
        icon
        :content="t('connection.form.connectTimeoutSecondsHint', { default: defaultSeconds })"
        side="top"
        align="start"
      >
        <RsLabel class="nm-conn-form__label-nowrap">{{ t('connection.form.connectTimeoutSeconds') }}</RsLabel>
      </RsTooltip>
      <RsInput
        v-model="form.connectTimeoutSeconds"
        autocomplete="off"
        :placeholder="String(defaultSeconds)"
      />
    </div>
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

.nm-conn-form__field--timeout {
  flex-shrink: 0;
  min-width: 8rem;
}

.nm-conn-form__label-nowrap {
  white-space: nowrap;
}
</style>
