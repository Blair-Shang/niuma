<script setup lang="ts">
import { RsInput, RsLabel, RsSelect } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { syncProxyPortForType } from '@/modules/connection/proxy-form'
import type { ConnectionFormMode, ProxyFormState } from '@/modules/connection/types'

const props = defineProps<{
  form: ProxyFormState
  mode: ConnectionFormMode
}>()

const { t } = useI18n()

const proxyTypeOptions = computed<RsSelectOptions>(() => [
  { value: 'none', label: t('connection.form.proxyNone') },
  { value: 'http', label: 'HTTP' },
  { value: 'socks5', label: 'SOCKS5' },
])

const proxyEnabled = computed(() => props.form.proxyType !== 'none')

watch(
  () => props.form.proxyType,
  (type) => {
    syncProxyPortForType(props.form, type)
  },
)
</script>

<template>
  <div class="nm-conn-proxy">
    <p class="nm-conn-proxy__hint">{{ t('connection.form.proxyHint') }}</p>
    <section class="nm-conn-proxy__section">
      <div class="nm-conn-proxy__field">
        <RsLabel>{{ t('connection.form.proxyType') }}</RsLabel>
        <RsSelect v-model="form.proxyType" :options="proxyTypeOptions" />
      </div>
    </section>
    <section v-if="proxyEnabled" class="nm-conn-proxy__section">
      <div class="nm-conn-proxy__row">
        <div class="nm-conn-proxy__field nm-conn-proxy__field--grow">
          <RsLabel required>{{ t('connection.form.proxyHost') }}</RsLabel>
          <RsInput v-model="form.proxyHost" placeholder="proxy.example.com" />
        </div>
        <div class="nm-conn-proxy__field nm-conn-proxy__field--port">
          <RsLabel>{{ t('connection.form.proxyPort') }}</RsLabel>
          <RsInput v-model="form.proxyPort" />
        </div>
      </div>
      <div class="nm-conn-proxy__row">
        <div class="nm-conn-proxy__field nm-conn-proxy__field--grow">
          <RsLabel>{{ t('connection.form.proxyUser') }}</RsLabel>
          <RsInput v-model="form.proxyUsername" />
        </div>
        <div class="nm-conn-proxy__field nm-conn-proxy__field--grow">
          <RsLabel>{{ t('connection.form.proxyPassword') }}</RsLabel>
          <RsInput v-model="form.proxyPassword" type="password" />
        </div>
      </div>
      <p v-if="mode === 'edit'" class="nm-conn-proxy__hint">
        {{ t('connection.form.proxyPasswordHint') }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.nm-conn-proxy {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
}

.nm-conn-proxy__section {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}

.nm-conn-proxy__row {
  display: flex;
  gap: var(--rs-space-md);
}

.nm-conn-proxy__field {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}

.nm-conn-proxy__field--grow {
  flex: 1;
  min-width: 0;
}

.nm-conn-proxy__field--port {
  width: 5.5rem;
  flex-shrink: 0;
}

.nm-conn-proxy__hint {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
</style>
