/**
 * **L3：连接导航编排** — 连接树 / Provider → Tab Store。
 *
 * 本 composable 只做编排，协议差异在 `connection-nav` 策略注册表：
 *
 * ```
 * connect(item, ctx)
 *   → getConnectionNavStrategy(item.kind)
 *   → strategy.buildTabSpec(item, ctx)
 *   → [dedupFocus] strategy.findExistingTab → activateTab
 *   → tabStore.openTab(spec)
 * ```
 *
 * **不调用** `session.open/close`（L4 Session Registry，见 docs/21）。
 *
 * @see web/src/modules/ops/conn-nav-providers.ts 内置注册
 * @see docs/18-ops-connection-tree.md §7
 */
import { getModuleById } from '@/extensions/registry/extension-registry'
import {
  getConnectionNavStrategy,
  type ConnectionNavConnectOptions,
} from '@/modules/ops/connection-nav'
import type { ConnOpenContext } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import { useTabStore } from '@/stores/tab'

export type { ConnectionNavConnectOptions as ConnectOptions }

export function useConnectionNavigation() {
  const tabStore = useTabStore()

  /**
   * 从连接项打开对应模块 Tab。
   *
   * @param item - 侧栏连接叶节点
   * @param ctx - 资源子节点上下文（Redis DB、Mongo 库表等）
   * @param options.forceNew - 跳过去重，始终新建 Tab
   */
  function connect(item: ConnItem, ctx?: ConnOpenContext, options?: ConnectionNavConnectOptions): void {
    const descriptor = getModuleById(item.kind)
    if (descriptor?.load && typeof descriptor.load === 'function') {
      void (descriptor.load as () => Promise<unknown>)()
    }

    const strategy = getConnectionNavStrategy(item.kind)
    const spec = strategy.buildTabSpec(item, ctx)

    const shouldTryDedup = strategy.dedupFocus && !options?.forceNew
    if (shouldTryDedup && strategy.findExistingTab) {
      const existing = strategy.findExistingTab(tabStore.allTabs, spec, item, ctx)
      if (existing) {
        tabStore.activateTab(existing.tabId)
        return
      }
    }

    tabStore.openTab({
      moduleId: spec.moduleId,
      title: spec.title,
      icon: spec.icon,
      closable: true,
      props: spec.props,
    })
  }

  return { connect }
}
