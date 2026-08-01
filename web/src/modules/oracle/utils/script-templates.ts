import { qualifiedName, quoteIdent } from '@/modules/oracle/sql-seed'
import type { OracleObjectCategory } from '@/modules/oracle/types/object-script'
import { ORACLE_CREATE_OBJECT_PLACEHOLDERS } from '@/modules/oracle/types/object-script'

export function createObjectTemplate(schema: string, category: OracleObjectCategory): string {
  const qn = qualifiedName(schema, ORACLE_CREATE_OBJECT_PLACEHOLDERS[category])
  if (category === 'views') return `CREATE OR REPLACE VIEW ${qn} AS\nSELECT\n  *\nFROM \n`
  if (category === 'procedures') return `CREATE OR REPLACE PROCEDURE ${qn}\nAS\nBEGIN\n  NULL;\nEND;\n/\n`
  if (category === 'functions') return `CREATE OR REPLACE FUNCTION ${qn}\nRETURN NUMBER\nAS\nBEGIN\n  RETURN 0;\nEND;\n/\n`
  return `CREATE OR REPLACE PACKAGE ${qn} AS\n  PROCEDURE example;\nEND;\n/\n\nCREATE OR REPLACE PACKAGE BODY ${qn} AS\n  PROCEDURE example IS\n  BEGIN\n    NULL;\n  END;\nEND;\n/\n`
}

export function dropObjectSql(schema: string, name: string, category: OracleObjectCategory): string {
  const type = category === 'views' ? 'VIEW' : category === 'procedures' ? 'PROCEDURE' : category === 'functions' ? 'FUNCTION' : 'PACKAGE'
  return `DROP ${type} ${qualifiedName(schema, name)};`
}

export function formatQualified(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`
}
