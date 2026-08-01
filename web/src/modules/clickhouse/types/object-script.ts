/**
 * ClickHouse 对象脚本：视图 / 物化视图 / 字典（新建与编辑共用）。
 */
export type ClickHouseObjectKind = 'view' | 'materializedView' | 'dictionary'

export type ClickHouseObjectScriptMode = 'create' | 'alter'

export type ClickHouseObjectCategory = 'views' | 'materializedViews' | 'dictionaries'

export const CLICKHOUSE_CREATE_OBJECT_PLACEHOLDERS: Record<ClickHouseObjectCategory, string> = {
  views: 'new_view',
  materializedViews: 'new_mv',
  dictionaries: 'new_dict',
}

export function categoryToObjectKind(category: ClickHouseObjectCategory): ClickHouseObjectKind {
  if (category === 'materializedViews') return 'materializedView'
  if (category === 'dictionaries') return 'dictionary'
  return 'view'
}

export function objectKindToCategory(kind: ClickHouseObjectKind): ClickHouseObjectCategory {
  if (kind === 'materializedView') return 'materializedViews'
  if (kind === 'dictionary') return 'dictionaries'
  return 'views'
}

export function objectKindIcon(kind: ClickHouseObjectKind): string {
  if (kind === 'materializedView') return 'layers'
  if (kind === 'dictionary') return 'book-marked'
  return 'eye'
}

export function isObjectCategory(name: string | undefined): name is ClickHouseObjectCategory {
  return name === 'views' || name === 'materializedViews' || name === 'dictionaries'
}
