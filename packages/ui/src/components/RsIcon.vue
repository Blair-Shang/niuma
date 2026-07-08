<script setup lang="ts">
import { computed, type Component } from 'vue'
import { resolveLucideIcon } from '../icons/registry'
import type { RsComponentSize } from '../theme/types'

const SIZE_PRESET: Record<RsComponentSize, number> = {
  sm: 14,
  md: 16,
  lg: 20,
}

const props = withDefaults(
  defineProps<{
    /** Lucide 图标名（kebab-case，如 `house`、`trash-2`） */
    name: string
    /** 数字 px、CSS 长度或 sm / md / lg 预设 */
    size?: number | string | RsComponentSize
    /** 无障碍名称；有值时作为语义图标，无值时为装饰性图标 */
    label?: string
    strokeWidth?: number | string
    /** 覆盖颜色，默认继承 currentColor */
    color?: string
    /** 水平 / 垂直 / 双向翻转 */
    flip?: 'horizontal' | 'vertical' | 'both'
    /** 旋转角度（度），与 spin 不宜同时使用 */
    rotate?: number
    /** 旋转动画，适合 loader 等加载态 */
    spin?: boolean
  }>(),
  {
    size: 'md',
    strokeWidth: 1.75,
  },
)

const iconComponent = computed<Component | undefined>(() => resolveLucideIcon(props.name))

const usesCustomSize = computed(() => {
  const { size } = props
  return typeof size === 'string' && !(size in SIZE_PRESET) && !/^\d+$/.test(size)
})

const lucideSize = computed(() => {
  if (usesCustomSize.value) return undefined
  const { size } = props
  if (typeof size === 'number') return size
  if (size in SIZE_PRESET) return SIZE_PRESET[size as RsComponentSize]
  return Number.parseInt(String(size), 10) || SIZE_PRESET.md
})

const iconStyle = computed(() => {
  const style: Record<string, string> = {}
  if (props.color) style.color = props.color

  const transforms: string[] = []
  if (props.flip === 'horizontal') transforms.push('scaleX(-1)')
  else if (props.flip === 'vertical') transforms.push('scaleY(-1)')
  else if (props.flip === 'both') transforms.push('scale(-1)')
  if (props.rotate) transforms.push(`rotate(${props.rotate}deg)`)
  if (transforms.length) style.transform = transforms.join(' ')

  if (usesCustomSize.value && typeof props.size === 'string') {
    style.width = props.size
    style.height = props.size
  }

  return Object.keys(style).length ? style : undefined
})

const isSemantic = computed(() => Boolean(props.label))
</script>

<template>
  <component
    :is="iconComponent"
    v-if="iconComponent"
    class="rs-icon"
    :class="{ 'rs-icon--spin': spin }"
    :style="iconStyle"
    :size="lucideSize"
    :stroke-width="strokeWidth"
    :color="color"
    :aria-hidden="isSemantic ? undefined : true"
    :aria-label="label"
    :role="isSemantic ? 'img' : undefined"
  />
</template>

<style scoped>
.rs-icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
}
.rs-icon--spin {
  animation: rs-icon-spin 0.8s linear infinite;
}
@keyframes rs-icon-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
