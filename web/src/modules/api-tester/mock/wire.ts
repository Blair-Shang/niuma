import type { ApiMockWireRoute } from '@/api/types/api-mock'
import type { ApiMockRoute } from '../types'

/** 把工作区路由转成 L1 监听表。param 匹配按精确路径处理。 */
export function wireMockRoutes(routes: readonly ApiMockRoute[]): ApiMockWireRoute[] {
  return routes.map((route) => ({
    id: route.id,
    method: route.method,
    path: route.path.trim() || '/',
    match: route.match === 'prefix' ? 'prefix' : 'exact',
    status: route.status > 0 ? route.status : 200,
    headers: (route.headers ?? [])
      .filter((row) => row.enabled && row.key.trim())
      .map((row) => ({ name: row.key.trim(), value: row.value })),
    body: route.body,
    delayMs: route.delayMs && route.delayMs > 0 ? route.delayMs : 0,
    script: route.script ?? '',
  }))
}
