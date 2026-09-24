/**
 * API 工作台共享状态（唯一 Pinia 门面）。
 *
 * 本文件只编排：持有 folders / env / sockets，对外暴露 CRUD 与发送。
 * 不要再拆第二个 api-* Store（hydrate 与发送会抢同一份 reactive）。
 * 协议 / 落盘已在外部；这里按块往下读即可：
 *
 *   1. 状态与索引
 *   2. 持久化接线（workspace / catalog）
 *   3. hydrate（读盘；旧快照里的环境在 catalog 为空时迁入）
 *   4. Tab
 *   5. 环境 / 变量
 *   6. 集合 CRUD
 *   7. 发送与套接字会话
 *   8. 历史
 *
 * 外部实现：
 * - utils/workspace-persist：workspace JSON（结构立即 / 字段防抖）
 * - utils/catalog-persist：环境与变量关系表（按 scope 排队）
 * - http/utils/request-resolve：变量 + Auth + URL/Body
 * - http/utils/send：HTTP 执行；tcp/utils/send：套接字会话
 * - composables/useApiRequestPersist：当前请求字段编辑标脏
 *
 * 运行时 exchanges / sockets / sending 不进 workspace。
 */
import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import { apiCatalogApi, apiHistoryApi, isBridgeAvailable, isPlatformUnavailable, settingsApi, withPlatformRetry } from '@/api'
import type { ApiVariableScope as CatalogVariableScope } from '@/api/types/api-catalog'
import { i18n } from '@/locale'
import type { ApiSocketDataEvent, ApiSocketEncoding } from '@/api/types/api-socket'
import { watchSocketSession } from '../utils/socket-hub'
import {
  SendError,
  executeRequest,
  failExchange,
  localizeSendError,
  protocolOf,
  resolveSend,
} from '../http/utils/send'
import {
  appendSocketFrame,
  buildLiveExchange,
  closeSocketSession,
  kickSocketPeer,
  listSocketPeers,
  openSocketSession,
  patchLiveExchangeFromFrame,
  sendSocketFrame,
} from '../tcp/utils/send'
import { adoptLivePeers, applyLiveSocketEvent } from '../tcp/utils/live-peers'
import type { SocketFrameOpen } from '../tcp/utils/frame'
import { createId } from '@/utils/id'
import { cloneRequest, defaultAuth, defaultEnvironments, defaultFolders, emptyKinds, emptyVars, isApiWorkspaceText, mergeWorkspaceFolders, parseWorkspace, serializeWorkspace, uniqueName, workspaceHasEmbeddedCatalog, type ApiWorkspaceState } from '../utils/collection-io'
import { applyFolderVariables, catalogEnvironmentToRuntime, catalogToTypedRecord, recordToVariableInputs } from '../utils/catalog-sync'
import { createCatalogPersister } from '../utils/catalog-persist'
import { createWorkspacePersister } from '../utils/workspace-persist'
import { applyPaneDefaults } from '../layout/pane-registry'
import { buildCurl } from '../http/utils/curl'
import { resolveRequest } from '../http/utils/request-resolve'
import { canAddChildFolder, canNestFolder, collectDescendantFolderIds, scopeForRequest, type ApiVariableScope } from '../utils/folder-tree'
import { requestFromHistory, toHistoryItem, toHistorySummary } from '../utils/history-map'
import { tabTitle, tabTooltip } from '../utils/tab-chrome'
import { isSocketMethod, type SocketTarget } from '../utils/target'
import type { ApiEnvironment, ApiExchange, ApiFolder, ApiHistoryItem, ApiLiveSocket, ApiMethod, ApiMockServer, ApiRequest, ApiRunProfile, ApiSendOptions, ApiVariableBag, ApiVariableKind } from '../types'
import { useTabStore } from '@/stores/tab'

const SETTING_KEY = 'api.workspace'

function replaceList<T>(target: T[], next: readonly T[]): void {
  target.splice(0, target.length, ...next)
}

function scanLocateRequest(
  folders: ApiFolder[],
  id: string | null | undefined,
): { folder: ApiFolder; index: number; request: ApiRequest } | undefined {
  if (!id) return undefined
  for (const folder of folders) {
    const index = folder.requests.findIndex((item) => item.id === id)
    if (index >= 0) {
      return { folder, index, request: folder.requests[index]! }
    }
  }
  return undefined
}

/**
 * API 测试共享状态：集合、环境、各请求的发送结果。
 * 每个请求对应一个 Shell Tab（props.requestId），集合树跨 Tab 共用。
 * TCP / UDP 会话按 requestId 保活，关 Tab 才 close；HTTP 仍一发一收。
 * 集合写入 Platform SQLite（nm_app_setting / api.workspace）；
 * 环境与变量写入 nm_api_environment / nm_api_variable，重启后按 id 还原。
 */
export const useApiTesterStore = defineStore('api-tester', () => {
  // --- 1. 状态与索引 ---
  const folders = reactive<ApiFolder[]>([])
  const environments = reactive<ApiEnvironment[]>([])
  const globals = reactive<ApiVariableBag>({ vars: emptyVars(), kinds: emptyKinds() })
  const runProfiles = reactive<ApiRunProfile[]>([])
  const mockServers = reactive<ApiMockServer[]>([])
  const envId = ref('')
  const treeFilter = ref('')
  const historyFilter = ref('')
  const history = reactive<ApiHistoryItem[]>([])
  const sending = reactive<Record<string, boolean>>({})
  const exchanges = reactive<Record<string, ApiExchange | null>>({})
  const sockets = reactive<Record<string, ApiLiveSocket>>({})
  const socketLogs = reactive<Record<string, ApiSocketDataEvent[]>>({})
  const socketUnwatch = new Map<string, () => void>()
  const peerSyncGen = new Map<string, number>()
  const peerSyncAt = new Map<string, number>()
  const sendGen = new Map<string, number>()
  const sendAbort = new Map<string, AbortController>()
  const ready = ref(false)
  let catalogLoading = false
  let unloadHookInstalled = false
  /** hydrate 完成前用户已改过集合时，禁止 applyWorkspace 覆盖。 */
  let touchedBeforeReady = false
  /** 磁盘已是工作区但文件夹解析失败：本会话不回写，避免空种子覆盖。 */
  let keepDisk = false
  /** requestId → folderId，Send / variableScope O(1) 查表。 */
  const requestFolderIndex = new Map<string, string>()

  function rebuildRequestIndex(): void {
    requestFolderIndex.clear()
    for (const folder of folders) {
      for (const req of folder.requests) {
        requestFolderIndex.set(req.id, folder.id)
      }
    }
  }

  function variableScope(requestId?: string | null): ApiVariableScope {
    return scopeForRequest(folders, globals, requestId, requestFolderIndex)
  }

  function seedEmpty(): void {
    replaceList(folders, defaultFolders(String(i18n.global.t('modules.api.drafts'))))
    replaceList(environments, defaultEnvironments())
    globals.vars = emptyVars()
    globals.kinds = emptyKinds()
    replaceList(runProfiles, [])
    replaceList(mockServers, [])
    envId.value = environments[0]?.id ?? ''
    rebuildRequestIndex()
  }

  function applyFolderSnapshot(
    nextFolders: readonly ApiFolder[],
    nextEnvId: string,
    profiles?: readonly ApiRunProfile[],
    mocks?: readonly ApiMockServer[],
  ): void {
    replaceList(folders, nextFolders.map((folder) => ({ ...folder, vars: emptyVars(), kinds: emptyKinds() })))
    replaceList(runProfiles, profiles ?? [])
    replaceList(mockServers, mocks ?? [])
    envId.value = nextEnvId
    rebuildRequestIndex()
  }

  function applyWorkspaceStructure(state: ApiWorkspaceState): void {
    applyFolderSnapshot(state.folders, state.envId, state.runProfiles, state.mockServers)
  }

  function mergeWorkspaceMeta(state: NonNullable<ReturnType<typeof parseWorkspace>>): void {
    replaceList(runProfiles, state.runProfiles ?? [])
    replaceList(mockServers, state.mockServers ?? [])
    if (state.envId) envId.value = state.envId
  }

  // --- 2. 持久化接线：只配回调，写盘逻辑在 *persist ---
  const workspacePersist = createWorkspacePersister({
    canWrite: () => ready.value && isBridgeAvailable() && !keepDisk,
    serialize: () =>
      JSON.stringify(
        serializeWorkspace(folders, envId.value, {
          runProfiles,
          mockServers,
        }),
      ),
    write: (payload) => {
      settingsApi.set(SETTING_KEY, payload).catch((error: unknown) => {
        if (isPlatformUnavailable(error)) return
        console.warn('[api-tester] workspace save failed', error)
      })
    },
  })

  const catalogPersist = createCatalogPersister({
    canFlush: () => ready.value && isBridgeAvailable() && !catalogLoading,
    flushScope: async (scope, scopeRefId) => {
      try {
        if (scope === 'global') {
          await apiCatalogApi.replaceScope({
            variableScope: 'global',
            variables: recordToVariableInputs(globals.vars, globals.kinds),
          })
          return
        }
        if (scope === 'environment') {
          const env = environments.find((item) => item.id === scopeRefId)
          if (!env) return
          await apiCatalogApi.updateEnvironment({
            environmentId: env.id,
            environmentName: env.name,
            baseUrl: env.baseUrl,
          })
          await apiCatalogApi.replaceScope({
            variableScope: 'environment',
            scopeRefId: env.id,
            variables: recordToVariableInputs(env.vars, env.kinds),
          })
          return
        }
        if (scope === 'folder') {
          const folder = folderById(scopeRefId)
          if (!folder) return
          await apiCatalogApi.replaceScope({
            variableScope: 'folder',
            scopeRefId: folder.id,
            variables: recordToVariableInputs(folder.vars, folder.kinds),
          })
        }
      } catch (error) {
        if (isPlatformUnavailable(error)) return
        console.warn('[api-tester] catalog save failed', error)
      }
    },
  })

  function queueCatalogScope(scope: CatalogVariableScope, scopeRefId = ''): void {
    catalogPersist.queue(scope, scopeRefId)
  }

  /** 当前请求字段编辑：只标脏，700ms 后写 workspace。 */
  function markWorkspaceDirty(): void {
    workspacePersist.markDirty()
  }

  function persistStructureNow(): void {
    if (!isBridgeAvailable()) return
    workspacePersist.flushNow()
  }

  async function loadCatalogFromPlatform(): Promise<void> {
    if (!isBridgeAvailable()) return
    catalogLoading = true
    try {
      const [envRes, varRes] = await Promise.all([
        withPlatformRetry(() => apiCatalogApi.listEnvironments()),
        withPlatformRetry(() => apiCatalogApi.listVariables()),
      ])
      const globalsTyped = catalogToTypedRecord(varRes.variables, 'global')
      const runtimeEnvs = envRes.environments.map((row) =>
        catalogEnvironmentToRuntime(row, catalogToTypedRecord(varRes.variables, 'environment', row.environmentId)),
      )
      replaceList(environments, runtimeEnvs.length ? runtimeEnvs : defaultEnvironments())
      globals.vars = globalsTyped.vars
      globals.kinds = globalsTyped.kinds
      applyFolderVariables(folders, varRes.variables)
      envId.value = environments.some((item) => item.id === envId.value)
        ? envId.value
        : (environments[0]?.id ?? '')
    } catch (error) {
      console.warn('[api-tester] catalog load failed', error)
      if (environments.length === 0) replaceList(environments, defaultEnvironments())
      if (!envId.value) envId.value = environments[0]?.id ?? ''
    } finally {
      catalogLoading = false
    }
  }

  async function ensureDefaultCatalog(): Promise<void> {
    if (!isBridgeAvailable()) return
    const listed = await withPlatformRetry(() => apiCatalogApi.listEnvironments())
    if (listed.environments.length > 0) {
      await loadCatalogFromPlatform()
      return
    }
    const seed = defaultEnvironments()[0]!
    await withPlatformRetry(() =>
      apiCatalogApi.createEnvironment({
        environmentId: seed.id,
        environmentName: seed.name,
        baseUrl: seed.baseUrl,
      }),
    )
    await loadCatalogFromPlatform()
  }

  /** 旧快照内嵌的环境 / 变量写入关系表。关系表已有同 scope 时不覆盖。 */
  async function adoptCatalog(state: ApiWorkspaceState | null): Promise<void> {
    if (!isBridgeAvailable()) return
    const listed = await withPlatformRetry(() => apiCatalogApi.listEnvironments())
    if (listed.environments.length === 0) {
      if (state && workspaceHasEmbeddedCatalog(state)) {
        await importEmbeddedCatalog(state)
        return
      }
      await ensureDefaultCatalog()
      return
    }
    if (state && workspaceHasEmbeddedCatalog(state)) {
      await fillEmbeddedVarsIfAbsent(state)
    }
    await loadCatalogFromPlatform()
  }

  async function fillEmbeddedVarsIfAbsent(state: ApiWorkspaceState): Promise<void> {
    const varRes = await withPlatformRetry(() => apiCatalogApi.listVariables())
    const hasGlobal = varRes.variables.some((row) => row.variableScope === 'global')
    if (!hasGlobal && state.globals && Object.keys(state.globals.vars).length > 0) {
      await withPlatformRetry(() =>
        apiCatalogApi.replaceScope({
          variableScope: 'global',
          variables: recordToVariableInputs(state.globals?.vars ?? {}, state.globals?.kinds),
        }),
      )
    }
    for (const folder of state.folders) {
      if (Object.keys(folder.vars).length === 0) continue
      const hasFolder = varRes.variables.some(
        (row) => row.variableScope === 'folder' && row.scopeRefId === folder.id,
      )
      if (hasFolder) continue
      await withPlatformRetry(() =>
        apiCatalogApi.replaceScope({
          variableScope: 'folder',
          scopeRefId: folder.id,
          variables: recordToVariableInputs(folder.vars, folder.kinds),
        }),
      )
    }
  }

  async function importEmbeddedCatalog(state: ApiWorkspaceState): Promise<void> {
    if (!isBridgeAvailable()) return
    for (const env of state.environments?.length ? state.environments : defaultEnvironments()) {
      await withPlatformRetry(() =>
        apiCatalogApi.createEnvironment({
          environmentId: env.id,
          environmentName: env.name,
          baseUrl: env.baseUrl,
        }),
      )
      const vars = { ...env.vars }
      delete vars.baseUrl
      await withPlatformRetry(() =>
        apiCatalogApi.replaceScope({
          variableScope: 'environment',
          scopeRefId: env.id,
          variables: recordToVariableInputs(vars, env.kinds),
        }),
      )
    }
    await withPlatformRetry(() =>
      apiCatalogApi.replaceScope({
        variableScope: 'global',
        variables: recordToVariableInputs(state.globals?.vars ?? {}, state.globals?.kinds),
      }),
    )
    for (const folder of state.folders) {
      if (Object.keys(folder.vars).length === 0) continue
      await withPlatformRetry(() =>
        apiCatalogApi.replaceScope({
          variableScope: 'folder',
          scopeRefId: folder.id,
          variables: recordToVariableInputs(folder.vars, folder.kinds),
        }),
      )
    }
    await loadCatalogFromPlatform()
  }

  // --- 3. hydrate：读 workspace，再叠 catalog；ready 前改集合不覆盖 ---
  function markTouchedBeforeReady(): void {
    if (!ready.value) touchedBeforeReady = true
  }

  function installUnloadPersistHook(): void {
    if (unloadHookInstalled || typeof window === 'undefined') return
    unloadHookInstalled = true
    window.addEventListener('beforeunload', () => {
      workspacePersist.cancelTimer()
      catalogPersist.cancelTimer()
      if (!catalogLoading) {
        queueCatalogScope('global')
        for (const env of environments) queueCatalogScope('environment', env.id)
        for (const folder of folders) queueCatalogScope('folder', folder.id)
      }
      catalogPersist.flushNow()
      workspacePersist.flushNow()
    })
  }

  async function hydrate(): Promise<void> {
    if (ready.value) return
    installUnloadPersistHook()
    try {
      if (isBridgeAvailable()) {
        const res = await withPlatformRetry(() => settingsApi.get(SETTING_KEY))
        const saved = parseWorkspace(res.value)
        if (saved) {
          if (touchedBeforeReady && folders.length > 0) {
            if (saved.folders.length) mergeWorkspaceFolders(folders, saved.folders)
            mergeWorkspaceMeta(saved)
          } else if (saved.folders.length) {
            applyWorkspaceStructure(saved)
          } else if (folders.length === 0) {
            seedEmpty()
          }
          await adoptCatalog(saved)
          if (workspaceHasEmbeddedCatalog(saved)) persistStructureNow()
        } else if (isApiWorkspaceText(res.value)) {
          keepDisk = true
          console.warn('[api-tester] workspace left on disk; folder list did not parse')
          if (folders.length === 0) seedEmpty()
          await loadCatalogFromPlatform()
        } else if (folders.length === 0) {
          seedEmpty()
          await ensureDefaultCatalog()
        } else {
          await loadCatalogFromPlatform()
        }
      } else if (folders.length === 0) {
        seedEmpty()
      }
    } catch (error) {
      console.warn('[api-tester] workspace load failed', error)
      if (folders.length === 0) seedEmpty()
    } finally {
      ready.value = true
      rebuildRequestIndex()
      watch(envId, () => persistStructureNow())
      if (keepDisk) workspacePersist.discardPending()
      else workspacePersist.replayPending()
      catalogPersist.flushSoon(0)
      void refreshHistory()
    }
  }

  const readyPromise = hydrate()

  function whenReady(): Promise<void> {
    return readyPromise
  }

  function afterReady(run: () => string | undefined): string | undefined {
    if (ready.value) return run()
    void readyPromise.then(run)
    return undefined
  }

  // --- 4. 定位与 Tab：一条请求一个 Shell Tab，hydrate 完再开 ---
  const environment = computed<ApiEnvironment | undefined>(() =>
    environments.find((item) => item.id === envId.value),
  )

  function locate(
    id: string | null | undefined,
  ): { folder: ApiFolder; index: number; request: ApiRequest } | undefined {
    if (!id) return undefined
    const folderId = requestFolderIndex.get(id)
    if (folderId) {
      const folder = folderById(folderId)
      if (folder) {
        const index = folder.requests.findIndex((item) => item.id === id)
        if (index >= 0) return { folder, index, request: folder.requests[index]! }
      }
    }
    return scanLocateRequest(folders, id)
  }

  function requestById(id: string | null | undefined): ApiRequest | undefined {
    return locate(id)?.request
  }

  function firstRequestId(): string | undefined {
    return folders.find((folder) => folder.requests.length)?.requests[0]?.id
  }

  function findRequestTabId(requestId: string): string | undefined {
    return useTabStore().allTabs.find(
      (tab) => tab.moduleId === 'api' && tab.props.requestId === requestId,
    )?.tabId
  }

  function openRequestTabNow(requestId: string): string | undefined {
    const req = requestById(requestId)
    if (!req) return undefined
    const tabStore = useTabStore()
    const existing = findRequestTabId(requestId)
    if (existing) {
      tabStore.activateTab(existing)
      return existing
    }
    return tabStore.openTab({
      moduleId: 'api',
      title: tabTitle(req),
      tooltip: tabTooltip(req),
      icon: 'send',
      closable: true,
      props: { requestId },
    })
  }

  /** 已有同请求 Tab 则聚焦，否则新开。hydrate 未完成时等 SQLite 读完再开。 */
  function openRequestTab(requestId: string): string | undefined {
    return afterReady(() => openRequestTabNow(requestId))
  }

  function openEntryTabNow(): string | undefined {
    const tabStore = useTabStore()
    const existing = tabStore.allTabs.find((tab) => tab.moduleId === 'api')
    if (existing) {
      tabStore.activateTab(existing.tabId)
      return existing.tabId
    }
    const id = firstRequestId()
    if (id) return openRequestTabNow(id)
    return tabStore.openModule('api')
  }

  /** Activity / 侧栏入口：优先回到已打开的 API Tab，否则打开第一条请求。 */
  function openEntryTab(): string | undefined {
    return afterReady(openEntryTabNow)
  }

  function folderById(id: string | null | undefined): ApiFolder | undefined {
    if (!id) return undefined
    return folders.find((folder) => folder.id === id)
  }

  // --- 5. 环境 / 变量：定义走 catalog，集合 JSON 只记 envId ---
  function syncEnvBaseUrl(env: ApiEnvironment): void {
    if (env.baseUrl.trim()) {
      env.vars.baseUrl = env.baseUrl.trim()
    }
  }

  function addEnvironment(name: string): ApiEnvironment {
    const trimmed = name.trim() || 'Environment'
    const baseUrl = '127.0.0.1:9000'
    const env: ApiEnvironment = {
      id: createId('env'),
      name: uniqueName(trimmed, environments.map((item) => item.name)),
      baseUrl,
      vars: { baseUrl },
      kinds: emptyKinds(),
    }
    environments.push(env)
    if (!envId.value) envId.value = env.id
    if (isBridgeAvailable()) {
      void withPlatformRetry(() =>
        apiCatalogApi.createEnvironment({
          environmentId: env.id,
          environmentName: env.name,
          baseUrl: env.baseUrl,
        }),
      ).catch((error: unknown) => {
        if (isPlatformUnavailable(error)) return
        console.warn('[api-tester] create environment failed', error)
      })
    }
    return env
  }

  function renameEnvironment(environmentId: string, name: string): ApiEnvironment | undefined {
    const env = environments.find((item) => item.id === environmentId)
    if (!env) return undefined
    const trimmed = name.trim()
    if (!trimmed) return env
    env.name = uniqueName(
      trimmed,
      environments.filter((item) => item.id !== environmentId).map((item) => item.name),
    )
    queueCatalogScope('environment', environmentId)
    return env
  }

  function removeEnvironment(environmentId: string): boolean {
    if (environments.length <= 1) return false
    const index = environments.findIndex((item) => item.id === environmentId)
    if (index < 0) return false
    environments.splice(index, 1)
    if (envId.value === environmentId) {
      envId.value = environments[0]?.id ?? ''
    }
    if (isBridgeAvailable()) {
      void withPlatformRetry(() => apiCatalogApi.deleteEnvironment({ environmentId })).catch((error: unknown) => {
        if (isPlatformUnavailable(error)) return
        console.warn('[api-tester] delete environment failed', error)
      })
    }
    return true
  }

  function updateEnvironmentBaseUrl(environmentId: string, baseUrl: string): void {
    const env = environments.find((item) => item.id === environmentId)
    if (!env) return
    env.baseUrl = baseUrl.trim()
    syncEnvBaseUrl(env)
    queueCatalogScope('environment', environmentId)
  }

  /** 环境面板整表写回：只 queue 这一个 scope。 */
  function replaceGlobalVars(vars: Record<string, string>, kinds: Record<string, ApiVariableKind> = emptyKinds()): void {
    globals.vars = vars
    globals.kinds = kinds
    queueCatalogScope('global')
  }

  function replaceEnvironmentVars(
    environmentId: string,
    vars: Record<string, string>,
    kinds: Record<string, ApiVariableKind> = emptyKinds(),
  ): void {
    const env = environments.find((item) => item.id === environmentId)
    if (!env) return
    env.vars = vars
    env.kinds = kinds
    queueCatalogScope('environment', environmentId)
  }

  // --- 6. 集合 CRUD：改树立刻 flush workspace；导入文件夹变量再 queue catalog ---
  function closeRequestTabs(ids: readonly string[]): void {
    const tabStore = useTabStore()
    for (const id of ids) {
      void closeLiveSocket(id)
      sendAbort.get(id)?.abort()
      sendAbort.delete(id)
      delete sending[id]
      delete exchanges[id]
      sendGen.delete(id)
      const tabId = findRequestTabId(id)
      if (tabId) tabStore.closeTab(tabId)
    }
  }

  function ensureDrafts(draftsName?: string): ApiFolder {
    const existing = folders.find((folder) => folder.id === 'drafts')
    if (existing) return existing
    const created: ApiFolder = {
      id: 'drafts',
      name: draftsName?.trim() || String(i18n.global.t('modules.api.drafts')),
      parentId: null,
      vars: emptyVars(),
      kinds: emptyKinds(),
      requests: [],
    }
    folders.push(created)
    return created
  }

  function addFolder(name: string, parentId: string | null = null): ApiFolder | null {
    markTouchedBeforeReady()
    if (parentId && !canAddChildFolder(folders, parentId)) return null
    const trimmed = name.trim() || 'Folder'
    const folder: ApiFolder = {
      id: createId('folder'),
      name: uniqueName(trimmed, folders.map((item) => item.name)),
      parentId,
      vars: emptyVars(),
      kinds: emptyKinds(),
      requests: [],
    }
    folders.push(folder)
    rebuildRequestIndex()
    persistStructureNow()
    return folder
  }

  function renameFolder(folderId: string, name: string): ApiFolder | undefined {
    const folder = folderById(folderId)
    if (!folder) return undefined
    const trimmed = name.trim()
    if (!trimmed) return folder
    folder.name = uniqueName(
      trimmed,
      folders.filter((item) => item.id !== folderId).map((item) => item.name),
    )
    workspacePersist.markDirty()
    return folder
  }

  function deleteFolder(folderId: string): boolean {
    const folder = folderById(folderId)
    if (!folder) return false
    const ids = collectDescendantFolderIds(folders, folderId)
    const requestIds: string[] = []
    for (const id of ids) {
      const item = folderById(id)
      if (item) requestIds.push(...item.requests.map((req) => req.id))
    }
    closeRequestTabs(requestIds)
    for (const id of [...ids].reverse()) {
      const index = folders.findIndex((item) => item.id === id)
      if (index >= 0) folders.splice(index, 1)
    }
    rebuildRequestIndex()
    persistStructureNow()
    return true
  }

  function addRequest(opts?: {
    folderId?: string
    draftsName?: string
    method?: ApiMethod
    listen?: boolean
    name?: string
  }): ApiRequest {
    markTouchedBeforeReady()
    const folder = folderById(opts?.folderId) ?? ensureDrafts(opts?.draftsName)
    const method = opts?.method ?? 'GET'
    const req: ApiRequest = {
      id: createId('req'),
      name: uniqueName(
        opts?.name?.trim() || 'Untitled',
        folder.requests.map((item) => item.name),
      ),
      method,
      url: '',
      params: [],
      headers: [],
      auth: defaultAuth(),
      bodyMode: 'none',
      body: '',
      bodyForm: [],
    }
    applyPaneDefaults(req, { listen: opts?.listen })
    folder.requests.push(req)
    requestFolderIndex.set(req.id, folder.id)
    openRequestTab(req.id)
    persistStructureNow()
    return req
  }

  /** 把已经拼好的请求放进文件夹（cURL / 历史保存）。 */
  function addPreparedRequest(source: ApiRequest, folderId?: string): ApiRequest {
    markTouchedBeforeReady()
    const folder = folderById(folderId) ?? ensureDrafts()
    const copy = cloneRequest(source, uniqueName(source.name, folder.requests.map((item) => item.name)))
    folder.requests.push(copy)
    requestFolderIndex.set(copy.id, folder.id)
    openRequestTab(copy.id)
    persistStructureNow()
    return copy
  }

  function renameRequest(requestId: string, name: string): ApiRequest | undefined {
    const located = locate(requestId)
    if (!located) return undefined
    const trimmed = name.trim()
    if (!trimmed) return located.request
    located.request.name = uniqueName(
      trimmed,
      located.folder.requests.filter((item) => item.id !== requestId).map((item) => item.name),
    )
    const tabId = findRequestTabId(requestId)
    syncTabTitle(tabId, requestId)
    workspacePersist.markDirty()
    return located.request
  }

  function duplicateRequest(requestId: string): ApiRequest | undefined {
    const located = locate(requestId)
    if (!located) return undefined
    const copy = cloneRequest(
      located.request,
      uniqueName(
        `${located.request.name} copy`,
        located.folder.requests.map((item) => item.name),
      ),
    )
    located.folder.requests.splice(located.index + 1, 0, copy)
    requestFolderIndex.set(copy.id, located.folder.id)
    openRequestTab(copy.id)
    persistStructureNow()
    return copy
  }

  function deleteRequest(requestId: string): boolean {
    const located = locate(requestId)
    if (!located) return false
    located.folder.requests.splice(located.index, 1)
    requestFolderIndex.delete(requestId)
    closeRequestTabs([requestId])
    persistStructureNow()
    return true
  }

  function moveRequest(requestId: string, folderId: string): boolean {
    const located = locate(requestId)
    const target = folderById(folderId)
    if (!located || !target) return false
    if (located.folder.id === folderId) return true
    located.folder.requests.splice(located.index, 1)
    located.request.name = uniqueName(
      located.request.name,
      target.requests.map((item) => item.name),
    )
    target.requests.push(located.request)
    requestFolderIndex.set(requestId, folderId)
    persistStructureNow()
    return true
  }

  function moveFolder(folderId: string, parentId: string | null): boolean {
    const folder = folderById(folderId)
    if (!folder) return false
    if (folder.parentId === parentId) return true
    if (parentId) {
      if (!folderById(parentId) || !canNestFolder(folders, folderId, parentId)) return false
    }
    const siblingNames = folders
      .filter((item) => item.id !== folderId && item.parentId === parentId)
      .map((item) => item.name)
    folder.name = uniqueName(folder.name, siblingNames)
    folder.parentId = parentId
    persistStructureNow()
    return true
  }

  function reorderFolder(dragId: string, dropId: string, position: 'before' | 'after'): boolean {
    const drag = folderById(dragId)
    const drop = folderById(dropId)
    if (!drag || !drop || dragId === dropId) return false
    const nextParent = drop.parentId
    if (nextParent !== drag.parentId) {
      if (nextParent && !canNestFolder(folders, dragId, nextParent)) return false
      const siblingNames = folders
        .filter((item) => item.id !== dragId && item.parentId === nextParent)
        .map((item) => item.name)
      drag.name = uniqueName(drag.name, siblingNames)
      drag.parentId = nextParent
    }
    const from = folders.indexOf(drag)
    folders.splice(from, 1)
    let to = folders.indexOf(drop)
    if (to < 0) {
      folders.push(drag)
    } else {
      if (position === 'after') to += 1
      folders.splice(to, 0, drag)
    }
    persistStructureNow()
    return true
  }

  function reorderRequest(dragId: string, dropId: string, position: 'before' | 'after'): boolean {
    const dragLoc = locate(dragId)
    const dropLoc = locate(dropId)
    if (!dragLoc || !dropLoc || dragId === dropId) return false
    if (dragLoc.folder.id !== dropLoc.folder.id && !moveRequest(dragId, dropLoc.folder.id)) return false
    const folder = folderById(dropLoc.folder.id)
    if (!folder) return false
    const dragReq = folder.requests.find((item) => item.id === dragId)
    const dropReq = folder.requests.find((item) => item.id === dropId)
    if (!dragReq || !dropReq) return false
    const from = folder.requests.indexOf(dragReq)
    folder.requests.splice(from, 1)
    let to = folder.requests.indexOf(dropReq)
    if (to < 0) {
      folder.requests.push(dragReq)
    } else {
      if (position === 'after') to += 1
      folder.requests.splice(to, 0, dragReq)
    }
    persistStructureNow()
    return true
  }

  function mergeImported(incoming: ApiFolder[], intoFolderId?: string): { folders: number; requests: number } {
    if (intoFolderId) {
      const target = folderById(intoFolderId)
      if (!target) return { folders: 0, requests: 0 }
      let requests = 0
      for (const folder of incoming) {
        for (const req of folder.requests) {
          req.name = uniqueName(req.name, target.requests.map((item) => item.name))
          target.requests.push(req)
          requests += 1
        }
      }
      rebuildRequestIndex()
      persistStructureNow()
      return { folders: 0, requests }
    }
    const names = folders.map((folder) => folder.name)
    let requests = 0
    for (const folder of incoming) {
      folder.name = uniqueName(folder.name, names)
      names.push(folder.name)
      folders.push(folder)
      requests += folder.requests.length
      if (Object.keys(folder.vars).length > 0) {
        queueCatalogScope('folder', folder.id)
      }
    }
    rebuildRequestIndex()
    persistStructureNow()
    return { folders: incoming.length, requests }
  }

  function syncTabTitle(tabId: string | undefined, requestId: string | undefined): void {
    if (!tabId) return
    const req = requestById(requestId)
    if (!req) return
    const tabs = useTabStore()
    tabs.updateTitle(tabId, tabTitle(req))
    const tab = tabs.allTabs.find((item) => item.tabId === tabId)
    if (tab) tab.tooltip = tabTooltip(req)
  }

  // --- 7. 发送：HTTP 一发一收；TCP/UDP 按 requestId 保活，关 Tab 才 close ---
  async function send(
    requestId: string,
    opts?: {
      encoding?: ApiSocketEncoding
      peerAddr?: string
      peerId?: string
      frame?: SocketFrameOpen
      data?: string
      broadcast?: boolean
    },
  ): Promise<void> {
    const req = requestById(requestId)
    if (!req || sending[requestId]) return
    if (isSocketMethod(req.method)) {
      await sendLive(
        requestId,
        req,
        opts?.encoding ?? 'auto',
        opts?.peerAddr,
        opts?.peerId,
        opts?.frame,
        opts?.data,
        opts?.broadcast,
      )
      return
    }
    if (sockets[requestId]) {
      await closeLiveSocket(requestId)
    }
    await sendHttp(requestId, req)
  }

  async function sendHttp(requestId: string, req: ApiRequest): Promise<void> {
    const gen = (sendGen.get(requestId) ?? 0) + 1
    sendGen.set(requestId, gen)
    sendAbort.get(requestId)?.abort()
    const ac = new AbortController()
    sendAbort.set(requestId, ac)
    sending[requestId] = true
    exchanges[requestId] = null
    const started = performance.now()
    try {
      const scope = variableScope(requestId)
      const exchange = await executeRequest(req, environment.value, ac.signal, scope)
      if (sendGen.get(requestId) !== gen) return
      exchanges[requestId] = exchange
      void rememberHistory(req, exchange)
    } catch (error) {
      if (sendGen.get(requestId) !== gen) return
      if (error instanceof SendError && error.code === 'cancelled') return
      const durationMs = Math.max(1, Math.round(performance.now() - started))
      const exchange = failExchange(localizeSendError(error), durationMs, protocolOf(req.method))
      exchanges[requestId] = exchange
      void rememberHistory(req, exchange)
    } finally {
      if (sendGen.get(requestId) === gen) sending[requestId] = false
      if (sendAbort.get(requestId) === ac) sendAbort.delete(requestId)
    }
  }

  async function sendLive(
    requestId: string,
    req: ApiRequest,
    encoding: ApiSocketEncoding = 'auto',
    peerAddr?: string,
    peerId?: string,
    frame?: SocketFrameOpen,
    data?: string,
    broadcast = false,
  ): Promise<void> {
    const gen = (sendGen.get(requestId) ?? 0) + 1
    sendGen.set(requestId, gen)
    sendAbort.get(requestId)?.abort()
    const ac = new AbortController()
    sendAbort.set(requestId, ac)
    sending[requestId] = true
    const started = performance.now()
    try {
      const scope = variableScope(requestId)
      const { target, payload } = resolveSend(req, environment.value, scope)
      const sessionId = await ensureLive(requestId, target, ac.signal, frame)
      const body = data !== undefined ? data : payload
      if (body) {
        await sendSocketFrame(sessionId, body, target, encoding, peerAddr, peerId, broadcast)
      }
      if (sendGen.get(requestId) !== gen) return
      patchLiveExchange(requestId)
      const exchange = exchanges[requestId]
      if (exchange) void rememberHistory(req, exchange)
    } catch (error) {
      if (sendGen.get(requestId) !== gen) return
      if (error instanceof SendError && error.code === 'cancelled') return
      const durationMs = Math.max(1, Math.round(performance.now() - started))
      const exchange = failExchange(localizeSendError(error), durationMs, protocolOf(req.method))
      exchanges[requestId] = exchange
      void rememberHistory(req, exchange)
    } finally {
      if (sendGen.get(requestId) === gen) sending[requestId] = false
      if (sendAbort.get(requestId) === ac) sendAbort.delete(requestId)
    }
  }

  function sameLiveTarget(live: ApiLiveSocket, target: SocketTarget): boolean {
    return live.kind === target.transport && live.host === target.host && live.port === target.port
  }

  async function ensureLive(
    requestId: string,
    target: SocketTarget,
    signal: AbortSignal,
    frame?: SocketFrameOpen,
  ): Promise<string> {
    const existing = sockets[requestId]
    if (existing && sameLiveTarget(existing, target)) return existing.sessionId
    if (existing) await closeLiveSocket(requestId)
    const info = await openSocketSession(target, frame)
    if (signal.aborted) {
      await closeSocketSession(info.sessionId)
      throw new SendError('cancelled', 'cancelled')
    }
    attachLive(requestId, info.sessionId, {
      kind: target.transport,
      host: target.host,
      port: target.port,
      state: info.state,
      localAddr: info.localAddr,
      remoteAddr: info.remoteAddr,
    })
    return info.sessionId
  }

  function attachLive(
    requestId: string,
    sessionId: string,
    info: Pick<ApiLiveSocket, 'kind' | 'host' | 'port' | 'state' | 'localAddr' | 'remoteAddr'>,
  ): void {
    socketUnwatch.get(requestId)?.()
    socketLogs[requestId] = []
    sockets[requestId] = {
      requestId,
      sessionId,
      kind: info.kind,
      host: info.host,
      port: info.port,
      state: info.state,
      localAddr: info.localAddr,
      remoteAddr: info.remoteAddr,
      peers: info.kind === 'tcp-server' ? [] : undefined,
      startedAt: performance.now(),
    }
    socketUnwatch.set(
      requestId,
      watchSocketSession(sessionId, (event) => {
        const live = sockets[requestId]
        if (!live || live.sessionId !== sessionId) return
        if (event.type === 'api.socket.data') {
          const frames = socketLogs[requestId] ?? (socketLogs[requestId] = [])
          const { dropped } = appendSocketFrame(frames, event)
          applyLiveSocketEvent(live, event)
          if (live.kind === 'tcp-server') maybeRefreshPeers(requestId)
          exchanges[requestId] = patchLiveExchangeFromFrame(
            exchanges[requestId],
            live,
            frames,
            event,
            dropped,
          )
        } else if (applyLiveSocketEvent(live, event) === 'ended') {
          detachLive(requestId, false)
        } else {
          patchLiveExchange(requestId)
          if (live.kind === 'tcp-server') void refreshPeers(requestId)
        }
      }),
    )
    patchLiveExchange(requestId)
    if (info.kind === 'tcp-server') void refreshPeers(requestId)
  }

  function maybeRefreshPeers(requestId: string): void {
    const now = Date.now()
    if (now - (peerSyncAt.get(requestId) ?? 0) < 1000) return
    peerSyncAt.set(requestId, now)
    void refreshPeers(requestId)
  }

  async function refreshPeers(requestId: string): Promise<void> {
    const live = sockets[requestId]
    if (!live || live.kind !== 'tcp-server') return
    const sessionId = live.sessionId
    const gen = (peerSyncGen.get(requestId) ?? 0) + 1
    peerSyncGen.set(requestId, gen)
    peerSyncAt.set(requestId, Date.now())
    try {
      const peers = await listSocketPeers(sessionId)
      if (peerSyncGen.get(requestId) !== gen) return
      const current = sockets[requestId]
      if (!current || current.sessionId !== sessionId) return
      adoptLivePeers(current, peers)
    } catch (error) {
      console.warn('[api-tester] peer list failed', error)
    }
  }

  function patchLiveExchange(requestId: string): void {
    const live = sockets[requestId]
    if (!live) return
    exchanges[requestId] = buildLiveExchange(live, socketLogs[requestId] ?? [])
  }

  async function connectSocket(requestId: string, frame?: SocketFrameOpen): Promise<void> {
    const req = requestById(requestId)
    if (!req || sending[requestId] || !isSocketMethod(req.method)) return
    const gen = (sendGen.get(requestId) ?? 0) + 1
    sendGen.set(requestId, gen)
    sendAbort.get(requestId)?.abort()
    const ac = new AbortController()
    sendAbort.set(requestId, ac)
    sending[requestId] = true
    const started = performance.now()
    try {
      const { target } = resolveSend(req, environment.value, variableScope(requestId))
      await ensureLive(requestId, target, ac.signal, frame)
      if (sendGen.get(requestId) !== gen) return
      patchLiveExchange(requestId)
    } catch (error) {
      if (sendGen.get(requestId) !== gen) return
      if (error instanceof SendError && error.code === 'cancelled') return
      const durationMs = Math.max(1, Math.round(performance.now() - started))
      exchanges[requestId] = failExchange(localizeSendError(error), durationMs, protocolOf(req.method))
    } finally {
      if (sendGen.get(requestId) === gen) sending[requestId] = false
      if (sendAbort.get(requestId) === ac) sendAbort.delete(requestId)
    }
  }

  function clearSocketLog(requestId: string, scope?: { peerId?: string; remoteAddr?: string }): void {
    const frames = socketLogs[requestId]
    if (!frames) return
    if (scope?.peerId) {
      socketLogs[requestId] = frames.filter((row) => row.peerId !== scope.peerId)
    } else if (scope?.remoteAddr) {
      socketLogs[requestId] = frames.filter((row) => row.remoteAddr?.trim() !== scope.remoteAddr)
    } else {
      socketLogs[requestId] = []
    }
    patchLiveExchange(requestId)
  }

  async function kickPeer(requestId: string, peerId: string): Promise<void> {
    const live = sockets[requestId]
    if (!live || !peerId) return
    await kickSocketPeer(live.sessionId, peerId)
    await refreshPeers(requestId)
  }

  function detachLive(requestId: string, markClosed: boolean): void {
    socketUnwatch.get(requestId)?.()
    socketUnwatch.delete(requestId)
    peerSyncGen.delete(requestId)
    peerSyncAt.delete(requestId)
    const live = sockets[requestId]
    if (live && markClosed) {
      live.state = 'closed'
      exchanges[requestId] = buildLiveExchange(live, socketLogs[requestId] ?? [])
    }
    delete sockets[requestId]
  }

  async function closeLiveSocket(requestId: string): Promise<void> {
    const live = sockets[requestId]
    detachLive(requestId, true)
    delete socketLogs[requestId]
    if (live) await closeSocketSession(live.sessionId)
  }

  // --- 8. 历史：只写 nm_api_history，不进 workspace ---
  async function refreshHistory(): Promise<void> {
    if (!isBridgeAvailable()) return
    try {
      const res = await withPlatformRetry(() => apiHistoryApi.list({ limit: 200 }))
      replaceList(history, (res.entries ?? []).map(toHistorySummary))
    } catch (error) {
      if (isPlatformUnavailable(error)) return
      console.warn('[api-tester] history load failed', error)
    }
  }

  function snapshotRequest(req: ApiRequest): Record<string, unknown> {
    return {
      id: req.id,
      name: req.name,
      method: req.method,
      url: req.url,
      params: req.params.map((row) => ({ ...row })),
      headers: req.headers.map((row) => ({ ...row })),
      auth: {
        type: req.auth.type,
        bearer: req.auth.bearer ? { ...req.auth.bearer } : undefined,
        basic: req.auth.basic ? { ...req.auth.basic } : undefined,
        apiKey: req.auth.apiKey ? { ...req.auth.apiKey } : undefined,
      },
      bodyMode: req.bodyMode,
      body: req.body,
      bodyForm: (req.bodyForm ?? []).map((row) => ({ ...row })),
    }
  }

  async function rememberHistory(req: ApiRequest, exchange: ApiExchange): Promise<void> {
    const env = environment.value
    const offline = !isBridgeAvailable()
    const scope = variableScope(req.id)
    const itemHint: ApiHistoryItem = {
      historyId: `local-${Date.now()}`,
      requestId: req.id,
      requestName: req.name,
      method: req.method,
      url: resolveRequest(req, env, scope).url,
      environmentName: env?.name ?? '',
      request: offline
        ? { ...req, params: req.params.map((row) => ({ ...row })), headers: req.headers.map((row) => ({ ...row })) }
        : null,
      exchange: offline ? exchange : null,
      durationMs: exchange.durationMs,
      httpStatus: exchange.status,
      createdAt: new Date().toISOString(),
    }
    history.unshift(itemHint)
    if (history.length > 200) history.splice(200)
    if (offline) return
    try {
      const res = await withPlatformRetry(() =>
        apiHistoryApi.append({
          requestId: req.id,
          requestName: req.name,
          httpMethod: req.method,
          requestUrl: itemHint.url,
          environmentId: env?.id,
          environmentName: env?.name ?? '',
          requestJson: snapshotRequest(req),
          exchangeJson: exchange,
          durationMs: exchange.durationMs,
          httpStatus: exchange.status,
        }),
      )
      if (res.entry) {
        const mapped = toHistorySummary(res.entry)
        const idx = history.findIndex((row) => row.historyId === itemHint.historyId)
        if (idx >= 0) history.splice(idx, 1, mapped)
        else history.unshift(mapped)
      }
    } catch (error) {
      if (isPlatformUnavailable(error)) return
      console.warn('[api-tester] history append failed', error)
    }
  }

  async function loadHistoryPayload(historyId: string): Promise<{ request: ApiRequest | null; exchange: ApiExchange | null }> {
    const item = history.find((row) => row.historyId === historyId)
    if (!item) return { request: null, exchange: null }
    let request = item.request
    let exchange = item.exchange
    if ((!request || !exchange) && isBridgeAvailable() && !historyId.startsWith('local-')) {
      try {
        const res = await withPlatformRetry(() => apiHistoryApi.get({ historyId }))
        if (res.entry) {
          const full = toHistoryItem(res.entry)
          request = full.request
          exchange = full.exchange
        }
      } catch (error) {
        if (!isPlatformUnavailable(error)) {
          console.warn('[api-tester] history get failed', error)
        }
      }
    }
    return { request: requestFromHistory(item, request), exchange }
  }

  async function openHistory(historyId: string): Promise<void> {
    const item = history.find((row) => row.historyId === historyId)
    if (!item) return
    const loaded = await loadHistoryPayload(historyId)
    let requestId = item.requestId
    if (!requestById(requestId) && loaded.request) {
      const folder = ensureDrafts()
      const copy = cloneRequest(loaded.request, uniqueName(loaded.request.name, folder.requests.map((row) => row.name)))
      folder.requests.push(copy)
      requestFolderIndex.set(copy.id, folder.id)
      requestId = copy.id
    }
    if (!requestId || !requestById(requestId)) return
    if (loaded.exchange) exchanges[requestId] = loaded.exchange
    openRequestTab(requestId)
  }

  /** 历史另存为集合请求。原请求还在时放在同一文件夹，否则进草稿。 */
  async function saveHistoryToCollection(historyId: string): Promise<ApiRequest | null> {
    const item = history.find((row) => row.historyId === historyId)
    if (!item) return null
    const loaded = await loadHistoryPayload(historyId)
    if (!loaded.request) return null
    const folder = locate(item.requestId)?.folder ?? ensureDrafts()
    return addPreparedRequest(loaded.request, folder.id)
  }

  async function deleteHistory(historyId: string): Promise<void> {
    const index = history.findIndex((row) => row.historyId === historyId)
    if (index >= 0) history.splice(index, 1)
    if (!isBridgeAvailable() || historyId.startsWith('local-')) return
    try {
      await withPlatformRetry(() => apiHistoryApi.delete({ historyId }))
    } catch (error) {
      if (isPlatformUnavailable(error)) return
      console.warn('[api-tester] history delete failed', error)
    }
  }

  async function clearHistory(): Promise<void> {
    history.splice(0, history.length)
    if (!isBridgeAvailable()) return
    try {
      await withPlatformRetry(() => apiHistoryApi.clear({}))
    } catch (error) {
      if (isPlatformUnavailable(error)) return
      console.warn('[api-tester] history clear failed', error)
    }
  }

  function cancel(requestId: string): void {
    sendGen.set(requestId, (sendGen.get(requestId) ?? 0) + 1)
    sendAbort.get(requestId)?.abort()
    sendAbort.delete(requestId)
    sending[requestId] = false
  }

  function closeSocket(requestId: string): void {
    cancel(requestId)
    void closeLiveSocket(requestId)
  }

  watch(
    () =>
      useTabStore()
        .allTabs.filter((tab) => tab.moduleId === 'api')
        .map((tab) => (typeof tab.props.requestId === 'string' ? tab.props.requestId : ''))
        .filter(Boolean)
        .sort()
        .join('\0'),
    () => {
      const open = new Set(
        useTabStore()
          .allTabs.filter((tab) => tab.moduleId === 'api')
          .map((tab) => tab.props.requestId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      )
      for (const requestId of Object.keys(sockets)) {
        if (!open.has(requestId)) void closeLiveSocket(requestId)
      }
    },
  )

  function curl(requestId: string): string {
    const req = requestById(requestId)
    if (!req) return ''
    return buildCurl(req, environment.value, variableScope(requestId))
  }

  function resolveEnvironmentForSend(opts?: ApiSendOptions): ApiEnvironment | undefined {
    if (opts?.envId) {
      return environments.find((item) => item.id === opts.envId)
    }
    return environment.value
  }

  /** 不绑 Tab 的发送入口；Runner / vitest 批量调用。 */
  async function sendResolved(req: ApiRequest, opts?: ApiSendOptions): Promise<ApiExchange> {
    if (!isBridgeAvailable()) {
      throw new SendError('need-desktop', 'desktop only')
    }
    const env = resolveEnvironmentForSend(opts)
    const scope = opts?.scope ?? variableScope(req.id)
    const ac = new AbortController()
    const signal = opts?.signal ?? ac.signal
    try {
      const exchange = await executeRequest(req, env, signal, scope)
      if (opts?.meta) {
        exchange.meta = { ...opts.meta }
      }
      if (!opts?.skipHistory) {
        void rememberHistory(req, exchange)
      }
      return exchange
    } catch (error) {
      if (error instanceof SendError) throw error
      const exchange = failExchange(localizeSendError(error), 1, protocolOf(req.method))
      if (opts?.meta) {
        exchange.meta = { ...opts.meta }
      }
      if (!opts?.skipHistory) {
        void rememberHistory(req, exchange)
      }
      return exchange
    }
  }

  return {
    folders,
    environments,
    globals,
    runProfiles,
    mockServers,
    envId,
    environment,
    ready,
    whenReady,
    treeFilter,
    historyFilter,
    history,
    sending,
    exchanges,
    sockets,
    socketLogs,
    requestById,
    folderById,
    firstRequestId,
    openRequestTab,
    openEntryTab,
    addFolder,
    renameFolder,
    deleteFolder,
    addEnvironment,
    renameEnvironment,
    removeEnvironment,
    updateEnvironmentBaseUrl,
    replaceGlobalVars,
    replaceEnvironmentVars,
    markWorkspaceDirty,
    variableScope,
    addRequest,
    addPreparedRequest,
    renameRequest,
    duplicateRequest,
    deleteRequest,
    moveRequest,
    moveFolder,
    reorderFolder,
    reorderRequest,
    mergeImported,
    syncTabTitle,
    send,
    sendResolved,
    connectSocket,
    clearSocketLog,
    kickPeer,
    cancel,
    closeSocket,
    curl,
    refreshHistory,
    openHistory,
    saveHistoryToCollection,
    deleteHistory,
    clearHistory,
  }
})
