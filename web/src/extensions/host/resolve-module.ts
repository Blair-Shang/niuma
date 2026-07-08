/**
 * Tab 工作区的模块组件解析器。
 *
 * 将 `ModuleDescriptor.load`（懒加载函数）转成可被 `<component :is>` 渲染的
 * 组件，并按 moduleId 记忆化——同一模块的多个 Tab 共用同一个 async 组件定义，
 * 配合 `<keep-alive :key="tabId">` 即可为每个 Tab 保活独立实例。
 *
 * @see docs/09-web-app-shell.md 第 6 节「Tab 工作区」
 */
import { defineAsyncComponent, type AsyncComponentLoader, type Component } from 'vue'
import { getModuleById } from '@/extensions/registry/extension-registry'

/** moduleId → 已解析组件，避免重复 defineAsyncComponent（否则会破坏 keep-alive 缓存） */
const componentCache = new Map<string, Component>()

/**
 * 解析模块 id 对应的可渲染组件。
 *
 * @param moduleId - 模块 id（内置或扩展）
 * @returns 组件；模块未注册时返回 null
 */
export function resolveModuleComponent(moduleId: string): Component | null {
  const cached = componentCache.get(moduleId)
  if (cached) {
    return cached
  }

  const descriptor = getModuleById(moduleId)
  if (!descriptor) {
    return null
  }

  const loader = descriptor.load
  // 内置与扩展模块的 load 均为「返回 Promise<组件模块>」的懒加载函数；
  // defineAsyncComponent 会自动解包 { default }。
  // 不设 loadingComponent：chunk 加载期间直接透出 nm-group__body 背景，
  // 无额外占位渲染，配合 connect() 预热可让加载近乎无感知。
  const component =
    typeof loader === 'function'
      ? defineAsyncComponent(loader as AsyncComponentLoader)
      : (loader as Component)

  componentCache.set(moduleId, component)
  return component
}

/** 清空组件缓存（HMR / 单测用）。 */
export function clearModuleComponentCache(): void {
  componentCache.clear()
}
