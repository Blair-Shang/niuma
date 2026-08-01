import { describe, expect, it } from 'vitest'
import {
  ensureOnClusterClause,
  onClusterSqlSuffix,
  uniqueClusterNames,
} from '@/modules/clickhouse/utils/cluster'

describe('clickhouse cluster helpers', () => {
  it('uniqueClusterNames dedupes and sorts', () => {
    expect(
      uniqueClusterNames([
        { cluster: 'b' },
        { cluster: 'a' },
        { cluster: 'b' },
        { cluster: '  ' },
        { cluster: null },
      ]),
    ).toEqual(['a', 'b'])
  })

  it('onClusterSqlSuffix quotes cluster', () => {
    expect(onClusterSqlSuffix('')).toBe('')
    expect(onClusterSqlSuffix(' my_cluster ')).toBe(' ON CLUSTER `my_cluster`')
  })

  it('ensureOnClusterClause inserts after object name', () => {
    expect(ensureOnClusterClause('DROP TABLE IF EXISTS `db`.`t`', 'c1')).toBe(
      'DROP TABLE IF EXISTS `db`.`t` ON CLUSTER `c1`',
    )
    expect(
      ensureOnClusterClause('CREATE OR REPLACE VIEW `db`.`v` AS SELECT 1', 'c1'),
    ).toBe('CREATE OR REPLACE VIEW `db`.`v` ON CLUSTER `c1` AS SELECT 1')
    expect(ensureOnClusterClause('DROP TABLE t ON CLUSTER `x`', 'c1')).toBe(
      'DROP TABLE t ON CLUSTER `x`',
    )
  })
})
