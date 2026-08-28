<script setup lang="ts">
import { RsDropdown, RsButton, RsIcon, RsInput } from '@niuma/ui'
import type { RsDropdownItems } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import type { ThemePreference } from '@/stores/app'
import { pluginApi } from '@/api'
import type { PluginRecord } from '@/api/types/plugin'
import { useBridgeStore } from '@/stores/bridge'
import type { ExtensionManifest } from '@/extensions/types/manifest'
import { computed, onMounted, ref, watch } from 'vue'
import ComponentsSettingsPanel from '@/shell/views/ComponentsSettingsPanel.vue'
import AiProvidersSettingsPanel from '@/shell/views/ai-settings/AiProvidersSettingsPanel.vue'
import AiMcpSettingsPanel from '@/shell/views/ai-settings/AiMcpSettingsPanel.vue'
import AiSkillsSettingsPanel from '@/shell/views/ai-settings/AiSkillsSettingsPanel.vue'
import DiagnosticsPanel from '@/shell/views/DiagnosticsPanel.vue'
import AppBrandIcon from '@/shell/widgets/AppBrandIcon.vue'
import { useAccountStore } from '@/stores/account'
import { CloudApiError } from '@/api/cloud/client'

/** 设置分区（VS Code 左右布局：左导航 + 右内容） */
type SettingsSection =
  | 'appearance'
  | 'account'
  | 'plugins'
  | 'components'
  | 'ai-providers'
  | 'ai-mcp'
  | 'ai-skills'
  | 'runtime'

const props = defineProps<{
  section?: string
  tabId?: string
}>()

const { t, te } = useI18n()
const appStore = useAppStore()
const bridgeStore = useBridgeStore()
const accountStore = useAccountStore()

const activeSection = ref<SettingsSection>('appearance')

const sections = computed(
  (): { id: SettingsSection; labelKey: string; descKey: string; icon: string }[] => [
    { id: 'appearance', labelKey: 'settings.appearance', descKey: 'settings.appearanceDesc', icon: 'palette' },
    { id: 'account', labelKey: 'settings.account', descKey: 'settings.accountDesc', icon: 'user' },
    { id: 'plugins', labelKey: 'settings.plugins', descKey: 'settings.pluginsDesc', icon: 'puzzle' },
    { id: 'components', labelKey: 'settings.components', descKey: 'settings.componentsDesc', icon: 'wrench' },
    { id: 'ai-providers', labelKey: 'settings.aiProviders', descKey: 'settings.aiProvidersDesc', icon: 'bot' },
    { id: 'ai-mcp', labelKey: 'settings.aiMcp', descKey: 'settings.aiMcpDesc', icon: 'plug-zap' },
    { id: 'ai-skills', labelKey: 'settings.aiSkills', descKey: 'settings.aiSkillsDesc', icon: 'sparkles' },
    { id: 'runtime', labelKey: 'settings.runtime', descKey: 'settings.runtimeDesc', icon: 'info' },
  ],
)

const validSections = new Set<SettingsSection>([
  'appearance',
  'account',
  'plugins',
  'components',
  'ai-providers',
  'ai-mcp',
  'ai-skills',
  'runtime',
])

const themeOptions = computed(
  (): { value: ThemePreference; label: string; icon: string }[] => [
    { value: 'light', label: t('settings.themeLight'), icon: 'sun' },
    { value: 'dark', label: t('settings.themeDark'), icon: 'moon' },
    { value: 'system', label: t('settings.themeSystem'), icon: 'monitor' },
  ],
)

const localeItems = computed<RsDropdownItems>(() => [
  { value: 'zh-CN', label: t('settings.localeZh'), icon: 'languages' },
  { value: 'en-US', label: t('settings.localeEn'), icon: 'languages' },
])

const plugins = ref<PluginRecord[]>([])
const pluginsLoading = ref(false)
const pluginsError = ref<string | null>(null)
const togglingId = ref<string | null>(null)

const profileName = ref('')
const profileBusy = ref(false)
const profileError = ref('')
const profileOk = ref(false)

watch(
  () => accountStore.user?.displayName,
  (name) => {
    profileName.value = name ?? ''
  },
  { immediate: true },
)

function accountErrMsg(e: unknown): string {
  if (e instanceof CloudApiError) {
    const key = `account.errors.${e.code}`
    if (te(key)) return t(key)
    return e.code
  }
  if (e instanceof Error) return e.message
  return t('account.errors.server_error')
}

async function saveDisplayName(): Promise<void> {
  const name = profileName.value.trim()
  if (!name) {
    profileError.value = t('account.validation.displayNameRequired')
    profileOk.value = false
    return
  }
  if ([...name].length > 64) {
    profileError.value = t('account.validation.displayNameLength')
    profileOk.value = false
    return
  }
  profileBusy.value = true
  profileError.value = ''
  profileOk.value = false
  try {
    await accountStore.updateDisplayName(name)
    profileOk.value = true
  } catch (e) {
    profileError.value = accountErrMsg(e)
  } finally {
    profileBusy.value = false
  }
}

function selectSection(id: SettingsSection): void {
  activeSection.value = id
  if (id === 'plugins' && !plugins.value.length) {
    void loadPlugins()
  }
}

function onThemeSelect(value: ThemePreference): void {
  appStore.setThemePreference(value)
}

function onLocaleSelect(value: string): void {
  appStore.setLocale(value as 'zh-CN' | 'en-US')
}

function manifestName(record: PluginRecord): string {
  const m = record.manifest
  if (typeof m === 'object' && m?.name) {
    return m.name
  }
  return record.pluginId ?? record.root
}

function pluginIdOf(record: PluginRecord): string {
  if (record.pluginId) {
    return record.pluginId
  }
  const m = record.manifest
  if (typeof m === 'object') {
    return (m as ExtensionManifest).id
  }
  return record.root
}

/** 加载全部插件及启用状态（含已禁用项） */
async function loadPlugins(): Promise<void> {
  if (!bridgeStore.connected) {
    plugins.value = []
    return
  }

  pluginsLoading.value = true
  pluginsError.value = null
  try {
    const payload = await pluginApi.listAll()
    plugins.value = payload.plugins ?? []
  } catch (e) {
    pluginsError.value = e instanceof Error ? e.message : String(e)
  } finally {
    pluginsLoading.value = false
  }
}

function applySectionProp(section: string | undefined): void {
  if (!section || !validSections.has(section as SettingsSection)) {
    return
  }
  activeSection.value = section as SettingsSection
  if (section === 'plugins' && !plugins.value.length) {
    void loadPlugins()
  }
}

watch(
  () => props.section,
  (section) => applySectionProp(section),
  { immediate: true },
)

/** 切换插件启用状态；变更后刷新页面以重建路由 */
async function togglePlugin(record: PluginRecord): Promise<void> {
  const pluginId = pluginIdOf(record)
  const nextEnabled = record.enabled === false
  togglingId.value = pluginId
  try {
    await pluginApi.setEnabled({ pluginId, enabled: nextEnabled })
    globalThis.location.reload()
  } catch (e) {
    pluginsError.value = e instanceof Error ? e.message : String(e)
  } finally {
    togglingId.value = null
  }
}

onMounted(() => {
  void bridgeStore.bootstrap()
})
</script>

<template>
  <div class="nm-settings">
    <!-- 左：分区导航 -->
    <nav class="nm-settings__nav" :aria-label="t('nav.settings')">
      <div class="nm-settings__nav-title">{{ t('nav.settings') }}</div>
      <button
        v-for="section in sections"
        :key="section.id"
        type="button"
        class="nm-settings__nav-item"
        :class="{ 'nm-settings__nav-item--active': activeSection === section.id }"
        @click="selectSection(section.id)"
      >
        <RsIcon :name="section.icon" :size="16" />
        <span>{{ t(section.labelKey) }}</span>
      </button>
    </nav>

    <!-- 右：内容 -->
    <div class="nm-settings__content">
      <!-- 外观 -->
      <section v-if="activeSection === 'appearance'" class="nm-settings__panel">
        <header class="nm-settings__panel-head">
          <h1 class="nm-section-title">{{ t('settings.appearance') }}</h1>
          <p class="nm-section-desc">{{ t('settings.appearanceDesc') }}</p>
        </header>

        <div class="nm-setting-row">
          <div class="nm-setting-row__info">
            <p class="nm-setting-row__label">{{ t('settings.themeLabel') }}</p>
            <p class="nm-setting-row__desc">{{ t('settings.themeDesc') }}</p>
          </div>
          <div class="nm-segmented">
            <button
              v-for="opt in themeOptions"
              :key="opt.value"
              type="button"
              class="nm-segmented__btn"
              :class="{ 'nm-segmented__btn--active': appStore.themePreference === opt.value }"
              :aria-pressed="appStore.themePreference === opt.value"
              @click="onThemeSelect(opt.value)"
            >
              <RsIcon :name="opt.icon" :size="14" />
              <span>{{ opt.label }}</span>
            </button>
          </div>
        </div>

        <div class="nm-setting-row">
          <div class="nm-setting-row__info">
            <p class="nm-setting-row__label">{{ t('settings.localeLabel') }}</p>
            <p class="nm-setting-row__desc">{{ t('settings.localeDesc') }}</p>
          </div>
          <div class="nm-setting-row__control">
            <RsDropdown
              v-model="appStore.locale"
              :items="localeItems"
              @select="onLocaleSelect"
            />
          </div>
        </div>
      </section>

      <!-- 账户 -->
      <section v-else-if="activeSection === 'account'" class="nm-settings__panel">
        <header class="nm-settings__panel-head">
          <h1 class="nm-section-title">{{ t('settings.account') }}</h1>
          <p class="nm-section-desc">{{ t('settings.accountDesc') }}</p>
        </header>
        <div class="nm-setting-row">
          <div class="nm-setting-row__info">
            <p class="nm-setting-row__label">
              {{
                accountStore.isLoggedIn
                  ? t('account.loggedInAs', { email: accountStore.user?.email })
                  : t('account.notLoggedIn')
              }}
            </p>
            <p class="nm-setting-row__desc">{{ t('account.sectionDesc') }}</p>
          </div>
          <div class="flex gap-2">
            <RsButton
              v-if="!accountStore.isLoggedIn"
              variant="primary"
              size="sm"
              @click="accountStore.openAuth('login')"
            >
              {{ t('account.openLogin') }}
            </RsButton>
            <template v-else>
              <RsButton variant="secondary" size="sm" @click="accountStore.openPasswordChange()">
                {{ t('account.changePassword') }}
              </RsButton>
              <RsButton variant="secondary" size="sm" @click="accountStore.openFeedback()">
                {{ t('account.openFeedback') }}
              </RsButton>
              <RsButton variant="secondary" size="sm" @click="accountStore.doLogout()">
                {{ t('account.logout') }}
              </RsButton>
            </template>
          </div>
        </div>

        <div v-if="accountStore.isLoggedIn" class="nm-setting-row nm-setting-row--stack">
          <div class="nm-setting-row__info">
            <p class="nm-setting-row__label">{{ t('account.displayNameEdit') }}</p>
          </div>
          <div class="nm-account-profile">
            <RsInput v-model="profileName" :placeholder="t('account.displayNameEdit')" />
            <RsButton
              variant="primary"
              size="sm"
              :loading="profileBusy"
              @click="saveDisplayName"
            >
              {{ t('account.displayNameSave') }}
            </RsButton>
            <p v-if="profileError" class="nm-caption" style="color: var(--rs-danger)">
              {{ profileError }}
            </p>
            <p v-else-if="profileOk" class="nm-caption" style="color: var(--rs-success, #22c55e)">
              {{ t('account.displayNameSaved') }}
            </p>
          </div>
        </div>
      </section>

      <!-- 插件 -->
      <section v-else-if="activeSection === 'plugins'" class="nm-settings__panel">
        <header class="nm-settings__panel-head">
          <div class="flex items-center justify-between gap-2">
            <h1 class="nm-section-title">{{ t('settings.plugins') }}</h1>
            <RsButton variant="ghost" size="sm" :disabled="pluginsLoading" @click="loadPlugins">
              {{ t('settings.pluginsRefresh') }}
            </RsButton>
          </div>
          <p class="nm-section-desc">{{ t('settings.pluginsHint') }}</p>
        </header>

        <p v-if="pluginsLoading" class="nm-caption">{{ t('extensions.loading') }}</p>
        <p v-else-if="pluginsError" class="nm-caption" style="color: var(--rs-danger)">
          {{ pluginsError }}
        </p>
        <p v-else-if="!bridgeStore.connected" class="nm-settings__hint">{{ t('settings.devHint') }}</p>
        <div v-else-if="plugins.length" class="nm-settings__list">
          <div
            v-for="record in plugins"
            :key="pluginIdOf(record)"
            class="nm-setting-row"
          >
            <div class="nm-setting-row__info min-w-0">
              <p class="nm-setting-row__label">{{ manifestName(record) }}</p>
              <p class="nm-setting-row__desc truncate font-mono">{{ pluginIdOf(record) }}</p>
            </div>
            <RsButton
              variant="secondary"
              size="sm"
              :disabled="togglingId === pluginIdOf(record)"
              @click="togglePlugin(record)"
            >
              {{ record.enabled !== false ? t('settings.pluginDisable') : t('settings.pluginEnable') }}
            </RsButton>
          </div>
        </div>
        <p v-else class="nm-caption">{{ t('settings.pluginsEmpty') }}</p>
      </section>

      <!-- 工具组件 -->
      <ComponentsSettingsPanel v-else-if="activeSection === 'components'" />

      <!-- 模型接入 -->
      <AiProvidersSettingsPanel v-else-if="activeSection === 'ai-providers'" />

      <!-- MCP 服务 -->
      <AiMcpSettingsPanel v-else-if="activeSection === 'ai-mcp'" />

      <!-- AI Skills -->
      <AiSkillsSettingsPanel v-else-if="activeSection === 'ai-skills'" />

      <!-- 关于 -->
      <section v-else class="nm-settings__panel">
        <header class="nm-settings__panel-head">
          <h1 class="nm-section-title">{{ t('settings.runtime') }}</h1>
          <p class="nm-section-desc">{{ t('settings.runtimeDesc') }}</p>
        </header>

        <div class="nm-about-card">
          <div class="nm-about-card__top">
            <div class="nm-about-card__brand">
              <div class="nm-about-card__mark">
                <AppBrandIcon :size="28" variant="app" />
              </div>
              <div class="min-w-0">
                <p class="nm-about-card__name">{{ t('app.title') }}</p>
                <p class="nm-about-card__tag">{{ t('app.subtitle') }}</p>
              </div>
            </div>
            <span
              class="nm-about-card__status"
              :class="
                bridgeStore.connected
                  ? 'nm-about-card__status--ready'
                  : 'nm-about-card__status--offline'
              "
            >
              {{ bridgeStore.connected ? t('settings.appReady') : t('settings.appOffline') }}
            </span>
          </div>
          <div class="nm-about-card__meta">
            <div class="nm-about-card__item">
              <span class="nm-about-card__k">{{ t('settings.appVersion') }}</span>
              <span class="nm-about-card__v">{{ bridgeStore.shellVersion || '—' }}</span>
            </div>
            <div class="nm-about-card__item">
              <span class="nm-about-card__k">{{ t('settings.buildId') }}</span>
              <span class="nm-about-card__v">{{ bridgeStore.shellBuildId || '—' }}</span>
            </div>
          </div>
        </div>

        <DiagnosticsPanel />
      </section>
    </div>
  </div>
</template>

<style scoped>
.nm-settings {
  display: flex;
  height: 100%;
  min-height: 0;
  background: var(--nm-editor-bg);
}

/* 左导航 */
.nm-settings__nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 13rem;
  flex-shrink: 0;
  padding: var(--rs-space-md) var(--rs-space-sm);
  border-right: 1px solid var(--rs-border-subtle);
  overflow-y: auto;
}

.nm-settings__nav-title {
  padding: 0 var(--rs-space-sm) var(--rs-space-sm);
  font-size: var(--nm-font-caption);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--rs-muted);
}

.nm-settings__nav-item {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-sm) var(--rs-space-sm);
  border: none;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--nm-font-body);
  text-align: left;
  cursor: pointer;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast);
}

.nm-settings__nav-item:hover {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.nm-settings__nav-item--active {
  background: color-mix(in srgb, var(--rs-primary) 16%, transparent);
  color: var(--rs-primary);
}

/* 右内容：纵向铺满，便于「工具组件 / 模型接入」等全高面板贴边 */
.nm-settings__content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.nm-settings__panel {
  max-width: 44rem;
  padding: var(--rs-space-xl);
}

.nm-settings__panel-head {
  margin-bottom: var(--rs-space-lg);
}

.nm-settings__panel-head .nm-section-desc {
  margin-top: 0.25rem;
}

/* 设置行：左标签右控件（macOS System Settings 风格） */
.nm-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-lg);
  padding: var(--rs-space-md) 0;
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-setting-row:last-child {
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-settings__list .nm-setting-row + .nm-setting-row {
  border-top: none;
}

.nm-settings__list .nm-setting-row {
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-settings__list .nm-setting-row:last-child {
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-setting-row__info {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.nm-setting-row__label {
  font-size: var(--nm-font-body);
  font-weight: 500;
  color: var(--rs-text);
}

.nm-setting-row__desc {
  font-size: var(--nm-font-caption);
  color: var(--rs-muted);
}

.nm-setting-row__control {
  width: 12rem;
  flex-shrink: 0;
}

.nm-setting-row--stack {
  flex-direction: column;
  align-items: stretch;
}

.nm-account-profile {
  display: grid;
  gap: 0.5rem;
  max-width: 24rem;
}

.nm-account-profile .nm-caption {
  margin: 0;
}

/* 主题分段控件 */
.nm-segmented {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  border-radius: var(--rs-radius-sm);
  background: color-mix(in srgb, var(--rs-text) 6%, transparent);
}

.nm-segmented__btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.3rem 0.7rem;
  border: none;
  border-radius: calc(var(--rs-radius-sm) - 2px);
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--nm-font-caption);
  cursor: pointer;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast),
    box-shadow var(--rs-transition-fast);
}

.nm-segmented__btn:hover {
  color: var(--rs-text);
}

.nm-segmented__btn--active {
  background: var(--rs-surface-elevated);
  color: var(--rs-text);
  box-shadow: var(--rs-shadow-sm);
}

.nm-settings__hint {
  margin: 0;
  padding: var(--rs-space-md);
  border-radius: var(--rs-radius);
  background: color-mix(in srgb, var(--rs-text) 4%, transparent);
  color: var(--rs-muted);
  font-size: var(--nm-font-caption);
  line-height: 1.5;
}

.nm-about-card {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  padding: var(--rs-space-lg);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius);
  background: var(--rs-surface-elevated, var(--rs-surface));
}

.nm-about-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-md);
}

.nm-about-card__brand {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  min-width: 0;
}

.nm-about-card__mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  flex-shrink: 0;
}

.nm-about-card__name {
  margin: 0;
  font-size: var(--nm-font-title);
  font-weight: 650;
  color: var(--rs-text);
}

.nm-about-card__tag {
  margin: 0.15rem 0 0;
  font-size: var(--nm-font-caption);
  color: var(--rs-muted);
}

.nm-about-card__status {
  flex-shrink: 0;
  padding: 0.2rem 0.6rem;
  border-radius: var(--rs-radius-full, 999px);
  font-size: var(--nm-font-caption);
  font-weight: 550;
}

.nm-about-card__status--ready {
  color: var(--rs-success, #16a34a);
  background: color-mix(in srgb, var(--rs-success, #16a34a) 12%, transparent);
}

.nm-about-card__status--offline {
  color: var(--rs-muted);
  background: color-mix(in srgb, var(--rs-text) 6%, transparent);
}

.nm-about-card__meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--rs-space-sm);
}

.nm-about-card__item {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.65rem 0.75rem;
  border-radius: var(--rs-radius-sm);
  background: color-mix(in srgb, var(--rs-text) 4%, transparent);
}

.nm-about-card__k {
  font-size: var(--nm-font-caption);
  color: var(--rs-muted);
}

.nm-about-card__v {
  font-size: var(--nm-font-body);
  font-weight: 550;
  font-variant-numeric: tabular-nums;
  color: var(--rs-text);
}
</style>
