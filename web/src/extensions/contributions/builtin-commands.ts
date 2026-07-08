/**
 * 内置（第一方）命令 — 让 ⌘K 命令面板开箱即用，并示范扩展命令 API 的用法。
 *
 * 命令元数据（标题/图标）写入命令注册表供面板展示，执行器绑定到 Tab 工作区、
 * 设置页与模块导航。标题按当前语言本地化，并在语言切换时重建。
 *
 * @see docs/10-web-extension-system.md 第 5 节「命令与命令面板」
 */
import { watch } from 'vue'
import { i18n } from '@/locale'
import {
  registerCommandContributions,
  registerCommandHandler,
} from '@/extensions/contributions/command-registry'
import { getAllModules } from '@/extensions/registry/extension-registry'
import { useShellStore } from '@/stores/shell'
import { useTabStore } from '@/stores/tab'

/** 内置命令归属的「扩展 id」，与真实插件区分 */
const OWNER = 'workbench'

let installed = false

/** 组合式 i18n 的全局 t（组件外可用） */
function tr(key: string): string {
  return i18n.global.t(key)
}

/** 注册单条命令：同时写入元数据与执行器 */
function register(
  id: string,
  title: string,
  icon: string | undefined,
  handler: () => void | Promise<void>,
): void {
  registerCommandContributions(OWNER, [{ id, title, icon }])
  registerCommandHandler(id, handler)
}

/** 打开设置：作为编辑器 Tab 呈现（VS Code 式），已存在则聚焦 */
function openSettings(): void {
  useTabStore().openSettings()
}

/** 关闭当前激活的可关闭 Tab */
function closeActiveTab(): void {
  const tab = useTabStore().activeTab
  if (tab?.closable) {
    useTabStore().closeTab(tab.tabId)
  }
}

/** 向右拆分编辑器（在激活组右侧新建编辑组） */
function splitEditor(): void {
  useTabStore().splitGroup()
}

/** 切换全局 AI 助手面板 */
function toggleAi(): void {
  useShellStore().toggleAiPanel()
}

/**
 * 按当前语言注册/刷新全部内置命令。
 * 命令注册表以 id 去重，重复调用会覆盖旧标题，故可安全地在语言切换时重跑。
 */
function registerAll(): void {
  register('workbench.settings.open', tr('command.openSettings'), 'settings', openSettings)
  register('workbench.tab.close', tr('command.closeActiveTab'), 'x', closeActiveTab)
  register('workbench.editor.split', tr('command.splitEditor'), 'columns-2', splitEditor)
  register('workbench.ai.toggle', tr('command.toggleAi'), 'bot', toggleAi)

  // 为每个模块（内置 + 已注册扩展）生成「打开模块」命令
  for (const module of getAllModules()) {
    register(
      `workbench.open.${module.id}`,
      `${tr('command.openModule')}: ${tr(module.labelKey)}`,
      module.icon,
      () => {
        useTabStore().openModule(module.id)
      },
    )
  }
}

/**
 * 注册内置命令，并在语言切换时按新语言重建标题。
 * 仅需调用一次（main.ts 于 bootstrapExtensions 之后调用，此时扩展模块已就绪）。
 */
export function registerBuiltinCommands(): void {
  if (installed) {
    return
  }
  installed = true
  registerAll()
  watch(() => i18n.global.locale.value, registerAll)
}
