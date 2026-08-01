<script setup lang="ts">
/**
 * 全局 AI 助手面板容器 — 只负责装配与 bootstrap，不处理具体渲染逻辑。
 *
 * 子组件见 `./ai/`：Header / MessageList / Composer。
 */
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAiStore } from '@/stores/ai'
import AiComposer from './ai/AiComposer.vue'
import AiMessageList from './ai/AiMessageList.vue'
import AiPanelHeader from './ai/AiPanelHeader.vue'

const { t } = useI18n()
const aiStore = useAiStore()

onMounted(() => {
  aiStore.bootstrap()
})
</script>

<template>
  <aside class="nm-ai-panel" :aria-label="t('ai.title')">
    <AiPanelHeader />
    <AiMessageList />
    <AiComposer />
  </aside>
</template>

<style scoped>
.nm-ai-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--nm-editor-bg);
  /* 原生滚动条随主题（Firefox 继承；WebKit 见下方 :deep） */
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--rs-muted) 60%, transparent) transparent;
}

.nm-ai-panel :deep(*::-webkit-scrollbar) {
  width: var(--rs-scrollbar-size);
  height: var(--rs-scrollbar-size);
}

.nm-ai-panel :deep(*::-webkit-scrollbar-track) {
  background: transparent;
}

.nm-ai-panel :deep(*::-webkit-scrollbar-thumb) {
  border: var(--rs-scrollbar-padding) solid transparent;
  border-radius: var(--rs-radius-full);
  background: color-mix(in srgb, var(--rs-muted) 60%, transparent);
  background-clip: padding-box;
}

.nm-ai-panel :deep(*::-webkit-scrollbar-thumb:hover) {
  background: color-mix(in srgb, var(--rs-primary) 40%, var(--rs-muted));
  background-clip: padding-box;
}

.nm-ai-panel :deep(*::-webkit-scrollbar-corner) {
  background: transparent;
}
</style>
