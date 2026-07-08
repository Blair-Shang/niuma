/**
 * 内置「视图型」Tab —— 不属于任何模块（不进 Activity Bar / SideNav / 插件体系），
 * 但作为一等公民在编辑区以 Tab 形式呈现（可保活、可关闭、可分屏），对齐 VS Code
 * 将「设置」当作编辑器页签打开、而非整页覆盖的行为。
 *
 * 与模块共用 Tab 数据结构：`WorkspaceTab.moduleId` 命中此表时，
 * `ModuleWorkspace` 解析为对应内置组件，`tabStore` 视其为合法 Tab（可持久化恢复）。
 *
 * @see docs/09-web-app-shell.md 第 6 节「Tab 工作区」
 */
import type { AsyncComponentLoader } from 'vue'

/** 设置视图的 Tab moduleId（内部命名空间，避免与真实模块 id 冲突） */
export const SETTINGS_VIEW_ID = 'workbench.view.settings'

/** 内置视图定义（元数据 + 组件懒加载器） */
export interface InternalView {
  id: string
  /** i18n 标题键（随语言切换更新 Tab 标题） */
  titleKey: string
  /** lucide 图标名（Tab 图标） */
  icon: string
  /** 组件懒加载器，供 `defineAsyncComponent` */
  load: AsyncComponentLoader
}

const INTERNAL_VIEWS: Record<string, InternalView> = {
  [SETTINGS_VIEW_ID]: {
    id: SETTINGS_VIEW_ID,
    titleKey: 'nav.settings',
    icon: 'settings',
    load: () => import('@/shell/views/SettingsView.vue'),
  },
}

/** 是否为内置视图 id */
export function isInternalViewId(id: string): boolean {
  return Object.hasOwn(INTERNAL_VIEWS, id)
}

/** 取内置视图定义（未命中返回 undefined） */
export function getInternalView(id: string): InternalView | undefined {
  return INTERNAL_VIEWS[id]
}
