/**
 * connection_options 读写辅助 —— 跨协议统一 snake_case，并兼容历史 camelCase 字段。
 */

/** 测试连接超时：取站点配置与上限的较小值，未配置时用协议默认值。 */
export function cappedTestTimeout(configured: number, defaultSeconds: number, capSeconds: number): number {
  const base = configured > 0 ? configured : defaultSeconds
  return Math.min(base, capSeconds)
}

/** 从已保存 options 读取建连超时（秒）；优先 snake_case，回退 camelCase。 */
export function readStoredTimeoutSeconds(
  options: Record<string, unknown> | undefined,
  defaultSeconds: number,
): number {
  const raw = options?.timeout_seconds ?? options?.timeoutSeconds
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  return parsed > 0 ? parsed : defaultSeconds
}

/** 将已存储超时转为表单字符串；与默认值相同时留空以展示 placeholder。 */
export function formatTimeoutFormValue(storedSeconds: number, defaultSeconds: number): string {
  return storedSeconds > 0 && storedSeconds !== defaultSeconds ? String(storedSeconds) : ''
}

/** 解析表单超时输入；无效或留空时回退默认值。 */
export function parseTimeoutFormValue(formValue: string, defaultSeconds: number): number {
  const parsed = Number.parseInt(formValue, 10)
  return parsed > 0 ? parsed : defaultSeconds
}

/** 从已保存 options 读取 Sentinel 主节点名；兼容 camelCase。 */
export function readStoredSentinelMasterName(options: Record<string, unknown> | undefined): string {
  const raw = options?.sentinel_master_name ?? options?.sentinelMasterName
  return typeof raw === 'string' ? raw : ''
}
