<script setup lang="ts">
/**
 * MCP 服务设置：注册外部 MCP Server、刷新工具发现、按工具启用 / 风险分级。
 * 布局对齐「模型接入」：顶栏 + 左列表 + 右详情（见 docs/24 §15）。
 */
import {
  RsBadge,
  RsButton,
  RsCheckbox,
  RsEmpty,
  RsIcon,
  RsInput,
  RsSelect,
  RsTooltip,
} from '@niuma/ui'
import type { RsSelectOption } from '@niuma/ui'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { aiApi } from '@/api/ai'
import type { AiMcpServer, AiMcpTransportKind, AiToolRiskLevel } from '@/api/types/ai'

const { t } = useI18n()

const servers = ref<AiMcpServer[]>([])
const selectedId = ref('')
const creating = ref(false)
const loading = ref(false)
const saving = ref(false)
const refreshing = ref(false)
const error = ref<string | null>(null)
const statusMessage = ref('')

const form = ref({
  serverName: '',
  transportKind: 'stdio' as AiMcpTransportKind,
  commandPath: '',
  endpointUrl: '',
  launchOptions: '{"args":[]}',
  bearerToken: '',
  clearToken: false,
  rowVersion: 0,
})

const selected = computed(() => servers.value.find((s) => s.serverId === selectedId.value) ?? null)
const showDetail = computed(() => creating.value || Boolean(selected.value))

const detailTitle = computed(() => {
  if (creating.value) return t('settings.aiMcpAdd')
  return form.value.serverName.trim() || t('settings.aiMcpEdit')
})

const enabledToolCount = computed(
  () => selected.value?.tools?.filter((x) => x.enabled).length ?? 0,
)

const transportOptions = computed((): RsSelectOption[] => [
  { value: 'stdio', label: t('settings.aiMcpTransportStdio') },
  { value: 'streamable_http', label: t('settings.aiMcpTransportHttp') },
])

const riskOptions = computed((): RsSelectOption[] => [
  { value: 'read', label: t('settings.aiMcpRiskRead') },
  { value: 'write', label: t('settings.aiMcpRiskWrite') },
  { value: 'dangerous', label: t('settings.aiMcpRiskDangerous') },
])

function transportIcon(kind: string): string {
  if (kind === 'stdio') return 'terminal'
  return 'globe'
}

function transportLabel(kind: string): string {
  if (kind === 'stdio') return t('settings.aiMcpTransportStdio')
  if (kind === 'streamable_http') return t('settings.aiMcpTransportHttp')
  if (kind === 'sse') return t('settings.aiMcpTransportSse')
  return kind
}

function riskBadgeVariant(risk: string | undefined): 'default' | 'warning' | 'danger' | 'success' {
  const r = (risk || 'read').toLowerCase()
  if (r === 'dangerous') return 'danger'
  if (r === 'write') return 'warning'
  return 'success'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const res = await aiApi.listMcpServers({ withTools: true })
    servers.value = res.servers ?? []
    if (selectedId.value && !servers.value.some((s) => s.serverId === selectedId.value)) {
      selectedId.value = ''
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function startCreate(): void {
  creating.value = true
  selectedId.value = ''
  form.value = {
    serverName: '',
    transportKind: 'stdio',
    commandPath: '',
    endpointUrl: '',
    launchOptions: '{"args":[]}',
    bearerToken: '',
    clearToken: false,
    rowVersion: 0,
  }
  statusMessage.value = ''
  error.value = null
}

/** 一键注册内置 Vastbase 只读 MCP（外部二进制；不编进 platform）。 */
async function addBuiltinVastbase(): Promise<void> {
  saving.value = true
  error.value = null
  statusMessage.value = ''
  try {
    const existing = servers.value.find(
      (s) => s.serverId === 'builtin_mcp_vastbase_readonly' || s.serverName === 'vastbase-readonly',
    )
    let serverId = existing?.serverId
    if (!existing) {
      const res = await aiApi.upsertMcpServer({
        serverId: 'builtin_mcp_vastbase_readonly',
        serverName: 'vastbase-readonly',
        transportKind: 'stdio',
        commandPath: 'mcp-vastbase-readonly',
        launchOptions: '{"args":[],"timeoutMs":30000}',
        recordStatus: 'active',
        sortOrder: 10,
      })
      serverId = res.server?.serverId
    }
    await load()
    if (serverId) {
      selectServer(serverId)
      refreshing.value = true
      try {
        await aiApi.refreshMcpTools({ serverId })
        await load()
        selectServer(serverId)
        statusMessage.value = t('settings.aiMcpBuiltinReady')
      } catch (e) {
        error.value = e instanceof Error ? e.message : t('settings.aiMcpBuiltinBinaryMissing')
      } finally {
        refreshing.value = false
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

function cancelCreate(): void {
  creating.value = false
  error.value = null
  statusMessage.value = ''
  if (servers.value[0]) {
    selectServer(servers.value[0].serverId)
  }
}

function selectServer(id: string): void {
  creating.value = false
  selectedId.value = id
  const s = servers.value.find((x) => x.serverId === id)
  if (!s) return
  form.value = {
    serverName: s.serverName,
    transportKind: (s.transportKind as AiMcpTransportKind) || 'stdio',
    commandPath: s.commandPath || '',
    endpointUrl: s.endpointUrl || '',
    launchOptions: s.launchOptions || '{}',
    bearerToken: '',
    clearToken: false,
    rowVersion: s.rowVersion,
  }
  statusMessage.value = ''
  error.value = null
}

async function save(): Promise<void> {
  if (!form.value.serverName.trim()) {
    error.value = t('settings.aiMcpNameRequired')
    return
  }
  saving.value = true
  error.value = null
  try {
    const res = await aiApi.upsertMcpServer({
      serverId: creating.value ? undefined : selectedId.value || undefined,
      serverName: form.value.serverName.trim(),
      transportKind: form.value.transportKind,
      commandPath: form.value.commandPath.trim() || undefined,
      endpointUrl: form.value.endpointUrl.trim() || undefined,
      launchOptions: form.value.launchOptions.trim() || '{}',
      rowVersion: creating.value ? undefined : form.value.rowVersion,
      bearerToken: form.value.bearerToken.trim() || undefined,
      clearToken: form.value.clearToken || undefined,
    })
    creating.value = false
    selectedId.value = res.server.serverId
    statusMessage.value = t('settings.aiMcpSaved')
    await load()
    selectServer(res.server.serverId)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  if (!selectedId.value) return
  const name = selected.value?.serverName ?? selectedId.value
  if (!window.confirm(t('settings.aiMcpDeleteConfirm', { name }))) return
  try {
    await aiApi.deleteMcpServer({ serverId: selectedId.value })
    selectedId.value = ''
    creating.value = false
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function refreshTools(): Promise<void> {
  if (!selectedId.value) return
  refreshing.value = true
  error.value = null
  try {
    const res = await aiApi.refreshMcpTools({ serverId: selectedId.value })
    statusMessage.value = t('settings.aiMcpRefreshed', { count: res.server.tools?.length ?? 0 })
    await load()
    selectServer(res.server.serverId)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    refreshing.value = false
  }
}

async function toggleTool(toolId: string, enabled: boolean): Promise<void> {
  try {
    await aiApi.setMcpToolEnabled({ toolId, enabled })
    await load()
    if (selectedId.value) selectServer(selectedId.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function setToolRisk(toolId: string, riskLevel: string): Promise<void> {
  try {
    await aiApi.setMcpToolRisk({ toolId, riskLevel: riskLevel as AiToolRiskLevel })
    await load()
    if (selectedId.value) selectServer(selectedId.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="nm-settings__panel nm-ai-mcp">
    <header class="nm-ai-mcp__toolbar">
      <div class="nm-ai-mcp__toolbar-main">
        <div class="nm-ai-mcp__title-row">
          <h1 class="nm-section-title">{{ t('settings.aiMcp') }}</h1>
          <RsTooltip side="bottom" align="start">
            <RsButton
              variant="ghost"
              size="sm"
              icon="info"
              icon-only
              :aria-label="t('settings.aiMcpDesc')"
            />
            <template #content>
              <div class="nm-ai-mcp__tooltip">
                <p>{{ t('settings.aiMcpDesc') }}</p>
              </div>
            </template>
          </RsTooltip>
        </div>
      </div>
      <div class="nm-ai-mcp__toolbar-actions">
        <RsTooltip :content="t('settings.aiMcpRefreshList')" side="top">
          <RsButton variant="ghost" size="sm" :loading="loading" :disabled="loading" @click="load">
            <RsIcon name="refresh-cw" :size="14" />
            {{ t('settings.aiMcpRefreshList') }}
          </RsButton>
        </RsTooltip>
        <RsTooltip :content="t('settings.aiMcpBuiltinHint')" side="top">
          <RsButton
            variant="ghost"
            size="sm"
            :loading="saving || refreshing"
            :disabled="saving || refreshing"
            @click="addBuiltinVastbase"
          >
            <RsIcon name="database" :size="14" />
            {{ t('settings.aiMcpBuiltinAdd') }}
          </RsButton>
        </RsTooltip>
        <RsButton variant="primary" size="sm" @click="startCreate">
          <RsIcon name="plus" :size="14" />
          {{ t('settings.aiMcpAdd') }}
        </RsButton>
      </div>
    </header>

    <div class="nm-ai-mcp__body">
      <RsEmpty
        v-if="loading && !servers.length"
        fill
        icon-radius="none"
        class="nm-ai-mcp__state"
        :description="t('settings.aiMcpLoading')"
      >
        <template #icon>
          <RsIcon name="loader-circle" :size="22" />
        </template>
      </RsEmpty>

      <div v-else class="nm-ai-mcp__workspace">
        <aside class="nm-ai-mcp__sidebar" :aria-label="t('settings.aiMcpList')">
          <div class="nm-ai-mcp__sidebar-title">{{ t('settings.aiMcpList') }}</div>
          <nav v-if="servers.length" class="nm-ai-mcp__nav">
            <button
              v-for="s in servers"
              :key="s.serverId"
              type="button"
              class="nm-ai-mcp__nav-item"
              :class="{ 'nm-ai-mcp__nav-item--active': !creating && selectedId === s.serverId }"
              @click="selectServer(s.serverId)"
            >
              <span class="nm-ai-mcp__nav-icon" aria-hidden="true">
                <RsIcon :name="transportIcon(s.transportKind)" :size="16" />
              </span>
              <span class="nm-ai-mcp__nav-text min-w-0">
                <span class="nm-ai-mcp__nav-name truncate">{{ s.serverName }}</span>
                <span class="nm-ai-mcp__nav-meta truncate">
                  {{ transportLabel(s.transportKind) }}
                  · {{ t('settings.aiMcpToolCount', { n: s.tools?.length ?? 0 }) }}
                </span>
              </span>
              <span
                class="nm-ai-mcp__status-dot"
                :class="
                  s.recordStatus === 'active'
                    ? 'nm-ai-mcp__status-dot--ok'
                    : 'nm-ai-mcp__status-dot--off'
                "
                :title="s.recordStatus"
                aria-hidden="true"
              />
            </button>
          </nav>
          <p v-else class="nm-ai-mcp__sidebar-empty nm-caption">
            {{ t('settings.aiMcpEmpty') }}
          </p>
        </aside>

        <div class="nm-ai-mcp__detail" :class="{ 'nm-ai-mcp__detail--empty': !showDetail }">
          <RsEmpty
            v-if="!showDetail"
            fill
            icon-radius="none"
            class="nm-ai-mcp__state"
            :description="t('settings.aiMcpSelectHint')"
          >
            <template #icon>
              <RsIcon name="blocks" :size="22" />
            </template>
            <RsButton variant="primary" size="sm" @click="startCreate">
              {{ t('settings.aiMcpAdd') }}
            </RsButton>
          </RsEmpty>

          <div v-else class="nm-ai-mcp__detail-inner">
            <header class="nm-ai-mcp__detail-head">
              <div class="min-w-0">
                <h2 class="nm-ai-mcp__detail-title truncate">{{ detailTitle }}</h2>
                <p class="nm-caption">
                  {{ creating ? t('settings.aiMcpNewHint') : transportLabel(form.transportKind) }}
                </p>
              </div>
              <div v-if="!creating" class="nm-ai-mcp__badges">
                <RsBadge :variant="selected?.recordStatus === 'active' ? 'success' : 'default'">
                  {{ selected?.recordStatus === 'active' ? t('settings.aiMcpActive') : selected?.recordStatus }}
                </RsBadge>
                <RsBadge variant="info">
                  {{ t('settings.aiMcpEnabledCount', { n: enabledToolCount, total: selected?.tools?.length ?? 0 }) }}
                </RsBadge>
                <RsBadge v-if="selected?.hasCredential" variant="primary">
                  {{ t('settings.aiMcpHasToken') }}
                </RsBadge>
              </div>
            </header>

            <p v-if="error" class="nm-ai-mcp__error nm-caption" role="alert">{{ error }}</p>
            <p v-else-if="statusMessage" class="nm-ai-mcp__status nm-caption">{{ statusMessage }}</p>

            <section class="nm-ai-mcp__section">
              <h3 class="nm-ai-mcp__section-title">{{ t('settings.aiMcpConnection') }}</h3>
              <div class="nm-ai-mcp__form">
                <div class="nm-ai-mcp__field">
                  <label class="nm-ai-mcp__label" for="ai-mcp-name">{{ t('settings.aiMcpName') }}</label>
                  <RsInput
                    id="ai-mcp-name"
                    v-model="form.serverName"
                    size="sm"
                    :placeholder="t('settings.aiMcpNamePlaceholder')"
                  />
                </div>
                <div class="nm-ai-mcp__field">
                  <span class="nm-ai-mcp__label">{{ t('settings.aiMcpTransport') }}</span>
                  <RsSelect v-model="form.transportKind" :options="transportOptions" size="sm" />
                </div>
                <div v-if="form.transportKind === 'stdio'" class="nm-ai-mcp__field nm-ai-mcp__field--full">
                  <label class="nm-ai-mcp__label" for="ai-mcp-cmd">{{ t('settings.aiMcpCommand') }}</label>
                  <RsInput
                    id="ai-mcp-cmd"
                    v-model="form.commandPath"
                    size="sm"
                    :placeholder="t('settings.aiMcpCommandPlaceholder')"
                  />
                </div>
                <div v-else class="nm-ai-mcp__field nm-ai-mcp__field--full">
                  <label class="nm-ai-mcp__label" for="ai-mcp-url">{{ t('settings.aiMcpEndpoint') }}</label>
                  <RsInput
                    id="ai-mcp-url"
                    v-model="form.endpointUrl"
                    size="sm"
                    placeholder="https://…"
                  />
                </div>
                <div class="nm-ai-mcp__field nm-ai-mcp__field--full">
                  <div class="nm-ai-mcp__label-row">
                    <label class="nm-ai-mcp__label" for="ai-mcp-launch">
                      {{ t('settings.aiMcpLaunchOptions') }}
                    </label>
                    <RsTooltip :content="t('settings.aiMcpLaunchOptionsHint')" side="top">
                      <RsButton
                        variant="ghost"
                        size="sm"
                        icon="info"
                        icon-only
                        :aria-label="t('settings.aiMcpLaunchOptionsHint')"
                      />
                    </RsTooltip>
                  </div>
                  <RsInput id="ai-mcp-launch" v-model="form.launchOptions" size="sm" />
                </div>
              </div>
            </section>

            <section class="nm-ai-mcp__section">
              <h3 class="nm-ai-mcp__section-title">{{ t('settings.aiMcpAuth') }}</h3>
              <div class="nm-ai-mcp__form">
                <div class="nm-ai-mcp__field nm-ai-mcp__field--full">
                  <label class="nm-ai-mcp__label" for="ai-mcp-token">{{ t('settings.aiMcpToken') }}</label>
                  <RsInput
                    id="ai-mcp-token"
                    v-model="form.bearerToken"
                    size="sm"
                    type="password"
                    :placeholder="
                      selected?.hasCredential
                        ? t('settings.aiMcpTokenKeep')
                        : t('settings.aiMcpTokenPlaceholder')
                    "
                  />
                  <div v-if="selected?.hasCredential" class="nm-ai-mcp__check">
                    <RsCheckbox v-model="form.clearToken" size="sm">
                      {{ t('settings.aiMcpClearToken') }}
                    </RsCheckbox>
                  </div>
                </div>
              </div>
            </section>

            <footer class="nm-ai-mcp__footer">
              <RsButton size="sm" variant="primary" :loading="saving" :disabled="saving" @click="save">
                {{ t('settings.aiMcpSave') }}
              </RsButton>
              <RsButton
                v-if="!creating && selectedId"
                size="sm"
                variant="secondary"
                :loading="refreshing"
                :disabled="refreshing || saving"
                @click="refreshTools"
              >
                <RsIcon name="scan-search" :size="14" />
                {{ t('settings.aiMcpDiscover') }}
              </RsButton>
              <RsButton
                v-if="creating"
                size="sm"
                variant="ghost"
                :disabled="saving"
                @click="cancelCreate"
              >
                {{ t('settings.aiMcpCancel') }}
              </RsButton>
              <span class="nm-ai-mcp__footer-spacer" />
              <RsButton
                v-if="!creating && selectedId"
                size="sm"
                variant="ghost"
                :disabled="saving"
                @click="remove"
              >
                <RsIcon name="trash-2" :size="14" />
                {{ t('settings.aiMcpDelete') }}
              </RsButton>
            </footer>

            <section v-if="!creating" class="nm-ai-mcp__section nm-ai-mcp__tools-section">
              <div class="nm-ai-mcp__tools-head">
                <h3 class="nm-ai-mcp__section-title">{{ t('settings.aiMcpTools') }}</h3>
                <p class="nm-caption">{{ t('settings.aiMcpToolsHint') }}</p>
              </div>

              <div v-if="selected?.tools?.length" class="nm-ai-mcp__tools">
                <div class="nm-ai-mcp__tools-cols" aria-hidden="true">
                  <span>{{ t('settings.aiMcpToolEnabled') }}</span>
                  <span>{{ t('settings.aiMcpToolName') }}</span>
                  <span>{{ t('settings.aiMcpToolRisk') }}</span>
                </div>
                <div
                  v-for="tool in selected.tools"
                  :key="tool.toolId"
                  class="nm-ai-mcp__tool"
                  :class="{ 'nm-ai-mcp__tool--off': !tool.enabled }"
                >
                  <div class="nm-ai-mcp__tool-enable">
                    <RsCheckbox
                      size="sm"
                      :model-value="tool.enabled"
                      :aria-label="tool.toolName"
                      @update:model-value="toggleTool(tool.toolId, $event)"
                    />
                  </div>
                  <div class="nm-ai-mcp__tool-main min-w-0">
                    <div class="nm-ai-mcp__tool-name-row">
                      <code class="nm-ai-mcp__tool-name">{{ tool.toolName }}</code>
                      <RsBadge
                        class="nm-ai-mcp__tool-risk-badge"
                        :variant="riskBadgeVariant(tool.riskLevel)"
                      >
                        {{
                          tool.riskLevel === 'write'
                            ? t('settings.aiMcpRiskWrite')
                            : tool.riskLevel === 'dangerous'
                              ? t('settings.aiMcpRiskDangerous')
                              : t('settings.aiMcpRiskRead')
                        }}
                      </RsBadge>
                    </div>
                    <p v-if="tool.toolDescription" class="nm-ai-mcp__tool-desc">
                      {{ tool.toolDescription }}
                    </p>
                  </div>
                  <div class="nm-ai-mcp__tool-risk">
                    <RsSelect
                      size="sm"
                      :model-value="tool.riskLevel || 'read'"
                      :options="riskOptions"
                      :disabled="!tool.enabled"
                      @update:model-value="setToolRisk(tool.toolId, String($event))"
                    />
                  </div>
                </div>
              </div>
              <RsEmpty
                v-else
                icon-radius="none"
                class="nm-ai-mcp__tools-empty"
                :description="t('settings.aiMcpNoTools')"
              >
                <template #icon>
                  <RsIcon name="wrench" :size="20" />
                </template>
                <RsButton
                  size="sm"
                  variant="secondary"
                  :loading="refreshing"
                  :disabled="!selectedId || refreshing"
                  @click="refreshTools"
                >
                  {{ t('settings.aiMcpDiscover') }}
                </RsButton>
              </RsEmpty>
            </section>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.nm-ai-mcp.nm-settings__panel {
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

.nm-ai-mcp__toolbar {
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

.nm-ai-mcp__toolbar-main {
  min-width: 0;
}

.nm-ai-mcp__title-row {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.nm-ai-mcp__tooltip {
  max-width: 18rem;
  line-height: 1.45;
}

.nm-ai-mcp__tooltip p {
  margin: 0;
}

.nm-ai-mcp__toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
}

.nm-ai-mcp__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-ai-mcp__workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  background: var(--rs-surface-elevated);
}

.nm-ai-mcp__sidebar {
  display: flex;
  flex-direction: column;
  width: 15.5rem;
  flex-shrink: 0;
  border-right: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 2%, var(--rs-surface-elevated));
  overflow: auto;
}

.nm-ai-mcp__sidebar-title {
  padding: var(--rs-space-sm) var(--rs-space-md);
  font-size: var(--nm-font-caption);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--rs-muted);
}

.nm-ai-mcp__sidebar-empty {
  padding: var(--rs-space-md);
  color: var(--rs-muted);
}

.nm-ai-mcp__nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.nm-ai-mcp__nav-item {
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

.nm-ai-mcp__nav-item:hover {
  background: var(--rs-item-hover);
}

.nm-ai-mcp__nav-item--active {
  background: color-mix(in srgb, var(--rs-primary) 14%, transparent);
  border-left-color: var(--rs-primary);
}

.nm-ai-mcp__nav-icon {
  display: inline-flex;
  color: var(--rs-muted);
  flex-shrink: 0;
}

.nm-ai-mcp__nav-item--active .nm-ai-mcp__nav-icon {
  color: var(--rs-primary);
}

.nm-ai-mcp__nav-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.nm-ai-mcp__nav-name {
  font-size: var(--nm-font-body);
  font-weight: 500;
}

.nm-ai-mcp__nav-meta {
  font-size: var(--nm-font-caption);
  color: var(--rs-muted);
}

.nm-ai-mcp__status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  flex-shrink: 0;
}

.nm-ai-mcp__status-dot--ok {
  background: var(--rs-success, #22c55e);
}

.nm-ai-mcp__status-dot--off {
  background: var(--rs-muted);
  opacity: 0.45;
}

.nm-ai-mcp__detail {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.nm-ai-mcp__detail-inner {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  padding: var(--rs-space-md) var(--rs-space-lg) var(--rs-space-lg);
}

.nm-ai-mcp__detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
}

.nm-ai-mcp__detail-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--rs-text);
}

.nm-ai-mcp__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.nm-ai-mcp__section {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}

.nm-ai-mcp__section-title {
  margin: 0;
  font-size: var(--nm-font-caption);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--rs-muted);
}

.nm-ai-mcp__form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--rs-space-md) var(--rs-space-lg);
}

.nm-ai-mcp__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.nm-ai-mcp__field--full {
  grid-column: 1 / -1;
}

.nm-ai-mcp__label {
  font-size: var(--nm-font-caption);
  font-weight: 500;
  color: var(--rs-muted);
}

.nm-ai-mcp__label-row {
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
  min-height: 1.5rem;
}

.nm-ai-mcp__check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  font-size: var(--nm-font-caption);
  color: var(--rs-muted);
  cursor: pointer;
}

.nm-ai-mcp__error {
  color: var(--rs-danger);
}

.nm-ai-mcp__status {
  color: var(--rs-success, #16a34a);
}

.nm-ai-mcp__footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--rs-space-sm);
  padding-top: var(--rs-space-sm);
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-ai-mcp__footer-spacer {
  flex: 1;
}

.nm-ai-mcp__tools-section {
  padding-top: var(--rs-space-sm);
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-ai-mcp__tools-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nm-ai-mcp__tools {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md, 8px);
  overflow: hidden;
  background: color-mix(in srgb, var(--rs-text) 1.5%, var(--rs-surface-elevated));
}

.nm-ai-mcp__tools-cols {
  display: grid;
  grid-template-columns: 2.5rem minmax(0, 1fr) 7.5rem;
  gap: var(--rs-space-sm);
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--rs-muted);
  background: color-mix(in srgb, var(--rs-text) 4%, transparent);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-ai-mcp__tool {
  display: grid;
  grid-template-columns: 2.5rem minmax(0, 1fr) 7.5rem;
  gap: var(--rs-space-sm);
  align-items: start;
  padding: 10px 12px;
  border-bottom: 1px solid var(--rs-border-subtle);
  transition: background var(--rs-transition-fast);
}

.nm-ai-mcp__tool:last-child {
  border-bottom: none;
}

.nm-ai-mcp__tool:hover {
  background: color-mix(in srgb, var(--rs-text) 3.5%, transparent);
}

.nm-ai-mcp__tool--off {
  opacity: 0.62;
}

.nm-ai-mcp__tool-enable {
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: 2px;
}

.nm-ai-mcp__tool-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nm-ai-mcp__tool-name-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.nm-ai-mcp__tool-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--rs-text);
}

.nm-ai-mcp__tool-desc {
  margin: 0;
  font-size: var(--nm-font-caption);
  line-height: 1.4;
  color: var(--rs-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.nm-ai-mcp__tool-risk {
  min-width: 0;
}

.nm-ai-mcp__tool-risk-badge {
  flex-shrink: 0;
}

.nm-ai-mcp__tools-empty {
  min-height: 8rem;
  border: 1px dashed var(--rs-border-subtle);
  border-radius: var(--rs-radius-md, 8px);
}

.nm-ai-mcp__state {
  flex: 1;
  min-height: 0;
}

@media (max-width: 860px) {
  .nm-ai-mcp__workspace {
    flex-direction: column;
  }

  .nm-ai-mcp__sidebar {
    width: 100%;
    max-height: 11rem;
    border-right: none;
    border-bottom: 1px solid var(--rs-border-subtle);
  }

  .nm-ai-mcp__form {
    grid-template-columns: 1fr;
  }

  .nm-ai-mcp__tools-cols,
  .nm-ai-mcp__tool {
    grid-template-columns: 2.25rem minmax(0, 1fr);
  }

  .nm-ai-mcp__tools-cols > span:last-child,
  .nm-ai-mcp__tool-risk {
    display: none;
  }

  .nm-ai-mcp__detail-inner {
    padding: var(--rs-space-sm) var(--rs-space-md) var(--rs-space-md);
  }
}
</style>
