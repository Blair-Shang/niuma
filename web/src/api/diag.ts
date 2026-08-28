import { bridgeInvoke } from '@/api/client'
import type {
  DiagCrashesResult,
  DiagSummaryParams,
  DiagSummaryResult,
  DiagTraceParams,
  DiagTraceResult,
} from '@/api/types/diag'

/**
 * 桌面本机可观测（无 APM）：检索当前会话目录下的 observe.jsonl 与 crashes/。
 */
export const diagApi = {
  /**
   * 按 traceId 拉出 Web → 壳 → Platform → L1 各跳记录。
   *
   * @param params - 关联 id 与条数上限
   * @returns 日志目录与匹配事件
   */
  trace(params: DiagTraceParams): Promise<DiagTraceResult> {
    return bridgeInvoke<DiagTraceResult>('platform.diag.trace', params)
  },

  /**
   * 汇总本机 RPC 次数、失败码与慢调用。
   *
   * @param params - 可选扫描行数上限
   * @returns 聚合统计
   */
  summary(params?: DiagSummaryParams): Promise<DiagSummaryResult> {
    return bridgeInvoke<DiagSummaryResult>('platform.diag.summary', params ?? {})
  },

  /**
   * 列出本机崩溃转储按栈签名聚类的结果。
   *
   * @returns 崩溃组列表
   */
  crashes(): Promise<DiagCrashesResult> {
    return bridgeInvoke<DiagCrashesResult>('platform.diag.crashes', {})
  },
} as const
