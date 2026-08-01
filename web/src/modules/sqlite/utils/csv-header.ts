/** 从 CSV 文本解析首行表头（仅用于列映射向导，不读全表数据）。 */

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

/** 从文件内容前缀解析源列名；无表头时生成 col1… */
export function parseCsvSourceColumns(
  textPrefix: string,
  options: { header: boolean; delimiter?: string },
): string[] {
  const line = firstCsvLine(textPrefix)
  if (!line.trim()) return []
  const cells = splitCsvLine(line, options.delimiter || ',')
  if (options.header) {
    return cells.map((c, i) => {
      const name = c.trim()
      return name || `col${i + 1}`
    })
  }
  return cells.map((_, i) => `col${i + 1}`)
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
