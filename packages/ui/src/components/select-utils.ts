export interface RsSelectOption {
  label: string
  value: string
  disabled?: boolean
}

export interface RsSelectOptionGroup {
  label: string
  options: RsSelectOption[]
}

export type RsSelectOptions = ReadonlyArray<RsSelectOption | RsSelectOptionGroup>

export function isSelectOptionGroup(
  item: RsSelectOption | RsSelectOptionGroup,
): item is RsSelectOptionGroup {
  return 'options' in item && Array.isArray(item.options)
}

export function flattenSelectOptions(options: RsSelectOptions): RsSelectOption[] {
  const result: RsSelectOption[] = []
  for (const item of options) {
    if (isSelectOptionGroup(item)) {
      result.push(...item.options)
    } else {
      result.push(item)
    }
  }
  return result
}

export function buildOptionLabelMap(options: RsSelectOptions): Map<string, string> {
  const map = new Map<string, string>()
  for (const opt of flattenSelectOptions(options)) {
    map.set(opt.value, opt.label)
  }
  return map
}

export function buildOptionDisabledMap(options: RsSelectOptions): Map<string, boolean> {
  const map = new Map<string, boolean>()
  for (const opt of flattenSelectOptions(options)) {
    map.set(opt.value, Boolean(opt.disabled))
  }
  return map
}

export function filterSelectOptions(
  options: RsSelectOptions,
  query: string,
  contains: (text: string, search: string) => boolean,
): RsSelectOptions {
  const trimmed = query.trim()
  if (!trimmed) return options

  const result: Array<RsSelectOption | RsSelectOptionGroup> = []
  for (const item of options) {
    if (isSelectOptionGroup(item)) {
      const filtered = item.options.filter((opt) => contains(opt.label, trimmed))
      if (filtered.length > 0) {
        result.push({ label: item.label, options: filtered })
      }
    } else if (contains(item.label, trimmed)) {
      result.push(item)
    }
  }
  return result as RsSelectOptions
}

export function flattenSelectValues(options: RsSelectOptions): string[] {
  return flattenSelectOptions(options).map((opt) => opt.value)
}
