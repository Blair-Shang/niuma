<script setup lang="ts">
import { computed } from 'vue'

/** 支持的响应式断点，语义与常见 SaaS 前端一致。 */
export type RsContainerBreakpoint = 'sm' | 'md' | 'lg' | 'xl'

/** 内容区最大宽度档位，对应 `--rs-container-max-*` token。 */
export type RsContainerMaxWidth = 'sm' | 'md' | 'lg' | 'xl' | 'full'

/** 水平内边距档位，对应 `--rs-space-*` token。 */
export type RsContainerPadding = 'none' | 'sm' | 'md' | 'lg'

/** 栅格间距档位，对应 `--rs-space-*` token。 */
export type RsContainerGap = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'

/** 断点映射配置，用于 maxWidth、padding、columns、gap。 */
export type RsContainerResponsive<T> = Partial<Record<RsContainerBreakpoint, T>>

/** 支持固定值或断点映射。 */
export type RsContainerMaybeResponsive<T> = T | RsContainerResponsive<T>

const props = withDefaults(
  defineProps<{
    /** 最大内容宽度；`fluid` 为 true 时忽略。 */
    maxWidth?: RsContainerMaybeResponsive<RsContainerMaxWidth>
    /** 水平内边距。 */
    padding?: RsContainerMaybeResponsive<RsContainerPadding>
    /** 是否在父级内水平居中。 */
    centered?: boolean
    /** 占满父级宽度，忽略 `maxWidth`。 */
    fluid?: boolean
    /** 根元素标签名。 */
    tag?: string
    /** 启用栅格布局；未传 `columns` 时默认为 12 栅格。 */
    grid?: boolean
    /** 栅格列数，支持响应式。 */
    columns?: RsContainerMaybeResponsive<number>
    /** 栅格间距，支持响应式。 */
    gap?: RsContainerMaybeResponsive<RsContainerGap>
  }>(),
  {
    maxWidth: 'lg',
    padding: 'md',
    centered: true,
    fluid: false,
    tag: 'div',
    grid: false,
    columns: 12,
    gap: 'md',
  },
)

const BREAKPOINTS: RsContainerBreakpoint[] = ['sm', 'md', 'lg', 'xl']

const isResponsiveObject = <T,>(value: RsContainerMaybeResponsive<T>): value is RsContainerResponsive<T> =>
  typeof value === 'object' && value !== null

const tokenToSpaceVar: Record<RsContainerGap | RsContainerPadding, string> = {
  none: '0',
  xs: 'var(--rs-space-xs)',
  sm: 'var(--rs-space-sm)',
  md: 'var(--rs-space-md)',
  lg: 'var(--rs-space-lg)',
  xl: 'var(--rs-space-xl)',
}

const tokenToContainerVar: Record<RsContainerMaxWidth, string> = {
  sm: 'var(--rs-container-max-sm)',
  md: 'var(--rs-container-max-md)',
  lg: 'var(--rs-container-max-lg)',
  xl: 'var(--rs-container-max-xl)',
  full: 'var(--rs-container-max-full)',
}

const rootClass = computed(() => [
  'rs-container',
  { 'rs-container--centered': props.centered, 'rs-container--grid': props.grid },
])

const rootStyle = computed(() => {
  const style: Record<string, string | number> = {}

  if (props.fluid) {
    style['--rs-container-max-current'] = 'none'
  } else if (isResponsiveObject(props.maxWidth)) {
    const responsiveMaxWidth = props.maxWidth as RsContainerResponsive<RsContainerMaxWidth>
    BREAKPOINTS.forEach((bp) => {
      const value = responsiveMaxWidth[bp]
      if (value) style[`--rs-container-max-${bp}`] = tokenToContainerVar[value]
    })
  } else {
    style['--rs-container-max-current'] = tokenToContainerVar[props.maxWidth]
  }

  if (isResponsiveObject(props.padding)) {
    const responsivePadding = props.padding as RsContainerResponsive<RsContainerPadding>
    BREAKPOINTS.forEach((bp) => {
      const value = responsivePadding[bp]
      if (value) style[`--rs-container-padding-${bp}`] = tokenToSpaceVar[value]
    })
  } else {
    style['--rs-container-padding-current'] = tokenToSpaceVar[props.padding]
  }

  if (props.grid) {
    if (isResponsiveObject(props.columns)) {
      const responsiveColumns = props.columns as RsContainerResponsive<number>
      BREAKPOINTS.forEach((bp) => {
        const value = responsiveColumns[bp]
        if (typeof value === 'number') style[`--rs-container-columns-${bp}`] = value
      })
    } else {
      style['--rs-container-columns-current'] = props.columns
    }

    if (isResponsiveObject(props.gap)) {
      const responsiveGap = props.gap as RsContainerResponsive<RsContainerGap>
      BREAKPOINTS.forEach((bp) => {
        const value = responsiveGap[bp]
        if (value) style[`--rs-container-gap-${bp}`] = tokenToSpaceVar[value]
      })
    } else {
      style['--rs-container-gap-current'] = tokenToSpaceVar[props.gap]
    }
  }

  return style
})
</script>

<template>
  <component :is="tag" :class="rootClass" :style="rootStyle">
    <slot />
  </component>
</template>

<style scoped>
.rs-container {
  width: 100%;
  box-sizing: border-box;
  max-width: var(--rs-container-max-current, var(--rs-container-max-lg));
  padding-inline: var(--rs-container-padding-current, var(--rs-space-md));
}
.rs-container--centered {
  margin-inline: auto;
}
.rs-container--grid {
  display: grid;
  grid-template-columns: repeat(var(--rs-container-columns-current, 12), minmax(0, 1fr));
  gap: var(--rs-container-gap-current, var(--rs-space-md));
}

@media (width >= 40rem) {
  .rs-container {
    max-width: var(--rs-container-max-sm, var(--rs-container-max-current, var(--rs-container-max-lg)));
    padding-inline: var(--rs-container-padding-sm, var(--rs-container-padding-current, var(--rs-space-md)));
  }
  .rs-container--grid {
    grid-template-columns: repeat(
      var(--rs-container-columns-sm, var(--rs-container-columns-current, 12)),
      minmax(0, 1fr)
    );
    gap: var(--rs-container-gap-sm, var(--rs-container-gap-current, var(--rs-space-md)));
  }
}

@media (width >= 48rem) {
  .rs-container {
    max-width: var(--rs-container-max-md, var(--rs-container-max-sm, var(--rs-container-max-current)));
    padding-inline: var(
      --rs-container-padding-md,
      var(--rs-container-padding-sm, var(--rs-container-padding-current))
    );
  }
  .rs-container--grid {
    grid-template-columns: repeat(
      var(--rs-container-columns-md, var(--rs-container-columns-sm, var(--rs-container-columns-current, 12))),
      minmax(0, 1fr)
    );
    gap: var(--rs-container-gap-md, var(--rs-container-gap-sm, var(--rs-container-gap-current)));
  }
}

@media (width >= 64rem) {
  .rs-container {
    max-width: var(
      --rs-container-max-lg,
      var(--rs-container-max-md, var(--rs-container-max-sm, var(--rs-container-max-current)))
    );
    padding-inline: var(
      --rs-container-padding-lg,
      var(--rs-container-padding-md, var(--rs-container-padding-sm, var(--rs-container-padding-current)))
    );
  }
  .rs-container--grid {
    grid-template-columns: repeat(
      var(
        --rs-container-columns-lg,
        var(--rs-container-columns-md, var(--rs-container-columns-sm, var(--rs-container-columns-current, 12)))
      ),
      minmax(0, 1fr)
    );
    gap: var(--rs-container-gap-lg, var(--rs-container-gap-md, var(--rs-container-gap-sm, var(--rs-container-gap-current))));
  }
}

@media (width >= 80rem) {
  .rs-container {
    max-width: var(
      --rs-container-max-xl,
      var(--rs-container-max-lg, var(--rs-container-max-md, var(--rs-container-max-sm, var(--rs-container-max-current))))
    );
    padding-inline: var(
      --rs-container-padding-xl,
      var(--rs-container-padding-lg, var(--rs-container-padding-md, var(--rs-container-padding-sm, var(--rs-container-padding-current))))
    );
  }
  .rs-container--grid {
    grid-template-columns: repeat(
      var(
        --rs-container-columns-xl,
        var(
          --rs-container-columns-lg,
          var(--rs-container-columns-md, var(--rs-container-columns-sm, var(--rs-container-columns-current, 12)))
        )
      ),
      minmax(0, 1fr)
    );
    gap: var(
      --rs-container-gap-xl,
      var(--rs-container-gap-lg, var(--rs-container-gap-md, var(--rs-container-gap-sm, var(--rs-container-gap-current))))
    );
  }
}
</style>
