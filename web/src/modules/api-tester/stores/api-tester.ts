import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import { apiHistoryApi, isBridgeAvailable, isPlatformUnavailable, settingsApi, withPlatformRetry } from '@/api'
import { i18n } from '@/locale'
import type { ApiSocketDataEvent, ApiSocketEncoding } from '@/api/types/api-socket'
import { useApiSend } from '../composables/useApiSend'
import { watchSocketSession } from '../composables/useApiSocketHub'
import { cloneRequest, defaultEnvironments, defaultFolders, newId, parseWorkspace, serializeWorkspace, uniqueName } from '../utils/collection-io'
import { applyPaneDefaults } from '../pane-registry'
import { buildCurl, interpolateEnv, resolveRequestUrl } from '../utils/format'
import { toHistoryItem } from '../utils/history-map'
import { tabTitle, tabTooltip } from '../utils/tab-chrome'
import { isSocketMethod, type SocketTarget } from '../utils/target'
import type { ApiEnvironment, ApiExchange, ApiFolder, ApiHistoryItem, ApiLiveSocket, ApiMethod, ApiRequest, ApiSideView } from '../types'
import { useTabStore } from '@/stores/tab'

const SETTING_KEY = 'api.workspace'
const PERSIST_MS = 300

function replaceList<T>(target: T[], next: readonly T[]): void {
  target.splice(0, target.length, ...next)
}

function findRequestIn(folders: ApiFolder[], id: string | null | undefined): ApiRequest | undefined {
  return locateRequest(folders, id)?.request
}

function locateRequest(
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
 * 集合与环境写入 Platform SQLite（nm_app_setting / api.workspace），重启后按 id 还原。
 */
export const useApiTesterStore = defineStore('api-tester', () => {
  const {
    resolveSend,
    executeRequest,
    openSocketSession,
    sendSocketFrame,
    closeSocketSession,
    buildLiveExchange,
    failExchange,
    localizeSendError,
    protocolOf,
    SendError,
  } = useApiSend()
  const folders = reactive<ApiFolder[]>([])
  const environments = reactive<ApiEnvironment[]>([])
  const envId = ref('')
  const treeFilter = ref('')
  const historyFilter = ref('')
  const sideView = ref<ApiSideView>('collection')
  const history = reactive<ApiHistoryItem[]>([])
  const sending = reactive<Record<string, boolean>>({})
  const exchanges = reactive<Record<string, ApiExchange | null>>({})
  const sockets = reactive<Record<string, ApiLiveSocket>>({})
  const socketLogs = reactive<Record<string, ApiSocketDataEvent[]>>({})
  const socketUnwatch = new Map<string, () => void>()
  const sendGen = new Map<string, number>()
  const sendAbort = new Map<string, AbortController>()
  const ready = ref(false)
  let persistTimer: ReturnType<typeof setTimeout> | null = null

  function seedEmpty(): void {
    replaceList(folders, defaultFolders(String(i18n.global.t('modules.api.drafts'))))
    replaceList(environments, defaultEnvironments())
    envId.value = environments[0]?.id ?? ''
  }

  function applyWorkspace(state: NonNullable<ReturnType<typeof parseWorkspace>>): void {
    replaceList(folders, state.folders)
    replaceList(environments, state.environments.length ? state.environments : defaultEnvironments())
    envId.value = environments.some((item) => item.id === state.envId)
      ? state.envId
      : (environments[0]?.id ?? '')
  }

  function persistNow(): void {
    if (!ready.value || !isBridgeAvailable()) return
    settingsApi.set(SETTING_KEY, JSON.stringify(serializeWorkspace(folders, environments, envId.value))).catch(
      (error: unknown) => {
        if (isPlatformUnavailable(error)) return
        console.warn('[api-tester] workspace save failed', error)
      },
    )
  }

  function persistSoon(): void {
    if (!ready.value || !isBridgeAvailable()) return
    if (persistTimer !== null) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      persistNow()
    }, PERSIST_MS)
  }

  async function hydrate(): Promise<void> {
    if (ready.value) return
    try {
      if (isBridgeAvailable()) {
        const res = await withPlatformRetry(() => settingsApi.get(SETTING_KEY))
        const saved = parseWorkspace(res.value)
        if (saved && saved.folders.length > 0) {
          applyWorkspace(saved)
        } else {
          seedEmpty()
        }
      } else {
        seedEmpty()
      }
    } catch (error) {
      console.warn('[api-tester] workspace load failed', error)
      if (folders.length === 0) seedEmpty()
    } finally {
      ready.value = true
      watch([folders, environments, envId], persistSoon, { deep: true })
      persistSoon()
      void refreshHistory()
    }
  }

  const readyPromise = hydrate()

  function afterReady(run: () => string | undefined): string | undefined {
    if (ready.value) return run()
    void readyPromise.then(run)
    return undefined
  }

  const environment = computed<ApiEnvironment | undefined>(() =>
    environments.find((item) => item.id === envId.value),
  )

  function requestById(id: string | null | undefined): ApiRequest | undefined {
    return findRequestIn(folders, id)
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

  function ensureDrafts(draftsName = 'Drafts'): ApiFolder {
    const existing = folders.find((folder) => folder.id === 'drafts')
    if (existing) return existing
    const created: ApiFolder = { id: 'drafts', name: draftsName, requests: [] }
    folders.push(created)
    return created
  }

  function addFolder(name: string): ApiFolder {
    const trimmed = name.trim() || 'Folder'
    const folder: ApiFolder = {
      id: newId('folder'),
      name: uniqueName(trimmed, folders.map((item) => item.name)),
      requests: [],
    }
    folders.push(folder)
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
    return folder
  }

  function deleteFolder(folderId: string): boolean {
    const index = folders.findIndex((folder) => folder.id === folderId)
    if (index < 0) return false
    const [removed] = folders.splice(index, 1)
    closeRequestTabs(removed?.requests.map((req) => req.id) ?? [])
    return true
  }

  function addRequest(opts?: {
    folderId?: string
    draftsName?: string
    method?: ApiMethod
    listen?: boolean
    name?: string
  }): ApiRequest {
    const folder = folderById(opts?.folderId) ?? ensureDrafts(opts?.draftsName)
    const method = opts?.method ?? 'GET'
    const req: ApiRequest = {
      id: newId('req'),
      name: uniqueName(
        opts?.name?.trim() || 'Untitled',
        folder.requests.map((item) => item.name),
      ),
      method,
      url: '',
      params: [],
      headers: [],
      body: '',
    }
    applyPaneDefaults(req, { listen: opts?.listen })
    folder.requests.push(req)
    openRequestTab(req.id)
    return req
  }

  function renameRequest(requestId: string, name: string): ApiRequest | undefined {
    const located = locateRequest(folders, requestId)
    if (!located) return undefined
    const trimmed = name.trim()
    if (!trimmed) return located.request
    located.request.name = uniqueName(
      trimmed,
      located.folder.requests.filter((item) => item.id !== requestId).map((item) => item.name),
    )
    const tabId = findRequestTabId(requestId)
    syncTabTitle(tabId, requestId)
    return located.request
  }

  function duplicateRequest(requestId: string): ApiRequest | undefined {
    const located = locateRequest(folders, requestId)
    if (!located) return undefined
    const copy = cloneRequest(
      located.request,
      uniqueName(
        `${located.request.name} copy`,
        located.folder.requests.map((item) => item.name),
      ),
    )
    located.folder.requests.splice(located.index + 1, 0, copy)
    openRequestTab(copy.id)
    return copy
  }

  function deleteRequest(requestId: string): boolean {
    const located = locateRequest(folders, requestId)
    if (!located) return false
    located.folder.requests.splice(located.index, 1)
    closeRequestTabs([requestId])
    return true
  }

  function moveRequest(requestId: string, folderId: string): boolean {
    const located = locateRequest(folders, requestId)
    const target = folderById(folderId)
    if (!located || !target || located.folder.id === folderId) return false
    located.folder.requests.splice(located.index, 1)
    located.request.name = uniqueName(
      located.request.name,
      target.requests.map((item) => item.name),
    )
    target.requests.push(located.request)
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
      return { folders: 0, requests }
    }
    const names = folders.map((folder) => folder.name)
    let requests = 0
    for (const folder of incoming) {
      folder.name = uniqueName(folder.name, names)
      names.push(folder.name)
      folders.push(folder)
      requests += folder.requests.length
    }
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

  async function send(requestId: string, opts?: { encoding?: ApiSocketEncoding; peerAddr?: string }): Promise<void> {
    const req = requestById(requestId)
    if (!req || sending[requestId]) return
    if (isSocketMethod(req.method)) {
      await sendLive(requestId, req, opts?.encoding ?? 'auto', opts?.peerAddr)
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
      const exchange = await executeRequest(req, environment.value, ac.signal)
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
  ): Promise<void> {
    const gen = (sendGen.get(requestId) ?? 0) + 1
    sendGen.set(requestId, gen)
    sendAbort.get(requestId)?.abort()
    const ac = new AbortController()
    sendAbort.set(requestId, ac)
    sending[requestId] = true
    const started = performance.now()
    try {
      const { target, payload } = resolveSend(req, environment.value)
      const sessionId = await ensureLive(requestId, target, ac.signal)
      if (payload) {
        await sendSocketFrame(sessionId, payload, target, encoding, peerAddr)
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

  async function ensureLive(requestId: string, target: SocketTarget, signal: AbortSignal): Promise<string> {
    const existing = sockets[requestId]
    if (existing && sameLiveTarget(existing, target)) return existing.sessionId
    if (existing) await closeLiveSocket(requestId)
    const info = await openSocketSession(target)
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
      startedAt: performance.now(),
    }
    socketUnwatch.set(
      requestId,
      watchSocketSession(sessionId, (event) => {
        const live = sockets[requestId]
        if (!live || live.sessionId !== sessionId) return
        if (event.type === 'api.socket.data') {
          const frames = socketLogs[requestId] ?? (socketLogs[requestId] = [])
          frames.push(event)
          if (event.localAddr) live.localAddr = event.localAddr
        } else {
          live.state = event.state
        }
        if (event.remoteAddr) live.remoteAddr = event.remoteAddr
        patchLiveExchange(requestId)
        if (event.type === 'api.session.state' && (event.state === 'closed' || event.state === 'lost')) {
          detachLive(requestId, false)
        }
      }),
    )
    patchLiveExchange(requestId)
  }

  function patchLiveExchange(requestId: string): void {
    const live = sockets[requestId]
    if (!live) return
    exchanges[requestId] = buildLiveExchange(live, socketLogs[requestId] ?? [])
  }

  async function connectSocket(requestId: string): Promise<void> {
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
      const { target } = resolveSend(req, environment.value)
      await ensureLive(requestId, target, ac.signal)
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

  function clearSocketLog(requestId: string): void {
    socketLogs[requestId] = []
    patchLiveExchange(requestId)
  }

  function detachLive(requestId: string, markClosed: boolean): void {
    socketUnwatch.get(requestId)?.()
    socketUnwatch.delete(requestId)
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

  async function refreshHistory(): Promise<void> {
    if (!isBridgeAvailable()) return
    try {
      const res = await withPlatformRetry(() => apiHistoryApi.list({ limit: 200 }))
      replaceList(history, (res.entries ?? []).map(toHistoryItem))
    } catch (error) {
      if (isPlatformUnavailable(error)) return
      console.warn('[api-tester] history load failed', error)
    }
  }

  async function rememberHistory(req: ApiRequest, exchange: ApiExchange): Promise<void> {
    const env = environment.value
    const itemHint: ApiHistoryItem = {
      historyId: `local-${Date.now()}`,
      requestId: req.id,
      requestName: req.name,
      method: req.method,
      url: resolveRequestUrl(req, env),
      environmentName: env?.name ?? '',
      request: { ...req, params: req.params.map((row) => ({ ...row })), headers: req.headers.map((row) => ({ ...row })) },
      exchange,
      durationMs: exchange.durationMs,
      httpStatus: exchange.status,
      createdAt: new Date().toISOString(),
    }
    history.unshift(itemHint)
    if (history.length > 200) history.splice(200)
    if (!isBridgeAvailable()) return
    try {
      const res = await withPlatformRetry(() =>
        apiHistoryApi.append({
          requestId: req.id,
          requestName: req.name,
          httpMethod: req.method,
          requestUrl: itemHint.url,
          environmentId: env?.id,
          environmentName: env?.name ?? '',
          requestJson: {
            id: req.id,
            name: req.name,
            method: req.method,
            url: req.url,
            params: req.params,
            headers: req.headers,
            body: req.body,
          },
          exchangeJson: exchange,
          durationMs: exchange.durationMs,
          httpStatus: exchange.status,
        }),
      )
      if (res.entry) {
        const mapped = toHistoryItem(res.entry)
        const idx = history.findIndex((row) => row.historyId === itemHint.historyId)
        if (idx >= 0) history.splice(idx, 1, mapped)
        else history.unshift(mapped)
      }
    } catch (error) {
      if (isPlatformUnavailable(error)) return
      console.warn('[api-tester] history append failed', error)
    }
  }

  function openHistory(historyId: string): void {
    const item = history.find((row) => row.historyId === historyId)
    if (!item) return
    let requestId = item.requestId
    if (!requestById(requestId) && item.request) {
      const folder = ensureDrafts()
      const copy = cloneRequest(item.request, uniqueName(item.request.name, folder.requests.map((row) => row.name)))
      folder.requests.push(copy)
      requestId = copy.id
    }
    if (!requestId || !requestById(requestId)) return
    if (item.exchange) exchanges[requestId] = item.exchange
    openRequestTab(requestId)
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
    return buildCurl(req, environment.value)
  }

  return {
    folders,
    environments,
    envId,
    environment,
    ready,
    treeFilter,
    historyFilter,
    sideView,
    history,
    sending,
    exchanges,
    sockets,
    socketLogs,
    interpolateEnv,
    requestById,
    folderById,
    firstRequestId,
    openRequestTab,
    openEntryTab,
    addFolder,
    renameFolder,
    deleteFolder,
    addRequest,
    renameRequest,
    duplicateRequest,
    deleteRequest,
    moveRequest,
    mergeImported,
    syncTabTitle,
    send,
    connectSocket,
    clearSocketLog,
    cancel,
    closeSocket,
    curl,
    refreshHistory,
    openHistory,
    deleteHistory,
    clearHistory,
  }
})
