import { computed, type ComputedRef } from 'vue'
import { RS_RADIUS_CSS, type RsRadius } from '../theme/types'
import { useRsConfigOptional } from '../composables/useRsConfig'

/**
 * 解析圆角：props → ConfigProvider.controlRadius → 组件默认档。
 * 业务应传 `radius` / `iconRadius` 或依赖全局配置，避免 :deep 改 border-radius。
 */
export function useResolvedRsRadius(
  radius: () => RsRadius | undefined,
  fallback: RsRadius,
): ComputedRef<RsRadius> {
  const config = useRsConfigOptional()
  return computed(
    () => radius() ?? config?.controlRadius.value ?? fallback,
  )
}

/** 将档位转为可写入 style / CSS 变量的值。 */
export function rsRadiusCss(radius: RsRadius): string {
  return RS_RADIUS_CSS[radius]
}
