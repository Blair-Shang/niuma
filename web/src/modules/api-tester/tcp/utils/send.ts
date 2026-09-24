/**
 * TCP / UDP 会话执行。无 Vue 状态，store 直接 import 具名函数。
 */
import { apiSocketApi } from '@/api'
import type { ApiSocketDataEvent, ApiSocketEncoding, ApiSocketSessionInfo } from '@/api/types/api-socket'
import type { ApiExchange, ApiLiveSocket } from '../../types'
import { newKvRow } from '../../utils/format'
import { resolveSocketSendDest, socketOpenFields, type SocketTarget } from '../../utils/target'
import type { SocketFrameOpen } from './frame'

const SOCKET_OPEN_MS = 10000
/** 套接字日志封顶，避免高速率 TCP 无界涨内存。 */
export const SOCKET_LOG_MAX = 400

export async function openSocketSession(target: SocketTarget, frame?: SocketFrameOpen): Promise<ApiSocketSessionInfo> {
  return apiSocketApi.open({
    kind: target.transport,
    timeoutMs: SOCKET_OPEN_MS,
    encoding: 'utf8',
    ...socketOpenFields(target),
    ...frame,
  })
}

export async function sendSocketFrame(
  sessionId: string,
  payload: string,
  target: SocketTarget,
  encoding: ApiSocketEncoding = 'auto',
  peerAddr?: string,
  peerId?: string,
  broadcast = false,
): Promise<void> {
  if (!payload) return
  const dest = resolveSocketSendDest(target, peerAddr, { broadcast })
  await apiSocketApi.send({
    sessionId,
    data: payload,
    encoding,
    peerId: peerId || undefined,
    host: dest?.host,
    port: dest?.port,
  })
}

export async function closeSocketSession(sessionId: string): Promise<void> {
  await apiSocketApi.close({ sessionId }).catch(() => undefined)
}

export async function listSocketPeers(sessionId: string): Promise<{ peerId: string; remoteAddr: string }[]> {
  const res = await apiSocketApi.peers({ sessionId })
  return (res.peers ?? [])
    .filter((peer) => peer.peerId)
    .map((peer) => ({ peerId: peer.peerId, remoteAddr: peer.remoteAddr || peer.peerId }))
}

export async function kickSocketPeer(sessionId: string, peerId: string): Promise<void> {
  await apiSocketApi.kick({ sessionId, peerId })
}

export function buildLiveExchange(
  live: ApiLiveSocket,
  frames: readonly ApiSocketDataEvent[],
): ApiExchange {
  const durationMs = Math.max(1, Math.round(performance.now() - live.startedAt))
  const hex = frames.map((frame) => frame.hex ?? '').join('')
  const sizeBytes = frames.reduce((sum, frame) => sum + (frame.bytes ?? 0), 0)
  const inbound = frames.some((frame) => frame.direction === 'in')
  const dead = live.state === 'lost' || live.state === 'closed'
  const headers = [
    newKvRow('sessionId', live.sessionId),
    newKvRow('kind', live.kind),
  ]
  if (live.localAddr) headers.push(newKvRow('local', live.localAddr))
  if (live.remoteAddr) headers.push(newKvRow('peer', live.remoteAddr))
  return {
    ok: !dead || inbound,
    status: null,
    statusText: liveStatusText(live.state, inbound),
    durationMs,
    sizeBytes: sizeBytes || (hex ? Math.floor(hex.length / 2) : 0),
    protocol: live.kind === 'udp' ? 'UDP' : 'TCP',
    headers,
    body: frames.map(formatSocketFrame).join('\n'),
    hex,
  }
}

/** TCP 按 peerId、UDP 按来源地址分桶，避免一个对端挤掉另一个。 */
export function socketFrameBucket(event: ApiSocketDataEvent): string {
  const peerId = event.peerId?.trim()
  if (peerId) return `peer:${peerId}`
  const addr = event.remoteAddr?.trim()
  if (addr) return `addr:${addr}`
  return '*'
}

/** 追加一帧并只裁本连接的旧帧。dropped > 0 时调用方应整份重算 exchange。 */
export function appendSocketFrame(
  frames: ApiSocketDataEvent[],
  event: ApiSocketDataEvent,
  max = SOCKET_LOG_MAX,
): { dropped: number } {
  frames.push(event)
  const bucket = socketFrameBucket(event)
  let count = 0
  for (const row of frames) {
    if (socketFrameBucket(row) === bucket) count += 1
  }
  if (count <= max) return { dropped: 0 }
  const extra = count - max
  let dropped = 0
  for (let i = 0; i < frames.length && dropped < extra; i += 1) {
    if (socketFrameBucket(frames[i]) !== bucket) continue
    frames.splice(i, 1)
    i -= 1
    dropped += 1
  }
  return { dropped }
}

/**
 * 有上一份 exchange 且没有丢帧时只追加这一行；否则整份重建。
 * 避免每帧 join 全部 hex（高速率时 O(n²)）。
 */
export function patchLiveExchangeFromFrame(
  prev: ApiExchange | null | undefined,
  live: ApiLiveSocket,
  frames: readonly ApiSocketDataEvent[],
  incoming: ApiSocketDataEvent,
  dropped: number,
): ApiExchange {
  if (dropped > 0 || !prev) return buildLiveExchange(live, frames)
  const extraHex = incoming.hex ?? ''
  const extraBytes = incoming.bytes ?? (extraHex ? Math.floor(extraHex.length / 2) : 0)
  const line = formatSocketFrame(incoming)
  const inbound = incoming.direction === 'in' || prev.ok
  const dead = live.state === 'lost' || live.state === 'closed'
  const headers = [
    newKvRow('sessionId', live.sessionId),
    newKvRow('kind', live.kind),
  ]
  if (live.localAddr) headers.push(newKvRow('local', live.localAddr))
  if (live.remoteAddr) headers.push(newKvRow('peer', live.remoteAddr))
  return {
    ok: !dead || inbound,
    status: null,
    statusText: liveStatusText(live.state, inbound),
    durationMs: Math.max(1, Math.round(performance.now() - live.startedAt)),
    sizeBytes: prev.sizeBytes + extraBytes,
    protocol: live.kind === 'udp' ? 'UDP' : 'TCP',
    headers,
    body: prev.body ? `${prev.body}\n${line}` : line,
    hex: `${prev.hex ?? ''}${extraHex}`,
  }
}

function liveStatusText(state: string, inbound: boolean): string {
  if (state === 'listening') return 'Listening'
  if (state === 'accepted') return inbound ? 'Received' : 'Accepted'
  if (state === 'connected') return inbound ? 'Received' : 'Connected'
  if (state === 'lost') return 'Lost'
  if (state === 'closed') return 'Closed'
  return inbound ? 'Received' : state || 'Open'
}

function formatSocketFrame(frame: ApiSocketDataEvent): string {
  const dir = frame.direction === 'in' ? 'in' : 'out'
  const who = frame.remoteAddr ? ` ${frame.remoteAddr}` : ''
  const text = frame.data ?? (frame.hex ? `<${frame.bytes ?? Math.floor((frame.hex.length || 0) / 2)} B>` : '')
  return `[${dir}${who}] ${text}`
}
