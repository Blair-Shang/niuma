export interface RsDropdownItem {
  label: string
  value: string
  icon?: string
  disabled?: boolean
}

export interface RsDropdownItemGroup {
  label: string
  options: RsDropdownItem[]
}

export type RsDropdownItems = RsDropdownItem[] | RsDropdownItemGroup[]

export function isDropdownItemGroup(
  item: RsDropdownItem | RsDropdownItemGroup,
): item is RsDropdownItemGroup {
  return 'options' in item && Array.isArray(item.options)
}

export function flattenDropdownItems(items: RsDropdownItems): RsDropdownItem[] {
  const result: RsDropdownItem[] = []
  for (const item of items) {
    if (isDropdownItemGroup(item)) {
      result.push(...item.options)
    } else {
      result.push(item)
    }
  }
  return result
}
