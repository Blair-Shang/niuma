/**
 * TCP 监听的连接表。对端 closed/lost 只摘掉那一条，监听会话继续。
 */
import type { ApiSocketDataEvent, ApiSocketStateEvent } from '@/api/types/api-socket'
import type { ApiLiveSocket } from '../../types'

export type LiveSocketSignal = 'open' | 'ended'

export function applyLiveSocketEvent(
  live: ApiLiveSocket,
  event: ApiSocketDataEvent | ApiSocketStateEvent,
): LiveSocketSignal {
  if (event.type === 'api.socket.data') {
    if (event.localAddr) live.localAddr = event.localAddr
    if (live.kind === 'tcp-server') {
      rememberPeer(live, event.peerId, event.remoteAddr)
      return 'open'
    }
    if (event.remoteAddr) live.remoteAddr = event.remoteAddr
    return 'open'
  }
  if (live.kind === 'tcp-server' && event.peerId) {
    if (event.state === 'closed' || event.state === 'lost') forgetPeer(live, event.peerId)
    else rememberPeer(live, event.peerId, event.remoteAddr)
    return 'open'
  }
  live.state = event.state
  if (event.remoteAddr) live.remoteAddr = event.remoteAddr
  if (event.state === 'closed' || event.state === 'lost') return 'ended'
  return 'open'
}

function rememberPeer(live: ApiLiveSocket, peerId?: string, remoteAddr?: string): void {
  const id = peerId?.trim()
  if (!id) return
  const peers = live.peers ?? (live.peers = [])
  const found = peers.find((peer) => peer.peerId === id)
  const addr = remoteAddr?.trim() || ''
  if (found) {
    if (addr) found.remoteAddr = addr
    return
  }
  peers.push({ peerId: id, remoteAddr: addr || id })
}

/** 用 socket.peers 快照覆盖事件推出来的名单。 */
export function adoptLivePeers(
  live: ApiLiveSocket,
  peers: readonly { peerId: string; remoteAddr: string }[],
): void {
  const next = peers
    .filter((peer) => peer.peerId.trim())
    .map((peer) => ({ peerId: peer.peerId, remoteAddr: peer.remoteAddr || peer.peerId }))
  if (!live.peers) {
    live.peers = next
    return
  }
  const byId = new Map(next.map((peer) => [peer.peerId, peer]))
  const kept = live.peers
    .filter((peer) => byId.has(peer.peerId))
    .map((peer) => byId.get(peer.peerId)!)
  for (const peer of next) {
    if (!kept.some((item) => item.peerId === peer.peerId)) kept.push(peer)
  }
  live.peers.splice(0, live.peers.length, ...kept)
}

function forgetPeer(live: ApiLiveSocket, peerId: string): void {
  if (!live.peers) return
  const index = live.peers.findIndex((peer) => peer.peerId === peerId)
  if (index >= 0) live.peers.splice(index, 1)
}
