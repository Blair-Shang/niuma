/**
 * 轻量 CSV 解析（首行为表头；支持引号与逗号转义）。
 * 不做方言扩展：定位企业级「粘贴/导入小表」场景。
 */

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
}

function parseLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
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
    if (ch === ',') {
      cells.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  cells.push(cur)
  return cells
}

export function parseCsv(text: string): ParsedCsv {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n').filter((l, idx, arr) => {
    if (l.length > 0) return true
    // 保留中间空行但丢弃尾部空行
    return idx < arr.length - 1 && arr.slice(idx + 1).some((x) => x.length > 0)
  })
  if (lines.length === 0) {
    return { headers: [], rows: [] }
  }
  const headers = parseLine(lines[0]).map((h) => h.trim())
  const rows: string[][] = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    rows.push(parseLine(lines[i]))
  }
  return { headers, rows }
}
