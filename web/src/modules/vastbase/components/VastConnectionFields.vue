<script setup lang="ts">
import { RsInput, RsLabel, RsTooltip } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import { DEFAULT_VAST_OPTIONS } from '@/api/types/vastbase'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

/** Vastbase「基础信息」专属字段：初始数据库（对齐 Navicat General）。 */
defineProps<{
  form: ConnectionFormState
}>()

const { t } = useI18n()
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.vastbase.form.databaseHint')" side="top" align="start">
        <RsLabel>{{ t('modules.vastbase.form.database') }}</RsLabel>
      </RsTooltip>
      <RsInput
        v-model="form.vastDatabase"
        autocomplete="off"
        :placeholder="DEFAULT_VAST_OPTIONS.database"
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
