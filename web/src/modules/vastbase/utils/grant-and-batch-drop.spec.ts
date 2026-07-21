import { describe, expect, it } from 'vitest'
import {
  buildGrantRevokeSql,
  defaultPrivileges,
  objectKindSql,
  privilegesForTarget,
} from './grant-privileges'
import {
  batchDropItemKey,
  batchDropSql,
  orderBatchDropByKind,
  topoOrderBatchDrop,
  type BatchDropItem,
} from './script-templates'

describe('grant-privileges', () => {
  it('filters privileges by object type', () => {
    expect(privilegesForTarget('schema')).toEqual(['USAGE', 'CREATE', 'ALL PRIVILEGES'])
    expect(privilegesForTarget('function')).toEqual(['EXECUTE', 'ALL PRIVILEGES'])
    expect(privilegesForTarget('procedure')).toEqual(['EXECUTE', 'ALL PRIVILEGES'])
    expect(privilegesForTarget('view')).not.toContain('TRUNCATE')
    expect(privilegesForTarget('table')).toContain('TRUNCATE')
  })

  it('uses PROCEDURE for procedures and FUNCTION for functions', () => {
    expect(objectKindSql('procedure')).toBe('PROCEDURE')
    expect(objectKindSql('function')).toBe('FUNCTION')
    expect(objectKindSql('view')).toBe('TABLE')
    expect(objectKindSql('schema')).toBe('SCHEMA')
  })

  it('builds multi-privilege GRANT with WITH GRANT OPTION', () => {
    expect(
      buildGrantRevokeSql({
        mode: 'GRANT',
        target: 'table',
        schema: 'public',
        name: 'orders',
        privileges: ['SELECT', 'UPDATE'],
        grantee: 'app_role',
        withGrantOption: true,
      }),
    ).toBe('GRANT SELECT, UPDATE ON TABLE "public"."orders" TO "app_role" WITH GRANT OPTION;')
  })

  it('builds PROCEDURE EXECUTE grant with args', () => {
    expect(
      buildGrantRevokeSql({
        mode: 'GRANT',
        target: 'procedure',
        schema: 'app',
        name: 'do_work',
        args: 'integer, text',
        privileges: defaultPrivileges('procedure'),
        grantee: 'PUBLIC',
      }),
    ).toBe('GRANT EXECUTE ON PROCEDURE "app"."do_work"(integer, text) TO PUBLIC;')
  })

  it('collapses ALL PRIVILEGES when mixed with others', () => {
    expect(
      buildGrantRevokeSql({
        mode: 'REVOKE',
        target: 'schema',
        name: 'public',
        privileges: ['USAGE', 'ALL PRIVILEGES', 'CREATE'],
        grantee: 'reader',
      }),
    ).toBe('REVOKE ALL PRIVILEGES ON SCHEMA "public" FROM "reader";')
  })
})

describe('batch-drop order', () => {
  const items: BatchDropItem[] = [
    { schema: 'public', name: 'child', kind: 'table' },
    { schema: 'public', name: 'parent', kind: 'table' },
    { schema: 'public', name: 'v1', kind: 'view' },
  ]

  it('orders by kind then name', () => {
    const ordered = orderBatchDropByKind(items)
    expect(ordered.map((i) => i.name)).toEqual(['v1', 'child', 'parent'])
  })

  it('topo-sorts FK dependents before referenced tables', () => {
    const tables = items.filter((i) => i.kind === 'table')
    const { ordered, cycle } = topoOrderBatchDrop(tables, [
      { before: batchDropItemKey(tables[0]!), after: batchDropItemKey(tables[1]!) },
    ])
    expect(cycle).toBe(false)
    expect(ordered.map((i) => i.name)).toEqual(['child', 'parent'])
  })

  it('falls back on cycle', () => {
    const tables = items.filter((i) => i.kind === 'table')
    const a = batchDropItemKey(tables[0]!)
    const b = batchDropItemKey(tables[1]!)
    const { cycle } = topoOrderBatchDrop(tables, [
      { before: a, after: b },
      { before: b, after: a },
    ])
    expect(cycle).toBe(true)
  })

  it('emits dependency notes and CASCADE tip', () => {
    const sql = batchDropSql(
      [{ schema: 'public', name: 't', kind: 'table' }],
      { dependencyOrdered: true, orderNote: 'FK aware' },
    )
    expect(sql).toContain('Order: FK aware')
    expect(sql).toContain('DROP TABLE IF EXISTS "public"."t";')
    expect(sql).toContain('-- DROP TABLE IF EXISTS "public"."t" CASCADE;')
  })
})
