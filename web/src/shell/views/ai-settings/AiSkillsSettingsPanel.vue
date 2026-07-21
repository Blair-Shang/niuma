<script setup lang="ts">
/**
 * 全局设置 · AI Skills（nm_ai_skill）。
 *
 * 仅提示词模板 CRUD；无执行逻辑。
 */
import { RsButton, RsEmpty, RsIcon, RsInput, RsSelect } from '@niuma/ui'
import type { RsSelectOption } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import { computed, onMounted, ref } from 'vue'
import { aiApi } from '@/api/ai'
import type { AiSkill } from '@/api/types/ai'
import { useBridgeStore } from '@/stores/bridge'

const { t } = useI18n()
const bridgeStore = useBridgeStore()

const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
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

const statusOptions = computed((): RsSelectOption[] => [
  { value: 'active', label: 'active' },
  { value: 'disabled', label: 'disabled' },
])

const selected = computed(() => skills.value.find((s) => s.skillId === selectedId.value) ?? null)
const showDetail = computed(() => creating.value || Boolean(selected.value))
const detailTitle = computed(() =>
  creating.value ? t('settings.aiSkillsAdd') : selected.value?.skillName || t('settings.aiSkills'),
)

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
}

function selectSkill(id: string): void {
  creating.value = false
  selectedId.value = id
  const sk = skills.value.find((s) => s.skillId === id)
  if (sk) {
    fillForm(sk)
  }
}

function startCreate(): void {
  creating.value = true
  selectedId.value = null
  formCode.value = ''
  formName.value = ''
  formScope.value = 'ops'
  formTemplate.value = ''
  formParamSchema.value = '{\n  "type": "object",\n  "properties": {}\n}'
  formStatus.value = 'active'
  formRowVersion.value = 0
}

async function save(): Promise<void> {
  const code = formCode.value.trim()
  const name = formName.value.trim()
  const template = formTemplate.value.trim()
  if (!code || !name || !template) {
    error.value = 'skillCode / skillName / promptTemplate required'
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
      recordStatus: formStatus.value,
      rowVersion: creating.value ? undefined : formRowVersion.value,
    })
    creating.value = false
    selectedId.value = res.skill.skillId
    await load()
    fillForm(res.skill)
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
        <h2 class="nm-section-title">{{ t('settings.aiSkills') }}</h2>
        <p class="nm-section-desc">{{ t('settings.aiSkillsDesc') }}</p>
      </div>
      <div class="nm-ai-skills__toolbar-actions">
        <RsButton size="sm" variant="secondary" :disabled="loading" @click="load">
          <RsIcon name="refresh-cw" :size="14" />
        </RsButton>
        <RsButton size="sm" @click="startCreate">
          <RsIcon name="plus" :size="14" />
          {{ t('settings.aiSkillsAdd') }}
        </RsButton>
      </div>
    </header>

    <div class="nm-ai-skills__body">
      <RsEmpty v-if="!bridgeStore.connected" :description="t('settings.runtimeOffline')" />
      <div v-else-if="loading && !skills.length" class="nm-ai-skills__state">{{ t('ai.loading') }}</div>
      <div v-else class="nm-ai-skills__workspace">
        <aside class="nm-ai-skills__sidebar">
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
              <span class="nm-ai-skills__nav-name truncate">{{ s.skillName }}</span>
              <span class="nm-ai-skills__nav-meta truncate">{{ s.skillCode }}</span>
            </button>
          </nav>
          <p v-else class="nm-ai-skills__sidebar-empty nm-caption">{{ t('settings.aiSkillsEmpty') }}</p>
        </aside>

        <div class="nm-ai-skills__detail" :class="{ 'nm-ai-skills__detail--empty': !showDetail }">
          <RsEmpty v-if="!showDetail" :description="t('settings.aiSkillsSelectHint')" />
          <div v-else class="nm-ai-skills__detail-inner">
            <header class="nm-ai-skills__detail-head">
              <h2 class="nm-ai-skills__detail-title truncate">{{ detailTitle }}</h2>
              <div class="nm-ai-skills__detail-actions">
                <RsButton
                  v-if="!creating"
                  size="sm"
                  variant="ghost"
                  :disabled="saving"
                  @click="remove"
                >
                  {{ t('settings.aiSkillsDelete') }}
                </RsButton>
                <RsButton size="sm" :disabled="saving" @click="save">
                  {{ t('settings.aiSkillsSave') }}
                </RsButton>
              </div>
            </header>
            <p v-if="error" class="nm-ai-skills__error nm-caption" role="alert">{{ error }}</p>
            <label class="nm-ai-skills__field">
              <span>{{ t('settings.aiSkillsCode') }}</span>
              <RsInput v-model="formCode" size="sm" :disabled="saving" />
            </label>
            <label class="nm-ai-skills__field">
              <span>{{ t('settings.aiSkillsName') }}</span>
              <RsInput v-model="formName" size="sm" :disabled="saving" />
            </label>
            <label class="nm-ai-skills__field">
              <span>{{ t('settings.aiSkillsScope') }}</span>
              <RsInput v-model="formScope" size="sm" :disabled="saving" />
            </label>
            <label class="nm-ai-skills__field">
              <span>{{ t('settings.aiSkillsStatus') }}</span>
              <RsSelect
                size="sm"
                :model-value="formStatus"
                :options="statusOptions"
                @update:model-value="(v) => (formStatus = (Array.isArray(v) ? v[0] : v) as 'active' | 'disabled')"
              />
            </label>
            <label class="nm-ai-skills__field nm-ai-skills__field--block">
              <span>{{ t('settings.aiSkillsTemplate') }}</span>
              <textarea
                v-model="formTemplate"
                class="nm-ai-skills__template"
                rows="12"
                :disabled="saving"
              />
            </label>
            <label class="nm-ai-skills__field nm-ai-skills__field--block">
              <span>{{ t('settings.aiSkillsParamSchema') }}</span>
              <p class="nm-ai-skills__hint nm-caption">{{ t('settings.aiSkillsParamSchemaHint') }}</p>
              <textarea
                v-model="formParamSchema"
                class="nm-ai-skills__template nm-ai-skills__template--schema"
                rows="8"
                :disabled="saving"
                spellcheck="false"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.nm-ai-skills__toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.nm-ai-skills__toolbar-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.nm-ai-skills__workspace {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 12px;
  min-height: 360px;
}

.nm-ai-skills__sidebar {
  border: 1px solid var(--rs-border-subtle);
  border-radius: 10px;
  padding: 10px;
  background: color-mix(in srgb, var(--nm-elevated-bg) 80%, transparent);
}

.nm-ai-skills__sidebar-title {
  font-size: var(--nm-font-caption);
  color: var(--rs-text-secondary);
  margin-bottom: 8px;
}

.nm-ai-skills__nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nm-ai-skills__nav-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--rs-text);
  text-align: left;
  cursor: pointer;
}

.nm-ai-skills__nav-item--active,
.nm-ai-skills__nav-item:hover {
  background: color-mix(in srgb, var(--rs-text) 8%, transparent);
}

.nm-ai-skills__nav-name {
  font-size: var(--nm-font-body);
  font-weight: 550;
}

.nm-ai-skills__nav-meta,
.nm-ai-skills__sidebar-empty {
  font-size: var(--nm-font-caption);
  color: var(--rs-text-secondary);
}

.nm-ai-skills__detail {
  border: 1px solid var(--rs-border-subtle);
  border-radius: 10px;
  padding: 14px;
  min-width: 0;
}

.nm-ai-skills__detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.nm-ai-skills__detail-title {
  margin: 0;
  font-size: var(--nm-font-title);
}

.nm-ai-skills__detail-actions {
  display: flex;
  gap: 8px;
}

.nm-ai-skills__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  font-size: var(--nm-font-caption);
  color: var(--rs-text-secondary);
}

.nm-ai-skills__hint {
  margin: 0;
  color: var(--rs-muted);
}

.nm-ai-skills__template {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 180px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--rs-border-subtle);
  background: var(--nm-editor-bg);
  color: var(--rs-text);
  font: inherit;
  line-height: 1.45;
}

.nm-ai-skills__error {
  color: var(--rs-danger, #ef4444);
  margin-bottom: 8px;
}

.nm-ai-skills__state {
  padding: 24px;
  color: var(--rs-text-secondary);
}
</style>
