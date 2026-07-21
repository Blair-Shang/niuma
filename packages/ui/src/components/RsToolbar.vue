<script setup lang="ts">
/** 工具栏高度密度，对应常见面板顶栏。 */
export type RsToolbarSize = 'sm' | 'md' | 'lg'

/** 分割线位置。 */
export type RsToolbarBorder = 'bottom' | 'top' | 'both' | 'none'

withDefaults(
  defineProps<{
    /** 根元素标签名。 */
    tag?: string
    /** 高度密度：sm≈32px / md≈36px / lg≈44px。 */
    size?: RsToolbarSize
    /** 分割线位置。 */
    border?: RsToolbarBorder
    /** 使用抬升底色（`--rs-surface-elevated`）。 */
    elevated?: boolean
    /** 收紧水平内边距。 */
    compact?: boolean
    /** 无障碍标签（`role="toolbar"`）。 */
    label?: string
  }>(),
  {
    tag: 'header',
    size: 'md',
    border: 'bottom',
    elevated: false,
    compact: false,
  },
)
</script>

<template>
  <component
    :is="tag"
    class="rs-toolbar"
    :class="[
      `rs-toolbar--${size}`,
      `rs-toolbar--border-${border}`,
      {
        'rs-toolbar--elevated': elevated,
        'rs-toolbar--compact': compact,
      },
    ]"
    role="toolbar"
    :aria-label="label"
  >
    <div v-if="$slots.left || $slots.default" class="rs-toolbar__start">
      <slot name="left" />
      <slot />
    </div>
    <div v-if="$slots.center" class="rs-toolbar__center">
      <slot name="center" />
    </div>
    <div v-if="$slots.right" class="rs-toolbar__end">
      <slot name="right" />
    </div>
  </component>
</template>

<style>
.rs-toolbar {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  flex-shrink: 0;
  padding: 0 var(--rs-space-sm);
  background: var(--rs-surface);
  color: var(--rs-text);
}

.rs-toolbar--compact {
  padding-inline: var(--rs-space-xs);
  gap: var(--rs-space-xs);
}

.rs-toolbar--elevated {
  background: var(--rs-surface-elevated);
}

.rs-toolbar--sm {
  height: 2rem;
}

.rs-toolbar--md {
  height: 2.25rem;
}

.rs-toolbar--lg {
  height: 2.75rem;
}

.rs-toolbar--border-bottom {
  border-bottom: 1px solid var(--rs-border-subtle);
}

.rs-toolbar--border-top {
  border-top: 1px solid var(--rs-border-subtle);
}

.rs-toolbar--border-both {
  border-top: 1px solid var(--rs-border-subtle);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.rs-toolbar--border-none {
  border: none;
}

.rs-toolbar__start,
.rs-toolbar__center,
.rs-toolbar__end {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  min-width: 0;
}

.rs-toolbar__start {
  flex: 1 1 auto;
  overflow: hidden;
}

.rs-toolbar__center {
  flex: 0 0 auto;
}

.rs-toolbar__end {
  flex: 0 0 auto;
  margin-inline-start: auto;
}
</style>
