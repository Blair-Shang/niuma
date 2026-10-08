import type { ApiFolder, ApiMethod, ApiRequest, ApiRunProfile } from '../types'
import { materializeTargets } from '../utils/run-plan'

const HTTP: ReadonlySet<ApiMethod> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])

/** 集合运行只发送 HTTP 请求。 */
export function httpRunTargets(folders: readonly ApiFolder[], profile: ApiRunProfile): ApiRequest[] {
  return materializeTargets(folders, profile).filter((req) => HTTP.has(req.method))
}
