import {
  executeCommand,
  registerCommandHandler,
} from '@/extensions/contributions/command-registry'
import type { ExtensionContext } from '@/extensions/api'
import { useTabStore, type OpenModuleOptions, type OpenTabSpec, type WorkspaceTab } from '@/stores/tab'

/** 命令注册 API，供插件 activate 使用 */
export interface ExtensionCommandsApi {
  /**
   * 绑定 manifest 中已声明的命令 id 到执行函数。
   *
   * @param commandId - contributions.commands[].id
   * @param handler - 执行回调
   */
  register(commandId: string, handler: () => void | Promise<void>): void

  /**
   * 执行已注册命令（可跨插件调用）。
   *
   * @param commandId - 目标命令 id
   * @returns 是否找到并执行
   */
  execute(commandId: string): Promise<boolean>
}

/** 工作区窗口 API：让插件把自己的 UI 以 Tab 形式打开（支持多实例） */
export interface ExtensionWindowApi {
  /**
   * 新开一个 Tab（始终新建实例）。默认 moduleId 为本插件 id。
   *
   * @param spec - Tab 规格；省略 moduleId 时用插件自身模块
   * @returns 新 Tab 的 tabId
   */
  openTab(spec?: Partial<OpenTabSpec>): string

  /**
   * 打开模块：聚焦已有 Tab 或新建。默认 moduleId 为本插件 id。
   *
   * @param moduleId - 目标模块 id，默认插件自身
   * @param options - forceNew / 标题 / props
   * @returns 目标 Tab 的 tabId
   */
  openModule(moduleId?: string, options?: OpenModuleOptions): string

  /**
   * 关闭指定 Tab。
   *
   * @param tabId - 目标 Tab id
   */
  closeTab(tabId: string): void

  /** 当前激活的 Tab（无则 null） */
  getActiveTab(): WorkspaceTab | null
}

/** 扩展 activate 完整上下文 */
export interface ExtensionActivateContext extends ExtensionContext {
  commands: ExtensionCommandsApi
  window: ExtensionWindowApi
}

/**
 * 为插件 entry activate 构建上下文（命令注册/执行 + 工作区窗口）。
 *
 * 注意：内部通过 `useTabStore()` 访问 Pinia store。activate 在 Pinia 已激活后
 * 调用（main.ts 先 `setActivePinia` 再 bootstrap），故组件外调用安全。
 *
 * @param extensionId - manifest.id
 */
export function createExtensionActivateContext(extensionId: string): ExtensionActivateContext {
  const subscriptions: Array<{ dispose(): void }> = []

  return {
    extensionId,
    subscriptions,
    commands: {
      register(commandId, handler) {
        registerCommandHandler(commandId, handler)
      },
      execute(commandId) {
        return executeCommand(commandId)
      },
    },
    window: {
      openTab(spec = {}) {
        return useTabStore().openTab({ ...spec, moduleId: spec.moduleId ?? extensionId })
      },
      openModule(moduleId, options) {
        return useTabStore().openModule(moduleId ?? extensionId, options)
      },
      closeTab(tabId) {
        useTabStore().closeTab(tabId)
      },
      getActiveTab() {
        return useTabStore().activeTab
      },
    },
  }
}
