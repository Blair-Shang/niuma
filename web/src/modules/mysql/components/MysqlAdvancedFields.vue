<script setup lang="ts">
import { RsLabel, RsSelect, RsTooltip } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_MYSQL_OPTIONS } from '@/api/types/mysql'
import { ConnectionTimeoutFields } from '@/modules/connection'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'
import {
  MYSQL_CHARSET_VALUES,
  collationsForCharset,
  normalizeMysqlCollation,
} from '@/modules/mysql/mysql-charset'

/**
 * MySQL「高级」Tab：客户端字符集 / 排序规则 / 系统库 / 超时 / 认证兼容
 *（对齐 Navicat Advanced、DBeaver Driver properties）。
 */
const props = defineProps<{
  form: ConnectionFormState
}>()

const { t } = useI18n()

const excludeSystemOptions = computed<RsSelectOptions>(() => [
  { value: 'true', label: t('modules.mysql.form.excludeSystemYes') },
  { value: 'false', label: t('modules.mysql.form.excludeSystemNo') },
])

const allowNativeOptions = computed<RsSelectOptions>(() => [
  { value: 'true', label: t('modules.mysql.form.allowNativeYes') },
  { value: 'false', label: t('modules.mysql.form.allowNativeNo') },
])

const charsetOptions = computed<RsSelectOptions>(() => {
  const cur = String(props.form.mysqlCharset ?? '').trim()
  const known = new Set<string>(MYSQL_CHARSET_VALUES)
  const base = MYSQL_CHARSET_VALUES.map((v) => ({ value: v, label: v }))
  if (cur && !known.has(cur)) {
    return [{ value: cur, label: cur }, ...base]
  }
  return base
})

const collationOptions = computed<RsSelectOptions>(() => {
  const charset = String(props.form.mysqlCharset ?? '').trim() || DEFAULT_MYSQL_OPTIONS.charset
  const known = collationsForCharset(charset)
  const cur = String(props.form.mysqlCollation ?? '').trim()
  const base = known.map((v) => ({ value: v, label: v }))
  if (cur && !known.includes(cur)) {
    return [{ value: cur, label: cur }, ...base]
  }
  return base
})

watch(
  () => String(props.form.mysqlCharset ?? ''),
  (charset) => {
    const next = normalizeMysqlCollation(charset, String(props.form.mysqlCollation ?? ''))
    if (next !== String(props.form.mysqlCollation ?? '').trim()) {
      props.form.mysqlCollation = next
    }
  },
)
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsTooltip icon :content="t('modules.mysql.form.charsetHint')" side="top" align="start">
          <RsLabel>{{ t('modules.mysql.form.charset') }}</RsLabel>
        </RsTooltip>
        <RsSelect v-model="form.mysqlCharset" :options="charsetOptions" />
      </div>
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsTooltip icon :content="t('modules.mysql.form.collationHint')" side="top" align="start">
          <RsLabel>{{ t('modules.mysql.form.collation') }}</RsLabel>
        </RsTooltip>
        <RsSelect
          v-model="form.mysqlCollation"
          clearable
          :options="collationOptions"
          :placeholder="t('modules.mysql.form.collationDefault')"
        />
      </div>
    </div>

    <div class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsTooltip icon :content="t('modules.mysql.form.excludeSystemHint')" side="top" align="start">
          <RsLabel>{{ t('modules.mysql.form.excludeSystem') }}</RsLabel>
        </RsTooltip>
        <RsSelect v-model="form.mysqlExcludeSystemSchemas" :options="excludeSystemOptions" />
      </div>
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsTooltip icon :content="t('modules.mysql.form.allowNativeHint')" side="top" align="start">
          <RsLabel>{{ t('modules.mysql.form.allowNative') }}</RsLabel>
        </RsTooltip>
        <RsSelect v-model="form.mysqlAllowNativePasswords" :options="allowNativeOptions" />
      </div>
    </div>

    <ConnectionTimeoutFields
      :form="form"
      :default-seconds="DEFAULT_MYSQL_OPTIONS.connect_timeout_seconds"
    />
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
</style>
