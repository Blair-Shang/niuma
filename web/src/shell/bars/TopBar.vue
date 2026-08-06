<script setup lang="ts">
import { RsIcon, RsInput, RsPopover } from '@niuma/ui'
import AppBrandIcon from '@/shell/widgets/AppBrandIcon.vue'
import WindowControls from '@/shell/widgets/WindowControls.vue'
import CommandPalettePanel from '@/shell/panels/CommandPalettePanel.vue'
import { useI18n } from 'vue-i18n'
import { computed, onMounted, ref } from 'vue'
import { useBridgeStore } from '@/stores/bridge'
import { useWindowChromeStore } from '@/stores/window-chrome'
import { useCommandPaletteStore } from '@/stores/command-palette'
import { useShellStore } from '@/stores/shell'
import { useTabStore } from '@/stores/tab'
import { useAccountStore } from '@/stores/account'
import { useAppUpdateStore } from '@/stores/app-update'
import { SETTINGS_VIEW_ID } from '@/shell/internal-views'

const { t } = useI18n()
const bridgeStore = useBridgeStore()
const paletteStore = useCommandPaletteStore()
const windowChrome = useWindowChromeStore()
const shellStore = useShellStore()
const tabStore = useTabStore()
const accountStore = useAccountStore()
const appUpdateStore = useAppUpdateStore()

const accountMenuOpen = ref(false)
const helpMenuOpen = ref(false)

/** 设置 Tab 是否为当前激活 Tab（齿轮高亮） */
const settingsActive = computed(() => tabStore.activeTab?.moduleId === SETTINGS_VIEW_ID)

const accountLabel = computed(() => {
  if (!accountStore.isLoggedIn) return t('account.menuSignIn')
  const u = accountStore.user
  return u?.displayName || u?.email || t('account.section')
})

const accountInitial = computed(() => {
  const raw = accountStore.user?.displayName || accountStore.user?.email || ''
  const ch = [...raw.trim()][0]
  return ch ? ch.toUpperCase() : ''
})

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

function openAccountSettings() {
  accountMenuOpen.value = false
  tabStore.openSettings({ section: 'account' })
}

function onMenuSignIn() {
  accountMenuOpen.value = false
  accountStore.openAuth('login')
}

function onMenuFeedback() {
  accountMenuOpen.value = false
  accountStore.openFeedback()
}

function onMenuChangePassword() {
  accountMenuOpen.value = false
  accountStore.openPasswordChange()
}

function onMenuLogout() {
  accountMenuOpen.value = false
  void accountStore.doLogout()
}

function onHelpChangelog() {
  helpMenuOpen.value = false
  void appUpdateStore.openChangelog()
}

function onHelpAbout() {
  helpMenuOpen.value = false
  appUpdateStore.openAbout()
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

      <div class="nm-topbar__account">
        <RsPopover v-model:open="accountMenuOpen" side="bottom" align="end" :side-offset="6" width="auto">
          <button
            type="button"
            class="nm-topbar__icon-btn nm-topbar__account-btn"
            :class="{
              'nm-topbar__icon-btn--active': accountMenuOpen,
              'nm-topbar__account-btn--signed': accountStore.isLoggedIn,
            }"
            :title="accountLabel"
            :aria-label="t('account.userMenuAria')"
            :aria-expanded="accountMenuOpen"
            :aria-haspopup="true"
          >
            <span v-if="accountStore.isLoggedIn" class="nm-topbar__avatar" aria-hidden="true">
              {{ accountInitial }}
            </span>
            <RsIcon v-else name="user" :size="16" />
          </button>
          <template #content>
            <div class="nm-account-menu">
              <template v-if="accountStore.isLoggedIn">
                <div class="nm-account-menu__head">
                  <span class="nm-account-menu__avatar" aria-hidden="true">{{ accountInitial }}</span>
                  <div class="nm-account-menu__meta">
                    <div class="nm-account-menu__name">
                      {{ accountStore.user?.displayName || accountStore.user?.email }}
                    </div>
                    <div v-if="accountStore.user?.displayName" class="nm-account-menu__email">
                      {{ accountStore.user.email }}
                    </div>
                  </div>
                </div>
                <div class="nm-account-menu__list" role="menu">
                  <button type="button" class="nm-account-menu__item" role="menuitem" @click="openAccountSettings">
                    <RsIcon name="settings" :size="14" />
                    <span>{{ t('account.menuAccount') }}</span>
                  </button>
                  <button type="button" class="nm-account-menu__item" role="menuitem" @click="onMenuChangePassword">
                    <RsIcon name="key-round" :size="14" />
                    <span>{{ t('account.changePassword') }}</span>
                  </button>
                  <button type="button" class="nm-account-menu__item" role="menuitem" @click="onMenuFeedback">
                    <RsIcon name="message-square" :size="14" />
                    <span>{{ t('account.menuFeedback') }}</span>
                  </button>
                  <button
                    type="button"
                    class="nm-account-menu__item nm-account-menu__item--muted"
                    role="menuitem"
                    @click="onMenuLogout"
                  >
                    <RsIcon name="log-out" :size="14" />
                    <span>{{ t('account.logout') }}</span>
                  </button>
                </div>
              </template>
              <template v-else>
                <div class="nm-account-menu__guest">
                  <span class="nm-account-menu__avatar nm-account-menu__avatar--guest" aria-hidden="true">
                    <RsIcon name="user" :size="16" />
                  </span>
                  <div class="nm-account-menu__meta">
                    <div class="nm-account-menu__name">{{ t('account.notLoggedIn') }}</div>
                    <div class="nm-account-menu__email">{{ t('account.menuGuestHint') }}</div>
                  </div>
                </div>
                <button type="button" class="nm-account-menu__cta" @click="onMenuSignIn">
                  {{ t('account.menuSignIn') }}
                </button>
              </template>
            </div>
          </template>
        </RsPopover>
      </div>

      <div class="nm-topbar__help">
        <RsPopover v-model:open="helpMenuOpen" side="bottom" align="end" :side-offset="6" width="auto">
          <button
            type="button"
            class="nm-topbar__icon-btn"
            :class="{ 'nm-topbar__icon-btn--active': helpMenuOpen }"
            :title="t('shell.help.menuAria')"
            :aria-label="t('shell.help.menuAria')"
            :aria-expanded="helpMenuOpen"
            :aria-haspopup="true"
          >
            <RsIcon name="circle-question-mark" :size="16" />
          </button>
          <template #content>
            <div class="nm-help-menu" role="menu">
              <button type="button" class="nm-help-menu__item" role="menuitem" @click="onHelpChangelog">
                <RsIcon name="scroll-text" :size="14" />
                <span>{{ t('shell.help.changelog') }}</span>
              </button>
              <button type="button" class="nm-help-menu__item" role="menuitem" @click="onHelpAbout">
                <RsIcon name="info" :size="14" />
                <span>{{ t('shell.help.about') }}</span>
              </button>
            </div>
          </template>
        </RsPopover>
      </div>

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

.nm-topbar__account :deep(.rs-popover__content),
.nm-topbar__help :deep(.rs-popover__content) {
  width: 15.5rem;
  min-width: 15.5rem;
  padding: 0.4rem;
  color: var(--rs-text);
  background: var(--rs-surface-elevated);
  border-color: var(--rs-border);
}

.nm-topbar__help :deep(.rs-popover__content) {
  width: 11.5rem;
  min-width: 11.5rem;
}

.nm-help-menu {
  display: grid;
  gap: 0.1rem;
}

.nm-help-menu__item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  border: none;
  outline: none;
  box-shadow: none;
  background: transparent;
  color: var(--rs-text);
  border-radius: 0.4rem;
  padding: 0.42rem 0.55rem;
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
  text-align: left;
  transition: background var(--rs-transition-fast);
}

.nm-help-menu__item:hover,
.nm-help-menu__item:focus-visible {
  background: color-mix(in srgb, var(--rs-text) 7%, transparent);
}

.nm-topbar__account-btn--signed {
  color: var(--rs-text);
}

.nm-topbar__avatar,
.nm-account-menu__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--rs-primary) 16%, var(--rs-surface));
  color: var(--rs-primary);
  font-size: 0.65rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
  user-select: none;
}

.nm-account-menu__avatar {
  width: 2rem;
  height: 2rem;
  font-size: 0.8rem;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--rs-primary) 18%, var(--rs-surface-elevated));
}

.nm-account-menu__avatar--guest {
  background: color-mix(in srgb, var(--rs-text) 8%, var(--rs-surface-elevated));
  color: var(--rs-muted);
}

.nm-account-menu {
  display: grid;
  gap: 0.35rem;
}

.nm-account-menu__head,
.nm-account-menu__guest {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.45rem 0.5rem 0.55rem;
}

.nm-account-menu__head {
  border-bottom: 1px solid var(--rs-border-subtle, var(--rs-border));
  margin: 0 0.1rem;
  padding-bottom: 0.65rem;
}

.nm-account-menu__meta {
  min-width: 0;
  flex: 1;
}

.nm-account-menu__name {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--rs-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-account-menu__email {
  margin-top: 0.1rem;
  font-size: 0.72rem;
  color: var(--rs-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.35;
}

.nm-account-menu__list {
  display: grid;
  gap: 0.1rem;
}

.nm-account-menu__item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  border: none;
  outline: none;
  box-shadow: none;
  background: transparent;
  color: var(--rs-text);
  border-radius: 0.4rem;
  padding: 0.42rem 0.55rem;
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
  text-align: left;
  transition: background var(--rs-transition-fast);
}

.nm-account-menu__item:hover,
.nm-account-menu__item:focus-visible {
  background: color-mix(in srgb, var(--rs-text) 7%, transparent);
}

.nm-account-menu__item--muted {
  color: var(--rs-muted);
}

.nm-account-menu__item--muted:hover,
.nm-account-menu__item--muted:focus-visible {
  color: var(--rs-text);
}

.nm-account-menu__cta {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  border: none;
  outline: none;
  box-shadow: none;
  border-radius: 0.45rem;
  padding: 0.48rem 0.75rem;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  color: var(--rs-primary-foreground);
  background: var(--rs-primary);
  transition: background var(--rs-transition-fast);
}

.nm-account-menu__cta:hover {
  background: var(--rs-primary-hover);
}

.nm-account-menu__cta:focus-visible {
  outline: 2px solid var(--rs-focus-ring);
  outline-offset: 1px;
}
</style>
