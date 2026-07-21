<script setup lang="ts">
import { computed } from 'vue'
import type { RsRadius } from '../theme/types'
import { rsRadiusCss, useResolvedRsRadius } from './resolve-radius'

const props = withDefaults(
  defineProps<{
    description: string
    title?: string
    /**
     * 占满父级可用空间，并去除外层虚线框 / 背景。
     * 适合嵌在面板、列表、结果区内的空态。
     * 开启后外层强制直角；图标圆角仍由 `iconRadius` 控制。
     */
    fill?: boolean
    /** 外层容器圆角（fill 时忽略，恒为直角）。默认 md。 */
    radius?: RsRadius
    /** 图标区圆角。默认 full（圆形）；直角 UI 传 `none`。 */
    iconRadius?: RsRadius
  }>(),
  {
    fill: false,
  },
)

const resolvedRadius = useResolvedRsRadius(() => props.radius, 'md')
const resolvedIconRadius = useResolvedRsRadius(() => props.iconRadius, 'full')

const rootStyle = computed(() => ({
  '--rs-empty-radius': props.fill ? '0' : rsRadiusCss(resolvedRadius.value),
  '--rs-empty-icon-radius': rsRadiusCss(resolvedIconRadius.value),
}))
</script>

<template>
  <div class="rs-empty" :class="{ 'rs-empty--fill': fill }" :style="rootStyle">
    <div class="rs-empty__icon">
      <slot name="icon" />
    </div>
    <div class="rs-empty__text">
      <p v-if="title" class="rs-empty__title">{{ title }}</p>
      <p class="rs-empty__description" :class="{ 'rs-empty__description--offset': title }">
        {{ description }}
      </p>
    </div>
    <slot />
  </div>
</template>

<style>
.rs-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 3.5rem 1.5rem;
  border-radius: var(--rs-empty-radius, var(--rs-radius));
  border: 1px dashed var(--rs-border);
  background: color-mix(in srgb, var(--rs-surface) 80%, var(--rs-bg));
  text-align: center;
  box-sizing: border-box;
}

.rs-empty--fill {
  flex: 1 1 auto;
  align-self: stretch;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  border-radius: 0;
  border-color: transparent;
  background: transparent;
}

.rs-empty__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: var(--rs-empty-icon-radius, var(--rs-radius-full));
  border: 1px solid var(--rs-border);
  background: var(--rs-surface);
  color: var(--rs-muted);
  box-shadow: var(--rs-shadow-sm);
}

.rs-empty__title {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 500;
  color: var(--rs-text);
}

.rs-empty__description {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
  line-height: var(--rs-line-height-normal);
}

.rs-empty__description--offset {
  margin-top: 0.25rem;
}
</style>
