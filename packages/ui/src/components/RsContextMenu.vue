<script setup lang="ts">
import {
  ContextMenuContent,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuTrigger,
} from './reka'
import type { RsContextMenuItem } from './context-menu-utils'
import RsContextMenuItems from './RsContextMenuItems.vue'

defineProps<{
  items: RsContextMenuItem[]
  /** 禁用时不拦截右键事件，直接透传 slot，浏览器原生菜单正常显示 */
  disabled?: boolean
}>()

const emit = defineEmits<{
  select: [key: string]
}>()

function onSelect(item: RsContextMenuItem) {
  emit('select', item.key)
}
</script>

<template>
  <ContextMenuRoot v-if="!disabled">
    <ContextMenuTrigger as-child>
      <slot />
    </ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent class="rs-context-menu__content rs-motion-reduce" :side-offset="4">
        <RsContextMenuItems :items="items" @select="onSelect" />
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
  <slot v-else />
</template>

<style>
/* ── 菜单容器：macOS 毛玻璃浮层 ── */
.rs-context-menu__content,
.rs-context-menu__sub-content {
  z-index: var(--rs-z-dropdown);
  min-width: 11rem;
  padding: 5px;
  border-radius: 10px;
  border: 0.5px solid var(--rs-ctx-border);
  background: var(--rs-ctx-bg);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  box-shadow: var(--rs-ctx-shadow);
  outline: none;
  overflow: hidden;
}

/* 主菜单入场动画（从鼠标位置展开） */
.rs-context-menu__content {
  transform-origin: var(--reka-context-menu-content-transform-origin, top left);
  animation: rs-ctx-in 0.13s cubic-bezier(0.36, 0.07, 0.19, 0.97);
}

/* 子菜单入场动画（从父项边缘展开，方向由 popper 决定） */
.rs-context-menu__sub-content {
  transform-origin: var(--reka-popper-transform-origin, left center);
  animation: rs-ctx-in 0.12s cubic-bezier(0.36, 0.07, 0.19, 0.97);
}

@keyframes rs-ctx-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* ── 菜单项 ── */
.rs-context-menu__item {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0 8px 0 0;
  height: 26px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1;
  color: var(--rs-text);
  cursor: default;
  outline: none;
  user-select: none;
  transition:
    background 0.08s,
    color 0.08s;
}

/* 图标占位列（固定 28px，居中对齐） */
.rs-context-menu__icon-cell {
  flex-shrink: 0;
  width: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--rs-ctx-icon);
}

/* 文本 */
.rs-context-menu__label {
  flex: 1;
  min-width: 0;
}

/* 键盘快捷键 */
.rs-context-menu__shortcut {
  flex-shrink: 0;
  margin-left: 16px;
  font-size: 12px;
  color: var(--rs-ctx-shortcut);
  letter-spacing: 0.02em;
  font-family: -apple-system, 'SF Pro Text', system-ui, sans-serif;
}

/* 子菜单展开箭头 */
.rs-context-menu__arrow {
  flex-shrink: 0;
  margin-left: 6px;
  color: var(--rs-ctx-icon);
}

/* 悬停 / 子菜单已展开：蓝色高亮条（macOS 主色调） */
.rs-context-menu__item[data-highlighted],
.rs-context-menu__item[data-state='open'] {
  background: var(--rs-primary);
  color: #ffffff;
}

.rs-context-menu__item[data-highlighted] .rs-context-menu__icon-cell,
.rs-context-menu__item[data-highlighted] .rs-context-menu__shortcut,
.rs-context-menu__item[data-highlighted] .rs-context-menu__arrow,
.rs-context-menu__item[data-state='open'] .rs-context-menu__icon-cell,
.rs-context-menu__item[data-state='open'] .rs-context-menu__shortcut,
.rs-context-menu__item[data-state='open'] .rs-context-menu__arrow {
  color: rgba(255 255 255 / 0.75);
}

/* 危险项 */
.rs-context-menu__item--danger {
  color: var(--rs-danger);
}

.rs-context-menu__item--danger .rs-context-menu__icon-cell {
  color: var(--rs-danger);
}

.rs-context-menu__item--danger[data-highlighted],
.rs-context-menu__item--danger[data-state='open'] {
  background: var(--rs-danger);
  color: #ffffff;
}

.rs-context-menu__item--danger[data-highlighted] .rs-context-menu__icon-cell,
.rs-context-menu__item--danger[data-state='open'] .rs-context-menu__icon-cell {
  color: rgba(255 255 255 / 0.75);
}

/* 禁用态 */
.rs-context-menu__item[data-disabled] {
  opacity: 0.38;
  cursor: not-allowed;
}

/* 分隔线：更细腻 */
.rs-context-menu__separator {
  height: 1px;
  margin: 5px 0;
  background: var(--rs-ctx-separator);
}

/* ── 主题变量：深色 ── */
:root,
[data-rs-theme='dark'] {
  --rs-ctx-bg: rgba(40, 40, 42, 0.85);
  --rs-ctx-border: rgba(255, 255, 255, 0.13);
  --rs-ctx-shadow:
    0 0 0 0.5px rgba(255, 255, 255, 0.08),
    0 2px 8px rgba(0, 0, 0, 0.4),
    0 8px 32px rgba(0, 0, 0, 0.55);
  --rs-ctx-icon: rgba(235, 235, 245, 0.5);
  --rs-ctx-shortcut: rgba(235, 235, 245, 0.4);
  --rs-ctx-separator: rgba(255, 255, 255, 0.1);
}

/* ── 主题变量：亮色 ── */
[data-rs-theme='light'] {
  --rs-ctx-bg: rgba(255, 255, 255, 0.88);
  --rs-ctx-border: rgba(0, 0, 0, 0.1);
  --rs-ctx-shadow:
    0 0 0 0.5px rgba(0, 0, 0, 0.06),
    0 2px 6px rgba(0, 0, 0, 0.12),
    0 8px 28px rgba(0, 0, 0, 0.18);
  --rs-ctx-icon: rgba(60, 60, 67, 0.5);
  --rs-ctx-shortcut: rgba(60, 60, 67, 0.4);
  --rs-ctx-separator: rgba(60, 60, 67, 0.1);
}
</style>
