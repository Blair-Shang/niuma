function needsQuote(cell: string): boolean {
  return /[\t\n\r"]/.test(cell)
}

function quoteCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  if (!needsQuote(text)) {
    return text
  }
  return `"${text.replace(/"/g, '""')}"`
}

/** 按列顺序把行格式化为 TSV（不含表头）。含 tab/换行/引号的单元格加引号。 */
export function formatRowsAsTsv(_columns: string[], rows: unknown[][]): string {
  return rows.map((row) => row.map(quoteCell).join('\t')).join('\n')
}

function parseTsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === '\t') {
      cells.push(current)
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current)
  return cells
}

export function parseClipboardMatrix(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized) {
    return []
  }
  return normalized
    .split('\n')
    .filter((line, idx, all) => !(idx === all.length - 1 && line === ''))
    .map(parseTsvLine)
}

/** 剪贴板矩阵映射到列记录：首行若匹配列名则按表头，否则按位置。 */
export function mapPasteToColumnRecords(
  columns: string[],
  matrix: string[][],
): Record<string, string>[] {
  if (matrix.length === 0) {
    return []
  }
  const header = matrix[0] ?? []
  const headerSet = new Set(header)
  const useHeader = columns.some((col) => headerSet.has(col))
  const body = useHeader ? matrix.slice(1) : matrix
  const indexByName = new Map(header.map((name, idx) => [name, idx]))
  return body.map((row) => {
    const record: Record<string, string> = {}
    for (let i = 0; i < columns.length; i += 1) {
      const col = columns[i]
      if (!col) {
        continue
      }
      const idx = useHeader ? indexByName.get(col) : i
      if (idx === undefined) {
        continue
      }
      record[col] = row[idx] ?? ''
    }
    return record
  })
}
