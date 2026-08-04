import { describe, expect, it } from 'vitest'
import { splitSqlStatements, splitSqlTexts } from './sql-statement-splitter'

describe('splitSqlTexts · vastbase / postgresql', () => {
  it('splits plain statements', () => {
    expect(splitSqlTexts('SELECT 1; SELECT 2;', 'vastbase')).toEqual([
      'SELECT 1',
      'SELECT 2',
    ])
  })

  it('keeps semicolon inside string', () => {
    expect(splitSqlTexts("SELECT 'a;b'; SELECT 2", 'vastbase')).toEqual([
      "SELECT 'a;b'",
      'SELECT 2',
    ])
  })

  it('keeps doubled quotes inside string', () => {
    expect(splitSqlTexts("SELECT 'it''s;ok'; SELECT 2", 'vastbase')).toEqual([
      "SELECT 'it''s;ok'",
      'SELECT 2',
    ])
  })

  it('respects E-string backslash escapes', () => {
    expect(splitSqlTexts("SELECT E'a\\';b'; SELECT 2", 'vastbase')).toEqual([
      "SELECT E'a\\';b'",
      'SELECT 2',
    ])
  })

  it('respects U&-string prefix', () => {
    expect(splitSqlTexts("SELECT U&'a\\';b'; SELECT 2", 'vastbase')).toEqual([
      "SELECT U&'a\\';b'",
      'SELECT 2',
    ])
  })

  it('does not treat backslash specially in normal strings (SCS on)', () => {
    // SELECT 'a\'; SELECT 2  → 串在 \ 后的 ' 结束，; 在串外
    expect(splitSqlTexts("SELECT 'a\\'; SELECT 2", 'vastbase')).toEqual([
      "SELECT 'a\\'",
      'SELECT 2',
    ])
  })

  it('honors standardConformingStrings=false', () => {
    // SCS=off：普通串也认 \，'; 留在串内
    expect(
      splitSqlTexts("SELECT 'a\\;b'; SELECT 2", 'vastbase', {
        standardConformingStrings: false,
      }),
    ).toEqual(["SELECT 'a\\;b'", 'SELECT 2'])
  })

  it('does not split on semicolon inside line comment', () => {
    expect(splitSqlTexts('SELECT 1; -- skip; me\nSELECT 2', 'vastbase')).toEqual([
      'SELECT 1',
      '-- skip; me\nSELECT 2',
    ])
  })

  it('does not split on semicolon inside block comment', () => {
    expect(splitSqlTexts('SELECT 1; /* a;b */ SELECT 2', 'vastbase')).toEqual([
      'SELECT 1',
      '/* a;b */ SELECT 2',
    ])
  })

  it('handles nested block comments (PG)', () => {
    expect(
      splitSqlTexts('SELECT 1; /* outer /* inner; */ still; */ SELECT 2', 'vastbase'),
    ).toEqual(['SELECT 1', '/* outer /* inner; */ still; */ SELECT 2'])
  })

  it('handles dollar quotes', () => {
    const sql = `CREATE FUNCTION f() RETURNS void AS $$
BEGIN
  PERFORM 1;
END;
$$ LANGUAGE plpgsql; SELECT 1`
    expect(splitSqlTexts(sql, 'vastbase')).toEqual([
      `CREATE FUNCTION f() RETURNS void AS $$
BEGIN
  PERFORM 1;
END;
$$ LANGUAGE plpgsql`,
      'SELECT 1',
    ])
  })

  it('keeps bare PL/SQL procedure body as one statement', () => {
    const sql = `CREATE OR REPLACE PROCEDURE "public"."new_procedure"(
  -- p_arg1 IN integer
)
SECURITY INVOKER
AS
BEGIN
  -- TODO: implement
  NULL;
END;`
    expect(splitSqlTexts(sql, 'vastbase')).toEqual([sql])
  })

  it('keeps nested BEGIN/END and END IF inside procedure', () => {
    const sql = `CREATE PROCEDURE p()
AS
BEGIN
  IF 1 = 1 THEN
    NULL;
  END IF;
  BEGIN
    NULL;
  END;
END;`
    expect(splitSqlTexts(sql, 'vastbase')).toEqual([sql])
  })

  it('keeps nested PROCEDURE in declare section as one statement', () => {
    const sql = `CREATE OR REPLACE PROCEDURE "public"."new_procedure"(
  p_debug IN BOOLEAN DEFAULT TRUE
)
SECURITY INVOKER
AS
  v_tid VARCHAR2(64) := COALESCE(p_debug, TRUE);

  PROCEDURE log(p_level VARCHAR2, p_msg VARCHAR2) IS
  BEGIN
    IF p_debug THEN
      NULL;
    END IF;
  END;
BEGIN
  log('INFO', 'start');
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;`
    expect(splitSqlTexts(sql, 'vastbase')).toEqual([sql])
  })

  it('keeps CASE expression END inside procedure body', () => {
    const sql = `CREATE PROCEDURE p()
AS
BEGIN
  log('INFO', 'dry='||CASE WHEN 1=1 THEN 'Y' ELSE 'N' END||'!');
  NULL;
END;`
    expect(splitSqlTexts(sql, 'vastbase')).toEqual([sql])
  })

  it('splits after procedure then next statement', () => {
    const sql = `CREATE PROCEDURE p()
AS
BEGIN
  NULL;
END;
SELECT 1;`
    expect(splitSqlTexts(sql, 'vastbase')).toEqual([
      `CREATE PROCEDURE p()
AS
BEGIN
  NULL;
END;`,
      'SELECT 1',
    ])
  })

  it('ignores trailing gsql slash after procedure', () => {
    const sql = `CREATE PROCEDURE p()
AS
BEGIN
  NULL;
END;
/
SELECT 1;`
    expect(splitSqlTexts(sql, 'vastbase')).toEqual([
      `CREATE PROCEDURE p()
AS
BEGIN
  NULL;
END;`,
      'SELECT 1',
    ])
  })

  it('keeps procedure with trailing gsql slash as one statement including END;', () => {
    const sql = `CREATE OR REPLACE PROCEDURE "public"."new_procedure"(
  -- p_arg1 IN integer
)
SECURITY INVOKER
AS
BEGIN
  -- TODO: implement
  NULL;
END;
/`
    expect(splitSqlTexts(sql, 'vastbase')).toEqual([
      `CREATE OR REPLACE PROCEDURE "public"."new_procedure"(
  -- p_arg1 IN integer
)
SECURITY INVOKER
AS
BEGIN
  -- TODO: implement
  NULL;
END;`,
    ])
  })

  it('handles tagged dollar quotes', () => {
    expect(splitSqlTexts('SELECT $tag$ a;b $tag$; SELECT 2', 'vastbase')).toEqual([
      'SELECT $tag$ a;b $tag$',
      'SELECT 2',
    ])
  })

  it('does not treat $1$ as dollar quote (tag cannot start with digit)', () => {
    // $1 是参数占位风格；$ 后不是合法 tag → 按普通分号切
    expect(splitSqlTexts('SELECT $1; SELECT 2', 'vastbase')).toEqual([
      'SELECT $1',
      'SELECT 2',
    ])
  })

  it('drops comment-only segments', () => {
    expect(splitSqlTexts('SELECT 1; -- only\n; SELECT 2', 'vastbase')).toEqual([
      'SELECT 1',
      'SELECT 2',
    ])
  })

  it('exposes offsets on slices', () => {
    const slices = splitSqlStatements('SELECT 1; SELECT 2', 'vastbase')
    expect(slices).toHaveLength(2)
    expect(slices[0]).toMatchObject({ index: 0, sql: 'SELECT 1', semicolonIndex: 8 })
    expect(slices[1]).toMatchObject({ index: 1, sql: 'SELECT 2', semicolonIndex: -1 })
    expect('SELECT 1; SELECT 2'.slice(slices[0]!.start, slices[0]!.end)).toBe('SELECT 1')
  })
})

describe('splitSqlTexts · mysql', () => {
  it('respects backticks', () => {
    expect(splitSqlTexts('SELECT `a;b`; SELECT 2', 'mysql')).toEqual([
      'SELECT `a;b`',
      'SELECT 2',
    ])
  })

  it('respects backslash escapes in strings', () => {
    expect(splitSqlTexts("SELECT 'a\\';b'; SELECT 2", 'mysql')).toEqual([
      "SELECT 'a\\';b'",
      'SELECT 2',
    ])
  })

  it('does not split on semicolon inside hash comment', () => {
    expect(splitSqlTexts('SELECT 1; # x;y\nSELECT 2', 'mysql')).toEqual([
      'SELECT 1',
      '# x;y\nSELECT 2',
    ])
  })

  it('respects DELIMITER for procedure bodies', () => {
    const sql = [
      'DELIMITER //',
      'CREATE PROCEDURE p()',
      'BEGIN',
      '  SELECT 1;',
      'END //',
      'DELIMITER ;',
      'SELECT 2;',
    ].join('\n')
    expect(splitSqlTexts(sql, 'mysql')).toEqual([
      ['CREATE PROCEDURE p()', 'BEGIN', '  SELECT 1;', 'END'].join('\n'),
      'SELECT 2',
    ])
  })

  it('keeps CREATE PROCEDURE without DELIMITER as one statement (Navicat style)', () => {
    const sql = [
      'CREATE PROCEDURE p()',
      'BEGIN',
      '  DECLARE EXIT HANDLER FOR SQLEXCEPTION',
      '  BEGIN',
      '    ROLLBACK;',
      '  END;',
      '  IF p_a IS NULL THEN',
      '    SIGNAL SQLSTATE \'45000\' SET MESSAGE_TEXT = \'x\';',
      '  END IF;',
      '  START TRANSACTION;',
      '  SELECT 1;',
      'END;',
    ].join('\n')
    expect(splitSqlTexts(sql, 'mysql')).toEqual([sql])
  })

  it('splits DROP then CREATE PROCEDURE without DELIMITER into two', () => {
    const create = [
      'CREATE PROCEDURE p()',
      'BEGIN',
      '  SELECT 1;',
      'END;',
    ].join('\n')
    const sql = `DROP PROCEDURE IF EXISTS p;\n${create}`
    expect(splitSqlTexts(sql, 'mysql')).toEqual([
      'DROP PROCEDURE IF EXISTS p',
      create,
    ])
  })

  it('keeps CREATE DEFINER FUNCTION without DELIMITER as one statement', () => {
    const sql = [
      'CREATE DEFINER=`root`@`%` FUNCTION f()',
      'RETURNS INT',
      'DETERMINISTIC',
      'BEGIN',
      '  RETURN 1;',
      'END;',
    ].join('\n')
    expect(splitSqlTexts(sql, 'mysql')).toEqual([sql])
  })

  it('ignores DELIMITER directives as executable statements', () => {
    expect(splitSqlTexts('DELIMITER $$\nSELECT 1$$\nDELIMITER ;\nSELECT 2;', 'mysql')).toEqual([
      'SELECT 1',
      'SELECT 2',
    ])
  })

  it('does not treat mid-statement DELIMITER ident as directive', () => {
    expect(splitSqlTexts('SELECT DELIMITER FROM t; SELECT 2;', 'mysql')).toEqual([
      'SELECT DELIMITER FROM t',
      'SELECT 2',
    ])
  })
})

describe('splitSqlTexts · oracle', () => {
  it('respects q-bracket quotes', () => {
    expect(splitSqlTexts("SELECT q'[a;b]'; SELECT 2", 'oracle')).toEqual([
      "SELECT q'[a;b]'",
      'SELECT 2',
    ])
  })

  it('respects q-bang quotes', () => {
    expect(splitSqlTexts("SELECT q'!a;b!'; SELECT 2", 'oracle')).toEqual([
      "SELECT q'!a;b!'",
      'SELECT 2',
    ])
  })
})

describe('splitSqlTexts · sqlite', () => {
  it('keeps CREATE TRIGGER … BEGIN … END; as one statement', () => {
    const sql = [
      'CREATE TRIGGER t1 AFTER INSERT ON t',
      'BEGIN',
      '  UPDATE t SET n = n + 1;',
      "  INSERT INTO log(msg) VALUES ('x');",
      'END;',
      'SELECT 1;',
    ].join('\n')
    expect(splitSqlTexts(sql, 'sqlite')).toEqual([
      [
        'CREATE TRIGGER t1 AFTER INSERT ON t',
        'BEGIN',
        '  UPDATE t SET n = n + 1;',
        "  INSERT INTO log(msg) VALUES ('x');",
        'END;',
      ].join('\n'),
      'SELECT 1',
    ])
  })
})

describe('splitSqlTexts · dameng', () => {
  it('keeps CREATE TRIGGER … BEGIN … END; / as one statement', () => {
    const sql = [
      'CREATE OR REPLACE TRIGGER "DATAHUB_TEST"."new_trg"',
      'BEFORE INSERT ON "DATAHUB_TEST"."target_table"',
      'FOR EACH ROW',
      'BEGIN',
      '  NULL;',
      'END;',
      '/',
    ].join('\n')
    expect(splitSqlTexts(sql, 'dameng')).toEqual([
      [
        'CREATE OR REPLACE TRIGGER "DATAHUB_TEST"."new_trg"',
        'BEFORE INSERT ON "DATAHUB_TEST"."target_table"',
        'FOR EACH ROW',
        'BEGIN',
        '  NULL;',
        'END;',
      ].join('\n'),
    ])
  })

  it('keeps CREATE TRIGGER with DECLARE section as one statement', () => {
    const sql = [
      'CREATE OR REPLACE TRIGGER "s"."trg"',
      'BEFORE INSERT ON "s"."t"',
      'FOR EACH ROW',
      'DECLARE',
      '  v_id INT;',
      'BEGIN',
      '  v_id := 1;',
      'END;',
      '/',
    ].join('\n')
    expect(splitSqlTexts(sql, 'dameng')).toEqual([
      [
        'CREATE OR REPLACE TRIGGER "s"."trg"',
        'BEFORE INSERT ON "s"."t"',
        'FOR EACH ROW',
        'DECLARE',
        '  v_id INT;',
        'BEGIN',
        '  v_id := 1;',
        'END;',
      ].join('\n'),
    ])
  })

  it('keeps CREATE PACKAGE header with nested PROCEDURE; before END', () => {
    const sql = [
      'CREATE OR REPLACE PACKAGE "s"."new_pkg" AS',
      '  PROCEDURE hello;',
      'END "new_pkg";',
      '/',
      'SELECT 1;',
    ].join('\n')
    expect(splitSqlTexts(sql, 'dameng')).toEqual([
      [
        'CREATE OR REPLACE PACKAGE "s"."new_pkg" AS',
        '  PROCEDURE hello;',
        'END "new_pkg";',
      ].join('\n'),
      'SELECT 1',
    ])
  })
})

describe('splitSqlTexts · sqlserver GO batches', () => {
  it('splits on standalone GO and omits GO from batches', () => {
    expect(
      splitSqlTexts('SELECT 1\nGO\nSELECT 2\nGO\nSELECT 3', 'sqlserver'),
    ).toEqual(['SELECT 1', 'SELECT 2', 'SELECT 3'])
  })

  it('keeps semicolons inside a GO batch as one exec unit', () => {
    expect(splitSqlTexts('SELECT 1; SELECT 2;\nGO\nSELECT 3', 'sqlserver')).toEqual([
      'SELECT 1; SELECT 2;',
      'SELECT 3',
    ])
  })

  it('ignores GO inside strings and comments', () => {
    expect(splitSqlTexts("SELECT 'GO';\nGO\nSELECT 2 -- GO\nGO\nSELECT 3", 'sqlserver')).toEqual([
      "SELECT 'GO';",
      'SELECT 2 -- GO',
      'SELECT 3',
    ])
  })

  it('ignores GO inside bracket identifiers', () => {
    expect(splitSqlTexts('SELECT [GO]\nGO\nSELECT 2', 'sqlserver')).toEqual([
      'SELECT [GO]',
      'SELECT 2',
    ])
  })
})
