import { describe, expect, it } from 'vitest'
import {
  ensureOracleCreateSchema,
  ensureOraclePlsqlScriptTerminator,
  joinOraclePackageSource,
  normalizeOracleObjectDdlForEdit,
  parseOracleObjectNameFromSql,
  stripOracleSqlPlusTerminator,
  stripOracleTriggerAlterTrailer,
  toReplaceSql,
} from './normalize-object-ddl'

describe('toReplaceSql', () => {
  it('prefixes bare PROCEDURE from ALL_SOURCE', () => {
    const src = `PROCEDURE "new_proc" (
  p_in_id IN NUMBER
)
AS
BEGIN
  NULL;
END;`
    expect(toReplaceSql(src)).toMatch(/^CREATE OR REPLACE PROCEDURE/i)
  })

  it('prefixes bare FUNCTION', () => {
    expect(toReplaceSql('FUNCTION "fn" RETURN NUMBER AS BEGIN RETURN 1; END;')).toMatch(
      /^CREATE OR REPLACE FUNCTION/i,
    )
  })

  it('prefixes bare TRIGGER', () => {
    expect(
      toReplaceSql('TRIGGER "trg" BEFORE INSERT ON t FOR EACH ROW BEGIN NULL; END;'),
    ).toMatch(/^CREATE OR REPLACE TRIGGER/i)
  })

  it('upgrades CREATE PROCEDURE to OR REPLACE', () => {
    expect(toReplaceSql('CREATE PROCEDURE p AS BEGIN NULL; END;')).toMatch(
      /^CREATE OR REPLACE PROCEDURE/i,
    )
  })

  it('upgrades CREATE SYNONYM to OR REPLACE', () => {
    expect(toReplaceSql('CREATE SYNONYM s FOR t')).toMatch(/^CREATE OR REPLACE SYNONYM/i)
  })

  it('keeps CREATE TABLE unchanged', () => {
    const sql = 'CREATE TABLE t (id NUMBER);'
    expect(toReplaceSql(sql)).toBe(sql)
  })

  it('keeps CREATE SEQUENCE unchanged (no OR REPLACE)', () => {
    const sql =
      'CREATE SEQUENCE "NIUMA"."new_seq" MINVALUE 1 START WITH 1 NOCACHE NOORDER NOCYCLE;'
    expect(toReplaceSql(sql)).toBe(sql)
  })

  it('strips mistaken OR REPLACE from SEQUENCE', () => {
    expect(toReplaceSql('CREATE OR REPLACE SEQUENCE "s" START WITH 1;')).toBe(
      'CREATE SEQUENCE "s" START WITH 1;',
    )
  })

  it('keeps existing OR REPLACE', () => {
    const sql = 'CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;'
    expect(toReplaceSql(sql)).toBe(sql)
  })
})

describe('normalizeOracleObjectDdlForEdit', () => {
  it('collapses spaces on first line after prefix', () => {
    const out = normalizeOracleObjectDdlForEdit('PROCEDURE  "p"\nAS\nBEGIN\nNULL;\nEND;')
    expect(out.startsWith('CREATE OR REPLACE PROCEDURE')).toBe(true)
    expect(out.trimEnd().endsWith('/')).toBe(true)
  })

  it('qualifies bare name when schema is provided and keeps script slash', () => {
    const out = normalizeOracleObjectDdlForEdit(
      'FUNCTION "new_func" RETURN VARCHAR2 AS BEGIN RETURN \'x\'; END;',
      'NIUMA',
    )
    expect(out).toMatch(/^CREATE OR REPLACE FUNCTION "NIUMA"\."new_func"/i)
    expect(out).toMatch(/END;\n\/\n?$/i)
  })

  it('keeps sequence as CREATE SEQUENCE and strips mistaken OR REPLACE', () => {
    const out = normalizeOracleObjectDdlForEdit(
      'CREATE OR REPLACE SEQUENCE "new_seq" START WITH 1 INCREMENT BY 1;',
      'NIUMA',
      'sequence',
    )
    expect(out).toMatch(/^CREATE SEQUENCE "NIUMA"\."new_seq"/i)
    expect(out).not.toMatch(/OR REPLACE/i)
  })

  it('upgrades synonym and qualifies schema', () => {
    const out = normalizeOracleObjectDdlForEdit(
      'CREATE SYNONYM "new_syn" FOR "NIUMA"."t";',
      'NIUMA',
      'synonym',
    )
    expect(out).toMatch(/^CREATE OR REPLACE SYNONYM "NIUMA"\."new_syn"/i)
  })

  it('upgrades trigger, qualifies schema, keeps slash', () => {
    const out = normalizeOracleObjectDdlForEdit(
      'CREATE TRIGGER "new_trg" BEFORE INSERT ON "t" FOR EACH ROW BEGIN NULL; END;',
      'NIUMA',
      'trigger',
    )
    expect(out).toMatch(/^CREATE OR REPLACE TRIGGER "NIUMA"\."new_trg"/i)
    expect(out.trimEnd().endsWith('/')).toBe(true)
  })

  it('strips DBMS_METADATA ALTER TRIGGER ENABLE trailer', () => {
    const src =
      'CREATE OR REPLACE EDITIONABLE TRIGGER "NIUMA"."new_trg" BEFORE INSERT ON "NIUMA"."T" FOR EACH ROW\n' +
      'BEGIN NULL;\nEND;\n/\nALTER TRIGGER "NIUMA"."new_trg" ENABLE;'
    const out = normalizeOracleObjectDdlForEdit(src, 'NIUMA', 'trigger')
    expect(out).toMatch(/^CREATE OR REPLACE EDITIONABLE TRIGGER "NIUMA"\."new_trg"/i)
    expect(out).not.toMatch(/ALTER\s+TRIGGER/i)
    expect(out.trimEnd().endsWith('/')).toBe(true)
  })

  it('strips same-line / ALTER TRIGGER after formatSql glue', () => {
    const src =
      'CREATE OR REPLACE EDITIONABLE TRIGGER "NIUMA"."new_trg" BEFORE INSERT ON "NIUMA"."T" FOR EACH ROW\n' +
      'BEGIN NULL;\n\nEND;\n\n/ ALTER TRIGGER "NIUMA"."new_trg" ENABLE;'
    const out = normalizeOracleObjectDdlForEdit(src, 'NIUMA', 'trigger')
    expect(out).not.toMatch(/ALTER\s+TRIGGER/i)
    expect(out).toMatch(/END;\n\/\n?$/i)
  })

  it('qualifies package spec and body separately', () => {
    const src =
      'CREATE PACKAGE "pkg" AS\n  PROCEDURE p;\nEND;\n/\n\nCREATE PACKAGE BODY "pkg" AS\n  PROCEDURE p AS BEGIN NULL; END;\nEND;\n/'
    const out = normalizeOracleObjectDdlForEdit(src, 'NIUMA', 'package')
    expect(out).toMatch(/CREATE OR REPLACE PACKAGE "NIUMA"\."pkg"/i)
    expect(out).toMatch(/CREATE OR REPLACE PACKAGE BODY "NIUMA"\."pkg"/i)
    expect(out).toMatch(/\n\/\s*\n+CREATE OR REPLACE PACKAGE BODY/i)
  })
})

describe('joinOraclePackageSource', () => {
  it('joins spec and body with slash separator', () => {
    const out = joinOraclePackageSource(
      'CREATE PACKAGE "pkg" AS\n  PROCEDURE p;\nEND;',
      'CREATE PACKAGE BODY "pkg" AS\n  PROCEDURE p AS BEGIN NULL; END;\nEND;',
    )
    expect(out).toContain('CREATE PACKAGE "pkg"')
    expect(out).toContain('CREATE PACKAGE BODY "pkg"')
    expect(out.match(/PACKAGE BODY/gi)?.length).toBe(1)
    expect(out).toMatch(/\n\/\s*\n+CREATE PACKAGE BODY/i)
  })

  it('does not duplicate body when definition already embeds PACKAGE BODY', () => {
    const combined =
      'CREATE OR REPLACE EDITIONABLE PACKAGE "NIUMA"."new_package" AS\n  PROCEDURE example;\nEND;\n/\n\n' +
      'CREATE OR REPLACE EDITIONABLE PACKAGE BODY "NIUMA"."new_package" AS\n  PROCEDURE example IS\n  BEGIN\n    NULL;\n  END;\nEND;'
    const body =
      'CREATE OR REPLACE EDITIONABLE PACKAGE BODY "NIUMA"."new_package" AS\n  PROCEDURE example IS\n  BEGIN\n    NULL;\n  END;\nEND;'
    const out = joinOraclePackageSource(combined, body)
    expect(out.match(/PACKAGE BODY/gi)?.length).toBe(1)
    expect(out).toBe(combined)
  })
})

describe('parseOracleObjectNameFromSql', () => {
  it('parses quoted procedure name', () => {
    expect(
      parseOracleObjectNameFromSql(
        'CREATE OR REPLACE PROCEDURE "NIUMA"."new_proc" AS BEGIN NULL; END;',
        'procedure',
      ),
    ).toBe('new_proc')
  })

  it('parses sequence name', () => {
    expect(
      parseOracleObjectNameFromSql(
        'CREATE SEQUENCE "NIUMA"."new_seq" START WITH 1;',
        'sequence',
      ),
    ).toBe('new_seq')
  })
})

describe('ensureOracleCreateSchema', () => {
  it('qualifies bare procedure name with schema', () => {
    const sql = ensureOracleCreateSchema(
      'CREATE OR REPLACE PROCEDURE "new_proc" AS BEGIN NULL; END;',
      'NIUMA',
    )
    expect(sql).toMatch(/^CREATE OR REPLACE PROCEDURE "NIUMA"\."new_proc"/i)
  })

  it('qualifies bare name when CREATE and OR REPLACE are on separate lines', () => {
    const src = `CREATE
OR REPLACE FUNCTION "new_func" RETURN VARCHAR2 AS BEGIN RETURN 'x'; END;`
    expect(ensureOracleCreateSchema(src, 'NIUMA')).toMatch(
      /^CREATE\s+OR REPLACE FUNCTION "NIUMA"\."new_func"/i,
    )
  })

  it('qualifies synonym and trigger', () => {
    expect(
      ensureOracleCreateSchema('CREATE OR REPLACE SYNONYM "s" FOR "t"', 'NIUMA'),
    ).toMatch(/^CREATE OR REPLACE SYNONYM "NIUMA"\."s"/i)
    expect(
      ensureOracleCreateSchema(
        'CREATE OR REPLACE TRIGGER "trg" BEFORE INSERT ON t FOR EACH ROW BEGIN NULL; END;',
        'NIUMA',
      ),
    ).toMatch(/^CREATE OR REPLACE TRIGGER "NIUMA"\."trg"/i)
  })

  it('qualifies sequence without injecting OR REPLACE', () => {
    const sql = ensureOracleCreateSchema('CREATE SEQUENCE "new_seq" START WITH 1;', 'NIUMA')
    expect(sql).toMatch(/^CREATE SEQUENCE "NIUMA"\."new_seq"/i)
    expect(sql).not.toMatch(/OR REPLACE/i)
  })
})

describe('stripOracleTriggerAlterTrailer', () => {
  it('removes slash + ALTER TRIGGER ENABLE', () => {
    const src =
      'CREATE OR REPLACE TRIGGER "t" BEFORE INSERT ON x FOR EACH ROW BEGIN NULL; END;\n/\nALTER TRIGGER "t" ENABLE;'
    expect(stripOracleTriggerAlterTrailer(src)).toBe(
      'CREATE OR REPLACE TRIGGER "t" BEFORE INSERT ON x FOR EACH ROW BEGIN NULL; END;',
    )
  })

  it('removes glued / ALTER TRIGGER DISABLE', () => {
    const src =
      'CREATE OR REPLACE TRIGGER "t" BEFORE INSERT ON x FOR EACH ROW BEGIN NULL; END;\n\n/ ALTER TRIGGER "t" DISABLE;'
    expect(stripOracleTriggerAlterTrailer(src)).toMatch(/END;$/i)
    expect(stripOracleTriggerAlterTrailer(src)).not.toMatch(/ALTER/i)
  })
})

describe('stripOracleSqlPlusTerminator', () => {
  it('removes trailing lone-line slash', () => {
    expect(stripOracleSqlPlusTerminator('BEGIN NULL; END;\n/\n')).toBe('BEGIN NULL; END;')
    expect(stripOracleSqlPlusTerminator('BEGIN NULL; END;\n/')).toBe('BEGIN NULL; END;')
  })

  it('removes same-line trailing slash', () => {
    expect(stripOracleSqlPlusTerminator('BEGIN NULL; END;/')).toBe('BEGIN NULL; END;')
    expect(stripOracleSqlPlusTerminator('BEGIN NULL; END; /')).toBe('BEGIN NULL; END;')
  })

  it('removes leading glued slash before ALTER', () => {
    expect(stripOracleSqlPlusTerminator('/ ALTER TRIGGER "t" ENABLE;')).toBe(
      'ALTER TRIGGER "t" ENABLE;',
    )
  })

  it('keeps slash inside body', () => {
    const sql = "BEGIN DBMS_OUTPUT.PUT_LINE('a/b'); END;"
    expect(stripOracleSqlPlusTerminator(sql)).toBe(sql)
  })
})

describe('ensureOraclePlsqlScriptTerminator', () => {
  it('appends lone-line slash for procedure/function/trigger', () => {
    expect(ensureOraclePlsqlScriptTerminator('CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;')).toBe(
      'CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;\n/\n',
    )
    expect(
      ensureOraclePlsqlScriptTerminator('CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;\n/\n'),
    ).toBe('CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;\n/\n')
    expect(
      ensureOraclePlsqlScriptTerminator(
        'CREATE OR REPLACE TRIGGER t BEFORE INSERT ON x FOR EACH ROW BEGIN NULL; END;',
      ),
    ).toMatch(/END;\n\/\n?$/i)
  })

  it('does not append for views or sequences', () => {
    const view = 'CREATE OR REPLACE VIEW v AS SELECT 1 AS n FROM DUAL'
    expect(ensureOraclePlsqlScriptTerminator(view)).toBe(view)
    const seq = 'CREATE SEQUENCE s START WITH 1;'
    expect(ensureOraclePlsqlScriptTerminator(seq)).toBe(seq)
  })
})
