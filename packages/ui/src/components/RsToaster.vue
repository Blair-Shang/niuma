<script setup lang="ts">
import { computed, inject } from 'vue'
import { Toaster } from 'vue-sonner'
import { rsConfigKey } from '../composables/useRsConfig'
import type { RsToastPosition } from './overlay-utils'
import { RS_TOAST_DEFAULT_POSITION } from './overlay-utils'

withDefaults(
  defineProps<{
    position?: RsToastPosition
    closeButton?: boolean
    richColors?: boolean
  }>(),
  {
    position: RS_TOAST_DEFAULT_POSITION,
    closeButton: true,
    richColors: false,
  },
)

const config = inject(rsConfigKey, null)

const sonnerTheme = computed<'light' | 'dark'>(() => {
  if (config?.theme.value) {
    return config.theme.value === 'dark' ? 'dark' : 'light'
  }
  if (typeof document !== 'undefined') {
    const mode = document.documentElement.dataset.rsTheme
    if (mode === 'dark' || mode === 'light') return mode
  }
  return 'dark'
})
</script>

<template>
  <Teleport to="body">
    <Toaster
      :theme="sonnerTheme"
      :position="position"
      :close-button="closeButton"
      :rich-colors="richColors"
      class="rs-toaster"
      :toast-options="{
        unstyled: true,
        classes: {
          toast: 'rs-toast',
          title: 'rs-toast__title',
          description: 'rs-toast__description',
          closeButton: 'rs-toast__close',
          actionButton: 'rs-toast__action',
          cancelButton: 'rs-toast__action rs-toast__action--secondary',
        },
      }"
    />
  </Teleport>
</template>

<style>
[data-sonner-toaster].rs-toaster {
  --rs-toast-radius: 1rem;
  --rs-toast-bg: color-mix(in srgb, var(--rs-surface-elevated) 86%, transparent);
  --rs-toast-border: color-mix(in srgb, var(--rs-border) 72%, rgb(255 255 255 / 0.08));
  --rs-toast-shadow:
    0 16px 40px -20px rgb(0 0 0 / 0.3),
    0 8px 18px -14px rgb(0 0 0 / 0.18),
    0 0 0 0.5px rgb(255 255 255 / 0.08);
  --rs-toast-tint: color-mix(in srgb, var(--rs-info) 7%, transparent);
  --rs-toast-highlight: rgb(255 255 255 / 0.08);
  z-index: var(--rs-z-toast);
  font-family: inherit;
}

[data-rs-theme='light'] [data-sonner-toaster].rs-toaster {
  --rs-toast-bg: color-mix(in srgb, var(--rs-surface-elevated) 94%, rgb(255 255 255 / 0.8));
  --rs-toast-border: color-mix(in srgb, var(--rs-border) 84%, rgb(255 255 255 / 0.9));
  --rs-toast-shadow:
    0 18px 42px -24px rgb(15 23 42 / 0.2),
    0 8px 18px -14px rgb(15 23 42 / 0.12),
    0 0 0 0.5px rgb(255 255 255 / 0.86);
  --rs-toast-tint: color-mix(in srgb, var(--rs-info) 4%, #ffffff);
  --rs-toast-highlight: rgb(255 255 255 / 0.72);
}

.rs-toast {
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  column-gap: 0.75rem;
  row-gap: 0.25rem;
  min-width: 19rem;
  max-width: min(29rem, calc(100vw - 1.5rem));
  padding: 0.875rem 0.9375rem 0.9375rem;
  border: 1px solid var(--rs-toast-border);
  border-radius: var(--rs-toast-radius);
  background:
    linear-gradient(180deg, var(--rs-toast-highlight), transparent 38%),
    linear-gradient(135deg, var(--rs-toast-tint), transparent 34%),
    var(--rs-toast-bg);
  color: var(--rs-text);
  box-shadow: var(--rs-toast-shadow);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  transition:
    transform var(--rs-transition-normal),
    box-shadow var(--rs-transition-normal),
    border-color var(--rs-transition-fast),
    background var(--rs-transition-fast);
}

.rs-toast[data-mounted='true'] {
  animation: rs-toast-enter 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.rs-toast[data-removed='true'] {
  animation: rs-toast-exit 180ms cubic-bezier(0.4, 0, 1, 1);
}

.rs-toast::before {
  content: '';
  position: absolute;
  inset: 0.625rem auto 0.625rem 0.5rem;
  width: 2px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--rs-info) 68%, transparent);
  opacity: 0.82;
}

.rs-toast::after {
  content: '';
  position: absolute;
  inset: 0.75px;
  border-radius: calc(var(--rs-toast-radius) - 1px);
  border-top: 1px solid rgb(255 255 255 / 0.08);
  pointer-events: none;
}

.rs-toast:hover {
  transform: translateY(-1px);
  box-shadow:
    0 18px 42px -20px rgb(0 0 0 / 0.34),
    0 10px 24px -16px rgb(0 0 0 / 0.22),
    0 0 0 0.5px rgb(255 255 255 / 0.1);
}

.rs-toast[data-styled='true'] {
  gap: 0;
}

.rs-toast [data-icon] {
  position: relative;
  z-index: 1;
  display: inline-flex;
  grid-row: 1 / span 2;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  margin-top: 0.125rem;
  border-radius: 999px;
  background: transparent;
  color: var(--rs-info);
  box-shadow: none;
}

.rs-toast [data-content] {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 0.1875rem;
  min-width: 0;
  padding-right: 1.5rem;
}

.rs-toast [data-button] {
  position: relative;
  z-index: 1;
  margin-top: 0.625rem;
}

.rs-toast__title {
  margin: 0;
  color: var(--rs-text);
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.012em;
}

.rs-toast__description {
  margin: 0;
  color: color-mix(in srgb, var(--rs-muted) 94%, var(--rs-text) 6%);
  font-size: 0.8125rem;
  line-height: 1.4;
}

.rs-toast__close {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  left: auto;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.375rem;
  height: 1.375rem;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--rs-muted);
  box-shadow: none;
  cursor: pointer;
  transform: none;
  opacity: 0.72;
  transition:
    opacity var(--rs-transition-fast),
    color var(--rs-transition-fast),
    border-color var(--rs-transition-fast),
    background var(--rs-transition-fast),
    box-shadow var(--rs-transition-fast);
}

.rs-toast__close:hover {
  opacity: 0.96;
  color: var(--rs-text);
  border-color: color-mix(in srgb, var(--rs-border) 68%, transparent);
  background: color-mix(in srgb, var(--rs-surface-hover) 70%, transparent);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.08),
    0 1px 4px rgb(0 0 0 / 0.08);
}

.rs-toast__close:focus-visible {
  outline: none;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.08),
    0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}

.rs-toast__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 4.5rem;
  min-height: 2rem;
  padding: 0 0.75rem;
  border: 1px solid transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--rs-primary) 92%, white 8%);
  color: var(--rs-primary-foreground);
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.01em;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.16),
    0 1px 2px rgb(0 0 0 / 0.08);
  cursor: pointer;
  transition:
    transform var(--rs-transition-fast),
    background var(--rs-transition-fast),
    border-color var(--rs-transition-fast),
    box-shadow var(--rs-transition-fast),
    color var(--rs-transition-fast);
}

.rs-toast__action:hover {
  transform: translateY(-0.5px);
  background: color-mix(in srgb, var(--rs-primary-hover) 94%, white 6%);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.18),
    0 4px 10px rgb(0 0 0 / 0.12);
}

.rs-toast__action:active {
  transform: translateY(0);
  box-shadow:
    inset 0 1px 1px rgb(0 0 0 / 0.08),
    0 1px 3px rgb(0 0 0 / 0.08);
}

.rs-toast__action:focus-visible {
  outline: none;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.18),
    0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}

.rs-toast__action--secondary {
  border-color: color-mix(in srgb, var(--rs-border) 72%, transparent);
  background: color-mix(in srgb, var(--rs-surface) 82%, transparent);
  color: var(--rs-text);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.08),
    0 1px 2px rgb(0 0 0 / 0.04);
}

.rs-toast__action--secondary:hover {
  background: color-mix(in srgb, var(--rs-surface-hover) 82%, transparent);
  border-color: color-mix(in srgb, var(--rs-border) 88%, transparent);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.1),
    0 3px 8px rgb(0 0 0 / 0.08);
}

.rs-toast[data-type='success']::before {
  background: color-mix(in srgb, var(--rs-success) 68%, transparent);
}

.rs-toast[data-type='success'] [data-icon] {
  color: var(--rs-success);
}

.rs-toast[data-type='success'] {
  --rs-toast-tint: color-mix(in srgb, var(--rs-success) 7%, transparent);
}

.rs-toast[data-type='error']::before {
  background: color-mix(in srgb, var(--rs-danger) 68%, transparent);
}

.rs-toast[data-type='error'] [data-icon] {
  color: var(--rs-danger);
}

.rs-toast[data-type='error'] {
  --rs-toast-tint: color-mix(in srgb, var(--rs-danger) 7%, transparent);
}

.rs-toast[data-type='warning']::before {
  background: color-mix(in srgb, var(--rs-warning) 72%, transparent);
}

.rs-toast[data-type='warning'] [data-icon] {
  color: var(--rs-warning);
}

.rs-toast[data-type='warning'] {
  --rs-toast-tint: color-mix(in srgb, var(--rs-warning) 8%, transparent);
}

.rs-toast[data-type='info']::before,
.rs-toast[data-type='default']::before {
  background: color-mix(in srgb, var(--rs-info) 68%, transparent);
}

.rs-toast[data-type='info'],
.rs-toast[data-type='default'] {
  --rs-toast-tint: color-mix(in srgb, var(--rs-info) 7%, transparent);
}

.rs-toast[data-type='loading'] [data-icon] {
  color: var(--rs-primary);
}

.rs-toast[data-type='loading'] {
  --rs-toast-tint: color-mix(in srgb, var(--rs-primary) 7%, transparent);
}

@keyframes rs-toast-enter {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.985);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes rs-toast-exit {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  to {
    opacity: 0;
    transform: translateY(4px) scale(0.99);
  }
}

@media (max-width: 640px) {
  .rs-toast {
    min-width: min(100%, 18.5rem);
    max-width: calc(100vw - 1rem);
    padding: 0.8125rem 0.875rem 0.875rem;
    border-radius: 0.9375rem;
  }

  .rs-toast__close {
    top: 0.4375rem;
    right: 0.4375rem;
  }

  .rs-toast__action {
    min-height: 1.875rem;
    padding: 0 0.6875rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .rs-toast,
  .rs-toast__action {
    transition: none;
  }

  .rs-toast[data-mounted='true'],
  .rs-toast[data-removed='true'] {
    animation: none;
  }
}
</style>
