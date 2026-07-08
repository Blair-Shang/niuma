<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

const emit = defineEmits<{
  mount: []
  unmount: []
}>()

onMounted(() => emit('mount'))
onUnmounted(() => emit('unmount'))
</script>

<template>
  <span class="mount-probe" data-mount-probe />
</template>

<style scoped>
.mount-probe {
  display: none;
}
</style>
