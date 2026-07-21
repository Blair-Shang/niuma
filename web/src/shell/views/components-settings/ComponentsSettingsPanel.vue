<script setup lang="ts">
import { RsButton, RsEmpty, RsIcon } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import ComponentsBundleDetail from './components/ComponentsBundleDetail.vue'
import ComponentsBundleSidebar from './components/ComponentsBundleSidebar.vue'
import ComponentsLoadingSkeleton from './components/ComponentsLoadingSkeleton.vue'
import ComponentsSettingsToolbar from './components/ComponentsSettingsToolbar.vue'
import { useToolComponents } from './composables/useToolComponents'

const { t } = useI18n()

const {
  bundles,
  loading,
  error,
  busyKey,
  installProgress,
  bundleInstalling,
  selectedBundleId,
  hasBundles,
  selectedBundle,
  bridgeStore,
  selectBundle,
  loadBundles,
  detectBundle,
  browsePath,
  clearPath,
  installBundle,
  openDownload,
} = useToolComponents()

function onBrowse(bundle: Parameters<typeof browsePath>[0], toolId: string): void {
  const tool = bundle.tools.find((entry) => entry.toolId === toolId)
  if (!tool) {
    return
  }
  void browsePath(bundle, tool)
}

defineExpose({ reload: loadBundles })
</script>

<template>
  <section class="nm-settings__panel nm-components">
    <ComponentsSettingsToolbar :loading="loading" @refresh="loadBundles" />

    <div class="nm-components__body">
      <ComponentsLoadingSkeleton v-if="loading" />

      <RsEmpty
        v-else-if="error"
        class="nm-components__state"
        :description="error"
        role="alert"
      >
        <template #icon>
          <RsIcon name="circle-alert" :size="22" />
        </template>
        <RsButton variant="secondary" size="sm" @click="loadBundles">
          {{ t('settings.componentsRefresh') }}
        </RsButton>
      </RsEmpty>

      <RsEmpty
        v-else-if="!bridgeStore.connected"
        class="nm-components__state"
        :description="t('settings.devHint')"
      >
        <template #icon>
          <RsIcon name="plug-zap" :size="22" />
        </template>
      </RsEmpty>

      <RsEmpty
        v-else-if="!hasBundles"
        class="nm-components__state"
        :description="t('settings.componentsEmpty')"
      >
        <template #icon>
          <RsIcon name="package-open" :size="22" />
        </template>
        <RsButton variant="secondary" size="sm" @click="loadBundles">
          {{ t('settings.componentsRefresh') }}
        </RsButton>
      </RsEmpty>

      <div v-else class="nm-components__workspace">
        <ComponentsBundleSidebar
          :bundles="bundles"
          :selected-bundle-id="selectedBundleId"
          @select="selectBundle"
        />
        <ComponentsBundleDetail
          :bundle="selectedBundle"
          :busy-key="busyKey"
          :install-progress="installProgress"
          :install-busy="bundleInstalling"
          @detect="detectBundle"
          @install="installBundle"
          @browse="onBrowse"
          @clear="clearPath"
          @download="openDownload"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.nm-components.nm-settings__panel {
  display: flex;
  flex-direction: column;
  max-width: none;
  width: 100%;
  min-height: 0;
  padding: 0;
}

.nm-components__body {
  flex: 1;
  min-height: 0;
  padding: 0;
}

.nm-components__state {
  min-height: 18rem;
  margin: var(--rs-space-lg) var(--rs-space-xl) var(--rs-space-xl);
}

.nm-components__workspace {
  position: relative;
  display: flex;
  min-height: 22rem;
  overflow: hidden;
  background: var(--rs-surface-elevated);
}

@media (max-width: 48rem) {
  .nm-components__workspace {
    flex-direction: column;
    min-height: auto;
  }
}
</style>
