<script setup lang="ts">
/** 分区卡片：导入导出表单的标准区块容器。 */
defineProps<{
  title?: string
}>()
</script>

<template>
  <section class="nm-dt-section">
    <div v-if="title || $slots.head" class="nm-dt-section__head">
      <h3 v-if="title" class="nm-dt-section__title">{{ title }}</h3>
      <div v-if="$slots.head" class="nm-dt-section__head-extra">
        <slot name="head" />
      </div>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.nm-dt-section {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm, 8px);
  padding: var(--rs-space-md, 12px);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm, 6px);
  background: var(--rs-surface);
}

.nm-dt-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm, 8px);
}

.nm-dt-section__title {
  margin: 0;
  font-size: var(--rs-font-size-xs, 12px);
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--rs-muted);
  text-transform: uppercase;
}

.nm-dt-section__head-extra {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
