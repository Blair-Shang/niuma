/**
 * 集合运行的数据文件。CSV 首行是列名；JSON 是对象数组。
 */

/** 解析 CSV 或 JSON 数组。无法识别时返回空数组。 */
export function parseDataRows(text: string): Record<string, string>[] {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) return parseJson(trimmed)
  return parseCsv(trimmed)
}

function parseJson(text: string): Record<string, string>[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return []
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      if (value == null) continue
      out[key] = typeof value === 'string' ? value : JSON.stringify(value)
    }
    return [out]
  })
}

function parseCsv(text: string): Record<string, string>[] {
  const rows = splitCsv(text)
  if (rows.length < 2) return []
  const header = rows[0]!.map((cell) => cell.trim())
  return rows.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) => {
    const out: Record<string, string> = {}
    header.forEach((key, index) => {
      if (key) out[key] = row[index] ?? ''
    })
    return out
  })
}

function splitCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else quoted = false
      } else cell += char
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ',') {
      row.push(cell)
      cell = ''
      continue
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }
    cell += char
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}
