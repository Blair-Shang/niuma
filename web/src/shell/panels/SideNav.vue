<script setup lang="ts">
/**
 * SideNav — Shell 布局侧栏：按 Activity 领域切换视图，不含连接 CRUD 业务。
 */
import { watch } from 'vue'
import { useRoute } from 'vue-router'
import OpsConnectionPanel from '@/modules/ops/components/OpsConnectionPanel.vue'
import { useShellStore } from '@/stores/shell'

const shellStore = useShellStore()
const route = useRoute()

watch(
  () => route.path,
  (path) => shellStore.syncFromRoute(path),
  { immediate: true },
)
</script>

<template>
  <div class="nm-sidenav">
    <OpsConnectionPanel :category="shellStore.activeCategory" />
  </div>
</template>

<style scoped>
.nm-sidenav {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--nm-sidebar-bg);
  overflow: hidden;
}
</style>
