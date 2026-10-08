<script setup lang="ts">
import { RsButton, RsInput, RsLabel } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { dialogApi } from '@/api'
import type { ApiHttpSettings, ApiRequest } from '../../types'
import { emptyHttpSettings, HTTP_TIMEOUT_DEFAULT_MS, timeoutMsOf } from '../settings/settings'

const props = defineProps<{
  request: ApiRequest
}>()

const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()

function current(): ApiHttpSettings {
  return props.request.settings ?? emptyHttpSettings()
}

function patch(next: Partial<ApiHttpSettings>): void {
  props.request.settings = { ...current(), ...next }
}

const timeoutSec = computed({
  get: () => String(Math.round(timeoutMsOf(props.request.settings) / 1000)),
  set: (value: string) => {
    const seconds = Number(value)
    const ms = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : HTTP_TIMEOUT_DEFAULT_MS
    patch({ timeoutMs: timeoutMsOf({ ...emptyHttpSettings(), timeoutMs: ms }) })
  },
})

const proxy = computed({
  get: () => current().proxy,
  set: (value: string) => patch({ proxy: value }),
})

const certPath = computed({
  get: () => current().certPath,
  set: (value: string) => patch({ certPath: value }),
})

const keyPath = computed({
  get: () => current().keyPath,
  set: (value: string) => patch({ keyPath: value }),
})

async function pick(field: 'certPath' | 'keyPath'): Promise<void> {
  try {
    const picked = await dialogApi.openFile({ title: t('modules.api.pickFile') })
    const path = picked.filePaths[0]
    if (picked.canceled || !path) return
    patch({ [field]: path })
  } catch {
    // 非桌面壳没有文件对话框。
  }
}
</script>

<template>
  <section class="nm-api-settings">
    <header class="nm-api-settings__bar">
      <span>{{ t('modules.api.settings') }}</span>
      <RsButton variant="ghost" size="sm" radius="sm" icon="x" icon-only :aria-label="t('common.close')" @click="emit('close')" />
    </header>
    <div class="nm-api-settings__fields">
      <div class="nm-api-settings__field">
        <RsLabel>{{ t('modules.api.timeoutSec') }}</RsLabel>
        <RsInput v-model="timeoutSec" size="sm" radius="sm" spellcheck="false" />
      </div>
      <div class="nm-api-settings__field">
        <RsLabel>{{ t('modules.api.proxy') }}</RsLabel>
        <RsInput v-model="proxy" size="sm" radius="sm" spellcheck="false" :placeholder="t('modules.api.proxyHint')" />
      </div>
      <div class="nm-api-settings__field">
        <RsLabel>{{ t('modules.api.clientCert') }}</RsLabel>
        <div class="nm-api-settings__file">
          <RsInput v-model="certPath" size="sm" radius="sm" spellcheck="false" />
          <RsButton size="sm" radius="sm" variant="text" @click="pick('certPath')">{{ t('modules.api.pickFile') }}</RsButton>
        </div>
      </div>
      <div class="nm-api-settings__field">
        <RsLabel>{{ t('modules.api.clientKey') }}</RsLabel>
        <div class="nm-api-settings__file">
          <RsInput v-model="keyPath" size="sm" radius="sm" spellcheck="false" />
          <RsButton size="sm" radius="sm" variant="text" @click="pick('keyPath')">{{ t('modules.api.pickFile') }}</RsButton>
        </div>
      </div>
      <p class="nm-api-settings__hint">{{ t('modules.api.settingsHint') }}</p>
    </div>
  </section>
</template>

<style scoped>
.nm-api-settings {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-api-settings__bar {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-height: 2rem;
  padding: 0 var(--rs-space-sm) 0 var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  font-size: var(--rs-font-size-xs);
  font-weight: var(--rs-font-weight-medium);
}

.nm-api-settings__bar span {
  margin-inline-end: auto;
}

.nm-api-settings__fields {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  padding: var(--rs-space-md);
  overflow: auto;
}

.nm-api-settings__field {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}

.nm-api-settings__file {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
}

.nm-api-settings__file :deep(.rs-field) {
  flex: 1;
  min-width: 0;
}

.nm-api-settings__hint {
  margin: 0;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  line-height: var(--rs-line-height-normal);
}
</style>
