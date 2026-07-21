<script setup lang="ts">
/**
 * 全局设置 · 模型接入（nm_ai_provider / nm_ai_model）。
 *
 * 布局对齐「工具组件」：左列表 + 右详情；API Key 经 Vault 加密，从不回显明文。
 */
import { RsButton, RsEmpty, RsIcon, RsInput, RsSelect, RsTooltip } from '@niuma/ui'
import type { RsSelectOption } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import { computed, onMounted, ref, watch } from 'vue'
import { aiApi } from '@/api/ai'
import type { AiProvider, AiProviderKind } from '@/api/types/ai'
import { useBridgeStore } from '@/stores/bridge'
import {
  AI_PROVIDER_PRESET_CUSTOM,
  AI_PROVIDER_PRESETS,
  findAiProviderPreset,
  matchAiProviderPreset,
} from './provider-presets'

const { t } = useI18n()
const bridgeStore = useBridgeStore()

const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const providers = ref<AiProvider[]>([])
const selectedId = ref<string | null>(null)
/** 新建模式：右侧展示空白表单，尚无 providerId。 */
const creating = ref(false)

const formPresetId = ref(AI_PROVIDER_PRESET_CUSTOM)
const formName = ref('')
const formKind = ref<AiProviderKind>('openai')
const formBaseUrl = ref('')
/** 已选模型 code（可多选）；保存时同步到 nm_ai_model，首项作为 defaultModelCode。 */
const formSelectedModels = ref<string[]>([])
const formApiKey = ref('')
const formRowVersion = ref(0)

/** 从上游 /models 拉取的候选项（不含预设推荐）。 */
const remoteModelIds = ref<string[]>([])
/** 下拉搜索词：用于在同一选择器内「添加自定义模型」，避免另起一行输入。 */
const modelSearchQuery = ref('')
const probing = ref(false)
const fetchingModels = ref(false)
const statusMessage = ref<string | null>(null)
/** 防止快速切换 Provider 时异步回填串台。 */
let formLoadSeq = 0

const presetOptions = computed((): RsSelectOption[] =>
  AI_PROVIDER_PRESETS.map((p) => ({
    value: p.id,
    label: p.id === AI_PROVIDER_PRESET_CUSTOM ? t('settings.aiProvidersPresetCustom') : p.label,
  })),
)

const kindOptions = computed((): RsSelectOption[] => [
  { value: 'openai', label: 'OpenAI / Compatible' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'azure_openai', label: 'Azure OpenAI' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'custom', label: t('settings.aiProvidersKindCustom') },
])

const activePreset = computed(() => findAiProviderPreset(formPresetId.value))

const presetHint = computed(() => {
  const key = activePreset.value?.hintKey
  return key ? t(key) : t('settings.aiProvidersBaseUrlHint')
})

/** 下拉选项 = 远程 ∪ 已选（按搜索过滤）∪（搜索词可作为自定义添加项）。 */
const modelSelectOptions = computed((): RsSelectOption[] => {
  const ids = new Set<string>()
  for (const id of remoteModelIds.value) {
    ids.add(id)
  }
  for (const id of formSelectedModels.value) {
    ids.add(id)
  }
  const q = modelSearchQuery.value.trim()
  const qLower = q.toLowerCase()
  const matched = [...ids]
    .filter((id) => !qLower || id.toLowerCase().includes(qLower))
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ value: id, label: id }))
  if (q && !ids.has(q)) {
    matched.unshift({
      value: q,
      label: t('settings.aiProvidersAddModelOption', { code: q }),
    })
  }
  return matched
})

const selected = computed(() =>
  providers.value.find((p) => p.providerId === selectedId.value) ?? null,
)

const showDetail = computed(() => creating.value || selected.value != null)

const kindLabel = computed(() => {
  const preset = activePreset.value
  if (preset && preset.id !== AI_PROVIDER_PRESET_CUSTOM) {
    return preset.label
  }
  const k = formKind.value
  return kindOptions.value.find((o) => o.value === k)?.label ?? k
})

function normalizeKind(kind: string): AiProviderKind {
  const allowed = ['openai', 'anthropic', 'azure_openai', 'ollama', 'custom'] as const
  return (allowed as readonly string[]).includes(kind) ? (kind as AiProviderKind) : 'custom'
}

/** 应用预设：自动填充类型、地址；不预填模型，由用户拉取或手输。 */
function applyPreset(presetId: string, opts?: { fillName?: boolean }): void {
  const preset = findAiProviderPreset(presetId)
  if (!preset) {
    return
  }
  formPresetId.value = preset.id
  formKind.value = preset.kind
  formBaseUrl.value = preset.baseUrl
  formSelectedModels.value = []
  modelSearchQuery.value = ''
  remoteModelIds.value = []
  statusMessage.value = null
  if (opts?.fillName !== false && (creating.value || !formName.value.trim())) {
    if (preset.defaultName) {
      formName.value = preset.defaultName
    }
  }
}

function onPresetChange(value: string | string[]): void {
  const presetId = Array.isArray(value) ? (value[0] ?? AI_PROVIDER_PRESET_CUSTOM) : value
  if (!presetId || presetId === AI_PROVIDER_PRESET_CUSTOM) {
    formPresetId.value = AI_PROVIDER_PRESET_CUSTOM
    remoteModelIds.value = []
    return
  }
  applyPreset(presetId, { fillName: creating.value })
}

function onModelsSelect(value: string | string[]): void {
  if (Array.isArray(value)) {
    formSelectedModels.value = value.map(String).filter(Boolean)
  } else {
    formSelectedModels.value = value ? [String(value)] : []
  }
  modelSearchQuery.value = ''
}

function onModelSearch(query: string): void {
  modelSearchQuery.value = query
}

function buildProbeParams() {
  return {
    providerId: creating.value ? undefined : selectedId.value ?? undefined,
    baseUrl: formBaseUrl.value.trim() || undefined,
    providerKind: formKind.value,
    apiKey: formApiKey.value.trim() || undefined,
  }
}

function resetRemoteState(): void {
  remoteModelIds.value = []
  statusMessage.value = null
}

function fillForm(p: AiProvider | null): void {
  const seq = ++formLoadSeq
  resetRemoteState()
  modelSearchQuery.value = ''
  if (!p) {
    formName.value = ''
    formApiKey.value = ''
    formRowVersion.value = 0
    formSelectedModels.value = []
    applyPreset('openai', { fillName: true })
    return
  }
  formName.value = p.providerName
  formKind.value = normalizeKind(p.providerKind)
  formBaseUrl.value = p.baseUrl ?? ''
  formApiKey.value = ''
  formRowVersion.value = p.rowVersion
  formPresetId.value = matchAiProviderPreset({
    baseUrl: p.baseUrl,
    providerKind: p.providerKind,
    providerName: p.providerName,
  })
  const saved = (p.models ?? []).map((m) => m.modelCode).filter(Boolean)
  // 若 default 不在 models 表里，仍并入已选，避免丢配置。
  if (p.defaultModelCode && !saved.includes(p.defaultModelCode)) {
    saved.unshift(p.defaultModelCode)
  }
  formSelectedModels.value = saved
  if (p.hasApiKey) {
    void loadApiKeyForEdit(p.providerId, seq)
  }
}

/** 编辑已存 Provider 时从 Vault 回填 API Key（对齐连接站点凭据回填）。 */
async function loadApiKeyForEdit(providerId: string, seq: number): Promise<void> {
  try {
    const res = await aiApi.getProviderApiKey({ providerId })
    if (seq !== formLoadSeq) {
      return
    }
    if (res.found && res.apiKey) {
      formApiKey.value = res.apiKey
    }
  } catch {
    // 回填失败静默：用户仍可手动输入或留空保留原密钥
  }
}

async function loadProviders(): Promise<void> {
  if (!bridgeStore.connected) {
    providers.value = []
    selectedId.value = null
    creating.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const res = await aiApi.listProviders({ includeModels: true })
    providers.value = res.providers ?? []
    if (creating.value) {
      return
    }
    if (selectedId.value && !providers.value.some((p) => p.providerId === selectedId.value)) {
      selectedId.value = providers.value[0]?.providerId ?? null
    } else if (!selectedId.value && providers.value.length) {
      selectedId.value = providers.value[0].providerId
    }
    fillForm(selected.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function selectProvider(id: string): void {
  creating.value = false
  selectedId.value = id
  const p = providers.value.find((x) => x.providerId === id) ?? null
  fillForm(p)
  error.value = null
}

function startCreate(): void {
  creating.value = true
  selectedId.value = null
  fillForm(null)
  error.value = null
}

async function testConnection(): Promise<void> {
  probing.value = true
  error.value = null
  statusMessage.value = null
  try {
    const result = await aiApi.testProvider(buildProbeParams())
    if (!result.ok) {
      error.value = result.message || t('settings.aiProvidersTestFailed')
      return
    }
    statusMessage.value = t('settings.aiProvidersTestOk', {
      n: result.modelCount,
      ms: result.latencyMs,
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    probing.value = false
  }
}

async function fetchRemoteModels(): Promise<void> {
  fetchingModels.value = true
  error.value = null
  statusMessage.value = null
  try {
    const result = await aiApi.listRemoteModels(buildProbeParams())
    const ids = (result.models ?? []).map((m) => m.id).filter(Boolean)
    remoteModelIds.value = ids
    if (!ids.length) {
      statusMessage.value = t('settings.aiProvidersFetchModelsEmpty')
      return
    }
    statusMessage.value = t('settings.aiProvidersFetchModelsOk', { n: ids.length })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    fetchingModels.value = false
  }
}

function cancelCreate(): void {
  creating.value = false
  if (providers.value.length) {
    selectedId.value = providers.value[0].providerId
    fillForm(providers.value[0])
  } else {
    fillForm(null)
  }
}

async function syncProviderModels(providerId: string, modelCodes: string[]): Promise<void> {
  const existing = providers.value.find((p) => p.providerId === providerId)
  const existingByCode = new Map((existing?.models ?? []).map((m) => [m.modelCode, m]))
  const wanted = new Set(modelCodes)

  for (const code of modelCodes) {
    if (!existingByCode.has(code)) {
      await aiApi.upsertModel({
        model: {
          providerId,
          modelCode: code,
          modelLabel: code,
        },
      })
    }
  }

  for (const [code, model] of existingByCode) {
    if (!wanted.has(code)) {
      await aiApi.deleteModel({ modelId: model.modelId })
    }
  }
}

async function saveProvider(): Promise<void> {
  const name = formName.value.trim()
  if (!name) {
    error.value = t('settings.aiProvidersNameRequired')
    return
  }
  const modelCodes = [...new Set(formSelectedModels.value.map((c) => c.trim()).filter(Boolean))]
  saving.value = true
  error.value = null
  try {
    const editingId = creating.value ? undefined : selectedId.value ?? undefined
    const result = await aiApi.upsertProvider({
      providerId: editingId,
      rowVersion: editingId ? formRowVersion.value : undefined,
      provider: {
        providerName: name,
        providerKind: formKind.value,
        baseUrl: formBaseUrl.value.trim() || undefined,
        defaultModelCode: modelCodes[0] || undefined,
        apiKey: formApiKey.value.trim() || undefined,
        recordStatus: 'active',
      },
    })
    await syncProviderModels(result.providerId, modelCodes)
    creating.value = false
    selectedId.value = result.providerId
    await loadProviders()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function removeSelected(): Promise<void> {
  const p = selected.value
  if (!p) {
    return
  }
  if (!globalThis.confirm(t('settings.aiProvidersDeleteConfirm', { name: p.providerName }))) {
    return
  }
  error.value = null
  try {
    await aiApi.deleteProvider({ providerId: p.providerId })
    selectedId.value = null
    creating.value = false
    await loadProviders()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

watch(selected, (p) => {
  if (!creating.value) {
    fillForm(p)
  }
})

onMounted(() => {
  bridgeStore.bootstrap().then(() => loadProviders())
})
</script>

<template>
  <section class="nm-settings__panel nm-ai-providers">
    <header class="nm-ai-providers__toolbar">
      <div class="nm-ai-providers__toolbar-main">
        <div class="nm-ai-providers__title-row">
          <h1 class="nm-section-title">{{ t('settings.aiProviders') }}</h1>
          <RsTooltip side="bottom" align="start">
            <RsButton
              variant="ghost"
              size="sm"
              icon="info"
              icon-only
              :aria-label="t('settings.aiProvidersTooltip')"
            />
            <template #content>
              <div class="nm-ai-providers__tooltip">
                <p>{{ t('settings.aiProvidersDesc') }}</p>
              </div>
            </template>
          </RsTooltip>
        </div>
      </div>
      <div class="nm-ai-providers__toolbar-actions">
        <RsTooltip :content="t('settings.aiProvidersRefresh')" side="top">
          <RsButton variant="ghost" size="sm" :disabled="loading" @click="loadProviders">
            {{ t('settings.aiProvidersRefresh') }}
          </RsButton>
        </RsTooltip>
        <RsButton variant="primary" size="sm" @click="startCreate">
          {{ t('settings.aiProvidersAdd') }}
        </RsButton>
      </div>
    </header>

    <div class="nm-ai-providers__body">
      <RsEmpty
        v-if="loading && !providers.length"
        fill
        icon-radius="none"
        class="nm-ai-providers__state"
        :description="t('settings.aiProvidersLoading')"
      >
        <template #icon>
          <RsIcon name="loader-circle" :size="22" />
        </template>
      </RsEmpty>

      <RsEmpty
        v-else-if="!bridgeStore.connected"
        fill
        icon-radius="none"
        class="nm-ai-providers__state"
        :description="t('settings.devHint')"
      >
        <template #icon>
          <RsIcon name="plug-zap" :size="22" />
        </template>
      </RsEmpty>

      <div v-else class="nm-ai-providers__workspace">
        <aside class="nm-ai-providers__sidebar" :aria-label="t('settings.aiProviders')">
          <div class="nm-ai-providers__sidebar-title">{{ t('settings.aiProvidersList') }}</div>
          <nav v-if="providers.length" class="nm-ai-providers__nav">
            <button
              v-for="p in providers"
              :key="p.providerId"
              type="button"
              class="nm-ai-providers__nav-item"
              :class="{ 'nm-ai-providers__nav-item--active': !creating && selectedId === p.providerId }"
              @click="selectProvider(p.providerId)"
            >
              <span class="nm-ai-providers__nav-icon" aria-hidden="true">
                <RsIcon name="bot" :size="16" />
              </span>
              <span class="nm-ai-providers__nav-text min-w-0">
                <span class="nm-ai-providers__nav-name truncate">{{ p.providerName }}</span>
                <span class="nm-ai-providers__nav-meta truncate">
                  {{ p.providerKind }}
                  <template v-if="p.defaultModelCode"> · {{ p.defaultModelCode }}</template>
                </span>
              </span>
              <span
                class="nm-ai-providers__key-dot"
                :class="p.hasApiKey ? 'nm-ai-providers__key-dot--ok' : 'nm-ai-providers__key-dot--miss'"
                :title="p.hasApiKey ? t('settings.aiProvidersHasKey') : t('settings.aiProvidersNoKey')"
                aria-hidden="true"
              />
            </button>
          </nav>
          <p v-else class="nm-ai-providers__sidebar-empty nm-caption">
            {{ t('settings.aiProvidersEmpty') }}
          </p>
        </aside>

        <div class="nm-ai-providers__detail" :class="{ 'nm-ai-providers__detail--empty': !showDetail }">
          <RsEmpty
            v-if="!showDetail"
            fill
            icon-radius="none"
            class="nm-ai-providers__state"
            :description="t('settings.aiProvidersSelectHint')"
          >
            <template #icon>
              <RsIcon name="bot" :size="22" />
            </template>
            <RsButton variant="primary" size="sm" @click="startCreate">
              {{ t('settings.aiProvidersAdd') }}
            </RsButton>
          </RsEmpty>

          <div v-else class="nm-ai-providers__detail-inner">
            <header class="nm-ai-providers__detail-head">
              <div class="min-w-0">
                <h2 class="nm-ai-providers__detail-title truncate">
                  {{ creating ? t('settings.aiProvidersAdd') : formName || t('settings.aiProvidersEdit') }}
                </h2>
                <p class="nm-caption">{{ kindLabel }}</p>
              </div>
              <div v-if="!creating" class="nm-ai-providers__badges">
                <span
                  class="nm-ai-providers__badge"
                  :class="selected?.hasApiKey ? 'nm-ai-providers__badge--ok' : 'nm-ai-providers__badge--warn'"
                >
                  {{ selected?.hasApiKey ? t('settings.aiProvidersHasKey') : t('settings.aiProvidersNoKey') }}
                </span>
                <span v-if="selected?.models?.length" class="nm-ai-providers__badge">
                  {{ t('settings.aiProvidersModelCount', { n: selected.models.length }) }}
                </span>
              </div>
            </header>

            <p v-if="error" class="nm-ai-providers__error nm-caption" role="alert">{{ error }}</p>
            <p v-else-if="statusMessage" class="nm-ai-providers__status nm-caption">
              {{ statusMessage }}
            </p>

            <div class="nm-ai-providers__form">
              <div class="nm-ai-providers__field nm-ai-providers__field--full">
                <div class="nm-ai-providers__label-row">
                  <span class="nm-ai-providers__label">{{ t('settings.aiProvidersPreset') }}</span>
                  <RsTooltip :content="t('settings.aiProvidersPresetHint')" side="top">
                    <RsButton
                      variant="ghost"
                      size="sm"
                      icon="info"
                      icon-only
                      :aria-label="t('settings.aiProvidersPresetHint')"
                    />
                  </RsTooltip>
                </div>
                <RsSelect
                  :model-value="formPresetId"
                  :options="presetOptions"
                  searchable
                  @update:model-value="onPresetChange"
                />
              </div>

              <div class="nm-ai-providers__field">
                <label class="nm-ai-providers__label" for="ai-provider-name">
                  {{ t('settings.aiProvidersName') }}
                </label>
                <RsInput
                  id="ai-provider-name"
                  v-model="formName"
                  :placeholder="t('settings.aiProvidersNamePlaceholder')"
                />
              </div>

              <div class="nm-ai-providers__field">
                <span class="nm-ai-providers__label">{{ t('settings.aiProvidersKind') }}</span>
                <RsSelect v-model="formKind" :options="kindOptions" />
              </div>

              <div class="nm-ai-providers__field nm-ai-providers__field--full">
                <div class="nm-ai-providers__label-row">
                  <label class="nm-ai-providers__label" for="ai-provider-url">
                    {{ t('settings.aiProvidersBaseUrl') }}
                  </label>
                  <RsTooltip :content="presetHint" side="top">
                    <RsButton
                      variant="ghost"
                      size="sm"
                      icon="info"
                      icon-only
                      :aria-label="presetHint"
                    />
                  </RsTooltip>
                </div>
                <RsInput
                  id="ai-provider-url"
                  v-model="formBaseUrl"
                  :placeholder="t('settings.aiProvidersBaseUrlPlaceholder')"
                />
              </div>

              <div class="nm-ai-providers__field nm-ai-providers__field--full">
                <div class="nm-ai-providers__label-row">
                  <span class="nm-ai-providers__label">{{ t('settings.aiProvidersModels') }}</span>
                  <RsTooltip :content="t('settings.aiProvidersModelsHint')" side="top">
                    <RsButton
                      variant="ghost"
                      size="sm"
                      icon="info"
                      icon-only
                      :aria-label="t('settings.aiProvidersModelsHint')"
                    />
                  </RsTooltip>
                </div>
                <div class="nm-ai-providers__model-row">
                  <RsSelect
                    class="nm-ai-providers__model-select"
                    block
                    size="md"
                    multiple
                    searchable
                    remote
                    :model-value="formSelectedModels"
                    :options="modelSelectOptions"
                    :placeholder="t('settings.aiProvidersModelsPlaceholder')"
                    :search-placeholder="t('settings.aiProvidersModelsSearch')"
                    :empty-text="t('settings.aiProvidersModelsEmpty')"
                    @update:model-value="onModelsSelect"
                    @search="onModelSearch"
                  />
                  <RsButton
                    class="nm-ai-providers__model-fetch"
                    variant="secondary"
                    size="md"
                    :disabled="fetchingModels || probing || saving"
                    @click="fetchRemoteModels"
                  >
                    {{
                      fetchingModels
                        ? t('settings.aiProvidersFetchingModels')
                        : t('settings.aiProvidersFetchModels')
                    }}
                  </RsButton>
                </div>
              </div>

              <div class="nm-ai-providers__field nm-ai-providers__field--full">
                <div class="nm-ai-providers__label-row">
                  <label class="nm-ai-providers__label" for="ai-provider-key">
                    {{ t('settings.aiProvidersApiKey') }}
                  </label>
                  <RsTooltip :content="t('settings.aiProvidersApiKeyHint')" side="top">
                    <RsButton
                      variant="ghost"
                      size="sm"
                      icon="info"
                      icon-only
                      :aria-label="t('settings.aiProvidersApiKeyHint')"
                    />
                  </RsTooltip>
                </div>
                <RsInput
                  id="ai-provider-key"
                  v-model="formApiKey"
                  type="password"
                  :placeholder="
                    creating
                      ? activePreset?.apiKeyOptional
                        ? t('settings.aiProvidersApiKeyOptional')
                        : t('settings.aiProvidersApiKeyPlaceholder')
                      : selected?.hasApiKey
                        ? t('settings.aiProvidersApiKeyLoaded')
                        : t('settings.aiProvidersApiKeyKeep')
                  "
                />
              </div>
            </div>

            <footer class="nm-ai-providers__footer">
              <RsButton
                v-if="!creating"
                variant="ghost"
                size="sm"
                :disabled="saving || probing || fetchingModels"
                @click="removeSelected"
              >
                {{ t('settings.aiProvidersDelete') }}
              </RsButton>
              <span class="nm-ai-providers__footer-spacer" />
              <RsButton
                variant="secondary"
                size="sm"
                :disabled="saving || probing || fetchingModels"
                @click="testConnection"
              >
                {{ probing ? t('settings.aiProvidersTesting') : t('settings.aiProvidersTest') }}
              </RsButton>
              <RsButton
                v-if="creating"
                variant="ghost"
                size="sm"
                :disabled="saving"
                @click="cancelCreate"
              >
                {{ t('settings.aiProvidersCancel') }}
              </RsButton>
              <RsButton variant="primary" size="sm" :disabled="saving" @click="saveProvider">
                {{ t('settings.aiProvidersSave') }}
              </RsButton>
            </footer>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.nm-ai-providers.nm-settings__panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  max-width: none;
  width: 100%;
  min-height: 0;
  height: 100%;
  padding: 0;
  border-radius: 0;
}

.nm-ai-providers__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-md);
  flex-shrink: 0;
  min-height: 2.5rem;
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 3%, var(--rs-surface-elevated));
}

.nm-ai-providers__toolbar-main {
  min-width: 0;
}

.nm-ai-providers__title-row {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.nm-ai-providers__tooltip {
  max-width: 18rem;
  line-height: 1.45;
}

.nm-ai-providers__tooltip p {
  margin: 0;
}

.nm-ai-providers__toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
}

.nm-ai-providers__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-ai-providers__workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  background: var(--rs-surface-elevated);
}

.nm-ai-providers__sidebar {
  display: flex;
  flex-direction: column;
  width: 15rem;
  flex-shrink: 0;
  border-right: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 2%, var(--rs-surface-elevated));
  overflow: auto;
}

.nm-ai-providers__sidebar-title {
  padding: var(--rs-space-sm) var(--rs-space-md);
  font-size: var(--nm-font-caption);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--rs-muted);
}

.nm-ai-providers__sidebar-empty {
  padding: var(--rs-space-md);
  color: var(--rs-muted);
}

.nm-ai-providers__nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 0;
}

.nm-ai-providers__nav-item {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  width: 100%;
  padding: var(--rs-space-sm) var(--rs-space-md);
  padding-left: calc(var(--rs-space-md) - 2px);
  border: none;
  border-left: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--rs-text);
  text-align: left;
  cursor: pointer;
  transition:
    background var(--rs-transition-fast),
    border-color var(--rs-transition-fast);
}

.nm-ai-providers__nav-item:hover {
  background: var(--rs-item-hover);
}

.nm-ai-providers__nav-item--active {
  background: color-mix(in srgb, var(--rs-primary) 14%, transparent);
  border-left-color: var(--rs-primary);
}

.nm-ai-providers__nav-icon {
  display: inline-flex;
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-ai-providers__nav-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.nm-ai-providers__nav-name {
  font-size: var(--nm-font-body);
  font-weight: 500;
}

.nm-ai-providers__nav-meta {
  font-size: var(--nm-font-caption);
  color: var(--rs-muted);
}

.nm-ai-providers__key-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 0;
  flex-shrink: 0;
}

.nm-ai-providers__key-dot--ok {
  background: var(--rs-success, #22c55e);
}

.nm-ai-providers__key-dot--miss {
  background: var(--rs-muted);
  opacity: 0.45;
}

.nm-ai-providers__detail {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}

.nm-ai-providers__detail--empty {
  overflow: hidden;
}

.nm-ai-providers__detail-inner {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  padding: var(--rs-space-md) var(--rs-space-lg) var(--rs-space-lg);
}

.nm-ai-providers__detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
}

.nm-ai-providers__detail-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--rs-text);
}

.nm-ai-providers__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.nm-ai-providers__badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 0;
  font-size: var(--nm-font-caption);
  color: var(--rs-muted);
  background: color-mix(in srgb, var(--rs-text) 6%, transparent);
}

.nm-ai-providers__badge--ok {
  color: var(--rs-success, #16a34a);
  background: color-mix(in srgb, var(--rs-success, #22c55e) 16%, transparent);
}

.nm-ai-providers__badge--warn {
  color: var(--rs-warning, #ca8a04);
  background: color-mix(in srgb, var(--rs-warning, #eab308) 16%, transparent);
}

.nm-ai-providers__form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--rs-space-md) var(--rs-space-lg);
  width: 100%;
  max-width: none;
}

.nm-ai-providers__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.nm-ai-providers__field--full {
  grid-column: 1 / -1;
}

.nm-ai-providers__label {
  font-size: var(--nm-font-caption);
  font-weight: 500;
  color: var(--rs-muted);
}

.nm-ai-providers__label-row {
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
  min-height: 1.5rem;
}

.nm-ai-providers__model-row {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  width: 100%;
  min-width: 0;
}

.nm-ai-providers__model-select {
  flex: 1 1 auto;
  min-width: 0;
}

.nm-ai-providers__model-fetch {
  flex: 0 0 auto;
  white-space: nowrap;
}

.nm-ai-providers__error {
  color: var(--rs-danger);
}

.nm-ai-providers__status {
  color: var(--rs-success, #16a34a);
}

.nm-ai-providers__footer {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  max-width: none;
  width: 100%;
  padding-top: var(--rs-space-sm);
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-ai-providers__footer-spacer {
  flex: 1;
}

.nm-ai-providers__state {
  flex: 1;
  min-height: 0;
}

@media (max-width: 860px) {
  .nm-ai-providers__workspace {
    flex-direction: column;
  }

  .nm-ai-providers__sidebar {
    width: 100%;
    max-height: 11rem;
    border-right: none;
    border-bottom: 1px solid var(--rs-border-subtle);
  }

  .nm-ai-providers__form {
    grid-template-columns: 1fr;
  }

  .nm-ai-providers__detail-inner {
    padding: var(--rs-space-sm) var(--rs-space-md) var(--rs-space-md);
  }
}
</style>
