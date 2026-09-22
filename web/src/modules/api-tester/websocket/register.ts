import { registerApiPaneFeature } from '../layout/pane-kind-loaders'

let registered = false

/** WebSocket 占位自注册。P3 再接 L1；工作台只提示尚未接入。 */
export function register(): void {
  if (registered) return
  registered = true
  registerApiPaneFeature('websocket', {
    resolvePane: () => ({
      loader: () => import('./Workspace.vue'),
      buildProps: (ctx) => ({
        request: ctx.request,
        requestId: ctx.requestId,
      }),
    }),
  })
}
