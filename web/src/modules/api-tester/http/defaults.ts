import type { ApiRequest } from '../types'
import { newKvRow } from '../utils/format'
import { looksLikeHttpUrl } from '../utils/request-kind'

/** HTTP 新建 / 切协议默认值。无 Vue。 */
export function applyHttpDefaults(req: ApiRequest): void {
  if (!looksLikeHttpUrl(req.url)) req.url = '{{baseUrl}}'
  if (req.headers.length === 0) req.headers = [newKvRow('Accept', 'application/json')]
}
