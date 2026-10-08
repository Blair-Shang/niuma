<script setup lang="ts">
import { RsButton } from '@niuma/ui'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiHttpCookie } from '@/api/types/api-http'
import { clearApiCookies, loadApiCookies, removeApiCookie } from '../utils/cookie-jar'

const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const cookies = ref<ApiHttpCookie[]>([])

function reload(): void {
  cookies.value = loadApiCookies()
}

function remove(item: ApiHttpCookie): void {
  removeApiCookie(item.name, item.domain, item.path)
  reload()
}

function clearAll(): void {
  clearApiCookies()
  reload()
}

onMounted(reload)
</script>

<template>
  <section class="nm-api-cookies">
    <header class="nm-api-cookies__bar">
      <span>{{ t('modules.api.cookies') }}</span>
      <RsButton variant="ghost" size="sm" radius="sm" :disabled="cookies.length === 0" @click="clearAll">
        {{ t('modules.api.clearCookies') }}
      </RsButton>
      <RsButton variant="ghost" size="sm" radius="sm" icon="x" icon-only :aria-label="t('common.close')" @click="emit('close')" />
    </header>
    <p v-if="cookies.length === 0" class="nm-api-cookies__empty">{{ t('modules.api.noCookies') }}</p>
    <ul v-else class="nm-api-cookies__list">
      <li v-for="item in cookies" :key="`${item.domain}|${item.path}|${item.name}`">
        <div class="nm-api-cookies__meta">
          <strong>{{ item.name }}</strong>
          <span>{{ item.domain }}{{ item.path }}</span>
        </div>
        <code>{{ item.value }}</code>
        <RsButton variant="ghost" size="sm" radius="sm" icon="x" icon-only :aria-label="t('common.close')" @click="remove(item)" />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.nm-api-cookies {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-api-cookies__bar {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-height: 2rem;
  padding: 0 var(--rs-space-sm) 0 var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  font-size: var(--rs-font-size-xs);
  font-weight: var(--rs-font-weight-medium);
}

.nm-api-cookies__bar span {
  margin-inline-end: auto;
}

.nm-api-cookies__empty {
  margin: 0;
  padding: var(--rs-space-md);
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}

.nm-api-cookies__list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
}

.nm-api-cookies__list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0 var(--rs-space-sm);
  align-items: center;
  padding: var(--rs-space-sm) var(--rs-space-sm) var(--rs-space-sm) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-api-cookies__meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: var(--rs-font-size-xs);
}

.nm-api-cookies__meta span,
.nm-api-cookies__list code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}

.nm-api-cookies__list code {
  grid-column: 1;
  font-family: var(--rs-font-mono);
}
</style>
