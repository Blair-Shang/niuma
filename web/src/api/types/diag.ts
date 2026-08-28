/** `platform.diag.trace` 入参 */
export interface DiagTraceParams {
  /** 跨进程关联 id，通常等于请求 id */
  traceId: string
  /** 最多返回条数，缺省 200 */
  limit?: number
}

/** 本机 observe.jsonl 中的一条 RPC 记录 */
export interface DiagEvent {
  ts: string
  kind: string
  service: string
  method: string
  id?: string
  traceId?: string
  ok: boolean
  errorCode?: string
  durationMs: number
}

/** `platform.diag.trace` 返回 */
export interface DiagTraceResult {
  dir: string
  events: DiagEvent[]
}

/** `platform.diag.summary` 入参 */
export interface DiagSummaryParams {
  /** 最多扫描 JSONL 行数 */
  limit?: number
}

/** 按方法聚合 */
export interface DiagMethodStat {
  method: string
  count: number
  fail: number
  slow: number
  maxMs: number
}

/** 按错误码聚合 */
export interface DiagErrorCodeStat {
  code: string
  count: number
}

/** `platform.diag.summary` 返回 */
export interface DiagSummaryResult {
  dir: string
  rpcTotal: number
  failTotal: number
  slowTotal: number
  slowMs: number
  scanned: number
  truncated: boolean
  methods: DiagMethodStat[]
  errors: DiagErrorCodeStat[]
  slowest: DiagEvent[]
}

/** 本机崩溃聚类 */
export interface DiagCrashGroup {
  signature: string
  service: string
  count: number
  samplePath: string
  updatedAt: string
}

/** `platform.diag.crashes` 返回 */
export interface DiagCrashesResult {
  dir: string
  groups: DiagCrashGroup[]
}
