<script setup lang="ts">
import { useRsToast, RsLoading } from '@niuma/ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fileEditorApi, windowApi } from '@/api'
import { subscribeBridgeEvent } from '@/api/event-bus'
import type { FileOpenSpec } from '@/api/types/file-editor'
import FileEditorPane from '@/modules/file-editor/components/FileEditorPane.vue'
import FileEditorStatusBar from '@/modules/file-editor/components/FileEditorStatusBar.vue'
import FileEditorTabBar from '@/modules/file-editor/components/FileEditorTabBar.vue'
import FileEditorToolbar from '@/modules/file-editor/components/FileEditorToolbar.vue'
import { useFileEditorStore } from '@/modules/file-editor/stores/file-editor'
import { prewarmCodeEditor } from '@/modules/file-editor/utils/prewarm-editor'
import { detectLanguageFromPath } from '@/modules/file-editor/utils/detectLanguage'
import AuxiliaryTitleBar from '@/shell/widgets/AuxiliaryTitleBar.vue'
import FramelessResizeEdges from '@/shell/widgets/FramelessResizeEdges.vue'
import { useBridgeStore } from '@/stores/bridge'
import { useWindowChromeStore } from '@/stores/window-chrome'

const { t } = useI18n()
const toast = useRsToast()
const store = useFileEditorStore()
const chrome = useWindowChromeStore()
const bridgeStore = useBridgeStore()

const activeDocument = computed(() => store.activeDocument)

/** 标题栏居中标题：当前文件优先，否则显示模块名 */
const windowTitle = computed(() => {
  if (activeDocument.value?.label) {
    return activeDocument.value.label
  }
  return t('fileEditor.title')
})

watch(
  windowTitle,
  (title) => {
    if (typeof document !== 'undefined') {
      document.title = title
    }
    void windowApi.setTitle({ title }).catch(() => {})
  },
  { immediate: true },
)

let unsubEvent: (() => void) | null = null

/** 窗口已显示、Platform 注册与 Tab 加载完成前为 true */
const bootstrapping = ref(true)
const editorEnabled = ref(false)

function pathFromSpec(spec: FileOpenSpec): string {
  const path = spec.context.path
  return typeof path === 'string' ? path : ''
}

/** 解析 Platform 推送的 fileEditor.tab.open 事件 */
function handleBridgeEvent(detail: unknown): void {
  if (typeof detail !== 'object' || detail === null) {
    return
  }
  const d = detail as { type?: string; spec?: FileOpenSpec }
  if (d.type !== 'fileEditor.tab.open' || !d.spec) {
    return
  }
  void store.openTab(d.spec)
}

/** 关闭 Tab；dirty 时确认 */
async function onCloseTab(docId: string): Promise<void> {
  const doc = store.documents.find((d) => d.docId === docId)
  if (!doc) {
    return
  }
  if (doc.content !== doc.savedContent) {
    const ok = window.confirm(t('fileEditor.unsavedWarning'))
    if (!ok) {
      return
    }
  }
  store.closeTab(docId)
  if (store.documents.length === 0) {
    await windowApi.close()
  }
}

async function onSave(): Promise<void> {
  const ok = await store.saveDocument()
  if (ok) {
    toast.success(t('fileEditor.saved'))
  } else if (store.activeDocument?.error) {
    toast.error(store.activeDocument.error)
  }
}

function onToggleReadonly(): void {
  const doc = store.activeDocument
  if (!doc) {
    return
  }
  store.setReadonly(doc.docId, !doc.readonly)
}

function onContentUpdate(content: string): void {
  const doc = store.activeDocument
  if (doc) {
    store.updateContent(doc.docId, content)
  }
}

function onKeydown(e: KeyboardEvent): void {
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void onSave()
    return
  }
  if (mod && e.key.toLowerCase() === 'w') {
    e.preventDefault()
    if (store.activeDocId) {
      void onCloseTab(store.activeDocId)
    }
  }
}

/** 工作台挂载：注册窗口、消费 pending 队列、订阅跨窗口 Tab 事件（不阻塞窗口 reveal） */
async function bootstrapWorkbench(): Promise<void> {
  bootstrapping.value = true
  try {
    unsubEvent = subscribeBridgeEvent(handleBridgeEvent)
    void bridgeStore.bootstrap().catch(() => {})

    const state = await windowApi.getState()
    const windowId = state.id ?? 0

    const reg =
      windowId > 0
        ? await fileEditorApi.registerWindow({ windowId })
        : { pending: [] as FileOpenSpec[] }

    const firstPath = reg.pending.length > 0 ? pathFromSpec(reg.pending[0]) : ''
    if (firstPath) {
      void prewarmCodeEditor(detectLanguageFromPath(firstPath)).catch(() => {})
    }
    for (const spec of reg.pending) {
      void store.openTab(spec)
    }

    editorEnabled.value = true
    void chrome.bootstrap().catch(() => {})
  } catch {
    editorEnabled.value = true
    void chrome.bootstrap().catch(() => {})
  } finally {
    bootstrapping.value = false
  }
}

onMounted(() => {
  void bootstrapWorkbench()
  globalThis.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  globalThis.removeEventListener('keydown', onKeydown)
  unsubEvent?.()
  void fileEditorApi.unregisterWindow()
})
</script>

<template>
  <div class="nm-file-workbench">
    <AuxiliaryTitleBar :title="windowTitle" />
    <FramelessResizeEdges v-if="chrome.frameless" />
    <div class="nm-aux-tabstrip">
      <FileEditorTabBar
        :documents="store.documents"
        :active-doc-id="store.activeDocId"
        @activate="store.activateTab"
        @close="(id) => void onCloseTab(id)"
      />
    </div>

    <FileEditorToolbar
      :document="activeDocument"
      @save="onSave"
      @toggle-readonly="onToggleReadonly"
    />

    <main class="nm-file-workbench__main">
      <RsLoading v-if="bootstrapping" class="nm-file-workbench__loading" />
      <FileEditorPane
        v-else
        :document="activeDocument"
        :editor-enabled="editorEnabled"
        @update:content="onContentUpdate"
      />
    </main>

    <FileEditorStatusBar :document="activeDocument" />
  </div>
</template>

<style scoped>
.nm-file-workbench {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--rs-surface);
  color: var(--rs-text);
  overflow: hidden;
}

.nm-file-workbench__main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-file-workbench__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--rs-surface);
}
</style>
