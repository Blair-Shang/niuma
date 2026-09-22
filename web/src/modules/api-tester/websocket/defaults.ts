import type { ApiRequest } from '../types'

/** WebSocket P3：只占 kind，不改地址栏。工作台提示尚未接入。 */
export function applyWebsocketDefaults(req: ApiRequest): void {
  req.params = []
  req.headers = []
}
