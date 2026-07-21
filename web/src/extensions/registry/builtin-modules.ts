import type { ModuleDescriptor } from '../types/module'

/**
 * 第一方内置模块 — 与外部 plugins/ 包在 Registry 中同等注册。
 * 新增内置模块：在此追加一条并创建 web/src/modules/<id>/。
 */
export const builtinModules: ModuleDescriptor[] = [
  {
    id: 'ssh',
    source: 'builtin',
    labelKey: 'nav.ssh',
    icon: 'terminal',
    routePath: '/ssh',
    order: 10,
    category: 'ops',
    load: () => import('@/modules/ssh/views/SshHome.vue'),
  },
  {
    id: 'ftp',
    source: 'builtin',
    labelKey: 'nav.ftp',
    icon: 'ftp',
    routePath: '/ftp',
    order: 15,
    category: 'ops',
    load: () => import('@/modules/ftp/views/FtpHome.vue'),
  },
  {
    id: 'redis',
    source: 'builtin',
    labelKey: 'nav.redis',
    icon: 'redis',
    routePath: '/redis',
    order: 18,
    category: 'ops',
    load: () => import('@/modules/redis/views/RedisHome.vue'),
  },
  {
    id: 'mongodb',
    source: 'builtin',
    labelKey: 'nav.mongodb',
    icon: 'mongodb',
    routePath: '/mongodb',
    order: 19,
    category: 'ops',
    load: () => import('@/modules/mongodb/views/MongoHome.vue'),
  },
  {
    id: 'vastbase',
    source: 'builtin',
    labelKey: 'nav.vastbase',
    icon: 'vastbase',
    routePath: '/vastbase',
    order: 21,
    category: 'data',
    load: () => import('@/modules/vastbase/views/VastHome.vue'),
  },
  {
    id: 'mysql',
    source: 'builtin',
    labelKey: 'nav.mysql',
    icon: 'mysql',
    routePath: '/mysql',
    order: 20,
    category: 'data',
    load: () => import('@/modules/mysql/views/MysqlHome.vue'),
  },
  {
    id: 'database',
    source: 'builtin',
    labelKey: 'nav.database',
    icon: 'database',
    routePath: '/database',
    order: 22,
    category: 'data',
    load: () => import('@/modules/database/views/DbHome.vue'),
  },
  {
    id: 'api',
    source: 'builtin',
    labelKey: 'nav.api',
    icon: 'send',
    routePath: '/api',
    order: 30,
    category: 'devtools',
    load: () => import('@/modules/api-tester/views/ApiHome.vue'),
  },
  // AI 不再是领域模块（不进 Activity Bar / 侧栏 / Tab）；作为全局能力由顶栏机器人按钮
  // 唤起右侧 AiPanel（web/src/shell/AiPanel.vue），任意模块工作时都可并存调用。
]
