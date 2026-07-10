<script setup lang="ts">
import { computed, useSlots } from 'vue'
import { Primitive } from './reka'

export type RsCardVariant = 'grouped' | 'plain' | 'outlined' | 'filled' | 'glass'

const props = withDefaults(
  defineProps<{
    as?: string
    title?: string
    description?: string
    padding?: boolean
    elevated?: boolean
    /** grouped=mac 分组面板；plain=mac 小组件；outlined/filled=Material 3；glass=mac 毛玻璃 */
    variant?: RsCardVariant
  }>(),
  {
    as: 'section',
    padding: true,
    elevated: false,
    variant: 'grouped',
  },
)

const slots = useSlots()
const hasHeader = computed(() => Boolean(props.title || props.description || slots.header))
</script>

<template>
  <Primitive
    :as="as"
    class="rs-card"
    :class="[
      `rs-card--${variant}`,
      { 'rs-card--elevated': elevated },
    ]"
  >
    <header v-if="hasHeader" class="rs-card__header">
      <div class="rs-card__heading">
        <slot name="header">
          <h3 v-if="title" class="rs-card__title">{{ title }}</h3>
          <p v-if="description" class="rs-card__description">{{ description }}</p>
        </slot>
      </div>
      <div v-if="$slots.actions" class="rs-card__actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="rs-card__body" :class="{ 'rs-card__body--padded': padding }">
      <slot />
    </div>
  </Primitive>
</template>

<style>
.rs-card {
  position: relative;
  overflow: hidden;
  border-radius: var(--rs-radius-lg);
  border: 1px solid var(--rs-card-border);
  background: var(--rs-card-body-bg);
  box-shadow: var(--rs-card-shadow);
  isolation: isolate;
}

/* ── grouped：macOS 系统设置分组面板（header 微分层 + inset 高光）── */
[data-rs-theme='light'] .rs-card--grouped {
  background: color-mix(in srgb, var(--rs-card-body-bg) 94%, transparent);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
}
.rs-card--grouped .rs-card__header {
  background: var(--rs-card-header-bg);
  border-bottom: 1px solid var(--rs-card-separator);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.05);
}
[data-rs-theme='light'] .rs-card--grouped .rs-card__header {
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.75);
}
.rs-card--grouped .rs-card__body {
  background: var(--rs-card-body-bg);
}
[data-rs-theme='light'] .rs-card--grouped .rs-card__body {
  background: transparent;
}
.rs-card--grouped.rs-card--elevated {
  box-shadow: var(--rs-card-shadow-elevated);
}

/* ── plain：macOS 小组件 / 仪表盘（单表面、弱分隔）── */
.rs-card--plain {
  border-color: var(--rs-card-separator);
  box-shadow: none;
}
.rs-card--plain .rs-card__header {
  padding-block: 0.625rem;
  background: transparent;
  border-bottom: 1px solid var(--rs-card-separator);
  box-shadow: none;
}
.rs-card--plain .rs-card__title {
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  color: var(--rs-card-description-fg);
  letter-spacing: 0;
}
.rs-card--plain .rs-card__body {
  background: transparent;
}
.rs-card--plain.rs-card--elevated {
  box-shadow: var(--rs-card-shadow-elevated);
}

/* ── outlined：Material 3 Outlined Card（描边、无 header 底色）── */
.rs-card--outlined {
  border: 1px solid var(--rs-card-border);
  box-shadow: none;
  background: var(--rs-card-body-bg);
}
.rs-card--outlined .rs-card__header {
  padding-block: 1rem;
  background: transparent;
  border-bottom: 1px solid var(--rs-card-separator);
  box-shadow: none;
}
.rs-card--outlined .rs-card__title {
  font-size: var(--rs-font-size-base);
  font-weight: 500;
  letter-spacing: 0;
}
.rs-card--outlined .rs-card__body {
  background: transparent;
}
.rs-card--outlined.rs-card--elevated {
  box-shadow: var(--rs-card-filled-elevated-shadow);
}

/* ── filled：Material 3 Filled Card（色调填充、无边框）── */
.rs-card--filled {
  border-color: transparent;
  background: var(--rs-card-filled-bg);
  box-shadow: none;
}
.rs-card--filled .rs-card__header {
  background: transparent;
  border-bottom: 1px solid var(--rs-card-separator);
  box-shadow: none;
}
.rs-card--filled .rs-card__title {
  font-size: var(--rs-font-size-base);
  font-weight: 500;
  letter-spacing: 0;
}
.rs-card--filled .rs-card__body {
  background: transparent;
}
.rs-card--filled.rs-card--elevated {
  box-shadow: var(--rs-card-filled-elevated-shadow);
}

/* ── glass：macOS Vibrancy 毛玻璃（强模糊 + 半透明）── */
.rs-card--glass {
  border-color: var(--rs-card-glass-border);
  background: var(--rs-card-glass-bg);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  box-shadow:
    0 0 0 0.5px rgb(255 255 255 / 0.12),
    0 8px 24px rgb(0 0 0 / 0.12);
}
[data-rs-theme='light'] .rs-card--glass {
  box-shadow:
    0 0 0 0.5px rgb(255 255 255 / 0.6),
    0 8px 24px rgb(0 0 0 / 0.08);
}
.rs-card--glass .rs-card__header {
  background: rgb(255 255 255 / 0.04);
  border-bottom: 1px solid var(--rs-card-glass-border);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.08);
}
[data-rs-theme='light'] .rs-card--glass .rs-card__header {
  background: rgb(255 255 255 / 0.35);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.8);
}
.rs-card--glass .rs-card__body {
  background: transparent;
}
.rs-card--glass.rs-card--elevated {
  box-shadow:
    0 0 0 0.5px rgb(255 255 255 / 0.14),
    0 12px 32px rgb(0 0 0 / 0.18);
}

/* ── 公共结构 ── */
.rs-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
  flex-shrink: 0;
  padding: 0.75rem 1rem 0.75rem 1.25rem;
}
.rs-card__heading {
  min-width: 0;
}
.rs-card__title {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--rs-card-title-fg);
}
.rs-card__description {
  margin: 0.2rem 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-card-description-fg);
  line-height: var(--rs-line-height-normal);
}
.rs-card__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
}
.rs-card__body--padded {
  padding: 1.25rem;
}
</style>
