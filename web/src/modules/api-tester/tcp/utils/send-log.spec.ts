import { describe, expect, it } from 'vitest'
import type { ApiSocketDataEvent } from '@/api/types/api-socket'
import { appendSocketFrame } from './send'

function frame(peerId: string, data: string): ApiSocketDataEvent {
  return { type: 'api.socket.data', sessionId: 'sess', direction: 'in', peerId, data }
}

describe('appendSocketFrame', () => {
  it('drops old frames of the noisy peer only', () => {
    const frames: ApiSocketDataEvent[] = []
    appendSocketFrame(frames, frame('a', 'a0'), 2)
    appendSocketFrame(frames, frame('b', 'b0'), 2)
    appendSocketFrame(frames, frame('a', 'a1'), 2)
    appendSocketFrame(frames, frame('a', 'a2'), 2)
    expect(frames.map((row) => row.data)).toEqual(['b0', 'a1', 'a2'])
  })

  it('drops old datagrams of the noisy address only', () => {
    const frames: ApiSocketDataEvent[] = []
    const udp = (remoteAddr: string, data: string): ApiSocketDataEvent => ({
      type: 'api.socket.data',
      sessionId: 'sess',
      direction: 'in',
      remoteAddr,
      data,
    })
    appendSocketFrame(frames, udp('10.0.0.2:1', 'a0'), 2)
    appendSocketFrame(frames, udp('10.0.0.3:2', 'b0'), 2)
    appendSocketFrame(frames, udp('10.0.0.2:1', 'a1'), 2)
    appendSocketFrame(frames, udp('10.0.0.2:1', 'a2'), 2)
    expect(frames.map((row) => row.data)).toEqual(['b0', 'a1', 'a2'])
  })
})
