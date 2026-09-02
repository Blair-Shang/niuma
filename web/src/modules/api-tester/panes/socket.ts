import type { ApiFeatureDef, ApiPaneCreateAction, ApiPaneCreateOpts } from '../pane-types'
import type { ApiRequest } from '../types'
import { DEFAULT_LISTEN_URL, DEFAULT_SOCKET_URL, looksLikeHttpUrl } from '../utils/request-kind'

function applyDefaults(req: ApiRequest, opts?: ApiPaneCreateOpts): void {
  const fallback = opts?.listen ? DEFAULT_LISTEN_URL : DEFAULT_SOCKET_URL
  req.url = looksLikeHttpUrl(req.url) ? fallback : (req.url.trim() || fallback)
  req.params = []
  req.headers = []
}

function socketCreates(method: 'TCP' | 'UDP', parentKey: string, icon: string): ApiPaneCreateAction {
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

export const socketFeature: ApiFeatureDef = {
  icon: 'unplug',
  labelKey: 'modules.api.paneSocket',
  methods: ['TCP', 'UDP'],
  applyDefaults,
  creates: [
    socketCreates('TCP', 'modules.api.newTcp', 'unplug'),
    socketCreates('UDP', 'modules.api.newUdp', 'radio'),
  ],
  resolvePane: (scope) => ({
    loader: scope.listen
      ? () => import('../components/ApiSocketServerWorkspace.vue')
      : () => import('../components/ApiSocketClientWorkspace.vue'),
    buildProps: (ctx) => ({
      request: ctx.request,
      requestId: ctx.requestId,
    }),
  }),
}
