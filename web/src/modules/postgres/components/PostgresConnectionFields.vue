<script setup lang="ts">
import { RsInput, RsLabel, RsTooltip } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import { DEFAULT_POSTGRES_OPTIONS } from '@/api/types/postgres'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

defineProps<{
  form: ConnectionFormState
}>()

const { t } = useI18n()
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.postgres.form.databaseHint')" side="top" align="start">
        <RsLabel>{{ t('modules.postgres.form.database') }}</RsLabel>
      </RsTooltip>
      <RsInput
        v-model="form.pgDatabase"
        autocomplete="off"
        :placeholder="DEFAULT_POSTGRES_OPTIONS.database"
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
