/**
 * SQLite Monaco：未迁 LSP，静默内置 sql（无 Worker）。
 */

/** 幂等；返回内置 `sql`。 */
export function bootstrapSqliteMonaco(): Promise<string> {
  return Promise.resolve('sql')
}
