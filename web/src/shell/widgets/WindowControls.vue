<script setup lang="ts">
import { RsIcon } from '@niuma/ui'
import { useWindowChromeStore } from '@/stores/window-chrome'
import { useI18n } from 'vue-i18n'

withDefaults(
  defineProps<{
    /** mac：左侧交通灯；trailing：右侧 Windows 式图标按钮（主窗口顶栏） */
    variant?: 'mac' | 'trailing'
  }>(),
  { variant: 'trailing' },
)

const chrome = useWindowChromeStore()
const { t } = useI18n()
</script>

<template>
  <fieldset
    v-if="chrome.controlsVisible"
    class="nm-window-controls nm-no-drag"
    :class="variant === 'mac' ? 'nm-window-controls--mac' : 'nm-window-controls--trailing'"
  >
    <legend class="nm-window-controls__legend">{{ t('shell.windowControls') }}</legend>
    <div v-if="variant === 'mac'" class="nm-window-controls__cluster">
      <button
        type="button"
        class="nm-traffic nm-traffic--close"
        :title="t('shell.windowClose')"
        :aria-label="t('shell.windowClose')"
        :disabled="chrome.busy"
        @click="chrome.close()"
      >
        <RsIcon name="x" :size="8" class="nm-traffic__glyph" />
      </button>
      <button
        type="button"
        class="nm-traffic nm-traffic--minimize"
        :title="t('shell.windowMinimize')"
        :aria-label="t('shell.windowMinimize')"
        :disabled="chrome.busy"
        @click="chrome.minimize()"
      >
        <RsIcon name="minus" :size="8" class="nm-traffic__glyph" />
      </button>
      <button
        type="button"
        class="nm-traffic nm-traffic--maximize"
        :title="chrome.maximized ? t('shell.windowRestore') : t('shell.windowMaximize')"
        :aria-label="chrome.maximized ? t('shell.windowRestore') : t('shell.windowMaximize')"
        :disabled="chrome.busy"
        @click="chrome.toggleMaximize()"
      >
        <RsIcon :name="chrome.maximized ? 'copy' : 'plus'" :size="8" class="nm-traffic__glyph" />
      </button>
    </div>

    <div v-else class="nm-window-controls__cluster">
      <button
        type="button"
        class="nm-window-controls__btn"
        :title="t('shell.windowMinimize')"
        :aria-label="t('shell.windowMinimize')"
        :disabled="chrome.busy"
        @click="chrome.minimize()"
      >
        <RsIcon name="minus" :size="14" />
      </button>
      <button
        type="button"
        class="nm-window-controls__btn"
        :title="chrome.maximized ? t('shell.windowRestore') : t('shell.windowMaximize')"
        :aria-label="chrome.maximized ? t('shell.windowRestore') : t('shell.windowMaximize')"
        :disabled="chrome.busy"
        @click="chrome.toggleMaximize()"
      >
        <RsIcon :name="chrome.maximized ? 'copy' : 'square'" :size="12" />
      </button>
      <button
        type="button"
        class="nm-window-controls__btn nm-window-controls__btn--close"
        :title="t('shell.windowClose')"
        :aria-label="t('shell.windowClose')"
        :disabled="chrome.busy"
        @click="chrome.close()"
      >
        <RsIcon name="x" :size="14" />
      </button>
    </div>
  </fieldset>
</template>

<style scoped>
.nm-window-controls {
  border: none;
  margin: 0;
  padding: 0;
  min-width: 0;
}

.nm-window-controls__legend {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.nm-window-controls__cluster {
  display: contents;
}
.nm-window-controls--trailing {
  display: flex;
  align-items: center;
  align-self: stretch;
  height: 100%;
  margin-left: var(--rs-space-sm);
  border-left: 1px solid var(--rs-border-subtle);
}

.nm-window-controls__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--rs-muted);
  line-height: 0;
  cursor: pointer;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast);
}

.nm-window-controls__btn :deep(svg) {
  display: block;
}

.nm-window-controls__btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--rs-text) 8%, transparent);
  color: var(--rs-text);
}

.nm-window-controls__btn--close:hover:not(:disabled) {
  background: #e81123;
  color: #fff;
}

.nm-window-controls__btn:disabled {
  opacity: 0.45;
  cursor: default;
}

/* macOS 交通灯：默认纯色圆点，悬停时显示符号 */
.nm-window-controls--mac {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 100%;
  padding: 0 2px;
}

.nm-traffic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0.75rem;
  height: 0.75rem;
  padding: 0;
  border: none;
  border-radius: 50%;
  cursor: default;
  line-height: 0;
  color: rgb(0 0 0 / 0.55);
  transition: filter var(--rs-transition-fast);
}

.nm-traffic__glyph {
  opacity: 0;
  transition: opacity var(--rs-transition-fast);
}

.nm-window-controls--mac:hover .nm-traffic__glyph {
  opacity: 1;
}

.nm-traffic--close {
  background: #ff5f57;
}

.nm-traffic--minimize {
  background: #febc2e;
}

.nm-traffic--maximize {
  background: #28c840;
}

.nm-traffic:hover:not(:disabled) {
  filter: brightness(0.92);
}

.nm-traffic:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
