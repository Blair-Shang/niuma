<script setup lang="ts">
import TopBar from './bars/TopBar.vue'
import ActivityBar from './bars/ActivityBar.vue'
import SideNav from './panels/SideNav.vue'
import StatusBar from './bars/StatusBar.vue'
import BottomDock from './panels/BottomDock.vue'
import DataTaskHost from '@/shell/data-tasks/DataTaskHost.vue'
import ModuleWorkspace from './workspace/ModuleWorkspace.vue'
import AiPanel from './panels/AiPanel.vue'
import AccountHost from '@/shell/account/AccountHost.vue'
import UpdateHost from '@/shell/account/UpdateHost.vue'
import HelpHost from '@/shell/account/HelpHost.vue'
import FramelessResizeEdges from '@/shell/widgets/FramelessResizeEdges.vue'
import { useAccountStore } from '@/stores/account'
import { useAppUpdateStore } from '@/stores/app-update'
import { RsSplitPane } from '@niuma/ui'
import type { RsSplitPaneItem } from '@niuma/ui'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useCommandPaletteStore } from '@/stores/command-palette'
import { useShellStore } from '@/stores/shell'
import { useTabStore } from '@/stores/tab'
import { useWindowChromeStore } from '@/stores/window-chrome'

const paletteStore = useCommandPaletteStore()
const windowChrome = useWindowChromeStore()
const shellStore = useShellStore()
const accountStore = useAccountStore()
const appUpdateStore = useAppUpdateStore()

/** 仅取 defineExpose 表面，避免 InstanceType<typeof RsSplitPane> 触发 TS 递归过深 */
type RsSplitPaneExpose = {
  collapse: (key: string) => void
  expand: (key: string, toSize?: number) => void
}
const splitRef = ref<RsSplitPaneExpose | null>(null)

/** 默认 AI 面板占比（展开时） */
const AI_PANEL_SIZE = 26

const splitPanes = computed<RsSplitPaneItem[]>(() => [
  {
    key: 'sidebar',
    size: 18,
    min: 8,
    max: 40,
    collapsible: true,
    collapsedSize: 0,
  },
  {
    key: 'editor',
    min: 30,
    resizerHandle: false,
  },
  {
    key: 'ai',
    size: AI_PANEL_SIZE,
    min: 16,
    max: 45,
    collapsible: true,
    collapsedSize: 0,
  },
])

/** sidebarVisible 变化时用程序化 API 折叠/展开侧栏 */
watch(
  () => shellStore.sidebarVisible,
  (visible) => {
    if (visible) {
      splitRef.value?.expand('sidebar')
    } else {
      splitRef.value?.collapse('sidebar')
    }
  },
  { flush: 'post' },
)

/** aiPanelOpen 变化时折叠/展开右侧 AI 面板（Cursor 式可拖拽分割） */
watch(
  () => shellStore.aiPanelOpen,
  (open) => {
    if (open) {
      splitRef.value?.expand('ai', AI_PANEL_SIZE)
    } else {
      splitRef.value?.collapse('ai')
    }
  },
  { flush: 'post' },
)

function onSplitCollapse(key: string): void {
  if (key === 'sidebar') shellStore.sidebarVisible = false
  if (key === 'ai') shellStore.setAiPanelOpen(false)
}

function onSplitExpand(key: string): void {
  if (key === 'sidebar') shellStore.sidebarVisible = true
  if (key === 'ai') shellStore.setAiPanelOpen(true)
}

function onGlobalKeydown(event: KeyboardEvent): void {
  const mod = event.ctrlKey || event.metaKey
  if (mod && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    paletteStore.toggle()
  }
  if (mod && event.key.toLowerCase() === 'b') {
    event.preventDefault()
    shellStore.sidebarVisible = !shellStore.sidebarVisible
  }
  if (mod && event.key.toLowerCase() === 'i') {
    event.preventDefault()
    shellStore.toggleAiPanel()
  }
  if (mod && event.key === '\\') {
    event.preventDefault()
    useTabStore().splitGroup()
  }
}

onMounted(() => {
  globalThis.addEventListener('keydown', onGlobalKeydown)
  void windowChrome.bootstrap()
  void accountStore.bootstrap()
  appUpdateStore.scheduleStartupCheck(10_000)
  void nextTick(() => {
    if (!shellStore.aiPanelOpen) {
      splitRef.value?.collapse('ai')
    }
  })
})

onUnmounted(() => {
  globalThis.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <div class="nm-app flex h-full min-h-0 flex-col overflow-hidden">
    <FramelessResizeEdges v-if="windowChrome.frameless" />
    <TopBar />
    <div class="nm-app__body flex min-h-0 flex-1">
      <ActivityBar />
      <RsSplitPane
        ref="splitRef"
        class="nm-body-split flex-1 min-w-0"
        :panes="splitPanes"
        with-handle
        @collapse="onSplitCollapse"
        @expand="onSplitExpand"
      >
        <template #sidebar>
          <SideNav />
        </template>
        <template #editor>
          <div class="nm-editor h-full flex flex-col min-w-0 min-h-0">
            <ModuleWorkspace />
          </div>
        </template>
        <template #ai>
          <AiPanel />
        </template>
      </RsSplitPane>
    </div>
    <BottomDock />
    <DataTaskHost />
    <AccountHost />
    <UpdateHost />
    <HelpHost />
    <StatusBar />
  </div>
</template>

<style scoped>
.nm-app__body {
  min-height: 0;
}

.nm-app {
  position: relative;
}

.nm-body-split {
  min-height: 0;
}

.nm-editor {
  min-height: 0;
  background: var(--nm-editor-bg);
}
</style>
