import { registerApiPaneFeature } from '../layout/pane-kind-loaders'
import { resolveWebsocketPane } from './defaults'

let registered = false

/** WebSocket 客户端自注册。工作台在本目录，不进 HTTP / TCP。 */
export function register(): void {
  if (registered) return
  registered = true
  registerApiPaneFeature('websocket', { resolvePane: resolveWebsocketPane })
}
