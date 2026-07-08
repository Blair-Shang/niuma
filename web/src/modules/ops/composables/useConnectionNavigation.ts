import { getModuleById } from '@/extensions/registry/extension-registry'
import { useTabStore } from '@/stores/tab'
import { kindIcon, type ConnItem } from '@/modules/ops/types'

/** 从连接项打开对应模块 Tab（FTP / SSH …） */
export function useConnectionNavigation() {
  const tabStore = useTabStore()

  function connect(item: ConnItem): void {
    // 预热：提前触发模块 chunk 下载，使 defineAsyncComponent 调用时命中缓存，
    // 消除 tab 打开后内容区短暂白屏（loading 占位可见时间趋近于零）。
    const descriptor = getModuleById(item.kind)
    if (descriptor?.load && typeof descriptor.load === 'function') {
      void (descriptor.load as () => Promise<unknown>)()
    }
    tabStore.openTab({
      moduleId: item.kind,
      title: item.profileName,
      icon: kindIcon(item.kind),
      closable: true,
      props: { profileId: item.profileId },
    })
  }

  return { connect }
}
