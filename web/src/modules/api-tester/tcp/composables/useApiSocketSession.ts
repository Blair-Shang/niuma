/**
 * TCP / UDP 会话台共用逻辑。客户端与服务端界面各用各的，这里只接管地址、收发、编码。
 */
import type { ApiSocketDataEvent } from '@/api/types/api-socket'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiRequest } from '../../types'
import { useApiRequestPersist } from '../../composables/useApiRequestPersist'
import { useApiTesterStore } from '../../stores/api-tester'
import { formatBytes, formatDuration, formatHexDumpFromHex } from '../../utils/format'
import { joinSocketUrl, splitSocketUrl } from '../../utils/request-kind'
import { parseRemoteAddr } from '../../utils/target'
import {
  applySocketLineEnd,
  isBase64Draft,
  isHexDraft,
  resolveSocketEncode,
  type SocketEncode,
  type SocketLineEnd,
} from '../utils/socket-payload'
import {
  frameOpenFields,
  modbusLengthFields,
  type SocketFrameDelimiter,
  type SocketFrameMode,
  type SocketLengthEndian,
  type SocketLengthSize,
} from '../utils/frame'

export type ApiSocketRole = 'client' | 'server'

/** 服务端日志里「全部连接」的选中键。默认不选它，避免多客户端叠在一条时间线。 */
export const SOCKET_ALL_PEERS = '*'

export interface SocketPeerView {
  key: string
  label: string
  peerId?: string
}

export function useApiSocketSession(request: () => ApiRequest, requestId: () => string | undefined, role: ApiSocketRole) {
  const { t } = useI18n()
  const api = useApiTesterStore()
  const listen = role === 'server'
  useApiRequestPersist(request)

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
  const frameMode = ref<SocketFrameMode>('raw')
  const frameDelimiter = ref<SocketFrameDelimiter>('crlf')
  const lengthOffset = ref(modbusLengthFields().lengthOffset)
  const lengthSize = ref<SocketLengthSize>(modbusLengthFields().lengthSize)
  const lengthEndian = ref<SocketLengthEndian>(modbusLengthFields().lengthEndian)
  const lengthAdjust = ref(modbusLengthFields().lengthAdjust)
  const broadcast = ref(false)
  const repeatMs = ref(1000)
  const repeatEpoch = ref(0)
  let repeatGen = 0
  let sendChain: Promise<void> = Promise.resolve()
  const repeatJobs = new Map<string, { gen: number; timer: ReturnType<typeof setTimeout> | null; peerId?: string; peerAddr?: string; payload: string }>()
  const logView = ref<'auto' | 'text' | 'hex'>('auto')
  const logEl = ref<HTMLElement | null>(null)
  const selectedPeer = ref('')
  /** UDP 来源按第一次出现固定，避免每个数据报把该地址顶到列表头。 */
  const udpPeerOrder = ref<string[]>([])
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
    void nextTick(() => {
      writingUrl = false
    })
  }

  watch([host, port], commitUrl)

  const bodyModel = computed({
    get: () => request().body,
    set: (value: string) => {
      request().body = value
    },
  })

  const inboundBytes = computed(() =>
    visibleFrames.value.filter((row) => row.direction === 'in').reduce((sum, row) => sum + frameBytes(row), 0),
  )
  const outboundBytes = computed(() =>
    visibleFrames.value.filter((row) => row.direction === 'out').reduce((sum, row) => sum + frameBytes(row), 0),
  )

  const tcpListen = computed(() => listen && request().method === 'TCP')

  const peers = computed((): SocketPeerView[] => {
    if (tcpListen.value) {
      return (live.value?.peers ?? [])
        .filter((peer) => peer.peerId)
        .map((peer) => ({
          key: peer.peerId,
          label: peer.remoteAddr || peer.peerId,
          peerId: peer.peerId,
        }))
    }
    const alive = new Set<string>()
    for (const row of frames.value) {
      const text = row.remoteAddr?.trim()
      if (text && parseRemoteAddr(text)) alive.add(text)
    }
    const liveAddr = live.value?.remoteAddr?.trim()
    if (liveAddr && parseRemoteAddr(liveAddr)) alive.add(liveAddr)
    const next: string[] = []
    for (const addr of udpPeerOrder.value) {
      if (alive.has(addr)) next.push(addr)
    }
    for (const addr of alive) {
      if (!next.includes(addr)) next.push(addr)
    }
    if (next.length !== udpPeerOrder.value.length || next.some((addr, index) => addr !== udpPeerOrder.value[index])) {
      udpPeerOrder.value = next
    }
    return next.map((addr) => ({ key: addr, label: addr }))
  })

  const lastInboundAddr = computed(() => {
    for (let i = frames.value.length - 1; i >= 0; i--) {
      const row = frames.value[i]
      if (row.direction === 'in' && parseRemoteAddr(row.remoteAddr)) return row.remoteAddr!.trim()
    }
    return parseRemoteAddr(live.value?.remoteAddr) ? live.value!.remoteAddr!.trim() : ''
  })

  const udpListen = computed(() => listen && request().method === 'UDP')

  const activePeer = computed(() => {
    const list = peers.value
    const picked = list.find((peer) => peer.key === selectedPeer.value)
    if (picked) return picked
    if ((tcpListen.value || udpListen.value) && selectedPeer.value === SOCKET_ALL_PEERS) return null
    if (list.length === 1) return list[0]
    return null
  })

  const replyAddr = computed(() => {
    if (tcpListen.value || udpListen.value) return activePeer.value?.label ?? ''
    if (selectedPeer.value && selectedPeer.value !== SOCKET_ALL_PEERS) return selectedPeer.value
    return lastInboundAddr.value
  })
  const replyPeerId = computed(() => (tcpListen.value ? activePeer.value?.peerId : undefined))

  const visibleFrames = computed(() => {
    const key = selectedPeer.value
    if (!key || key === SOCKET_ALL_PEERS) return frames.value
    if (tcpListen.value) return frames.value.filter((row) => row.peerId === key)
    return frames.value.filter((row) => row.remoteAddr?.trim() === key)
  })

  watch(peers, (list) => {
    if (!tcpListen.value && !udpListen.value) {
      if (selectedPeer.value && !list.some((peer) => peer.key === selectedPeer.value)) selectedPeer.value = ''
      return
    }
    if (selectedPeer.value === SOCKET_ALL_PEERS) return
    if (selectedPeer.value && list.some((peer) => peer.key === selectedPeer.value)) return
    selectedPeer.value = list.at(-1)?.key ?? ''
  })

  watch(peers, (list) => {
    const gone: string[] = []
    for (const [key, job] of repeatJobs) {
      if (key.startsWith('tcp:') && !list.some((peer) => peer.peerId === job.peerId)) gone.push(key)
      if (key.startsWith('udp:') && !list.some((peer) => peer.key === job.peerAddr)) gone.push(key)
    }
    for (const key of gone) stopRepeat(key)
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
  const udpBroadcast = computed(() => broadcast.value && request().method === 'UDP')
  function socketReady(): boolean {
    if (!canOpen.value || sending.value || !hasDraft.value || !draftOk.value) return false
    if (udpListen.value && !udpBroadcast.value) return Boolean(replyAddr.value)
    if (tcpListen.value) return Boolean(replyPeerId.value)
    return true
  }
  function currentRepeatKey(): string {
    if (tcpListen.value) return replyPeerId.value ? `tcp:${replyPeerId.value}` : ''
    if (udpListen.value && !udpBroadcast.value) return replyAddr.value ? `udp:${replyAddr.value}` : ''
    return '*'
  }
  const repeating = computed(() => {
    void repeatEpoch.value
    const key = currentRepeatKey()
    return key !== '' && repeatJobs.has(key)
  })
  const canSend = computed(() => !repeating.value && socketReady())
  const canRepeat = computed(() => repeating.value || (currentRepeatKey() !== '' && socketReady()))
  const encodeHint = computed(() => {
    if (encode.value === 'hex' && bodyModel.value && !isHexDraft(bodyModel.value)) {
      return t('modules.api.socketEncodeNeedHex')
    }
    if (encode.value === 'base64' && bodyModel.value && !isBase64Draft(bodyModel.value)) {
      return t('modules.api.socketEncodeNeedBase64')
    }
    if (udpBroadcast.value) {
      return t('modules.api.socketBroadcastHint', { port: port.value.trim() || '—' })
    }
    if ((udpListen.value && !replyAddr.value) || (tcpListen.value && !replyPeerId.value)) {
      return t('modules.api.socketReplyNeedPeer')
    }
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

  function currentFrame() {
    if (request().method !== 'TCP') return undefined
    return frameOpenFields({
      mode: frameMode.value,
      delimiter: frameDelimiter.value,
      lengthOffset: lengthOffset.value,
      lengthSize: lengthSize.value,
      lengthEndian: lengthEndian.value,
      lengthAdjust: lengthAdjust.value,
    })
  }

  function onConnect(): void {
    const id = requestId()
    if (!id) return
    commitUrl()
    void api.connectSocket(id, currentFrame())
  }

  function linedPayload(): string {
    return applySocketLineEnd(bodyModel.value, encode.value, lineEnd.value)
  }

  function repeatDelay(): number {
    const n = Number(repeatMs.value)
    if (!Number.isFinite(n)) return 1000
    return Math.min(60_000, Math.max(100, Math.round(n)))
  }

  function stopRepeat(key?: string): void {
    const keys = key ? [key] : [...repeatJobs.keys()]
    for (const item of keys) {
      const job = repeatJobs.get(item)
      if (!job) continue
      job.gen += 1
      if (job.timer != null) clearTimeout(job.timer)
      repeatJobs.delete(item)
    }
    repeatEpoch.value += 1
  }

  function repeatTargetAlive(peerId?: string, peerAddr?: string): boolean {
    if (tcpListen.value) return Boolean(peerId && peers.value.some((peer) => peer.peerId === peerId))
    if (udpListen.value && !udpBroadcast.value) return Boolean(peerAddr && peers.value.some((peer) => peer.key === peerAddr))
    return Boolean(live.value)
  }

  async function sendPayload(keepDraft: boolean, target?: { peerId?: string; peerAddr?: string; payload: string }): Promise<boolean> {
    const id = requestId()
    if (!id) return false
    const payload = target?.payload ?? linedPayload()
    if (!payload) return false
    commitUrl()
    const run = sendChain.then(() =>
      api.send(id, {
        encoding: encode.value,
        peerAddr: target ? target.peerAddr : replyAddr.value || undefined,
        peerId: target ? target.peerId : replyPeerId.value,
        frame: currentFrame(),
        data: payload,
        broadcast: udpBroadcast.value,
      }),
    )
    sendChain = run.then(() => undefined, () => undefined)
    await run
    if (!keepDraft) request().body = ''
    return !exchange.value?.error
  }

  async function repeatTick(key: string, gen: number): Promise<void> {
    const job = repeatJobs.get(key)
    if (!job || job.gen !== gen) return
    if (!repeatTargetAlive(job.peerId, job.peerAddr)) {
      stopRepeat(key)
      return
    }
    const ok = await sendPayload(true, job)
    const current = repeatJobs.get(key)
    if (!current || current.gen !== gen) return
    if (!ok) {
      stopRepeat(key)
      return
    }
    current.timer = setTimeout(() => {
      void repeatTick(key, gen)
    }, repeatDelay())
  }

  function onSend(): void {
    if (repeating.value) return
    if (!canSend.value) return
    void sendPayload(false)
  }

  function onToggleRepeat(): void {
    const key = currentRepeatKey()
    if (!key) return
    if (repeatJobs.has(key)) {
      stopRepeat(key)
      return
    }
    if (!canRepeat.value) return
    repeatMs.value = repeatDelay()
    const payload = linedPayload()
    if (!payload) return
    const gen = ++repeatGen
    repeatJobs.set(key, {
      gen,
      timer: null,
      peerId: tcpListen.value ? replyPeerId.value : undefined,
      peerAddr: udpListen.value && !udpBroadcast.value ? replyAddr.value : undefined,
      payload,
    })
    repeatEpoch.value += 1
    void repeatTick(key, gen)
  }

  function onCancel(): void {
    stopRepeat()
    const id = requestId()
    if (id) api.cancel(id)
  }

  function onClose(): void {
    stopRepeat()
    const id = requestId()
    if (id) api.closeSocket(id)
  }

  function onClear(): void {
    const id = requestId()
    if (!id) return
    const key = selectedPeer.value
    if ((tcpListen.value || udpListen.value) && key && key !== SOCKET_ALL_PEERS) {
      api.clearSocketLog(id, tcpListen.value ? { peerId: key } : { remoteAddr: key })
      return
    }
    api.clearSocketLog(id)
  }

  function onKick(peerId: string): void {
    const id = requestId()
    if (id && peerId) void api.kickPeer(id, peerId)
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

  watch(live, (next, prev) => {
    if (prev && !next) stopRepeat()
  })

  onUnmounted(stopRepeat)

  watch(
    () => visibleFrames.value.length,
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
    frameMode,
    frameDelimiter,
    lengthOffset,
    lengthSize,
    lengthEndian,
    lengthAdjust,
    broadcast,
    repeatMs,
    repeating,
    canRepeat,
    logView,
    logEl,
    sending,
    live,
    exchange,
    frames: visibleFrames,
    peers,
    selectedPeer,
    activePeer,
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
    onToggleRepeat,
    onCancel,
    onClose,
    onClear,
    onKick,
    onComposeKey,
    frameBytes,
    frameTime,
    framePreview,
    onLogScroll,
    formatBytes,
    formatDuration,
  }
}
