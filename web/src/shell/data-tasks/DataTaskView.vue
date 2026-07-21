<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useDataTaskHubStore } from '@/stores/data-task-hub'
import {
  resolveDataTaskRenderer,
  type DataTaskPresentation,
} from '@/shell/data-tasks/registry'

const props = defineProps<{
  taskId: string
  presentation: DataTaskPresentation
  /** 是否为 Dock 内当前可见任务（决定 Teleport 目标） */
  activeInDock?: boolean
}>()

const hub = useDataTaskHubStore()
const { tasks } = storeToRefs(hub)

const task = computed(() => tasks.value.find((t) => t.id === props.taskId))
const view = computed(() => (task.value ? resolveDataTaskRenderer(task.value) : null))
</script>

<template>
  <component
    :is="view"
    v-if="view && task"
    :task-id="taskId"
    :presentation="presentation"
    :active-in-dock="activeInDock === true"
  />
</template>
