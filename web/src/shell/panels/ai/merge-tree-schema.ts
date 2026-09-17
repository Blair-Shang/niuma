/** 发送时并入连接树对象提示（已有同 path / catalog 或更具体的则不重复）。 */
export function mergeTreeSchemaHint<
  T extends {
    id: string
    kind: string
    payload: Record<string, unknown>
  },
>(attachments: T[], treeHint: T | null): T[] {
  if (!treeHint) {
    return attachments
  }
  if (
    attachments.some(
      (a) => a.kind === 'schema' && (a.id === treeHint.id || objectHintEqual(a.payload, treeHint.payload)),
    )
  ) {
    return attachments
  }
  const existing = attachments.filter((a) => a.kind === 'schema')
  const best = existing.reduce((m, a) => Math.max(m, objectHintScore(a.payload)), 0)
  if (existing.length && best >= objectHintScore(treeHint.payload)) {
    return attachments
  }
  return [treeHint, ...attachments]
}

function pathKey(payload: Record<string, unknown>): string {
  const path = payload.path
  if (Array.isArray(path) && path.length) {
    return path
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return ''
        }
        const seg = item as { kind?: unknown; name?: unknown }
        return `${String(seg.kind ?? '')}:${String(seg.name ?? '')}`
      })
      .join('/')
  }
  return [
    payload.profileId,
    payload.database,
    payload.schema,
    payload.table,
    payload.collection,
  ].join('\0')
}

function objectHintEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return pathKey(a) === pathKey(b)
}

function objectHintScore(payload: Record<string, unknown>): number {
  if (Array.isArray(payload.path) && payload.path.length) {
    return payload.path.length
  }
  let n = 0
  if (typeof payload.database === 'string' && payload.database) n += 1
  if (typeof payload.schema === 'string' && payload.schema) n += 1
  if (typeof payload.table === 'string' && payload.table) n += 1
  if (typeof payload.collection === 'string' && payload.collection) n += 1
  return n
}
