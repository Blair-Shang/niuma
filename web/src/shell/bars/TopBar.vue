<script setup lang="ts">
import { RsIcon, RsInput, RsPopover } from '@niuma/ui'
import AppBrandIcon from '@/shell/widgets/AppBrandIcon.vue'
import WindowControls from '@/shell/widgets/WindowControls.vue'
import CommandPalettePanel from '@/shell/panels/CommandPalettePanel.vue'
import { useI18n } from 'vue-i18n'
import { computed, onMounted } from 'vue'
import { useBridgeStore } from '@/stores/bridge'
import { useWindowChromeStore } from '@/stores/window-chrome'
import { useCommandPaletteStore } from '@/stores/command-palette'
import { useShellStore } from '@/stores/shell'
import { useTabStore } from '@/stores/tab'
import { SETTINGS_VIEW_ID } from '@/shell/internal-views'

const { t } = useI18n()
const bridgeStore = useBridgeStore()
const paletteStore = useCommandPaletteStore()
const windowChrome = useWindowChromeStore()
const shellStore = useShellStore()
const tabStore = useTabStore()

/** 设置 Tab 是否为当前激活 Tab（齿轮高亮） */
const settingsActive = computed(() => tabStore.activeTab?.moduleId === SETTINGS_VIEW_ID)

function onTopBarDoubleClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('.nm-no-drag')) {
    return
  }
  void windowChrome.toggleMaximize()
}

/** 打开设置：作为编辑器 Tab 呈现（VS Code 式），已存在则聚焦 */
function openSettings() {
  tabStore.openSettings()
}

onMounted(() => {
  void bridgeStore.bootstrap().then(() => windowChrome.bootstrap())
})
</script>

<template>
  <!-- 全宽顶栏：品牌 | 拖拽 | 搜索 | 窗口控制 — 全部垂直居中 -->
  <header class="nm-topbar shrink-0" @dblclick="onTopBarDoubleClick">
    <div class="nm-topbar__brand nm-drag-region">
      <span class="nm-brand-icon" :title="t('app.title')">
        <AppBrandIcon :size="14" variant="mark" />
      </span>
    </div>

    <div class="nm-topbar__spacer nm-drag-region" aria-hidden="true" />

    <div class="nm-topbar__actions nm-no-drag">
      <RsPopover
        v-model:open="paletteStore.open"
        side="bottom"
        align="start"
        :side-offset="8"
        width="auto"
      >
        <div class="nm-topbar__search" :title="t('commandPalette.shortcutHint')">
          <RsInput class="pointer-events-none" :placeholder="t('shell.searchPlaceholder')" readonly>
            <template #prefix>
              <RsIcon name="search" :size="14" style="color: var(--rs-muted)" />
            </template>
          </RsInput>
        </div>
        <template #content>
          <CommandPalettePanel />
        </template>
      </RsPopover>

      <button
        type="button"
        class="nm-topbar__icon-btn"
        :class="{ 'nm-topbar__icon-btn--active': shellStore.aiPanelOpen }"
        :title="t('ai.toggle')"
        :aria-label="t('ai.toggle')"
        :aria-pressed="shellStore.aiPanelOpen"
        @click="shellStore.toggleAiPanel()"
      >
        <RsIcon name="bot" :size="16" />
      </button>

      <button
        type="button"
        class="nm-topbar__icon-btn"
        :class="{ 'nm-topbar__icon-btn--active': settingsActive }"
        :title="t('nav.settings')"
        :aria-label="t('nav.settings')"
        :aria-pressed="settingsActive"
        @click="openSettings"
      >
        <RsIcon name="settings" :size="16" />
      </button>

      <WindowControls />
    </div>
  </header>
</template>

<style scoped>
.nm-topbar__search {
  width: 16rem;
  max-width: 28vw;
  cursor: text;
  flex-shrink: 1;
  min-width: 8rem;
  display: flex;
  align-items: center;
  outline: none;
}

.nm-topbar__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--nm-topbar-control-h);
  height: var(--nm-topbar-control-h);
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-muted);
  line-height: 0;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast);
}

.nm-topbar__icon-btn :deep(svg) {
  display: block;
}

.nm-topbar__icon-btn:hover {
  background: color-mix(in srgb, var(--rs-text) 8%, transparent);
  color: var(--rs-text);
}

.nm-topbar__icon-btn--active {
  color: var(--rs-primary);
}

/* 面板展开时高亮搜索框边框（reka 在触发器上写 data-state） */
.nm-topbar__search[data-state='open'] :deep(.rs-input-group) {
  border-color: var(--rs-focus-border);
}

/* 覆盖 RsInput 默认 md 高度（.rs-input-group 有 min-height），使其贴合顶栏并留出上下留白 */
.nm-topbar__search :deep(.rs-input-field),
.nm-topbar__search :deep(.rs-input-group) {
  width: 100%;
}

.nm-topbar__search :deep(.rs-input-group) {
  height: var(--nm-topbar-control-h);
  min-height: var(--nm-topbar-control-h);
}

.nm-topbar__search :deep(.rs-input-group__control) {
  height: 100%;
  min-height: 0;
}
</style>
