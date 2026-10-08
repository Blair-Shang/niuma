import { bridgeInvoke } from '@/api/client'

export interface ApiGrpcInvokeParams {
  url: string
  method: string
  body?: string
  timeoutMs?: number
  insecure?: boolean
  proxy?: string
  headers?: { name: string; value: string }[]
}

export interface ApiGrpcInvokeResult {
  status: number
  message: string
  body: string
  headers: { name: string; value: string }[]
  httpStatus: number
  durationMs: number
}

/** JSON codec 的 unary gRPC。服务端需接受 application/grpc+json。 */
export const apiGrpcApi = {
  invoke(params: ApiGrpcInvokeParams): Promise<ApiGrpcInvokeResult> {
    return bridgeInvoke<ApiGrpcInvokeResult>('api.grpc.invoke', params)
  },
} as const
