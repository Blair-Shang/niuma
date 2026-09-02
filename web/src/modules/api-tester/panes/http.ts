import type { ApiFeatureDef } from '../pane-types'
import type { ApiRequest } from '../types'
import { newKvRow } from '../utils/format'
import { looksLikeHttpUrl } from '../utils/request-kind'

function applyDefaults(req: ApiRequest): void {
  if (!looksLikeHttpUrl(req.url)) req.url = '{{baseUrl}}'
  if (req.headers.length === 0) req.headers = [newKvRow('Accept', 'application/json')]
}

export const httpFeature: ApiFeatureDef = {
  icon: 'globe',
  labelKey: 'modules.api.paneHttp',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'WS'],
  applyDefaults,
  creates: [{ method: 'GET', labelKey: 'modules.api.newRequest', icon: 'plus' }],
  resolvePane: () => ({
    loader: () => import('../components/ApiHttpWorkspace.vue'),
    buildProps: (ctx) => ({
      request: ctx.request,
      requestId: ctx.requestId,
    }),
  }),
}
