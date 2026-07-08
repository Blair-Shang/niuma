<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { RsContainer, RsLabel, RsSelect, useRsConfig } from '@ruoshui/ui'
import { playgroundRoutes } from '../routes'

const { theme, locale, setTheme, setLocale, t } = useRsConfig()

const themeModel = ref(theme.value)
const localeModel = ref(locale.value)

const themeOptions = computed(() => [
  { label: t('playground.theme.dark'), value: 'dark' },
  { label: t('playground.theme.light'), value: 'light' },
])

const localeOptions = [
  { label: '简体中文', value: 'zh-CN' },
  { label: 'English', value: 'en-US' },
]

const componentRoutes = computed(() =>
  playgroundRoutes.filter((route) => !['/theme', '/studio-components'].includes(route.path)),
)

const labRoutes = computed(() =>
  playgroundRoutes.filter((route) => ['/theme', '/studio-components'].includes(route.path)),
)

watch(themeModel, (value) => setTheme(value as 'dark' | 'light'))
watch(localeModel, (value) => setLocale(value as 'zh-CN' | 'en-US'))
watch(theme, (value) => {
  themeModel.value = value
})
watch(locale, (value) => {
  localeModel.value = value
})
</script>

<template>
  <div class="pg-shell">
    <header class="pg-shell__header">
      <div class="pg-shell__brand">
        <span class="pg-shell__brand-name">{{ t('playground.brand') }}</span>
        <span class="pg-shell__brand-sub">{{ t('playground.subtitle') }}</span>
      </div>
      <div class="pg-shell__toolbar">
        <div class="pg-shell__control">
          <RsLabel class="pg-shell__control-label">{{ t('playground.theme.label') }}</RsLabel>
          <RsSelect v-model="themeModel" :options="themeOptions" size="sm" />
        </div>
        <div class="pg-shell__control">
          <RsLabel class="pg-shell__control-label">{{ t('playground.locale.label') }}</RsLabel>
          <RsSelect v-model="localeModel" :options="localeOptions" size="sm" />
        </div>
      </div>
    </header>

    <div class="pg-shell__body">
      <aside class="pg-shell__aside">
        <nav class="pg-shell__nav" :aria-label="t('playground.nav.label')">
          <section class="pg-shell__group">
            <h2 class="pg-shell__group-title">{{ t('playground.nav.start') }}</h2>
            <RouterLink to="/" class="pg-shell__link" active-class="pg-shell__link--active">
              {{ t('playground.nav.overview') }}
            </RouterLink>
          </section>

          <section class="pg-shell__group">
            <h2 class="pg-shell__group-title">{{ t('playground.nav.components') }}</h2>
            <RouterLink
              v-for="route in componentRoutes"
              :key="route.path"
              :to="route.path"
              class="pg-shell__link"
              active-class="pg-shell__link--active"
            >
              {{ route.title }}
            </RouterLink>
          </section>

          <section class="pg-shell__group">
            <h2 class="pg-shell__group-title">{{ t('playground.nav.lab') }}</h2>
            <RouterLink
              v-for="route in labRoutes"
              :key="route.path"
              :to="route.path"
              class="pg-shell__link"
              active-class="pg-shell__link--active"
            >
              {{ route.title }}
            </RouterLink>
          </section>
        </nav>
      </aside>

      <main class="pg-shell__main">
        <RsContainer max-width="xl" padding="lg" :centered="true">
          <RouterView />
        </RsContainer>
      </main>
    </div>
  </div>
</template>

<style scoped>
.pg-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 100vh;
  overflow: hidden;
  background: var(--rs-bg);
  color: var(--rs-text);
}

.pg-shell__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-lg);
  flex-shrink: 0;
  padding: var(--rs-space-md) var(--rs-space-xl);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
}

.pg-shell__brand {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
  min-width: 0;
}

.pg-shell__brand-name {
  font-size: var(--rs-font-size-base);
  font-weight: 600;
  line-height: var(--rs-line-height-tight);
  letter-spacing: -0.01em;
  color: var(--rs-text);
}

.pg-shell__brand-sub {
  font-size: var(--rs-font-size-xs);
  line-height: var(--rs-line-height-normal);
  color: var(--rs-muted);
}

.pg-shell__toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--rs-space-md);
}

.pg-shell__control {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
}

.pg-shell__control-label {
  flex-direction: row;
  align-items: center;
  white-space: nowrap;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.pg-shell__control-label :deep(.rs-label__text) {
  font-size: inherit;
}

.pg-shell__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.pg-shell__aside {
  width: 17rem;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
}

.pg-shell__nav {
  flex: 1;
  overflow-y: auto;
  padding: var(--rs-space-sm);
}

.pg-shell__group + .pg-shell__group {
  margin-top: var(--rs-space-md);
}

.pg-shell__group-title {
  margin: 0;
  padding: var(--rs-space-xs) var(--rs-space-sm);
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: var(--rs-line-height-normal);
  color: var(--rs-muted);
}

.pg-shell__link {
  display: flex;
  align-items: center;
  min-height: var(--rs-control-height-md);
  padding: 0 var(--rs-space-sm);
  border: 1px solid transparent;
  border-radius: var(--rs-radius-sm);
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
  line-height: var(--rs-line-height-normal);
  text-decoration: none;
  transition:
    background var(--rs-transition-fast),
    border-color var(--rs-transition-fast),
    color var(--rs-transition-fast);
}

.pg-shell__link:hover {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.pg-shell__link--active {
  background: color-mix(in srgb, var(--rs-primary) 12%, transparent);
  color: var(--rs-primary);
  font-weight: 500;
}

.pg-shell__link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}

.pg-shell__main {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: var(--rs-bg);
  padding-block: var(--rs-space-xl);
}

@media (width < 48rem) {
  .pg-shell__header {
    flex-direction: column;
    align-items: stretch;
  }

  .pg-shell__toolbar {
    justify-content: stretch;
  }

  .pg-shell__control {
    flex: 1;
    min-width: 0;
  }

  .pg-shell__aside {
    width: 14rem;
  }
}
</style>
