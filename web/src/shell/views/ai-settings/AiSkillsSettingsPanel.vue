<script setup lang="ts">
/**
 * 全局设置 · AI Skills（nm_ai_skill）。
 *
 * 布局对齐 MCP：顶栏 + 左列表 + 右详情分区。
 * Skill = 提示词模板 + 参数 schema；无执行逻辑，由编排层装配进 system。
 */
import { RsBadge, RsButton, RsEmpty, RsIcon, RsInput, RsSelect, RsTooltip } from '@niuma/ui'
import type { RsSelectOption } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import { computed, onMounted, ref } from 'vue'
import { aiApi } from '@/api/ai'
import { dialogApi } from '@/api/dialog'
import type { AiSkill, AiSkillPackMeta } from '@/api/types/ai'
import { useBridgeStore } from '@/stores/bridge'

const { t } = useI18n()
const bridgeStore = useBridgeStore()

const loading = ref(false)
const saving = ref(false)
const installing = ref(false)
const error = ref<string | null>(null)
const statusMessage = ref<string | null>(null)
const skills = ref<AiSkill[]>([])
const selectedId = ref<string | null>(null)
const creating = ref(false)

const formCode = ref('')
const formName = ref('')
const formScope = ref('')
const formTemplate = ref('')
const formParamSchema = ref('{}')
const formStatus = ref<'active' | 'disabled'>('active')
const formRowVersion = ref(0)
const formSkillOptions = ref('{}')

const statusOptions = computed((): RsSelectOption[] => [
  { value: 'active', label: t('settings.aiSkillsActive') },
  { value: 'disabled', label: t('settings.aiSkillsDisabled') },
])

const selected = computed(() => skills.value.find((s) => s.skillId === selectedId.value) ?? null)
const showDetail = computed(() => creating.value || Boolean(selected.value))
const detailTitle = computed(() =>
  creating.value ? t('settings.aiSkillsAdd') : selected.value?.skillName || t('settings.aiSkills'),
)
const packMeta = computed((): AiSkillPackMeta | null => parsePackMeta(formSkillOptions.value))
const detailSubtitle = computed(() => {
  if (creating.value) return t('settings.aiSkillsNewHint')
  if (packMeta.value?.hasScripts) {
    return t('settings.aiSkillsPackWithScripts')
  }
  if (packMeta.value) {
    return t('settings.aiSkillsPackPromptOnly')
  }
  const code = formCode.value.trim()
  const scope = formScope.value.trim()
  if (code && scope) return `${code} · ${scope}`
  return code || scope || ''
})

function parsePackMeta(options: string): AiSkillPackMeta | null {
  try {
    const o = JSON.parse(options || '{}') as { pack?: AiSkillPackMeta }
    return o.pack ?? null
  } catch {
    return null
  }
}

function statusLabel(status: string | undefined): string {
  return status === 'disabled' ? t('settings.aiSkillsDisabled') : t('settings.aiSkillsActive')
}

function skillIsPack(sk: AiSkill): boolean {
  return Boolean(parsePackMeta(sk.skillOptions))
}

async function load(): Promise<void> {
  if (!bridgeStore.connected) {
    return
  }
  loading.value = true
  error.value = null
  try {
    const res = await aiApi.listSkills()
    skills.value = res.skills ?? []
    if (!creating.value && selectedId.value && !skills.value.some((s) => s.skillId === selectedId.value)) {
      selectedId.value = skills.value[0]?.skillId ?? null
    }
    if (!creating.value && !selectedId.value && skills.value.length) {
      selectedId.value = skills.value[0].skillId
      fillForm(skills.value[0])
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function fillForm(sk: AiSkill): void {
  formCode.value = sk.skillCode
  formName.value = sk.skillName
  formScope.value = sk.skillScope || ''
  formTemplate.value = sk.promptTemplate
  formParamSchema.value = sk.paramSchema?.trim() || '{}'
  formStatus.value = sk.recordStatus === 'disabled' ? 'disabled' : 'active'
  formRowVersion.value = sk.rowVersion
  formSkillOptions.value = sk.skillOptions?.trim() || '{}'
}

function selectSkill(id: string): void {
  creating.value = false
  selectedId.value = id
  error.value = null
  statusMessage.value = null
  const sk = skills.value.find((s) => s.skillId === id)
  if (sk) {
    fillForm(sk)
  }
}

function startCreate(): void {
  creating.value = true
  selectedId.value = null
  error.value = null
  statusMessage.value = null
  formCode.value = ''
  formName.value = ''
  formScope.value = 'ops'
  formTemplate.value = ''
  formParamSchema.value = '{\n  "type": "object",\n  "properties": {}\n}'
  formStatus.value = 'active'
  formRowVersion.value = 0
  formSkillOptions.value = '{}'
}

function cancelCreate(): void {
  creating.value = false
  error.value = null
  statusMessage.value = null
  if (skills.value.length) {
    selectedId.value = skills.value[0].skillId
    fillForm(skills.value[0])
  } else {
    selectedId.value = null
  }
}

async function installFromFolder(): Promise<void> {
  const picked = await dialogApi.openFolder({
    title: t('settings.aiSkillsInstallFolder'),
    okButtonLabel: t('settings.aiSkillsInstall'),
  })
  if (picked.canceled || !picked.filePaths[0]) {
    return
  }
  await runInstall(picked.filePaths[0])
}

async function installFromZip(): Promise<void> {
  const picked = await dialogApi.openFile({
    title: t('settings.aiSkillsInstallZip'),
    accept: ['.zip'],
  })
  if (picked.canceled || !picked.filePaths[0]) {
    return
  }
  await runInstall(picked.filePaths[0])
}

async function runInstall(sourcePath: string): Promise<void> {
  installing.value = true
  error.value = null
  statusMessage.value = null
  try {
    const res = await aiApi.installSkillPack({ sourcePath })
    creating.value = false
    selectedId.value = res.skill.skillId
    await load()
    fillForm(res.skill)
    if (res.warning) {
      statusMessage.value = res.warning
    } else if (res.hasScripts) {
      statusMessage.value = t('settings.aiSkillsInstallOkScripts', { n: res.toolCount })
    } else {
      statusMessage.value = t('settings.aiSkillsInstallOk')
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    installing.value = false
  }
}

async function exportPack(): Promise<void> {
  if (!selectedId.value || creating.value) {
    return
  }
  const picked = await dialogApi.saveFile({
    title: t('settings.aiSkillsExport'),
    defaultPath: `${formCode.value.trim() || 'skill'}.zip`,
    accept: ['.zip'],
  })
  if (picked.canceled || !picked.filePaths[0]) {
    return
  }
  saving.value = true
  error.value = null
  statusMessage.value = null
  try {
    const res = await aiApi.exportSkillPack({
      skillId: selectedId.value,
      destPath: picked.filePaths[0],
    })
    statusMessage.value = t('settings.aiSkillsExportOk', { path: res.path })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function save(): Promise<void> {
  const code = formCode.value.trim()
  const name = formName.value.trim()
  const template = formTemplate.value.trim()
  if (!code || !name || !template) {
    error.value = t('settings.aiSkillsRequired')
    return
  }
  let paramSchema = formParamSchema.value.trim() || '{}'
  try {
    JSON.parse(paramSchema)
  } catch {
    error.value = t('settings.aiSkillsParamSchemaInvalid')
    return
  }
  saving.value = true
  error.value = null
  try {
    const res = await aiApi.upsertSkill({
      skillId: creating.value ? undefined : selectedId.value || undefined,
      skillCode: code,
      skillName: name,
      skillScope: formScope.value.trim() || undefined,
      promptTemplate: template,
      paramSchema,
      skillOptions: formSkillOptions.value.trim() || '{}',
      recordStatus: formStatus.value,
      rowVersion: creating.value ? undefined : formRowVersion.value,
    })
    creating.value = false
    selectedId.value = res.skill.skillId
    await load()
    fillForm(res.skill)
    statusMessage.value = t('settings.aiSkillsSaveOk')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  if (!selectedId.value || creating.value) {
    return
  }
  const name = selected.value?.skillName || selectedId.value
  if (!window.confirm(t('settings.aiSkillsDeleteConfirm', { name }))) {
    return
  }
  saving.value = true
  error.value = null
  try {
    await aiApi.deleteSkill({ skillId: selectedId.value })
    selectedId.value = null
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="nm-settings__panel nm-ai-skills">
    <header class="nm-ai-skills__toolbar">
      <div class="nm-ai-skills__toolbar-main">
        <div class="nm-ai-skills__title-row">
          <h1 class="nm-section-title">{{ t('settings.aiSkills') }}</h1>
          <RsTooltip side="bottom" align="start">
            <RsButton
              variant="ghost"
              size="sm"
              icon="info"
              icon-only
              :aria-label="t('settings.aiSkillsDesc')"
            />
            <template #content>
              <div class="nm-ai-skills__tooltip">
                <p>{{ t('settings.aiSkillsDesc') }}</p>
              </div>
            </template>
          </RsTooltip>
        </div>
      </div>
      <div class="nm-ai-skills__toolbar-actions">
        <RsTooltip :content="t('settings.aiSkillsRefresh')" side="top">
          <RsButton
            variant="ghost"
            size="sm"
            :loading="loading"
            :disabled="loading || !bridgeStore.connected"
            @click="load"
          >
            <RsIcon name="refresh-cw" :size="14" />
            {{ t('settings.aiSkillsRefresh') }}
          </RsButton>
        </RsTooltip>
        <RsTooltip :content="t('settings.aiSkillsInstallFolderHint')" side="top">
          <RsButton
            variant="ghost"
            size="sm"
            :loading="installing"
            :disabled="installing || !bridgeStore.connected"
            @click="installFromFolder"
          >
            <RsIcon name="folder" :size="14" />
            {{ t('settings.aiSkillsInstallFolder') }}
          </RsButton>
        </RsTooltip>
        <RsTooltip :content="t('settings.aiSkillsInstallZipHint')" side="top">
          <RsButton
            variant="ghost"
            size="sm"
            :loading="installing"
            :disabled="installing || !bridgeStore.connected"
            @click="installFromZip"
          >
            <RsIcon name="file-archive" :size="14" />
            {{ t('settings.aiSkillsInstallZip') }}
          </RsButton>
        </RsTooltip>
        <RsButton variant="primary" size="sm" :disabled="!bridgeStore.connected" @click="startCreate">
          <RsIcon name="plus" :size="14" />
          {{ t('settings.aiSkillsAdd') }}
        </RsButton>
      </div>
    </header>

    <div class="nm-ai-skills__body">
      <RsEmpty
        v-if="!bridgeStore.connected"
        fill
        icon-radius="none"
        class="nm-ai-skills__state"
        :description="t('settings.runtimeOffline')"
      />
      <RsEmpty
        v-else-if="loading && !skills.length"
        fill
        icon-radius="none"
        class="nm-ai-skills__state"
        :description="t('ai.loading')"
      >
        <template #icon>
          <RsIcon name="loader-circle" :size="22" />
        </template>
      </RsEmpty>

      <div v-else class="nm-ai-skills__workspace">
        <aside class="nm-ai-skills__sidebar" :aria-label="t('settings.aiSkillsList')">
          <div class="nm-ai-skills__sidebar-title">{{ t('settings.aiSkillsList') }}</div>
          <nav v-if="skills.length" class="nm-ai-skills__nav">
            <button
              v-for="s in skills"
              :key="s.skillId"
              type="button"
              class="nm-ai-skills__nav-item"
              :class="{ 'nm-ai-skills__nav-item--active': !creating && selectedId === s.skillId }"
              @click="selectSkill(s.skillId)"
            >
              <span class="nm-ai-skills__nav-icon" aria-hidden="true">
                <RsIcon name="sparkles" :size="16" />
              </span>
              <span class="nm-ai-skills__nav-text min-w-0">
                <span class="nm-ai-skills__nav-name truncate">{{ s.skillName }}</span>
                <span class="nm-ai-skills__nav-meta truncate">
                  {{ s.skillCode }}
                  <template v-if="skillIsPack(s)"> · pack</template>
                  <template v-else-if="s.skillScope"> · {{ s.skillScope }}</template>
                </span>
              </span>
              <span
                class="nm-ai-skills__status-dot"
                :class="
                  s.recordStatus === 'active'
                    ? 'nm-ai-skills__status-dot--ok'
                    : 'nm-ai-skills__status-dot--off'
                "
                :title="statusLabel(s.recordStatus)"
                aria-hidden="true"
              />
            </button>
          </nav>
          <p v-else class="nm-ai-skills__sidebar-empty nm-caption">
            {{ t('settings.aiSkillsEmpty') }}
          </p>
        </aside>

        <div class="nm-ai-skills__detail" :class="{ 'nm-ai-skills__detail--empty': !showDetail }">
          <RsEmpty
            v-if="!showDetail"
            fill
            icon-radius="none"
            class="nm-ai-skills__state"
            :description="t('settings.aiSkillsSelectHint')"
          >
            <template #icon>
              <RsIcon name="sparkles" :size="22" />
            </template>
            <RsButton variant="primary" size="sm" @click="startCreate">
              {{ t('settings.aiSkillsAdd') }}
            </RsButton>
          </RsEmpty>

          <div v-else class="nm-ai-skills__detail-inner">
            <header class="nm-ai-skills__detail-head">
              <div class="min-w-0">
                <h2 class="nm-ai-skills__detail-title truncate">{{ detailTitle }}</h2>
                <p v-if="detailSubtitle" class="nm-caption truncate">{{ detailSubtitle }}</p>
              </div>
              <div v-if="!creating" class="nm-ai-skills__badges">
                <RsBadge :variant="formStatus === 'active' ? 'success' : 'default'">
                  {{ statusLabel(formStatus) }}
                </RsBadge>
                <RsBadge v-if="packMeta" variant="primary">{{ t('settings.aiSkillsPackBadge') }}</RsBadge>
                <RsBadge v-if="packMeta?.hasScripts" variant="warning">
                  {{ t('settings.aiSkillsScriptsBadge') }}
                </RsBadge>
                <RsBadge v-else-if="formScope.trim()" variant="info">{{ formScope.trim() }}</RsBadge>
              </div>
            </header>

            <p v-if="error" class="nm-ai-skills__error nm-caption" role="alert">{{ error }}</p>
            <p v-else-if="statusMessage" class="nm-ai-skills__status nm-caption">{{ statusMessage }}</p>

            <section v-if="packMeta" class="nm-ai-skills__section">
              <h3 class="nm-ai-skills__section-title">{{ t('settings.aiSkillsPackInfo') }}</h3>
              <p class="nm-caption nm-ai-skills__pack-path">{{ packMeta.packPath }}</p>
              <p v-if="packMeta.mcpServerId" class="nm-caption">
                {{ t('settings.aiSkillsPackMcp', { id: packMeta.mcpServerId }) }}
              </p>
            </section>

            <section class="nm-ai-skills__section">
              <h3 class="nm-ai-skills__section-title">{{ t('settings.aiSkillsBasics') }}</h3>
              <div class="nm-ai-skills__form">
                <div class="nm-ai-skills__field">
                  <label class="nm-ai-skills__label" for="ai-skill-code">{{ t('settings.aiSkillsCode') }}</label>
                  <RsInput id="ai-skill-code" v-model="formCode" size="sm" :disabled="saving" />
                </div>
                <div class="nm-ai-skills__field">
                  <label class="nm-ai-skills__label" for="ai-skill-name">{{ t('settings.aiSkillsName') }}</label>
                  <RsInput id="ai-skill-name" v-model="formName" size="sm" :disabled="saving" />
                </div>
                <div class="nm-ai-skills__field">
                  <label class="nm-ai-skills__label" for="ai-skill-scope">{{ t('settings.aiSkillsScope') }}</label>
                  <RsInput
                    id="ai-skill-scope"
                    v-model="formScope"
                    size="sm"
                    :disabled="saving"
                    :placeholder="t('settings.aiSkillsScopePlaceholder')"
                  />
                </div>
                <div class="nm-ai-skills__field">
                  <span class="nm-ai-skills__label">{{ t('settings.aiSkillsStatus') }}</span>
                  <RsSelect
                    size="sm"
                    :model-value="formStatus"
                    :options="statusOptions"
                    :disabled="saving"
                    @update:model-value="(v) => (formStatus = (Array.isArray(v) ? v[0] : v) as 'active' | 'disabled')"
                  />
                </div>
              </div>
            </section>

            <section class="nm-ai-skills__section">
              <div class="nm-ai-skills__section-head">
                <h3 class="nm-ai-skills__section-title">{{ t('settings.aiSkillsTemplate') }}</h3>
                <p class="nm-caption">{{ t('settings.aiSkillsTemplateHint') }}</p>
              </div>
              <textarea
                v-model="formTemplate"
                class="nm-ai-skills__template"
                rows="12"
                :disabled="saving"
                :placeholder="t('settings.aiSkillsTemplatePlaceholder')"
                spellcheck="false"
              />
            </section>

            <section class="nm-ai-skills__section nm-ai-skills__section--schema">
              <div class="nm-ai-skills__section-head">
                <h3 class="nm-ai-skills__section-title">{{ t('settings.aiSkillsParamSchema') }}</h3>
                <p class="nm-caption">{{ t('settings.aiSkillsParamSchemaHint') }}</p>
              </div>
              <textarea
                v-model="formParamSchema"
                class="nm-ai-skills__template nm-ai-skills__template--schema"
                rows="8"
                :disabled="saving"
                spellcheck="false"
              />
            </section>

            <footer class="nm-ai-skills__footer">
              <RsButton size="sm" variant="primary" :loading="saving" :disabled="saving || installing" @click="save">
                {{ t('settings.aiSkillsSave') }}
              </RsButton>
              <RsButton
                v-if="!creating && selectedId"
                size="sm"
                variant="secondary"
                :disabled="saving || installing"
                @click="exportPack"
              >
                <RsIcon name="download" :size="14" />
                {{ t('settings.aiSkillsExport') }}
              </RsButton>
              <RsButton
                v-if="creating"
                size="sm"
                variant="ghost"
                :disabled="saving"
                @click="cancelCreate"
              >
                {{ t('settings.aiSkillsCancel') }}
              </RsButton>
              <span class="nm-ai-skills__footer-spacer" />
              <RsButton
                v-if="!creating && selectedId"
                size="sm"
                variant="ghost"
                :disabled="saving"
                @click="remove"
              >
                <RsIcon name="trash-2" :size="14" />
                {{ t('settings.aiSkillsDelete') }}
              </RsButton>
            </footer>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.nm-ai-skills.nm-settings__panel {
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

.nm-ai-skills__toolbar {
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

.nm-ai-skills__toolbar-main {
  min-width: 0;
}

.nm-ai-skills__title-row {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.nm-ai-skills__tooltip {
  max-width: 18rem;
  line-height: 1.45;
}

.nm-ai-skills__tooltip p {
  margin: 0;
}

.nm-ai-skills__toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
}

.nm-ai-skills__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-ai-skills__workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  background: var(--rs-surface-elevated);
}

.nm-ai-skills__sidebar {
  display: flex;
  flex-direction: column;
  width: 15.5rem;
  flex-shrink: 0;
  border-right: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 2%, var(--rs-surface-elevated));
  overflow: auto;
}

.nm-ai-skills__sidebar-title {
  padding: var(--rs-space-sm) var(--rs-space-md);
  font-size: var(--nm-font-caption);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--rs-muted);
}

.nm-ai-skills__sidebar-empty {
  padding: var(--rs-space-md);
  color: var(--rs-muted);
}

.nm-ai-skills__nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.nm-ai-skills__nav-item {
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

.nm-ai-skills__nav-item:hover {
  background: var(--rs-item-hover);
}

.nm-ai-skills__nav-item--active {
  background: color-mix(in srgb, var(--rs-primary) 14%, transparent);
  border-left-color: var(--rs-primary);
}

.nm-ai-skills__nav-icon {
  display: inline-flex;
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-ai-skills__nav-item--active .nm-ai-skills__nav-icon {
  color: var(--rs-primary);
}

.nm-ai-skills__nav-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.nm-ai-skills__nav-name {
  font-size: var(--nm-font-body);
  font-weight: 500;
}

.nm-ai-skills__nav-meta {
  font-size: var(--nm-font-caption);
  color: var(--rs-muted);
}

.nm-ai-skills__status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  flex-shrink: 0;
}

.nm-ai-skills__status-dot--ok {
  background: var(--rs-success, #22c55e);
}

.nm-ai-skills__status-dot--off {
  background: var(--rs-muted);
  opacity: 0.45;
}

.nm-ai-skills__detail {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.nm-ai-skills__detail-inner {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  padding: var(--rs-space-md) var(--rs-space-lg) var(--rs-space-lg);
}

.nm-ai-skills__detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
}

.nm-ai-skills__detail-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--rs-text);
}

.nm-ai-skills__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.nm-ai-skills__section {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
  flex: 0 0 auto;
  min-width: 0;
}

.nm-ai-skills__section--schema {
  margin-top: var(--rs-space-xs);
  padding-top: var(--rs-space-md);
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-ai-skills__section-title {
  margin: 0;
  font-size: var(--nm-font-caption);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--rs-muted);
}

.nm-ai-skills__section-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.nm-ai-skills__section-head .nm-caption {
  margin: 0;
  line-height: 1.45;
}

.nm-ai-skills__form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--rs-space-md) var(--rs-space-lg);
}

.nm-ai-skills__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.nm-ai-skills__label {
  font-size: var(--nm-font-caption);
  font-weight: 500;
  color: var(--rs-muted);
}

.nm-ai-skills__template {
  display: block;
  width: 100%;
  box-sizing: border-box;
  flex: none;
  resize: vertical;
  min-height: 10rem;
  max-height: 40rem;
  padding: 10px 12px;
  border-radius: var(--rs-radius-md, 8px);
  border: 1px solid var(--rs-border-subtle);
  background: var(--nm-editor-bg, color-mix(in srgb, var(--rs-text) 2%, var(--rs-surface-elevated)));
  color: var(--rs-text);
  font-family: var(--rs-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 0.8125rem;
  line-height: 1.5;
}

.nm-ai-skills__template--schema {
  min-height: 8rem;
}

.nm-ai-skills__template:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--rs-primary) 55%, var(--rs-border-subtle));
}

.nm-ai-skills__error {
  color: var(--rs-danger);
}

.nm-ai-skills__status {
  color: var(--rs-success, #16a34a);
}

.nm-ai-skills__pack-path {
  margin: 0;
  word-break: break-all;
  font-family: var(--rs-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}

.nm-ai-skills__footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--rs-space-sm);
  padding-top: var(--rs-space-sm);
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-ai-skills__footer-spacer {
  flex: 1;
}

.nm-ai-skills__state {
  flex: 1;
}
</style>
