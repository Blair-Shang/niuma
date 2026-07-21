import type { InjectionKey, Ref } from 'vue'

/** VastSession 顶栏右侧操作区挂载点（供子面板 Teleport）。 */
export const VAST_SESSION_HEADER_ACTIONS_KEY: InjectionKey<Ref<HTMLElement | null>> = Symbol(
  'vastSessionHeaderActions',
)
