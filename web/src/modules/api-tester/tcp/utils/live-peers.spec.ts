import { describe, expect, it } from 'vitest'
import type { ApiLiveSocket } from '../../types'
import { adoptLivePeers, applyLiveSocketEvent } from './live-peers'

function server(): ApiLiveSocket {
  return {
    requestId: 'req',
    sessionId: 'sess',
    kind: 'tcp-server',
    host: '0.0.0.0',
    port: 9000,
    state: 'listening',
    startedAt: 0,
    peers: [],
  }
}

describe('tcp live peers', () => {
  it('keeps the listener when one client disconnects', () => {
    const live = server()
    expect(
      applyLiveSocketEvent(live, {
        type: 'api.session.state',
        sessionId: 'sess',
        state: 'accepted',
        peerId: 'peer-a',
        remoteAddr: '127.0.0.1:1',
      }),
    ).toBe('open')
    applyLiveSocketEvent(live, {
      type: 'api.session.state',
      sessionId: 'sess',
      state: 'accepted',
      peerId: 'peer-b',
      remoteAddr: '127.0.0.1:2',
    })
    expect(
      applyLiveSocketEvent(live, {
        type: 'api.session.state',
        sessionId: 'sess',
        state: 'closed',
        peerId: 'peer-a',
        remoteAddr: '127.0.0.1:1',
      }),
    ).toBe('open')
    expect(live.state).toBe('listening')
    expect(live.peers?.map((peer) => peer.peerId)).toEqual(['peer-b'])
  })

  it('ends the session only when the listener itself closes', () => {
    const live = server()
    expect(
      applyLiveSocketEvent(live, {
        type: 'api.session.state',
        sessionId: 'sess',
        state: 'closed',
      }),
    ).toBe('ended')
    expect(live.state).toBe('closed')
  })

  it('does not overwrite the listener address with the latest client', () => {
    const live = server()
    live.localAddr = '0.0.0.0:9000'
    applyLiveSocketEvent(live, {
      type: 'api.socket.data',
      sessionId: 'sess',
      direction: 'in',
      peerId: 'peer-a',
      remoteAddr: '10.0.0.2:11',
      localAddr: '0.0.0.0:9000',
      data: 'a',
    })
    applyLiveSocketEvent(live, {
      type: 'api.socket.data',
      sessionId: 'sess',
      direction: 'in',
      peerId: 'peer-b',
      remoteAddr: '10.0.0.3:12',
      data: 'b',
    })
    expect(live.remoteAddr).toBeUndefined()
    expect(live.peers?.map((peer) => peer.remoteAddr)).toEqual(['10.0.0.2:11', '10.0.0.3:12'])
  })

  it('replaces the event list with the socket.peers snapshot', () => {
    const live = server()
    live.peers = [{ peerId: 'stale', remoteAddr: '10.0.0.9:9' }]
    adoptLivePeers(live, [{ peerId: 'peer-b', remoteAddr: '10.0.0.3:12' }])
    expect(live.peers.map((peer) => peer.peerId)).toEqual(['peer-b'])
  })

  it('keeps the existing peer order when the snapshot comes back shuffled', () => {
    const live = server()
    live.peers = [
      { peerId: 'peer-a', remoteAddr: '10.0.0.1:1' },
      { peerId: 'peer-b', remoteAddr: '10.0.0.2:2' },
    ]
    adoptLivePeers(live, [
      { peerId: 'peer-b', remoteAddr: '10.0.0.2:2' },
      { peerId: 'peer-c', remoteAddr: '10.0.0.3:3' },
      { peerId: 'peer-a', remoteAddr: '10.0.0.1:1' },
    ])
    expect(live.peers.map((peer) => peer.peerId)).toEqual(['peer-a', 'peer-b', 'peer-c'])
  })
})
