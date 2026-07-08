export interface RsBreadcrumbRenderItem {
  key: string
  label: string
  href?: string
  isLink: boolean
  isCurrent: boolean
}

export function buildBreadcrumbRenderItems(
  items: Array<{ label: string; to?: string; href?: string }>,
): RsBreadcrumbRenderItem[] {
  return items.map((item, index) => ({
    key: `${item.label}-${index}`,
    label: item.label,
    href: item.href,
    isLink: Boolean(item.to || item.href),
    isCurrent: index === items.length - 1,
  }))
}
