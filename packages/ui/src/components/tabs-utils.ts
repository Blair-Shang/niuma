/** 选项卡项定义 */
export interface RsTabItem {
  value: string
  label: string
  icon?: string
  disabled?: boolean
  badge?: string | number
  /** 是否可关闭；未设置时继承 RsTabs 的 closable */
  closable?: boolean
  /** 是否可重命名；未设置时继承 RsTabs 的 renamable */
  renamable?: boolean
}

/** 选项卡尺寸 */
export type RsTabsSize = 'sm' | 'md'

/** line 下划线 · segmented 胶囊 · card 卡片（Ant editable-card） */
export type RsTabsVariant = 'line' | 'segmented' | 'card'

/** 标签过多时的处理方式 */
export type RsTabsOverflow = 'scroll' | 'dropdown'

/** 判断单项是否展示关闭按钮 */
export function isTabClosable(item: RsTabItem, globalClosable = false): boolean {
  if (item.closable !== undefined) return item.closable
  return globalClosable
}

/** 判断单项是否可双击重命名 */
export function isTabRenamable(item: RsTabItem, globalRenamable = false): boolean {
  if (item.renamable !== undefined) return item.renamable
  return globalRenamable
}

/** 关闭当前激活项时，解析应切换到的下一项（优先右侧，否则左侧） */
export function getNextTabAfterClose(
  items: RsTabItem[],
  closedValue: string,
  activeValue: string,
): string | undefined {
  if (activeValue !== closedValue) return activeValue
  const index = items.findIndex((item) => item.value === closedValue)
  if (index < 0) return undefined
  const remaining = items.filter((item) => item.value !== closedValue)
  if (!remaining.length) return undefined
  return remaining[index]?.value ?? remaining[index - 1]?.value ?? remaining[0]?.value
}

/** 将 dragValue 对应的项移动到 dropValue 之前 */
export function reorderTabItems(
  items: RsTabItem[],
  dragValue: string,
  dropValue: string,
): RsTabItem[] {
  const from = items.findIndex((item) => item.value === dragValue)
  const to = items.findIndex((item) => item.value === dropValue)
  if (from < 0 || to < 0 || from === to) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  if (!moved) return items
  next.splice(to, 0, moved)
  return next
}

export interface ResolveVisibleTabOptions {
  /** dropdown 模式下为 false：激活项仅在「更多」展示，不占标签栏 */
  keepActiveVisible?: boolean
}

/**
 * 根据各标签宽度与可用宽度，计算应展示的标签 value 集合。
 */
export function resolveVisibleTabValues(
  items: RsTabItem[],
  widths: Map<string, number>,
  availableWidth: number,
  activeValue: string,
  reservedWidth = 0,
  options: ResolveVisibleTabOptions = {},
): Set<string> {
  const keepActiveVisible = options.keepActiveVisible ?? true

  if (availableWidth <= 0 || !items.length) {
    return new Set(items.map((item) => item.value))
  }

  const budget = Math.max(0, availableWidth - reservedWidth)
  const visible: string[] = []
  let used = 0

  for (const item of items) {
    const width = widths.get(item.value) ?? 0
    if (used + width > budget) break
    visible.push(item.value)
    used += width
  }

  if (keepActiveVisible && !visible.includes(activeValue)) {
    const activeIndex = items.findIndex((item) => item.value === activeValue)
    if (activeIndex >= 0) {
      if (visible.length > 1) visible.pop()
      if (!visible.includes(activeValue)) visible.push(activeValue)
    }
  }

  return new Set(visible)
}
