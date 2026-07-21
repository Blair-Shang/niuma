<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useDataTaskHubStore } from '@/stores/data-task-hub'
import DataTaskView from './DataTaskView.vue'

/**
 * 全局唯一挂载：每个 taskId 只保留一个视图实例。
 * 切换 dock/float 只改 presentation，避免卸挂导致表单状态丢失。
 */
const hub = useDataTaskHubStore()
const { tasks, activeId } = storeToRefs(hub)

const items = computed(() =>
  tasks.value.map((task) => ({
    id: task.id,
    presentation: (task.surface === 'float' ? 'float' : 'inline') as 'float' | 'inline',
    activeInDock: task.surface === 'dock' && task.id === activeId.value,
  })),
)
</script>

<template>
  <DataTaskView
    v-for="item in items"
    :key="item.id"
    :task-id="item.id"
    :presentation="item.presentation"
    :active-in-dock="item.activeInDock"
  />
</template>
