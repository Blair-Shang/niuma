/**
 * TCP 默认值、右键新建项、工作台解析。
 * UDP 复用 applySocketDefaults / resolveSocketPane；creates 在各自 defaults。
 * 无 Vue；工作台 Vue 只在 resolvePane.loader 里动态 import。
 */
import type { ApiPaneCreateAction, ApiPaneCreateOpts, ApiPaneDescriptor } from '../layout/pane-types'
import type { ApiRequest } from '../types'
import { DEFAULT_LISTEN_URL, DEFAULT_SOCKET_URL, looksLikeHttpUrl } from '../utils/request-kind'

export function applySocketDefaults(req: ApiRequest, opts?: ApiPaneCreateOpts): void {
  const fallback = opts?.listen ? DEFAULT_LISTEN_URL : DEFAULT_SOCKET_URL
  req.url = looksLikeHttpUrl(req.url) ? fallback : (req.url.trim() || fallback)
  req.params = []
  req.headers = []
}

export function socketCreates(method: 'TCP' | 'UDP', parentKey: string, icon: string): ApiPaneCreateAction {
  const prefix = method === 'TCP' ? 'Tcp' : 'Udp'
  return {
    method,
    labelKey: parentKey,
    icon,
    children: [
      {
        method,
        labelKey: 'modules.api.socketClient',
        icon,
        listen: false,
        nameKey: `modules.api.name${prefix}Client`,
      },
      {
        method,
        labelKey: 'modules.api.socketServer',
        icon: 'radio',
        listen: true,
        nameKey: `modules.api.name${prefix}Server`,
      },
    ],
  }
}

export const applyTcpDefaults = applySocketDefaults
export const tcpCreates = socketCreates('TCP', 'modules.api.newTcp', 'unplug')

export function resolveSocketPane(scope: { listen?: boolean }): ApiPaneDescriptor {
  return {
    loader: scope.listen
      ? () => import('./SocketServerWorkspace.vue')
      : () => import('./SocketClientWorkspace.vue'),
    buildProps: (ctx) => ({
      request: ctx.request,
      requestId: ctx.requestId,
    }),
  }
}
