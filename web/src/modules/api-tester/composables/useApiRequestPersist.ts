/**
 * 当前打开的一条请求：字段编辑标脏 workspace。
 * 只深 watch 这一条，不要在 store 里深 watch 整棵 folders。
 */
import { watch } from 'vue'
import type { ApiRequest } from '../types'
import { useApiTesterStore } from '../stores/api-tester'

export function useApiRequestPersist(request: () => ApiRequest | undefined): void {
  const api = useApiTesterStore()
  watch(
    request,
    (req) => {
      if (req) api.markWorkspaceDirty()
    },
    { deep: true },
  )
}
