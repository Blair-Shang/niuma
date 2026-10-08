/**
 * gRPC JSON 调用。帧和 HTTP/2 由 api-service 完成。
 */
import { apiGrpcApi, isBridgeAvailable } from '@/api'
import { i18n } from '@/locale'
import type { ApiEnvironment, ApiExchange, ApiRequest } from '../types'
import type { ApiVariableScope } from '../utils/folder-tree'
import { newKvRow } from '../utils/format'
import { SendError } from '../http/utils/send'
import { httpTransportOf } from '../http/settings/settings'
import { interpolateVariables, resolveRequest } from '../http/utils/request-resolve'

/** 发送一条 unary gRPC。地址缺省补 https://。 */
export async function executeGrpc(
  req: ApiRequest,
  env: ApiEnvironment | undefined,
  signal: AbortSignal,
  scope?: ApiVariableScope,
): Promise<ApiExchange> {
  if (!isBridgeAvailable()) throw new SendError('need-desktop', 'desktop only')
  const resolved = resolveRequest(req, env, scope)
  const method = (req.grpcMethod ?? '').trim()
  if (!method) throw new Error(String(i18n.global.t('modules.api.grpcMethod')))
  if (signal.aborted) throw new SendError('cancelled', 'cancelled')
  const fill = (text: string) => interpolateVariables(text, resolved.values)
  const transport = httpTransportOf(req, fill)
  const started = performance.now()
  const result = await apiGrpcApi.invoke({
    url: resolved.url,
    method,
    body: resolved.body || '{}',
    timeoutMs: transport.timeoutMs,
    insecure: transport.insecure,
    proxy: transport.proxy,
    headers: [...resolved.headers.entries()].map(([name, value]) => ({ name, value })),
  })
  const durationMs = result.durationMs || Math.max(1, Math.round(performance.now() - started))
  return {
    ok: result.status === 0,
    status: result.httpStatus || (result.status === 0 ? 200 : result.status),
    statusText: result.message || (result.status === 0 ? 'OK' : `grpc-status ${result.status}`),
    durationMs,
    sizeBytes: result.body.length,
    protocol: 'gRPC',
    headers: (result.headers ?? []).map((row) => newKvRow(row.name, row.value, true)),
    body: result.body,
    error: result.status === 0 ? undefined : result.message || `grpc-status ${result.status}`,
  }
}
