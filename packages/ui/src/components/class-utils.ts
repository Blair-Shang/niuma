export type RsClassValue =
  | string
  | number
  | false
  | null
  | undefined
  | Record<string, boolean | null | undefined>
  | RsClassValue[]

function flattenClassValue(value: RsClassValue, output: string[]): void {
  if (!value) return
  if (typeof value === 'string' || typeof value === 'number') {
    output.push(String(value))
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => flattenClassValue(item, output))
    return
  }
  Object.entries(value).forEach(([key, enabled]) => {
    if (enabled) output.push(key)
  })
}

export function rsCn(...values: RsClassValue[]): string {
  const output: string[] = []
  values.forEach((value) => flattenClassValue(value, output))
  return Array.from(new Set(output.join(' ').split(/\s+/).filter(Boolean))).join(' ')
}
