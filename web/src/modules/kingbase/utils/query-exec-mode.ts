/**
 * 金仓查询执行模式：默认分页（query.exec）；显式模式 / SQL 标识才同连接批跑（query.execBatch）。
 *
 * - `queryExecMode`：产品入口（树菜单 / 打开查询页）传入，便于扩展
 * - `-- niuma:exec=batch`：脚本自带语义，复制粘贴仍可识别（作兜底）
 */

export type KingbaseQueryExecMode = 'paged' | 'batch'

/** 稳定标识：出现在脚本任意处即走批跑（大小写不敏感）。 */
export const NIUMA_EXEC_BATCH_MARKER = '-- niuma:exec=batch'

const BATCH_MARKER_RE = /--\s*niuma:exec\s*=\s*batch\b/i

/** SQL 是否要求同连接批跑。 */
export function hasBatchExecMarker(sql: string): boolean {
  return BATCH_MARKER_RE.test(sql)
}

/** 若尚无标识则插到首行（生成脚本用）。 */
export function ensureBatchExecMarker(sql: string): string {
  const text = sql.trimStart()
  if (!text || hasBatchExecMarker(text)) return sql
  return `${NIUMA_EXEC_BATCH_MARKER}\n${sql}`
}

/**
 * 解析本次运行模式。
 * 优先级：SQL 标识 > 入口 prop > 默认 paged。
 */
export function resolveQueryExecMode(
  preferred: KingbaseQueryExecMode | undefined,
  sql: string,
): KingbaseQueryExecMode {
  if (hasBatchExecMarker(sql)) return 'batch'
  if (preferred === 'batch') return 'batch'
  return 'paged'
}
