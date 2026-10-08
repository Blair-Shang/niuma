<script setup lang="ts">
/**
 * 一轮里的工具卡片列表。挂在助手回复或尚未回复的用户消息下。
 */
import { defineAsyncComponent } from 'vue'
import type { AiLiveToolInvocation } from '@/api/types/ai'
import { useAiStore } from '@/stores/ai'

const AiToolCallCard = defineAsyncComponent(() => import('./AiToolCallCard.vue'))

defineProps<{
  tools: AiLiveToolInvocation[]
}>()

const aiStore = useAiStore()
</script>

<template>
  <div v-if="tools.length" class="nm-ai-tools">
    <AiToolCallCard
      v-for="tool in tools"
      :key="tool.invocationId"
      :name="tool.toolName"
      :status="tool.status"
      :args-summary="tool.argsSummary"
      :result-summary="tool.resultSummary"
      :error="tool.error"
      :risk="tool.risk"
      :confirmable="tool.status === 'pending'"
      @approve="(scope) => aiStore.confirmTool(tool.invocationId, 'approve', scope)"
      @reject="aiStore.confirmTool(tool.invocationId, 'reject')"
    />
  </div>
</template>

<style scoped>
.nm-ai-tools {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  max-width: 100%;
}

.nm-ai-tools :deep(.nm-ai-tool) {
  margin: 0;
}
</style>
