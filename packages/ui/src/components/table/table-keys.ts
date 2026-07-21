export function makeCellKey(rowKey: string, colKey: string): string {
  return `${rowKey}:${colKey}`
}

export function parseCellKey(cellKey: string): { rowKey: string; colKey: string } {
  const index = cellKey.indexOf(':')
  if (index < 0) return { rowKey: cellKey, colKey: '' }
  return {
    rowKey: cellKey.slice(0, index),
    colKey: cellKey.slice(index + 1),
  }
}
