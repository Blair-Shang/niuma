/**
 * gRPC 默认地址。正文是 JSON，方法名单独存放。
 */
import type { ApiPaneCreateAction, ApiPaneDescriptor } from '../layout/pane-types'
import type { ApiRequest } from '../types'

export const grpcCreates: ApiPaneCreateAction = {
  method: 'GRPC',
  labelKey: 'modules.api.newGrpc',
  icon: 'boxes',
  nameKey: 'modules.api.nameGrpc',
}

/** 没有地址时填本机 https 端口。 */
export function applyGrpcDefaults(req: ApiRequest): void {
  if (!req.url.trim()) req.url = 'localhost:50051'
  if (!req.grpcMethod) req.grpcMethod = ''
  if (!req.body.trim()) {
    req.bodyMode = 'json'
    req.body = '{}'
  }
}

export function resolveGrpcPane(): ApiPaneDescriptor {
  return {
    loader: () => import('./Workspace.vue'),
    buildProps: (ctx) => ({
      request: ctx.request,
      requestId: ctx.requestId,
    }),
  }
}
