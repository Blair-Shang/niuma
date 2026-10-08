import { registerApiPaneFeature } from '../layout/pane-kind-loaders'
import { resolveGrpcPane } from './defaults'

let registered = false

/** gRPC 工作台自注册。 */
export function register(): void {
  if (registered) return
  registered = true
  registerApiPaneFeature('grpc', { resolvePane: resolveGrpcPane })
}
