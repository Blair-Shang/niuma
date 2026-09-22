import { registerApiPaneFeature } from '../layout/pane-kind-loaders'
import { resolveSocketPane } from '../tcp/defaults'

let registered = false

/** UDP 完整自注册。工作台复用 tcp/ 套接字壳（同一套收发 UI）。 */
export function register(): void {
  if (registered) return
  registered = true
  registerApiPaneFeature('udp', { resolvePane: resolveSocketPane })
}
