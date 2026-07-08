<script setup lang="ts">
/**
 * NiuMa 品牌剑形标 — 与 assets/brand/app-icon.svg / favicon 同源几何。
 * `mark` 使用 `currentColor`，随主题/父级颜色动态变化；`app` 仅用于系统图标等需固定蓝底的场景。
 */
withDefaults(
  defineProps<{
    /** 渲染边长（px） */
    size?: number
    /** mark：单色剑形（Shell chrome）；app：含品牌蓝圆角底（任务栏/安装包） */
    variant?: 'mark' | 'app'
  }>(),
  {
    size: 14,
    variant: 'mark',
  },
)
</script>

<template>
  <svg
    class="nm-app-brand-icon"
    :class="{ 'nm-app-brand-icon--app': variant === 'app' }"
    :width="size"
    :height="size"
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect v-if="variant === 'app'" width="32" height="32" rx="7" fill="#007AFF" />
    <g :fill="variant === 'app' ? '#fff' : 'currentColor'">
      <path d="M16 6 L17.9 18.2 L17 18.2 L16 16.8 L15 18.2 L14.1 18.2 Z" />
      <path d="M11.8 18.2 H20.2 V20.5 H11.8 Z" />
      <path d="M14.8 20.5 H17.2 V25 H14.8 Z" />
      <rect x="14" y="25" width="4" height="1.25" rx="0.6" />
    </g>
  </svg>
</template>

<style scoped>
.nm-app-brand-icon {
  display: block;
  flex-shrink: 0;
}
</style>
