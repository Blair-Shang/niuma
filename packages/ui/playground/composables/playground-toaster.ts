import { ref } from 'vue'
import type { RsToastPosition } from '@ruoshui/ui'
import { RS_TOAST_DEFAULT_POSITION } from '@ruoshui/ui'

/** Playground 全局 RsToaster 配置，供 App.vue 与 ToasterPage 共享 */
export const playgroundToasterPosition = ref<RsToastPosition>(RS_TOAST_DEFAULT_POSITION)
export const playgroundToasterCloseButton = ref(true)
export const playgroundToasterRichColors = ref(false)
