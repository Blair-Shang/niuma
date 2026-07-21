<script setup lang="ts">
import { ref } from 'vue'
import ComponentsSettingsPanel from './components-settings/ComponentsSettingsPanel.vue'

const panelRef = ref<InstanceType<typeof ComponentsSettingsPanel> | null>(null)

defineExpose({
  reload: () => panelRef.value?.reload(),
})
</script>

<template>
  <ComponentsSettingsPanel ref="panelRef" />
</template>
