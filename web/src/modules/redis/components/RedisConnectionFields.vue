<script setup lang="ts">
import { RsInput, RsLabel, RsSelect } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_REDIS_OPTIONS } from '@/api/types/redis'
import { ConnectionTimeoutFields } from '@/modules/connection'
import type { ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

/** Redis 专属连接选项字段（供 ConnectionFormDialog #options 插槽使用）。 */
defineProps<{
  form: ConnectionFormState
}>()

const { t } = useI18n()

const topologyOptions = computed<RsSelectOptions>(() => [
  { value: 'standalone', label: t('modules.redis.form.topologyStandalone') },
  { value: 'sentinel', label: t('modules.redis.form.topologySentinel') },
  { value: 'cluster', label: t('modules.redis.form.topologyCluster') },
])
</script>

<template>
  <section class="nm-conn-form__section">
    <div class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsLabel>{{ t('modules.redis.form.topology') }}</RsLabel>
        <RsSelect v-model="form.redisTopology" :options="topologyOptions" />
      </div>
      <div class="nm-conn-form__field nm-conn-form__field--port">
        <RsLabel>{{ t('modules.redis.form.database') }}</RsLabel>
        <RsInput v-model="form.redisDatabase" autocomplete="off" placeholder="0" />
      </div>
    </div>
    <div v-if="form.redisTopology === 'sentinel'" class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsLabel required>{{ t('modules.redis.form.sentinelMasterName') }}</RsLabel>
        <RsInput v-model="form.redisSentinelMasterName" autocomplete="off" placeholder="mymaster" />
      </div>
    </div>
    <div v-if="form.redisTopology !== 'standalone'" class="nm-conn-form__field">
      <RsLabel>{{ t('modules.redis.form.nodes') }}</RsLabel>
      <RsInput
        v-model="form.redisNodes"
        autocomplete="off"
        :placeholder="t('modules.redis.form.nodesPlaceholder')"
      />
      <p class="nm-conn-form__hint">{{ t('modules.redis.form.nodesHint') }}</p>
    </div>
    <ConnectionTimeoutFields :form="form" :default-seconds="DEFAULT_REDIS_OPTIONS.timeout_seconds" />
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

.nm-conn-form__field--port {
  width: 5.5rem;
  flex-shrink: 0;
}

.nm-conn-form__hint {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
</style>
