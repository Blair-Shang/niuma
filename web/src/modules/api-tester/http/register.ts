import { registerApiPaneFeature } from '../layout/pane-kind-loaders'

let registered = false

/** HTTP 完整自注册：只挂工作台解析，元数据在 pane-catalog。 */
export function register(): void {
  if (registered) return
  registered = true
  registerApiPaneFeature('http', {
    resolvePane: () => ({
      loader: () => import('./HttpWorkspace.vue'),
      buildProps: (ctx) => ({
        request: ctx.request,
        requestId: ctx.requestId,
      }),
    }),
  })
}
