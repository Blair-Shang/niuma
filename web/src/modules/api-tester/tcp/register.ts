import { registerApiPaneFeature } from '../layout/pane-kind-loaders'
import { resolveSocketPane } from './defaults'

let registered = false

/** TCP 完整自注册。工作台在本目录。 */
export function register(): void {
  if (registered) return
  registered = true
  registerApiPaneFeature('tcp', { resolvePane: resolveSocketPane })
}
