import type { Component, ShallowRef } from 'vue'
import { shallowRef } from 'vue'
import type { RsContextMenuItem } from '@niuma/ui'
import type { ConnItem } from '@/modules/ops/types'
import type { ConnResourceDescriptor, ConnResourcePath } from '@/modules/ops/conn-tree/types'

/** 各连接类型向运维树贡献懒加载子节点的 Provider。 */
export interface ConnTreeChildProvider {
  canExpand(conn: ConnItem): boolean
  loadChildren(
    conn: ConnItem,
    parentPath?: ConnResourcePath,
    opts?: { filter?: string },
  ): Promise<ConnResourceDescriptor[]>
  activate?(conn: ConnItem, path: ConnResourcePath): void
  /** 连接节点扩展菜单；`conn-refresh` 由面板统一拦截，无需实现。 */
  connMenuItems?(conn: ConnItem): RsContextMenuItem[]
  /** 处理连接节点扩展菜单；返回 true 表示已消费。 */
  onConnMenuSelect?(conn: ConnItem, key: string): boolean
  /** 资源节点右键菜单项；返回空数组或 undefined 表示无菜单。 */
  resourceMenuItems?(conn: ConnItem, path: ConnResourcePath): RsContextMenuItem[]
  /** 处理资源节点右键菜单点击（"refresh" / "resource-refresh" 由面板统一拦截，无需实现）。 */
  onResourceMenuSelect?(conn: ConnItem, path: ConnResourcePath, key: string): void
}

const _registry: Record<string, ConnTreeChildProvider> = {}

/**
 * Provider 注册世代：懒加载 `registerConnTreeProvider` 后递增，
 * 供右键菜单等依赖 Provider 的计算在同一帧内拿到完整 items。
 */
const _registryEpoch: ShallowRef<number> = shallowRef(0)

/**
 * 协议侧树操作宿主（确认框 / DDL 对话框等），与 Provider 同生命周期；
 * 面板只负责挂载，不写协议逻辑。
 * 使用 shallowRef：`ensureConnKind` 懒注册后，OpsConnectionPanel 可自动挂上新宿主。
 */
const _actionHosts: ShallowRef<Component[]> = shallowRef([])

/** 登记某种连接协议的树子节点 Provider。 */
export function registerConnTreeProvider(kind: string, provider: ConnTreeChildProvider): void {
  _registry[kind] = provider
  _registryEpoch.value += 1
}

/** 查询已登记的树 Provider；未加载或未声明树的 kind 返回 undefined。 */
export function getConnTreeProvider(kind: string): ConnTreeChildProvider | undefined {
  return _registry[kind]
}

/** 响应式世代号；菜单构建时读取以在懒注册后刷新 items。 */
export function useConnTreeRegistryEpoch(): ShallowRef<number> {
  return _registryEpoch
}

/** 登记协议树操作宿主组件（如 Vastbase DDL ActionHost）；重复登记同一引用会被忽略。 */
export function registerConnTreeActionHost(host: Component): void {
  if (_actionHosts.value.includes(host)) return
  _actionHosts.value = [..._actionHosts.value, host]
}

/**
 * 响应式宿主列表（OpsConnectionPanel 直接绑定）。
 * 懒注册后列表变更会触发面板重新渲染挂载点。
 */
export function useConnTreeActionHosts(): ShallowRef<readonly Component[]> {
  return _actionHosts
}

/** 非响应式快照（测试 / 非 Vue 上下文）。 */
export function listConnTreeActionHosts(): readonly Component[] {
  return _actionHosts.value
}
