<script setup lang="ts">
import { computed } from 'vue'
import { AvatarFallback, AvatarImage, AvatarRoot } from './reka'
import { getAvatarInitials, type RsAvatarShape, type RsAvatarSize, type RsAvatarTone } from './avatar-utils'
import RsIcon from './RsIcon.vue'

const props = withDefaults(
  defineProps<{
    src?: string
    alt?: string
    name?: string
    fallback?: string
    icon?: string
    size?: RsAvatarSize
    shape?: RsAvatarShape
    tone?: RsAvatarTone
    label?: string
  }>(),
  {
    size: 'md',
    shape: 'circle',
    tone: 'primary',
    icon: 'user',
  },
)

const fallbackText = computed(() => {
  if (props.fallback?.trim()) return props.fallback.trim()
  if (props.name?.trim()) return getAvatarInitials(props.name)
  return ''
})

const showIconFallback = computed(() => !fallbackText.value)
const imageAlt = computed(() => props.alt ?? props.name ?? '')
const ariaLabel = computed(() => props.label ?? props.alt ?? props.name ?? undefined)
</script>

<template>
  <AvatarRoot
    class="rs-avatar"
    :class="[`rs-avatar--${size}`, `rs-avatar--${shape}`]"
    :aria-label="ariaLabel"
    :role="ariaLabel ? 'img' : undefined"
  >
    <AvatarImage v-if="src" :src="src" :alt="imageAlt" class="rs-avatar__image" />
    <AvatarFallback class="rs-avatar__fallback" :class="`rs-avatar__fallback--${tone}`">
      <slot name="fallback">
        <RsIcon v-if="showIconFallback" :name="icon" :size="size === 'sm' ? 14 : size === 'lg' ? 20 : 16" />
        <span v-else>{{ fallbackText }}</span>
      </slot>
    </AvatarFallback>
  </AvatarRoot>
</template>

<style>
.rs-avatar {
  display: inline-flex;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid var(--rs-border);
  background: var(--rs-surface);
}
.rs-avatar--circle {
  border-radius: var(--rs-radius-full);
}
.rs-avatar--square {
  border-radius: var(--rs-radius-sm);
}
.rs-avatar--sm {
  width: 1.75rem;
  height: 1.75rem;
}
.rs-avatar--md {
  width: 2.25rem;
  height: 2.25rem;
}
.rs-avatar--lg {
  width: 3rem;
  height: 3rem;
}
.rs-avatar__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.rs-avatar__fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: var(--rs-font-size-xs);
  font-weight: 600;
}
.rs-avatar__fallback--default {
  background: var(--rs-surface-hover);
  color: var(--rs-muted);
}
.rs-avatar__fallback--primary {
  background: var(--rs-primary-container);
  color: var(--rs-on-primary-container);
}
.rs-avatar__fallback--success {
  background: var(--rs-success-container);
  color: var(--rs-on-success-container);
}
.rs-avatar__fallback--warning {
  background: var(--rs-warning-container);
  color: var(--rs-on-warning-container);
}
.rs-avatar__fallback--danger {
  background: var(--rs-danger-container);
  color: var(--rs-on-danger-container);
}
</style>
