/**
 * 内置 API 协议懒加载登记。对齐 ops/register-builtin-conn-kinds。
 *
 * 新增协议：
 *   1. 建 http|tcp|udp|websocket 同级目录，写 register.ts
 *   2. 在本文件 LOADERS 追加一行
 *   3. 在 pane-catalog.ts 的 API_PANE_KIND_DEFS 追加 kind
 *
 * 启动只登记 loader；打开 Tab / 切协议才 ensureApiPane。
 */
import { registerApiPaneLoader } from '@/modules/api-tester/layout/pane-kind-loaders'
import type { ApiPaneKind } from '@/modules/api-tester/layout/pane-types'

const LOADERS: Record<ApiPaneKind, () => Promise<void>> = {
  http: () => import('../http/register').then((m) => m.register()),
  tcp: () => import('../tcp/register').then((m) => m.register()),
  udp: () => import('../udp/register').then((m) => m.register()),
  websocket: () => import('../websocket/register').then((m) => m.register()),
}

let registered = false

/** 登记全部协议 loader（不执行模块加载）。 */
export function registerBuiltinApiPaneLoaders(): void {
  if (registered) return
  registered = true
  for (const [kind, load] of Object.entries(LOADERS) as Array<[ApiPaneKind, () => Promise<void>]>) {
    registerApiPaneLoader(kind, load)
  }
}
