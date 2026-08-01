/** 从 CSV 文本解析表头 / 样本行（仅用于导入向导，不读全表）。 */

/** 按 RFC4180 风格拆分一行（支持双引号转义）。 */
export function splitCsvLine(line: string, delimiter = ','): string[] {
  const delim = delimiter || ','
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  let i = 0
  while (i < line.length) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i += 2
        continue
      }
      if (ch === '"') {
        inQuotes = false
        i++
        continue
      }
      cur += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delim) {
      out.push(cur)
      cur = ''
      i++
      continue
    }
    if (ch !== '\r') cur += ch
    i++
  }
  out.push(cur)
  return out
}

/** 取文本首行（跳过 UTF-8 BOM）。 */
export function firstCsvLine(text: string): string {
  const raw = text.replace(/^\uFEFF/, '')
  const end = raw.search(/\r?\n/)
  return end < 0 ? raw : raw.slice(0, end)
}

/** 按行拆分（保留引号内换行）；仅扫描前缀，适合向导预览。 */
export function splitCsvRecords(text: string, delimiter = ',', maxRecords = 21): string[][] {
  const raw = text.replace(/^\uFEFF/, '')
  const delim = delimiter || ','
  const records: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuotes = false
  let i = 0
  while (i < raw.length && records.length < maxRecords) {
    const ch = raw[i]!
    if (inQuotes) {
      if (ch === '"' && raw[i + 1] === '"') {
        cur += '"'
        i += 2
        continue
      }
      if (ch === '"') {
        inQuotes = false
        i++
        continue
      }
      cur += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delim) {
      row.push(cur)
      cur = ''
      i++
      continue
    }
    if (ch === '\n') {
      row.push(cur)
      records.push(row)
      row = []
      cur = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    cur += ch
    i++
  }
  if (records.length < maxRecords && (cur.length > 0 || row.length > 0)) {
    row.push(cur)
    records.push(row)
  }
  return records
}

function normalizeHeaderCells(cells: string[]): string[] {
  return cells.map((c, i) => {
    const name = c.trim()
    return name || `col${i + 1}`
  })
}

/** 从文件内容前缀解析源列名；无表头时生成 col1… */
export function parseCsvSourceColumns(
  textPrefix: string,
  options: { header: boolean; delimiter?: string },
): string[] {
  const line = firstCsvLine(textPrefix)
  if (!line.trim()) return []
  const cells = splitCsvLine(line, options.delimiter || ',')
  if (options.header) return normalizeHeaderCells(cells)
  return cells.map((_, i) => `col${i + 1}`)
}

export interface CsvPreviewResult {
  columns: string[]
  /** 数据行（不含表头）；最多 maxRows 行 */
  rows: string[][]
}

/** 解析表头 + 前若干数据行，供导入预览。 */
export function parseCsvPreview(
  textPrefix: string,
  options: { header: boolean; delimiter?: string; maxRows?: number },
): CsvPreviewResult {
  const maxRows = options.maxRows ?? 5
  const records = splitCsvRecords(textPrefix, options.delimiter || ',', maxRows + 1)
  if (records.length === 0) return { columns: [], rows: [] }

  if (options.header) {
    const columns = normalizeHeaderCells(records[0] ?? [])
    return { columns, rows: records.slice(1, 1 + maxRows) }
  }
  const width = records[0]?.length ?? 0
  const columns = Array.from({ length: width }, (_, i) => `col${i + 1}`)
  return { columns, rows: records.slice(0, maxRows) }
}

/** 按忽略大小写同名匹配表列。 */
export function autoMatchColumns(
  sources: string[],
  tableColumns: string[],
): Record<string, string> {
  const byLower = new Map(tableColumns.map((c) => [c.toLowerCase(), c]))
  const map: Record<string, string> = {}
  for (const src of sources) {
    const hit = byLower.get(src.toLowerCase())
    if (hit) map[src] = hit
  }
  return map
}

/** 轻量解开 ClickHouse TabSeparated 常见转义（预览用）。 */
export function unescapeTsvField(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!
    if (ch !== '\\' || i + 1 >= value.length) {
      out += ch
      continue
    }
    const next = value[++i]!
    switch (next) {
      case 'n':
        out += '\n'
        break
      case 'r':
        out += '\r'
        break
      case 't':
        out += '\t'
        break
      case 'b':
        out += '\b'
        break
      case 'f':
        out += '\f'
        break
      case '0':
        out += '\0'
        break
      case '\\':
        out += '\\'
        break
      case "'":
        out += "'"
        break
      case 'x': {
        const hex = value.slice(i + 1, i + 3)
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16))
          i += 2
        } else {
          out += 'x'
        }
        break
      }
      default:
        out += next
    }
  }
  return out
}

/** ClickHouse TSV / TSVWithNames 预览（真实 Tab 分列 + 反斜杠还原）。 */
export function parseTsvPreview(
  textPrefix: string,
  options: { header: boolean; maxRows?: number },
): CsvPreviewResult {
  const maxRows = options.maxRows ?? 5
  const raw = textPrefix.replace(/^\uFEFF/, '')
  const lines = raw.split(/\n/).filter((line, idx, arr) => {
    // 保留中间空行语义弱化：预览跳过纯空行
    return line.length > 0 || idx === arr.length - 1
  }).filter((line) => line.length > 0)

  if (lines.length === 0) return { columns: [], rows: [] }

  const splitLine = (line: string) =>
    line.replace(/\r$/, '').split('\t').map((cell) => unescapeTsvField(cell))

  if (options.header) {
    const columns = normalizeHeaderCells(splitLine(lines[0]!))
    const rows = lines.slice(1, 1 + maxRows).map(splitLine)
    return { columns, rows }
  }
  const first = splitLine(lines[0]!)
  const columns = first.map((_, i) => `col${i + 1}`)
  return { columns, rows: lines.slice(0, maxRows).map(splitLine) }
}
