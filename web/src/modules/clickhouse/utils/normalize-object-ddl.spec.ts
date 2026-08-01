import { describe, expect, it } from 'vitest'
import {
  isRenameExchangeUnsupportedError,
  normalizeClickHouseObjectDdlForEdit,
  parseClickHouseObjectNameFromSql,
  parseClickHouseObjectRefFromSql,
  prepareApplySql,
  prepareFallbackApplySql,
  shouldFallbackToDropCreate,
  supportsCreateOrReplace,
  toPlainCreateSql,
} from '@/modules/clickhouse/utils/normalize-object-ddl'
import { Cap, defaultClickHouseProfile } from '@/modules/sql-editor/capabilities'

describe('clickhouse normalize-object-ddl', () => {
  it('normalizes CREATE VIEW to CREATE OR REPLACE', () => {
    const out = normalizeClickHouseObjectDdlForEdit(
      'CREATE VIEW `db`.`v1` AS\nSELECT 1',
    )
    expect(out.startsWith('CREATE OR REPLACE VIEW')).toBe(true)
  })

  it('normalizes materialized view without OR REPLACE', () => {
    expect(
      normalizeClickHouseObjectDdlForEdit(
        'CREATE MATERIALIZED VIEW `db`.`mv1` ENGINE = MergeTree ORDER BY tuple() AS SELECT 1',
      ),
    ).toMatch(/^CREATE MATERIALIZED VIEW/i)
    expect(
      normalizeClickHouseObjectDdlForEdit(
        'CREATE OR REPLACE MATERIALIZED VIEW `db`.`mv1` ENGINE = MergeTree ORDER BY tuple() AS SELECT 1',
      ),
    ).toBe(
      'CREATE MATERIALIZED VIEW `db`.`mv1` ENGINE = MergeTree ORDER BY tuple() AS SELECT 1',
    )
    expect(
      normalizeClickHouseObjectDdlForEdit(
        'CREATE MATERIALIZED VIEW IF NOT EXISTS `db`.`mv1` AS SELECT 1',
      ),
    ).toBe('CREATE MATERIALIZED VIEW `db`.`mv1` AS SELECT 1')
  })

  it('parses qualified view name', () => {
    expect(
      parseClickHouseObjectNameFromSql(
        'CREATE OR REPLACE VIEW `db`.`my_view` AS SELECT 1',
        'view',
      ),
    ).toBe('my_view')
  })

  it('parses object ref with quotes for DROP', () => {
    expect(
      parseClickHouseObjectRefFromSql(
        'CREATE OR REPLACE VIEW `db`.`my_view` AS SELECT 1',
        'view',
      ),
    ).toBe('`db`.`my_view`')
  })

  it('parses materialized view name', () => {
    expect(
      parseClickHouseObjectNameFromSql(
        'CREATE MATERIALIZED VIEW `db`.`mv1` ENGINE = MergeTree ORDER BY tuple() AS SELECT 1',
        'materializedView',
      ),
    ).toBe('mv1')
  })

  it('toPlainCreateSql strips OR REPLACE and IF NOT EXISTS', () => {
    expect(toPlainCreateSql('CREATE OR REPLACE VIEW `db`.`v1` AS SELECT 1')).toBe(
      'CREATE VIEW `db`.`v1` AS SELECT 1',
    )
    expect(
      toPlainCreateSql('CREATE MATERIALIZED VIEW IF NOT EXISTS `db`.`mv1` AS SELECT 1'),
    ).toBe('CREATE MATERIALIZED VIEW `db`.`mv1` AS SELECT 1')
  })

  it('supportsCreateOrReplace follows default Cap matrix', () => {
    const profile = defaultClickHouseProfile()
    expect(supportsCreateOrReplace('view', profile)).toBe(true)
    expect(supportsCreateOrReplace('materializedView', profile)).toBe(false)
    expect(supportsCreateOrReplace('dictionary', profile)).toBe(false)
  })

  it('prepareApplySql prefers CREATE OR REPLACE for views when Cap on', () => {
    const profile = defaultClickHouseProfile()
    expect(prepareApplySql('CREATE VIEW `db`.`v1` AS SELECT 1', 'view', { profile })).toMatch(
      /^CREATE OR REPLACE VIEW/i,
    )
    expect(
      prepareApplySql('CREATE OR REPLACE VIEW `db`.`v1` AS SELECT 1', 'view', { profile }),
    ).toMatch(/^CREATE OR REPLACE VIEW/i)
  })

  it('prepareApplySql uses DROP + CREATE for materialized views without Cap', () => {
    const profile = defaultClickHouseProfile()
    expect(
      prepareApplySql(
        'CREATE MATERIALIZED VIEW `db`.`mv1` ENGINE = MergeTree ORDER BY tuple() AS SELECT 1',
        'materializedView',
        { profile },
      ),
    ).toBe(
      'DROP TABLE IF EXISTS `db`.`mv1`;\nCREATE MATERIALIZED VIEW `db`.`mv1` ENGINE = MergeTree ORDER BY tuple() AS SELECT 1',
    )
    expect(
      prepareApplySql(
        'CREATE OR REPLACE MATERIALIZED VIEW `db`.`mv1` AS SELECT 1',
        'materializedView',
        { profile },
      ),
    ).toBe('DROP TABLE IF EXISTS `db`.`mv1`;\nCREATE MATERIALIZED VIEW `db`.`mv1` AS SELECT 1')
  })

  it('prepareApplySql uses OR REPLACE for MV when Cap enabled', () => {
    const profile = {
      ...defaultClickHouseProfile(),
      capabilities: [
        ...defaultClickHouseProfile().capabilities,
        Cap.ClickHouseCreateOrReplaceMaterializedView,
      ],
    }
    expect(
      prepareApplySql('CREATE MATERIALIZED VIEW `db`.`mv1` AS SELECT 1', 'materializedView', {
        profile,
      }),
    ).toMatch(/^CREATE OR REPLACE MATERIALIZED VIEW/i)
  })

  it('prepareApplySql uses DROP + CREATE for dictionaries', () => {
    const profile = defaultClickHouseProfile()
    expect(
      prepareApplySql(
        'CREATE OR REPLACE DICTIONARY `db`.`d1` (id UInt64) PRIMARY KEY id SOURCE(NULL()) LAYOUT(FLAT()) LIFETIME(0)',
        'dictionary',
        { profile },
      ),
    ).toBe(
      'DROP DICTIONARY IF EXISTS `db`.`d1`;\nCREATE DICTIONARY `db`.`d1` (id UInt64) PRIMARY KEY id SOURCE(NULL()) LAYOUT(FLAT()) LIFETIME(0)',
    )
  })

  it('prepareApplySql injects ON CLUSTER when provided', () => {
    const profile = defaultClickHouseProfile()
    expect(
      prepareApplySql('CREATE VIEW `db`.`v1` AS SELECT 1', 'view', {
        profile,
        onCluster: 'c1',
      }),
    ).toMatch(/^CREATE OR REPLACE VIEW `db`.`v1` ON CLUSTER `c1` AS SELECT 1/i)
    expect(
      prepareFallbackApplySql('CREATE VIEW `db`.`v1` AS SELECT 1', 'view', { onCluster: 'c1' }),
    ).toBe(
      'DROP VIEW IF EXISTS `db`.`v1` ON CLUSTER `c1`;\nCREATE VIEW `db`.`v1` ON CLUSTER `c1` AS SELECT 1',
    )
  })

  it('prepareFallbackApplySql uses DROP + CREATE', () => {
    expect(prepareFallbackApplySql('CREATE OR REPLACE VIEW `db`.`v1` AS SELECT 1', 'view')).toBe(
      'DROP VIEW IF EXISTS `db`.`v1`;\nCREATE VIEW `db`.`v1` AS SELECT 1',
    )
    expect(
      prepareFallbackApplySql(
        'CREATE MATERIALIZED VIEW IF NOT EXISTS `db`.`mv1` AS SELECT 1',
        'materializedView',
      ),
    ).toBe('DROP TABLE IF EXISTS `db`.`mv1`;\nCREATE MATERIALIZED VIEW `db`.`mv1` AS SELECT 1')
  })

  it('detects RENAME EXCHANGE unsupported errors', () => {
    expect(
      isRenameExchangeUnsupportedError(
        new Error(
          'clickhouse: exec: code: 48, message: RENAME EXCHANGE is not supported because exchanging files is not supported by the OS (Linux kernel 3.15+ is required, got 3.10.0)',
        ),
      ),
    ).toBe(true)
    expect(isRenameExchangeUnsupportedError(new Error('code: 57, already exists'))).toBe(false)
  })

  it('detects dictionary and MV syntax fallback errors', () => {
    expect(
      shouldFallbackToDropCreate(
        new Error('clickhouse: exec: code: 387, message: Dictionary my_test.55555555 already exists'),
      ),
    ).toBe(true)
    expect(
      shouldFallbackToDropCreate(
        new Error('clickhouse: exec: code: 62, message: Syntax error: failed at position 19 (MATERIALIZED)'),
      ),
    ).toBe(true)
    expect(shouldFallbackToDropCreate(new Error('code: 57, already exists'))).toBe(false)
  })

  it('parses dictionary name', () => {
    expect(
      parseClickHouseObjectNameFromSql(
        'CREATE DICTIONARY `db`.`d1` (id UInt64) PRIMARY KEY id SOURCE(NULL()) LAYOUT(FLAT()) LIFETIME(0)',
        'dictionary',
      ),
    ).toBe('d1')
  })
})
