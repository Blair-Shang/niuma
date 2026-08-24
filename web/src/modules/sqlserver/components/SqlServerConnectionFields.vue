<script setup lang="ts">
import { RsInput, RsLabel, RsSelect, RsTooltip } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

/** SQL Server「基础信息」专属字段：默认库、命名实例、认证方式。 */
const props = defineProps<{
  form: ConnectionFormState
}>()

const { t } = useI18n()

const authOptions = computed<RsSelectOptions>(() => [
  { value: 'sql', label: t('modules.sqlserver.form.authTypeSql') },
  { value: 'windows', label: t('modules.sqlserver.form.authTypeWindows') },
  { value: 'aad_password', label: t('modules.sqlserver.form.authTypeAadPassword') },
  { value: 'aad_integrated', label: t('modules.sqlserver.form.authTypeAadIntegrated') },
  { value: 'aad_msi', label: t('modules.sqlserver.form.authTypeAadMsi') },
  { value: 'aad_service_principal', label: t('modules.sqlserver.form.authTypeAadSp') },
])

const authHint = computed(() => {
  const auth = String(props.form.ssAuthType || 'sql')
  return t(`modules.sqlserver.form.authHint.${auth}`)
})
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.sqlserver.form.databaseHint')" side="top" align="start">
        <RsLabel>{{ t('modules.sqlserver.form.database') }}</RsLabel>
      </RsTooltip>
      <RsInput
        v-model="form.ssDatabase"
        autocomplete="off"
        :placeholder="t('modules.sqlserver.form.databasePlaceholder')"
      />
    </div>

    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.sqlserver.form.instanceHint')" side="top" align="start">
        <RsLabel>{{ t('modules.sqlserver.form.instance') }}</RsLabel>
      </RsTooltip>
      <RsInput
        v-model="form.ssInstance"
        autocomplete="off"
        :placeholder="t('modules.sqlserver.form.instancePlaceholder')"
      />
      <p class="nm-conn-form__hint">{{ t('modules.sqlserver.form.instancePortHint') }}</p>
    </div>

    <div class="nm-conn-form__field">
      <RsTooltip icon :content="t('modules.sqlserver.form.authTypeHint')" side="top" align="start">
        <RsLabel>{{ t('modules.sqlserver.form.authType') }}</RsLabel>
      </RsTooltip>
      <RsSelect v-model="form.ssAuthType" :options="authOptions" />
      <p class="nm-conn-form__hint">{{ authHint }}</p>
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

.nm-conn-form__hint {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
</style>
