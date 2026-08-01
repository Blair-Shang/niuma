/** 单元格内换行展平为空格，避免 CSV 物理多行拆坏表格。 */
function flattenCellText(s: string): string {
  return s.replace(/\r\n|\r|\n/g, ' ')
}

/** 将查询结果导出为 CSV（Excel 友好：UTF-8 BOM）。 */
export function exportQueryResultAsCsv(
  columns: Array<{ name: string }>,
  rows: unknown[][],
  filename: string,
): void {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    const raw = typeof v === 'object' ? JSON.stringify(v) : String(v)
    const s = flattenCellText(raw)
    if (/[",]/.test(s)) return `"${s.replaceAll('"', '""')}"`
    return s
  }

  const lines = [
    columns.map((c) => escape(c.name)).join(','),
    ...rows.map((row) => row.map(escape).join(',')),
  ]
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
