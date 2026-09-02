/**
 * TCP / UDP 会话台共用逻辑。客户端与服务端界面各用各的，这里只接管地址、收发、编码。
 */
import type { ApiSocketDataEvent } from '@/api/types/api-socket'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiRequest } from '../types'
import { useApiTesterStore } from '../stores/api-tester'
import { formatBytes, formatDuration, formatHexDumpFromHex } from '../utils/format'
import { joinSocketUrl, splitSocketUrl } from '../utils/request-kind'
import { parseRemoteAddr } from '../utils/target'
import {
  applySocketLineEnd,
  isBase64Draft,
  isHexDraft,
  resolveSocketEncode,
  type SocketEncode,
  type SocketLineEnd,
} from '../utils/socket-payload'

export type ApiSocketRole = 'client' | 'server'

export function useApiSocketSession(request: () => ApiRequest, requestId: () => string | undefined, role: ApiSocketRole) {
  const { t } = useI18n()
  const api = useApiTesterStore()
  const listen = role === 'server'

  const sending = computed(() => Boolean(requestId() && api.sending[requestId()!]))
  const live = computed(() => {
    const id = requestId()
    return id ? api.sockets[id] ?? null : null
  })
  const exchange = computed(() => {
    const id = requestId()
    return id ? api.exchanges[id] ?? null : null
  })
  const frames = computed(() => {
    const id = requestId()
    return id ? api.socketLogs[id] ?? [] : []
  })

  const host = ref('')
  const port = ref('')
  const encode = ref<SocketEncode>('auto')
  const lineEnd = ref<SocketLineEnd>('none')
  const logView = ref<'auto' | 'text' | 'hex'>('auto')
  const logEl = ref<HTMLElement | null>(null)
  const selectedPeer = ref('')
  let writingUrl = false
  let pinBottom = true

  watch(
    () => request().url,
    (url) => {
      if (writingUrl) return
      const parsed = splitSocketUrl(url)
      host.value = parsed.host
      port.value = parsed.port
    },
    { immediate: true },
  )

  function commitUrl(): void {
    const req = request()
    const next = joinSocketUrl(host.value, port.value, listen)
    if (next === req.url) return
    writingUrl = true
    req.url = next
    writingUrl = false
  }

  watch([host, port], commitUrl)

  const bodyModel = computed({
    get: () => request().body,
    set: (value: string) => {
      request().body = value
    },
  })

  const inboundBytes = computed(() =>
    frames.value.filter((row) => row.direction === 'in').reduce((sum, row) => sum + frameBytes(row), 0),
  )
  const outboundBytes = computed(() =>
    frames.value.filter((row) => row.direction === 'out').reduce((sum, row) => sum + frameBytes(row), 0),
  )

  const peers = computed(() => {
    const seen = new Set<string>()
    const list: string[] = []
    const push = (addr?: string) => {
      const text = addr?.trim()
      if (!text || seen.has(text) || !parseRemoteAddr(text)) return
      seen.add(text)
      list.push(text)
    }
    push(live.value?.remoteAddr)
    for (const row of frames.value) push(row.remoteAddr)
    return list
  })

  const lastInboundAddr = computed(() => {
    for (let i = frames.value.length - 1; i >= 0; i--) {
      const row = frames.value[i]
      if (row.direction === 'in' && parseRemoteAddr(row.remoteAddr)) return row.remoteAddr!.trim()
    }
    return parseRemoteAddr(live.value?.remoteAddr) ? live.value!.remoteAddr!.trim() : ''
  })

  const replyAddr = computed(() => selectedPeer.value || lastInboundAddr.value)
  const udpListen = computed(() => listen && request().method === 'UDP')

  watch(peers, (list) => {
    if (selectedPeer.value && !list.includes(selectedPeer.value)) selectedPeer.value = ''
  })

  const canOpen = computed(() => Boolean(host.value.trim() && port.value.trim()))
  const liveOn = computed(() => Boolean(live.value || sending.value))
  const resolvedEncode = computed(() => resolveSocketEncode(bodyModel.value, encode.value))
  const draftOk = computed(() => {
    if (encode.value === 'hex') return isHexDraft(bodyModel.value)
    if (encode.value === 'base64') return isBase64Draft(bodyModel.value)
    return true
  })
  const hasDraft = computed(() => Boolean(bodyModel.value) || lineEnd.value !== 'none')
  const canSend = computed(() => {
    if (!canOpen.value || sending.value || !hasDraft.value || !draftOk.value) return false
    if (udpListen.value) return Boolean(replyAddr.value)
    return true
  })
  const encodeHint = computed(() => {
    if (encode.value === 'hex' && bodyModel.value && !isHexDraft(bodyModel.value)) {
      return t('modules.api.socketEncodeNeedHex')
    }
    if (encode.value === 'base64' && bodyModel.value && !isBase64Draft(bodyModel.value)) {
      return t('modules.api.socketEncodeNeedBase64')
    }
    if (udpListen.value && !replyAddr.value) return t('modules.api.socketReplyNeedPeer')
    return t('modules.api.socketEncodeAs', {
      encoding: resolvedEncode.value === 'hex' ? 'Hex' : resolvedEncode.value === 'base64' ? 'Base64' : 'UTF-8',
    })
  })

  const statusLabel = computed(() => {
    if (sending.value) return t('modules.api.sending')
    const state = live.value?.state
    if (state === 'listening') {
      return listen ? t('modules.api.socketStateListening') : t('modules.api.socketStateConnected')
    }
    if (state === 'connected') return t('modules.api.socketStateConnected')
    if (state === 'accepted') return t('modules.api.socketStateAccepted')
    if (state === 'lost') return t('modules.api.socketStateLost')
    if (state === 'closed') return t('modules.api.socketStateClosed')
    if (state) return state
    if (exchange.value?.error) {
      return listen ? t('modules.api.socketListenFailed') : t('modules.api.socketConnectFailed')
    }
    return listen ? t('modules.api.socketIdleServer') : t('modules.api.socketIdle')
  })

  const emptyLog = computed(() => {
    if (live.value || sending.value) {
      return listen ? t('modules.api.socketWaitServer') : t('modules.api.socketWaitClient')
    }
    return listen ? t('modules.api.emptySocketServer') : t('modules.api.emptySocketClient')
  })

  function onConnect(): void {
    const id = requestId()
    if (!id) return
    commitUrl()
    void api.connectSocket(id)
  }

  function onSend(): void {
    const id = requestId()
    if (!canSend.value || !id) return
    commitUrl()
    request().body = applySocketLineEnd(bodyModel.value, encode.value, lineEnd.value)
    void api.send(id, { encoding: encode.value, peerAddr: replyAddr.value || undefined })
    request().body = ''
  }

  function onCancel(): void {
    const id = requestId()
    if (id) api.cancel(id)
  }

  function onClose(): void {
    const id = requestId()
    if (id) api.closeSocket(id)
  }

  function onClear(): void {
    const id = requestId()
    if (id) api.clearSocketLog(id)
  }

  function onComposeKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return
    event.preventDefault()
    onSend()
  }

  function frameBytes(row: ApiSocketDataEvent): number {
    if (typeof row.bytes === 'number') return row.bytes
    if (row.hex) return Math.floor(row.hex.length / 2)
    return row.data ? new TextEncoder().encode(row.data).length : 0
  }

  function frameTime(row: ApiSocketDataEvent): string {
    if (!row.at) return ''
    const date = new Date(row.at)
    if (Number.isNaN(date.getTime())) return row.at
    return date.toLocaleTimeString()
  }

  function framePreview(row: ApiSocketDataEvent): string {
    if (logView.value === 'hex' || (logView.value === 'auto' && !row.data && row.hex)) {
      return row.hex ? formatHexDumpFromHex(row.hex) : ''
    }
    return row.data || (row.hex ? `<${frameBytes(row)} B>` : '')
  }

  function onLogScroll(): void {
    const el = logEl.value
    if (!el) return
    pinBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32
  }

  watch(
    () => frames.value.length,
    async () => {
      if (!pinBottom) return
      await nextTick()
      const el = logEl.value
      if (el) el.scrollTop = el.scrollHeight
    },
  )

  return {
    t,
    host,
    port,
    encode,
    lineEnd,
    logView,
    logEl,
    sending,
    live,
    exchange,
    frames,
    peers,
    selectedPeer,
    replyAddr,
    bodyModel,
    inboundBytes,
    outboundBytes,
    canOpen,
    liveOn,
    canSend,
    encodeHint,
    resolvedEncode,
    statusLabel,
    emptyLog,
    onConnect,
    onSend,
    onCancel,
    onClose,
    onClear,
    onComposeKey,
    frameBytes,
    frameTime,
    framePreview,
    onLogScroll,
    formatBytes,
    formatDuration,
  }
}
