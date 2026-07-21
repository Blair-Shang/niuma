<script setup lang="ts">
import { RsInput, RsLabel, RsTooltip } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

/** MySQL「基础信息」专属字段：初始数据库（对齐 Navicat General）。 */
defineProps<{
  form: ConnectionFormState
}>()

const { t } = useI18n()
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.mysql.form.databaseHint')" side="top" align="start">
        <RsLabel>{{ t('modules.mysql.form.database') }}</RsLabel>
      </RsTooltip>
      <RsInput
        v-model="form.mysqlDatabase"
        autocomplete="off"
        :placeholder="t('modules.mysql.form.databasePlaceholder')"
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
</style>
