<script setup lang="ts">
/**
 * SideNav — Shell 布局侧栏：按 Activity 领域切换视图，不含连接 CRUD 业务。
 * 默认资源管理器（全量连接）；分类仅随 Activity Bar 点击切换，不跟路由抢焦点。
 */
import OpsConnectionPanel from '@/modules/ops/components/OpsConnectionPanel.vue'
import { useShellStore } from '@/stores/shell'

const shellStore = useShellStore()
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
