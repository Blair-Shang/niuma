<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { activatePluginEntry } from '@/extensions/bootstrap/activate-plugin-entry'
import { resolvePluginAssetUrl } from '@/extensions/types/local-plugin'
import type { ExtensionManifest } from '@/extensions/types/manifest'

/** 插件 entry.js 可导出的元信息 */
interface PluginEntryMeta {
  title?: string
  description?: string
}

/**
 * 挂载信息来源二选一：
 *  - Tab 工作区渲染时经 props 传入（多实例场景）；
 *  - 直接经路由渲染时回退到 route.meta。
 */
const props = defineProps<{
  pluginRoot?: string
  pluginUiEntry?: string
  moduleId?: string
}>()

const route = useRoute()
const { t } = useI18n()

const loading = ref(true)
const error = ref<string | null>(null)
const meta = ref<PluginEntryMeta>({})

const pluginRoot = computed(() => String(props.pluginRoot ?? route.meta.pluginRoot ?? ''))
const pluginUiEntry = computed(() =>
  String(props.pluginUiEntry ?? route.meta.pluginUiEntry ?? ''),
)
const moduleId = computed(() => String(props.moduleId ?? route.meta.moduleId ?? ''))

/** 动态加载插件 ESM 入口并调用 activate（P1：静态 entry.js）。 */
onMounted(async () => {
  if (!pluginRoot.value || !pluginUiEntry.value) {
    error.value = 'Missing pluginRoot or pluginUiEntry in route meta'
    loading.value = false
    return
  }

  try {
    const url = resolvePluginAssetUrl(pluginRoot.value, pluginUiEntry.value)
    const mod = (await import(/* @vite-ignore */ url)) as {
      pluginMeta?: PluginEntryMeta
      default?: PluginEntryMeta
    }

    if (mod.pluginMeta) {
      meta.value = mod.pluginMeta
    } else if (mod.default && typeof mod.default === 'object') {
      meta.value = mod.default
    }

    const manifest: ExtensionManifest = {
      id: moduleId.value,
      module: { uiEntry: pluginUiEntry.value } as ExtensionManifest['module'],
    } as ExtensionManifest
    await activatePluginEntry(pluginRoot.value, manifest)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="nm-module-root nm-module-empty">
    <h2 class="nm-section-title">
      {{ meta.title ?? moduleId }}
    </h2>

    <p v-if="loading" class="nm-section-desc">{{ t('extensions.loading') }}</p>
    <p v-else-if="error" class="nm-section-desc" style="color: var(--rs-danger)">
      {{ error }}
    </p>
    <template v-else>
      <p class="nm-section-desc">
        {{ meta.description ?? t('extensions.placeholder') }}
      </p>
      <p class="nm-caption">{{ t('extensions.root') }}: {{ pluginRoot }}</p>
    </template>
  </div>
</template>
