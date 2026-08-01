/** 表数据浏览：行级剪贴板（TSV，兼容 Excel / 多数 DB 客户端）。 */

function flattenCellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value).replace(/\r\n|\r|\n/g, ' ')
}

function escapeTsvCell(value: unknown): string {
  const s = flattenCellText(value)
  if (/[\t\n\r"]/.test(s)) return `"${s.replaceAll('"', '""')}"`
  return s
}

/** 按列顺序将多行格式化为 TSV（无表头）。 */
export function formatRowsAsTsv(columns: string[], rows: unknown[][]): string {
  return rows.map((row) => columns.map((_, i) => escapeTsvCell(row[i])).join('\t')).join('\n')
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === delimiter) {
      cells.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  cells.push(cur)
  return cells
}

/** 解析剪贴板文本为矩阵；优先 TSV，否则 CSV。 */
export function parseClipboardMatrix(text: string): string[][] {
  const body = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = body.split('\n')
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) return []

  const sample = lines.slice(0, 8).join('\n')
  const delimiter = sample.includes('\t') ? '\t' : ','
  return lines.map((line) => parseDelimitedLine(line, delimiter))
}

function looksLikeHeaderRow(columns: string[], cells: string[]): boolean {
  if (cells.length === 0 || columns.length === 0) return false
  const lowerCols = new Set(columns.map((c) => c.toLowerCase()))
  const nonEmpty = cells.map((c) => c.trim()).filter(Boolean)
  if (nonEmpty.length === 0) return false
  const matched = nonEmpty.filter((c) => lowerCols.has(c.toLowerCase())).length
  return matched >= Math.min(2, nonEmpty.length) || matched === nonEmpty.length
}

/**
 * 将剪贴板矩阵映射为「列名 → 文本」行。
 * 首行若像表头则按列名对齐，否则按列顺序位置对齐。
 */
export function mapPasteToColumnRecords(
  columns: string[],
  matrix: string[][],
): Array<Record<string, string>> {
  if (columns.length === 0 || matrix.length === 0) return []

  let dataRows = matrix
  let nameOrder: Array<string | null> | null = null

  if (looksLikeHeaderRow(columns, matrix[0]!)) {
    const lowerIndex = new Map(columns.map((c, i) => [c.toLowerCase(), i]))
    nameOrder = matrix[0]!.map((h) => {
      const idx = lowerIndex.get(h.trim().toLowerCase())
      return idx === undefined ? null : columns[idx]!
    })
    dataRows = matrix.slice(1)
  }

  const records: Array<Record<string, string>> = []
  for (const cells of dataRows) {
    const rec: Record<string, string> = {}
    if (nameOrder) {
      nameOrder.forEach((name, i) => {
        if (!name || cells[i] === undefined) return
        rec[name] = cells[i]!
      })
    } else {
      columns.forEach((name, i) => {
        if (cells[i] === undefined) return
        rec[name] = cells[i]!
      })
    }
    if (Object.values(rec).some((v) => v.trim() !== '')) records.push(rec)
  }
  return records
}
