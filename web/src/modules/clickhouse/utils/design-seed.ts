/**
 * 导入向导 → 设计器「从文件建表」的一次性种子。
 * 打开 Design 创建页时 take 消费，避免串台。
 */
import { columnFromParts, type DesignColumnDraft } from '@/modules/clickhouse/utils/table-design'

export interface ClickHouseDesignSeed {
  database: string
  tableName?: string
  columns: string[]
}

let pending: ClickHouseDesignSeed | null = null

export function setClickHouseDesignSeed(seed: ClickHouseDesignSeed): void {
  pending = {
    database: seed.database,
    tableName: seed.tableName?.trim() || undefined,
    columns: seed.columns.map((c) => c.trim()).filter(Boolean),
  }
}

export function takeClickHouseDesignSeed(database?: string): ClickHouseDesignSeed | null {
  if (!pending) return null
  if (database && pending.database && pending.database !== database) return null
  const seed = pending
  pending = null
  return seed
}

/** 将 CSV/JSON 列名转为设计器草稿（默认 String）。 */
export function columnsFromImportSeed(names: string[]): DesignColumnDraft[] {
  return names
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => columnFromParts({ name, typeBase: 'String' }))
}

export function suggestTableNameFromPath(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop() ?? 'imported'
  const stem = base.replace(/\.(csv|tsv|txt|json|ndjson|parquet)$/i, '')
  const cleaned = stem.replace(/[^\w\u4e00-\u9fff]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'imported_table'
}
