<script setup lang="ts">
/**
 * 空工作区欢迎页：铺满编辑区，极光品牌标 + 主操作，最近连接与开始分栏。
 * 只读侧栏连接快照；有 Tab 时不挂载。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RsButton, RsIcon } from '@niuma/ui'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { kindIcon, profileAccentColor, type ConnItem } from '@/modules/ops/types'
import { useCommandPaletteStore } from '@/stores/command-palette'
import { useConnTreeSyncStore } from '@/stores/conn-tree-sync'
import { useShellStore } from '@/stores/shell'
import { useTabStore } from '@/stores/tab'
import AppBrandIcon from '@/shell/widgets/AppBrandIcon.vue'
import {
  WORKSPACE_RECENT_LIMIT,
  chordKeys,
  kindLabel,
  profileHostLabel,
  sortRecentProfiles,
} from './workspace-empty'

type StartCommand = {
  id: string
  label: string
  icon: string
  keys?: string[]
  run: () => void
}

const { t } = useI18n()
const { connect } = useConnectionNavigation()
const connTreeSync = useConnTreeSyncStore()
const shellStore = useShellStore()
const tabStore = useTabStore()
const paletteStore = useCommandPaletteStore()

const recent = computed(() => sortRecentProfiles(connTreeSync.profiles, WORKSPACE_RECENT_LIMIT))
const hasSites = computed(() => connTreeSync.profiles.length > 0)
const commandKeys = chordKeys('K')

function revealSidebar(): void {
  shellStore.showSidebar()
}

function startSsh(): void {
  revealSidebar()
  connTreeSync.requestCreate('ssh')
}

function startMysql(): void {
  revealSidebar()
  connTreeSync.requestCreate('mysql')
}

function startImport(): void {
  revealSidebar()
  connTreeSync.requestImport()
}

function openRecent(item: ConnItem): void {
  connect(item)
}

const commands = computed((): StartCommand[] => {
  const extras: StartCommand[] = hasSites.value
    ? []
    : [{ id: 'mysql', label: t('workspace.watermarkNewMysql'), icon: 'mysql', run: startMysql }]
  return [
    ...extras,
    {
      id: 'palette',
      label: t('workspace.watermarkShowCommands'),
      icon: 'search',
      keys: commandKeys,
      run: () => paletteStore.show(),
    },
    { id: 'settings', label: t('workspace.watermarkSettings'), icon: 'settings', run: () => tabStore.openSettings() },
  ]
})
</script>

<template>
  <div class="nm-workspace-empty">
    <div class="nm-workspace-empty__frame" :class="{ 'nm-workspace-empty__frame--start': !hasSites }">
      <header class="nm-workspace-empty__hero">
        <div class="nm-workspace-empty__intro">
          <span class="nm-brand-icon nm-workspace-empty__brand" aria-hidden="true">
            <AppBrandIcon :size="20" />
          </span>
          <div class="nm-workspace-empty__copy">
            <h1 class="nm-workspace-empty__title">
              {{ hasSites ? t('workspace.emptyTitle') : t('workspace.startTitle') }}
            </h1>
            <p class="nm-workspace-empty__desc">
              {{ hasSites ? t('workspace.emptyDesc') : t('workspace.startDesc') }}
            </p>
          </div>
        </div>
        <div class="nm-workspace-empty__cta">
          <RsButton variant="primary" size="sm" @click="startSsh">
            {{ hasSites ? t('workspace.watermarkNewConnection') : t('workspace.watermarkNewSsh') }}
          </RsButton>
          <RsButton size="sm" @click="startImport">{{ t('workspace.watermarkImport') }}</RsButton>
        </div>
      </header>

      <div class="nm-workspace-empty__board">
        <section v-if="hasSites" class="nm-workspace-empty__block">
          <h2 class="nm-workspace-empty__label">{{ t('workspace.recentTitle') }}</h2>
          <div class="nm-workspace-empty__group">
            <button
              v-for="item in recent"
              :key="item.profileId"
              type="button"
              class="nm-workspace-empty__item"
              :title="profileHostLabel(item)"
              @click="openRecent(item)"
            >
              <span
                class="nm-workspace-empty__well"
                :style="{ '--nm-empty-accent': profileAccentColor(item.connectionOptions) }"
              >
                <RsIcon :name="kindIcon(item.kind)" :size="15" :stroke-width="2" />
              </span>
              <span class="nm-workspace-empty__name">{{ item.profileName }}</span>
              <span class="nm-workspace-empty__kind">{{ kindLabel(item.kind) }}</span>
              <span class="nm-workspace-empty__meta">{{ profileHostLabel(item) }}</span>
            </button>
          </div>
        </section>

        <section class="nm-workspace-empty__block">
          <h2 class="nm-workspace-empty__label">{{ t('workspace.startSection') }}</h2>
          <div class="nm-workspace-empty__group">
            <button
              v-for="cmd in commands"
              :key="cmd.id"
              type="button"
              class="nm-workspace-empty__item"
              @click="cmd.run()"
            >
              <span class="nm-workspace-empty__well">
                <RsIcon :name="cmd.icon" :size="15" :stroke-width="2" />
              </span>
              <span class="nm-workspace-empty__name">{{ cmd.label }}</span>
              <span v-if="cmd.keys" class="nm-workspace-empty__keys">
                <kbd v-for="key in cmd.keys" :key="key">{{ key }}</kbd>
              </span>
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nm-workspace-empty {
  position: relative;
  isolation: isolate;
  display: flex;
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  align-items: center;
  justify-content: center;
  padding: 1.5rem 2rem;
  box-sizing: border-box;
}

.nm-workspace-empty__frame {
  display: flex;
  width: min(56rem, 100%);
  max-width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 1.5rem;
}

.nm-workspace-empty__frame--start {
  width: min(36rem, 100%);
}

.nm-workspace-empty__hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1.25rem 1.75rem;
}

.nm-workspace-empty__intro {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.9rem;
}

.nm-workspace-empty__brand.nm-brand-icon {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.72rem;
}

.nm-workspace-empty__copy {
  min-width: 0;
}

.nm-workspace-empty__title {
  margin: 0;
  font-size: var(--nm-font-heading);
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.25;
  color: var(--rs-text);
}

.nm-workspace-empty__desc {
  margin: 0.2rem 0 0;
  color: var(--rs-muted);
  font-size: var(--nm-font-body);
  line-height: 1.45;
}

.nm-workspace-empty__cta {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.5rem;
}

.nm-workspace-empty__board {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(16rem, 0.8fr);
  gap: 1.25rem 1.5rem;
  align-items: start;
}

.nm-workspace-empty__frame--start .nm-workspace-empty__board {
  grid-template-columns: minmax(0, 1fr);
}

.nm-workspace-empty__block {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.4rem;
}

.nm-workspace-empty__label {
  margin: 0;
  padding: 0 0.15rem;
  font-size: var(--nm-font-caption);
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--rs-muted);
}

.nm-workspace-empty__group {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--rs-border-subtle) 80%, var(--rs-primary));
  border-radius: calc(var(--nm-content-radius) + 2px);
  background: color-mix(in srgb, var(--rs-surface) 92%, transparent);
  backdrop-filter: blur(16px);
  box-shadow:
    0 1px 0 var(--nm-elev-highlight) inset,
    var(--nm-elev-shadow),
    0 0 0 1px color-mix(in srgb, var(--rs-primary) 8%, transparent);
}

.nm-workspace-empty__item {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  width: 100%;
  min-height: 2.7rem;
  margin: 0;
  padding: 0.45rem 0.75rem;
  border: 0;
  background: transparent;
  color: var(--rs-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.nm-workspace-empty__item + .nm-workspace-empty__item {
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-workspace-empty__item:hover {
  background: color-mix(in srgb, var(--rs-text) 5.5%, transparent);
}

.nm-workspace-empty__well {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 6px;
  background: color-mix(in srgb, var(--nm-empty-accent, var(--rs-muted)) 16%, transparent);
  color: var(--nm-empty-accent, var(--rs-muted));
}

.nm-workspace-empty__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  font-size: var(--nm-font-body);
  font-weight: 500;
  line-height: 1.3;
}

.nm-workspace-empty__kind {
  flex: 0 0 auto;
  color: var(--rs-muted);
  font-size: var(--nm-font-caption);
}

.nm-workspace-empty__meta {
  flex: 0 1 auto;
  max-width: 42%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--rs-muted);
  font-size: var(--nm-font-caption);
  line-height: 1.3;
}

.nm-workspace-empty__keys {
  display: inline-flex;
  align-items: center;
  gap: 0.18rem;
  flex: 0 0 auto;
}

.nm-workspace-empty__keys kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.3rem;
  height: 1.3rem;
  padding: 0 0.32rem;
  border: 1px solid var(--rs-border-subtle);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--rs-text) 6%, var(--nm-editor-bg));
  box-shadow: none;
  font: inherit;
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  color: var(--rs-muted);
}

@media (max-width: 800px) {
  .nm-workspace-empty__hero {
    flex-wrap: wrap;
  }

  .nm-workspace-empty__board,
  .nm-workspace-empty__frame--start .nm-workspace-empty__board {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
