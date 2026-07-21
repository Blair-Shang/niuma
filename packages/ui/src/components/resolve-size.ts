import { computed, type ComputedRef } from 'vue'
import type { RsComponentSize } from '../theme/types'
import { useRsConfigOptional } from '../composables/useRsConfig'
import { useRsFormContext, type RsFormContext } from './form-utils'

/**
 * 解析控件尺寸：props → Form → ConfigProvider → md。
 * 业务应传 `size` 或依赖全局/表单上下文，避免 :deep 改高度。
 */
export function resolveRsComponentSize(
  size: RsComponentSize | undefined,
  form?: RsFormContext | null,
): ComputedRef<RsComponentSize> {
  const config = useRsConfigOptional()
  return computed(
    () => size ?? form?.size.value ?? config?.controlSize.value ?? 'md',
  )
}

/** 在 setup 内便捷解析（自动读 Form / Config）。 */
export function useResolvedRsComponentSize(
  size: () => RsComponentSize | undefined,
): ComputedRef<RsComponentSize> {
  const form = useRsFormContext()
  const config = useRsConfigOptional()
  return computed(
    () => size() ?? form?.size.value ?? config?.controlSize.value ?? 'md',
  )
}
