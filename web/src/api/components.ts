import { bridgeInvoke } from '@/api/client'
import type {
  ComponentsDetectParams,
  ComponentsDetectResult,
  ComponentsGetDownloadParams,
  ComponentsGetDownloadResult,
  ComponentsInstallParams,
  ComponentsInstallResult,
  ComponentsListParams,
  ComponentsListResult,
  ComponentsSetPathParams,
  ComponentsSetPathResult,
} from '@/api/types/components'

/**
 * 工具组件管理（platform-core 本机 CLI 探测与路径配置）。
 *
 * 对标 Navicat Environment → Executables；与 NiuMa 扩展「插件」无关。
 */
export const componentsApi = {
  list(params: ComponentsListParams = {}): Promise<ComponentsListResult> {
    return bridgeInvoke<ComponentsListResult>('platform.components.list', params)
  },

  detect(params: ComponentsDetectParams): Promise<ComponentsDetectResult> {
    return bridgeInvoke<ComponentsDetectResult>('platform.components.detect', params)
  },

  setPath(params: ComponentsSetPathParams): Promise<ComponentsSetPathResult> {
    return bridgeInvoke<ComponentsSetPathResult>('platform.components.setPath', params)
  },

  getDownload(params: ComponentsGetDownloadParams): Promise<ComponentsGetDownloadResult> {
    return bridgeInvoke<ComponentsGetDownloadResult>('platform.components.getDownload', params)
  },

  install(params: ComponentsInstallParams): Promise<ComponentsInstallResult> {
    return bridgeInvoke<ComponentsInstallResult>('platform.components.install', params)
  },
} as const
