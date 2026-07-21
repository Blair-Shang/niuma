/** Deep-merge plain message objects (locale fragments). Arrays / primitives overwrite. */
export function mergeMessages(
  ...parts: Array<Record<string, unknown>>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      const prev = out[key]
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        prev &&
        typeof prev === 'object' &&
        !Array.isArray(prev)
      ) {
        out[key] = mergeMessages(
          prev as Record<string, unknown>,
          value as Record<string, unknown>,
        )
      } else {
        out[key] = value
      }
    }
  }
  return out
}
