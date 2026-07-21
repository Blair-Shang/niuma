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
}
</style>
