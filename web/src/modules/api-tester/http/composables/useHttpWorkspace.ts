/**
 * HTTP 工作台交互：环境切换、发送、取消、复制 curl。
 * 标脏仍走模块级 useApiRequestPersist，TCP 工作台共用那一个。
 */
import { useRsToast, type RsSplitPaneItem } from '@niuma/ui'
import { computed, type ComputedRef, type WritableComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiRequestPersist } from '../../composables/useApiRequestPersist'
import { useApiTesterStore } from '../../stores/api-tester'
import type { ApiExchange, ApiRequest } from '../../types'

export function useHttpWorkspace(props: { request: ApiRequest; requestId?: string }): {
  sending: ComputedRef<boolean>
  live: ComputedRef<boolean>
  exchange: ComputedRef<ApiExchange | null>
  envId: WritableComputedRef<string>
  splitPanes: ComputedRef<RsSplitPaneItem[]>
  onSend: () => void
  onCancel: () => void
  onClose: () => void
  onCopyCurl: () => Promise<void>
} {
  const { t } = useI18n()
  const toast = useRsToast()
  const api = useApiTesterStore()
  useApiRequestPersist(() => props.request)

  const sending = computed(() => Boolean(props.requestId && api.sending[props.requestId]))
  const live = computed(() => Boolean(props.requestId && api.sockets[props.requestId]))
  const exchange = computed(() => (props.requestId ? api.exchanges[props.requestId] ?? null : null))
  const envId = computed({
    get: () => api.envId,
    set: (id: string) => {
      api.envId = id
    },
  })

  const splitPanes = computed<RsSplitPaneItem[]>(() => [
    { key: 'request', size: 46, min: 22, resizerHandle: true },
    { key: 'response', size: 54, min: 24 },
  ])

  function onSend(): void {
    if (props.requestId) void api.send(props.requestId)
  }

  function onCancel(): void {
    if (props.requestId) api.cancel(props.requestId)
  }

  function onClose(): void {
    if (props.requestId) api.closeSocket(props.requestId)
  }

  async function onCopyCurl(): Promise<void> {
    if (!props.requestId) return
    const text = api.curl(props.requestId)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('modules.api.copied'))
    } catch {
      toast.error(t('modules.api.copyFailed'))
    }
  }

  return { sending, live, exchange, envId, splitPanes, onSend, onCancel, onClose, onCopyCurl }
}
