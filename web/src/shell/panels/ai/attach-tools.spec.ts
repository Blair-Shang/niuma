import { describe, expect, it } from 'vitest'
import { partitionAiTools, type AiToolMessageRef, type AiToolRef } from './attach-tools'

function msg(messageId: string, messageRole: string, createdAt: string): AiToolMessageRef {
  return { messageId, messageRole, createdAt }
}

function tool(invocationId: string, createdAt: string, runId: string): AiToolRef {
  return { invocationId, createdAt, runId }
}

describe('partitionAiTools', () => {
  it('keeps a cancelled turn on its user message instead of the next reply', () => {
    const messages = [
      msg('u1', 'user', '2026-10-08T01:00:00.000Z'),
      msg('u2', 'user', '2026-10-08T01:02:00.000Z'),
      msg('a2', 'assistant', '2026-10-08T01:03:00.000Z'),
    ]
    const tools = [tool('old', '2026-10-08T01:01:00.000Z', 'run-old')]
    const { byMessageId, streaming } = partitionAiTools(messages, tools, {
      streaming: false,
      activeRunId: null,
      liveIds: new Set(),
    })
    expect(streaming).toEqual([])
    expect(byMessageId.get('u1')?.after.map((t) => t.invocationId)).toEqual(['old'])
    expect(byMessageId.get('a2')).toBeUndefined()
  })

  it('leaves the current run on the streaming bubble', () => {
    const messages = [
      msg('u1', 'user', '2026-10-08T01:00:00.000Z'),
      msg('u2', 'user', '2026-10-08T01:02:00.000Z'),
    ]
    const tools = [
      tool('old', '2026-10-08T01:01:00.000Z', 'run-old'),
      tool('now', '2026-10-08T01:02:01.000Z', 'run-new'),
    ]
    const { byMessageId, streaming } = partitionAiTools(messages, tools, {
      streaming: true,
      activeRunId: 'run-new',
      liveIds: new Set(['now']),
    })
    expect(streaming.map((t) => t.invocationId)).toEqual(['now'])
    expect(byMessageId.get('u1')?.after.map((t) => t.invocationId)).toEqual(['old'])
    expect(byMessageId.get('u2')).toBeUndefined()
  })

  it('puts a tool that ran first above the answer', () => {
    const messages = [
      msg('u1', 'user', '2026-10-08T01:00:00.000Z'),
      msg('a1', 'assistant', '2026-10-08T01:01:00.000Z'),
    ]
    const tools = [tool('t', '2026-10-08T01:00:30.000Z', 'run-1')]
    const { byMessageId } = partitionAiTools(messages, tools, {
      streaming: false,
      activeRunId: null,
      liveIds: new Set(),
    })
    expect(byMessageId.get('a1')?.before.map((t) => t.invocationId)).toEqual(['t'])
    expect(byMessageId.get('a1')?.after).toEqual([])
  })

  it('puts a tool between the lead-in and the following answer', () => {
    const messages = [
      msg('u1', 'user', '2026-10-08T01:00:00.000Z'),
      msg('lead', 'assistant', '2026-10-08T01:00:10.000Z'),
      msg('answer', 'assistant', '2026-10-08T01:00:40.000Z'),
    ]
    const tools = [tool('t', '2026-10-08T01:00:20.000Z', 'run-1')]
    const { byMessageId } = partitionAiTools(messages, tools, {
      streaming: false,
      activeRunId: null,
      liveIds: new Set(),
    })
    expect(byMessageId.get('lead')?.after.map((t) => t.invocationId)).toEqual(['t'])
    expect(byMessageId.get('answer')).toBeUndefined()
  })
})
