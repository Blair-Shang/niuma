/**
 * 内置连接协议懒加载登记。
 *
 * 新增协议步骤：
 *   1. 在 modules/<kind>/ 实现 connection-form-adapter /（可选）树与导航
 *   2. 新增 register-conn-form.ts（对话框）与 register-conn-full.ts（完整）
 *   3. 在本文件 BUILTIN_CONN_KIND_LOADERS 追加一行
 *   4. 在 ops/types.ts 的 CONN_KIND_DEFS 追加 kind
 *
 * 启动时只登记 loader；新建/编辑走 loadForm，展开树/导航走 load。
 */
import { registerConnKindLoader } from '@/modules/ops/conn-kind-loaders'
import type { ConnKind } from '@/modules/ops/types'

const BUILTIN_CONN_KIND_LOADERS: Record<
  ConnKind,
  { loadForm: () => Promise<void>; load: () => Promise<void>; tree: boolean }
> = {
  ssh: {
    tree: false,
    loadForm: () => import('@/modules/ssh/register-conn-form').then((m) => m.registerForm()),
    load: () => import('@/modules/ssh/register-conn-full').then((m) => m.registerFull()),
  },
  sftp: {
    tree: false,
    loadForm: () => import('@/modules/sftp/register-conn-form').then((m) => m.registerForm()),
    load: () => import('@/modules/sftp/register-conn-full').then((m) => m.registerFull()),
  },
  ftp: {
    tree: false,
    loadForm: () => import('@/modules/ftp/register-conn-form').then((m) => m.registerForm()),
    load: () => import('@/modules/ftp/register-conn-full').then((m) => m.registerFull()),
  },
  redis: {
    tree: true,
    loadForm: () => import('@/modules/redis/register-conn-form').then((m) => m.registerForm()),
    load: () => import('@/modules/redis/register-conn-full').then((m) => m.registerFull()),
  },
  mongodb: {
    tree: true,
    loadForm: () => import('@/modules/mongodb/register-conn-form').then((m) => m.registerForm()),
    load: () => import('@/modules/mongodb/register-conn-full').then((m) => m.registerFull()),
  },
  vastbase: {
    tree: true,
    loadForm: () => import('@/modules/vastbase/register-conn-form').then((m) => m.registerForm()),
    load: () => import('@/modules/vastbase/register-conn-full').then((m) => m.registerFull()),
  },
  mysql: {
    tree: true,
    loadForm: () => import('@/modules/mysql/register-conn-form').then((m) => m.registerForm()),
    load: () => import('@/modules/mysql/register-conn-full').then((m) => m.registerFull()),
  },
  sqlite: {
    tree: true,
    loadForm: () => import('@/modules/sqlite/register-conn-form').then((m) => m.registerForm()),
    load: () => import('@/modules/sqlite/register-conn-full').then((m) => m.registerFull()),
  },
  dameng: {
    tree: true,
    loadForm: () => import('@/modules/dameng/register-conn-form').then((m) => m.registerForm()),
    load: () => import('@/modules/dameng/register-conn-full').then((m) => m.registerFull()),
  },
  oracle: {
    tree: true,
    loadForm: () => import('@/modules/oracle/register-conn-form').then((m) => m.registerForm()),
    load: () => import('@/modules/oracle/register-conn-full').then((m) => m.registerFull()),
  },
  clickhouse: {
    tree: true,
    loadForm: () => import('@/modules/clickhouse/register-conn-form').then((m) => m.registerForm()),
    load: () => import('@/modules/clickhouse/register-conn-full').then((m) => m.registerFull()),
  },
  kingbase: {
    tree: true,
    loadForm: () => import('@/modules/kingbase/register-conn-form').then((m) => m.registerForm()),
    load: () => import('@/modules/kingbase/register-conn-full').then((m) => m.registerFull()),
  },
  sqlserver: {
    tree: true,
    loadForm: () => import('@/modules/sqlserver/register-conn-form').then((m) => m.registerForm()),
    load: () => import('@/modules/sqlserver/register-conn-full').then((m) => m.registerFull()),
  },
  postgres: {
    tree: true,
    loadForm: () => import('@/modules/postgres/register-conn-form').then((m) => m.registerForm()),
    load: () => import('@/modules/postgres/register-conn-full').then((m) => m.registerFull()),
  },
}

/** 登记全部内置协议 loader（不执行模块加载）。 */
export function registerBuiltinConnKindLoaders(): void {
  for (const [kind, entry] of Object.entries(BUILTIN_CONN_KIND_LOADERS) as Array<
    [ConnKind, (typeof BUILTIN_CONN_KIND_LOADERS)[ConnKind]]
  >) {
    registerConnKindLoader(kind, entry)
  }
}
