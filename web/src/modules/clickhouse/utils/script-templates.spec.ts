import { describe, expect, it } from 'vitest'
import {
  alterDatabaseSql,
  createDatabaseSql,
  renameDatabaseSql,
  selectDatabaseMetaSql,
  showCreateDatabaseSql,
} from '@/modules/clickhouse/utils/script-templates'

describe('clickhouse database DDL templates', () => {
  it('createDatabaseSql keeps name + optional cluster', () => {
    expect(createDatabaseSql('analytics')).toBe('CREATE DATABASE IF NOT EXISTS `analytics`;')
    expect(createDatabaseSql('analytics', { onCluster: 'c1' })).toBe(
      'CREATE DATABASE IF NOT EXISTS `analytics` ON CLUSTER `c1`;',
    )
  })

  it('createDatabaseSql appends engine and comment', () => {
    expect(createDatabaseSql('analytics', { engine: 'Atomic', comment: "team's lake" })).toBe(
      "CREATE DATABASE IF NOT EXISTS `analytics` ENGINE = Atomic COMMENT 'team''s lake';",
    )
  })

  it('alterDatabaseSql writes MODIFY COMMENT', () => {
    expect(alterDatabaseSql('analytics', { comment: "a'b", onCluster: 'c1' })).toBe(
      "ALTER DATABASE `analytics` ON CLUSTER `c1` MODIFY COMMENT 'a''b';",
    )
    expect(alterDatabaseSql('analytics')).toBe("ALTER DATABASE `analytics` MODIFY COMMENT '';")
  })

  it('renameDatabaseSql quotes both names', () => {
    expect(renameDatabaseSql('old', 'new db', { onCluster: 'c1' })).toBe(
      'RENAME DATABASE `old` TO `new db` ON CLUSTER `c1`;',
    )
  })

  it('selectDatabaseMetaSql and showCreateDatabaseSql quote the name', () => {
    expect(selectDatabaseMetaSql("a'b")).toBe(
      "SELECT name, engine, comment FROM system.databases WHERE name = 'a''b'",
    )
    expect(showCreateDatabaseSql('analytics')).toBe('SHOW CREATE DATABASE `analytics`')
  })
})
