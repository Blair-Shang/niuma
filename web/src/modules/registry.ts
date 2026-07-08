/**
 * 模块注册表 — 文档约定路径，重导出 Extension Registry。
 * @see docs/09-web-app-shell.md
 * @see docs/10-web-extension-system.md
 */
export {
  createModuleRoutes,
  getModuleNavItems,
  registerExtensionModule,
  getAllModules,
} from '@/extensions/registry/extension-registry'

export { builtinModules } from '@/extensions/registry/builtin-modules'
