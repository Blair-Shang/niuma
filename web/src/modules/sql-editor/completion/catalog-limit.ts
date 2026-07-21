/**
 * Catalog 补全条数策略（docs/23）：
 * - 短前缀命中面大 → 提高 limit，避免 `bas` 下靠后的 `bas_sku` 被截断
 * - 空前缀只做轻量浏览，禁止靠「拉前 N + Monaco 模糊」碰目标
 */

/** 与后端 DefaultCatalogLimit 对齐的兜底默认值 */
export const SQL_CATALOG_LIMIT = 200

/** 与后端 MaxCatalogLimit 对齐 */
export const SQL_CATALOG_MAX_LIMIT = 500

/**
 * 按当前输入前缀长度选择 catalog limit。
 * 前缀越长，命中集越小，可略降；短前缀则抬高上限（仍封顶 MAX）。
 */
export function catalogLimitForPrefix(prefix: string): number {
  const len = prefix.trim().length
  if (len <= 0) return 40
  if (len === 1) return 200
  if (len === 2) return 300
  if (len <= 4) return 400
  return SQL_CATALOG_MAX_LIMIT
}
