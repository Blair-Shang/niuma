/**
 * 扩展 API 门面 — 插件应通过 niuma.* 访问能力，而非裸 bridge.invoke。
 *
 * @see docs/10-web-extension-system.md
 */

import { bridgeInvoke, bridgeOnEvent } from '@/api/client'

export interface ExtensionContext {
  extensionId: string
  subscriptions: Array<{ dispose(): void }>
}

export type { ExtensionActivateContext } from './create-extension-context'
export { createExtensionActivateContext } from './create-extension-context'

/** 插件 activate(context) 签名 */
export type ExtensionActivateFn = (
  context: import('./create-extension-context').ExtensionActivateContext,
) => void | Promise<void>

export type ExtensionDeactivateFn = () => void | Promise<void>

/**
 * 受控 API — 后续替换为方法白名单，禁止插件直接调用任意 Bridge method。
 */
export function createExtensionApi(extensionId: string) {
  return {
    extensionId,
    invoke: bridgeInvoke,
    onEvent: bridgeOnEvent,
    // P3: commands.register, window.openTab, ...
  }
}

export type ExtensionApi = ReturnType<typeof createExtensionApi>
