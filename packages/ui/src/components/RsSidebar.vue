<script setup lang="ts">
export type RsSidebarOrientation = 'vertical' | 'horizontal'
export type RsSidebarPlacement = 'left' | 'right'

const collapsed = defineModel<boolean>('collapsed', { default: false })

withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    collapsible?: boolean
    width?: 'sm' | 'md' | 'lg'
    orientation?: RsSidebarOrientation
    placement?: RsSidebarPlacement
  }>(),
  {
    collapsible: false,
    width: 'md',
    orientation: 'vertical',
    placement: 'left',
  },
)
</script>

<template>
  <aside
    class="rs-sidebar"
    :class="[
      `rs-sidebar--${width}`,
      `rs-sidebar--${orientation}`,
      `rs-sidebar--${placement}`,
      { 'rs-sidebar--collapsed': collapsed },
    ]"
  >
    <header v-if="title || subtitle || collapsible || $slots.header" class="rs-sidebar__header">
      <slot name="header">
        <div class="rs-sidebar__title-wrap">
          <strong v-if="title" class="rs-sidebar__title">{{ title }}</strong>
          <span v-if="subtitle && !collapsed" class="rs-sidebar__subtitle">{{ subtitle }}</span>
        </div>
        <button
          v-if="collapsible"
          type="button"
          class="rs-sidebar__collapse"
          @click="collapsed = !collapsed"
        >
          {{ collapsed ? '>' : '<' }}
        </button>
      </slot>
    </header>
    <div class="rs-sidebar__body">
      <slot :collapsed="collapsed" />
    </div>
    <footer v-if="$slots.footer" class="rs-sidebar__footer">
      <slot name="footer" :collapsed="collapsed" />
    </footer>
  </aside>
</template>

<style scoped>
.rs-sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-surface) 88%, transparent);
  color: var(--rs-text);
}
.rs-sidebar--sm {
  width: 14rem;
}
.rs-sidebar--md {
  width: 17rem;
}
.rs-sidebar--lg {
  width: 21rem;
}
.rs-sidebar--collapsed {
  width: 4rem;
}
.rs-sidebar__header,
.rs-sidebar__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
}
.rs-sidebar__footer {
  border-top: 1px solid var(--rs-border-subtle);
  border-bottom: 0;
}
.rs-sidebar__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--rs-space-sm);
}
.rs-sidebar__title-wrap {
  min-width: 0;
}
.rs-sidebar__title,
.rs-sidebar__subtitle {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-sidebar__subtitle {
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}
.rs-sidebar__collapse {
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
  color: var(--rs-muted);
  cursor: pointer;
}
</style>
