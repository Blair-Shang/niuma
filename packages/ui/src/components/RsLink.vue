<script setup lang="ts">
import { computed } from 'vue'
import { Primitive } from './reka'

const props = withDefaults(
  defineProps<{
    href: string
    target?: '_self' | '_blank' | '_parent' | '_top' | (string & {})
    rel?: string
    disabled?: boolean
    underline?: 'always' | 'hover' | 'none'
  }>(),
  {
    target: '_self',
    rel: undefined,
    disabled: false,
    underline: 'hover',
  },
)

const mergedRel = computed(() => {
  const relParts = (props.rel ?? '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)

  if (props.target === '_blank') {
    if (!relParts.includes('noopener')) relParts.push('noopener')
    if (!relParts.includes('noreferrer')) relParts.push('noreferrer')
  }

  return relParts.length > 0 ? relParts.join(' ') : undefined
})

function onClick(event: MouseEvent) {
  if (!props.disabled) return
  event.preventDefault()
  event.stopPropagation()
}
</script>

<template>
  <Primitive
    as="a"
    :href="disabled ? undefined : href"
    :target="disabled ? undefined : target"
    :rel="disabled ? undefined : mergedRel"
    class="rs-link"
    :class="{
      'rs-link--disabled': disabled,
      [`rs-link--underline-${underline}`]: true,
    }"
    :aria-disabled="disabled ? 'true' : undefined"
    :tabindex="disabled ? -1 : undefined"
    @click="onClick"
  >
    <slot />
  </Primitive>
</template>

<style>
.rs-link {
  color: var(--rs-primary);
  font-size: var(--rs-font-size-sm);
  font-weight: 500;
  line-height: var(--rs-line-height-tight);
  text-underline-offset: 0.18em;
  text-decoration-thickness: 1px;
  transition:
    color var(--rs-transition-fast),
    text-decoration-color var(--rs-transition-fast);
}
.rs-link:visited {
  color: var(--rs-primary);
}
.rs-link:hover {
  color: var(--rs-primary-hover);
}
.rs-link:active {
  color: var(--rs-primary-hover);
}
.rs-link:focus-visible {
  outline: none;
  border-radius: var(--rs-radius-xs);
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}
.rs-link--underline-always {
  text-decoration: underline;
}
.rs-link--underline-hover {
  text-decoration: none;
}
.rs-link--underline-hover:hover,
.rs-link--underline-hover:focus-visible {
  text-decoration: underline;
}
.rs-link--underline-none {
  text-decoration: none;
}
.rs-link--disabled {
  color: var(--rs-muted);
  cursor: not-allowed;
  text-decoration: none;
  pointer-events: auto;
}
</style>
