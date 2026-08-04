<script setup lang="ts">
import { RsInput, RsLabel, RsSelect } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

defineProps<{ form: ConnectionFormState }>()
const { t } = useI18n()

const authTypeOptions = computed(() => [
  { value: 'sql', label: t('modules.sqlserver.form.authTypeSql') },
])

const encryptOptions = computed(() => [
  { value: 'optional', label: t('modules.sqlserver.form.encryptOptional') },
  { value: 'disable', label: t('modules.sqlserver.form.encryptDisable') },
  { value: 'mandatory', label: t('modules.sqlserver.form.encryptMandatory') },
  { value: 'strict', label: t('modules.sqlserver.form.encryptStrict') },
])
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.sqlserver.form.database') }}</RsLabel>
      <RsInput
        v-model="form.ssDatabase"
        autocomplete="off"
        :placeholder="t('modules.sqlserver.form.databasePlaceholder')"
      />
    </div>
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.sqlserver.form.instance') }}</RsLabel>
      <RsInput
        v-model="form.ssInstance"
        autocomplete="off"
        :placeholder="t('modules.sqlserver.form.instancePlaceholder')"
      />
    </div>
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.sqlserver.form.authType') }}</RsLabel>
      <RsSelect v-model="form.ssAuthType" :options="authTypeOptions" />
    </div>
    <div class="nm-conn-form__field">
      <RsLabel>{{ t('modules.sqlserver.form.encrypt') }}</RsLabel>
      <RsSelect v-model="form.ssEncrypt" :options="encryptOptions" />
    </div>
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
</style>
