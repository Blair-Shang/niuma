import { describe, expect, it } from 'vitest'
import {
  normalizeMysqlRoutineDdlForEdit,
  normalizeMysqlViewDdlForEdit,
  parseMysqlObjectNameFromSql,
} from './normalize-object-ddl'

describe('normalizeMysqlViewDdlForEdit', () => {
  it('strips ALGORITHM / DEFINER / SQL SECURITY and uses CREATE OR REPLACE', () => {
    const raw =
      "CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `new_view` AS select 1 AS `col`"
    expect(normalizeMysqlViewDdlForEdit(raw)).toBe(
      'CREATE OR REPLACE VIEW `new_view` AS select 1 AS `col`',
    )
  })

  it('handles formatter-spaced DEFINER', () => {
    const raw =
      'CREATE ALGORITHM = UNDEFINED DEFINER = `root` @ `%` SQL SECURITY DEFINER VIEW `new_view` AS\nSELECT 1'
    expect(normalizeMysqlViewDdlForEdit(raw)).toBe(
      'CREATE OR REPLACE VIEW `new_view` AS\nSELECT 1',
    )
  })

  it('keeps existing CREATE OR REPLACE', () => {
    const raw = 'CREATE OR REPLACE VIEW `v` AS SELECT 1'
    expect(normalizeMysqlViewDdlForEdit(raw)).toBe(raw)
  })
})

describe('normalizeMysqlRoutineDdlForEdit', () => {
  it('strips DEFINER only', () => {
    const raw =
      "CREATE DEFINER=`root`@`%` PROCEDURE `p`()\nBEGIN\n  SELECT 1;\nEND"
    expect(normalizeMysqlRoutineDdlForEdit(raw)).toBe(
      "CREATE PROCEDURE `p`()\nBEGIN\n  SELECT 1;\nEND",
    )
  })
})

describe('parseMysqlObjectNameFromSql', () => {
  it('parses qualified procedure name', () => {
    const sql =
      'CREATE PROCEDURE `test2`.`my_proc`()\nBEGIN\n  SELECT 1;\nEND;'
    expect(parseMysqlObjectNameFromSql(sql, 'procedure')).toBe('my_proc')
  })

  it('parses bare function name after DEFINER', () => {
    const sql =
      "CREATE DEFINER=`root`@`%` FUNCTION `calc`() RETURNS INT\nBEGIN\n  RETURN 1;\nEND"
    expect(parseMysqlObjectNameFromSql(sql, 'function')).toBe('calc')
  })

  it('parses view name from CREATE OR REPLACE', () => {
    expect(
      parseMysqlObjectNameFromSql(
        'CREATE OR REPLACE VIEW `db`.`v1` AS SELECT 1',
        'view',
      ),
    ).toBe('v1')
  })

  it('skips DELIMITER client lines', () => {
    const sql =
      'DELIMITER $$\nCREATE PROCEDURE `p1`()\nBEGIN\n  SELECT 1;\nEND$$\nDELIMITER ;'
    expect(parseMysqlObjectNameFromSql(sql, 'procedure')).toBe('p1')
  })
})
