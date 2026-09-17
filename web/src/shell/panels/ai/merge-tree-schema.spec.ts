import { describe, expect, it } from 'vitest'
import { mergeTreeSchemaHint } from './merge-tree-schema'

type Hint = { id: string; kind: string; label: string; payload: Record<string, unknown> }

function schema(id: string, extra: Record<string, unknown> = {}): Hint {
  return {
    id,
    kind: 'schema',
    label: id,
    payload: { database: 'app', ...extra },
  }
}

describe('mergeTreeSchemaHint', () => {
  const tree = schema('schema:tree:res:p1:db:2', { database: '2', moduleId: 'redis' })

  it('injects tree hint when none attached', () => {
    const tab = { id: 'tab:1', kind: 'tab' as const, label: 'Redis', payload: {} }
    expect(mergeTreeSchemaHint([tab], tree).map((a) => a.id)).toEqual([tree.id, tab.id])
  })

  it('skips when the same catalog is already attached', () => {
    const same = schema('schema:tab:db2', { database: '2', moduleId: 'redis' })
    expect(mergeTreeSchemaHint([same], tree)).toEqual([same])
  })

  it('adds a more specific tree object beside a weaker schema', () => {
    const tabOnly = schema('schema:tab:app', { database: 'app' })
    const table = schema('schema:tree:orders', { database: 'app', schema: 'public', table: 'orders' })
    expect(mergeTreeSchemaHint([tabOnly], table).map((a) => a.id)).toEqual([table.id, tabOnly.id])
  })

  it('returns attachments unchanged when tree hint is null', () => {
    const tab = { id: 'tab:1', kind: 'tab' as const, label: 'x', payload: {} }
    expect(mergeTreeSchemaHint([tab], null)).toEqual([tab])
  })
})
