/**
 * WebSocket 默认地址和新建项。工作台 Vue 只在 register 的 loader 里加载。
 */
import type { ApiPaneCreateAction, ApiPaneDescriptor } from '../layout/pane-types'
import type { ApiRequest } from '../types'

export const DEFAULT_WEBSOCKET_URL = 'ws://127.0.0.1:8080'

export function applyWebsocketDefaults(req: ApiRequest): void {
  const text = req.url.trim().toLowerCase()
  if (!text || text.startsWith('http://') || text.startsWith('https://')) {
    req.url = DEFAULT_WEBSOCKET_URL
  }
}

export const websocketCreates: ApiPaneCreateAction = {
  method: 'WS',
  labelKey: 'modules.api.newWebsocket',
  icon: 'unplug',
  nameKey: 'modules.api.nameWebsocket',
}

export function resolveWebsocketPane(): ApiPaneDescriptor {
  return {
    loader: () => import('./Workspace.vue'),
    buildProps: (ctx) => ({
      request: ctx.request,
      requestId: ctx.requestId,
    }),
  }
}
